import {
  prisma,
  getSettings,
  logger,
  monthToDateSpendUsd,
  claimNextKeyword,
  decidePacing,
  listAutopilotSites,
  loadSiteThroughput,
  reclaimStaleKeywords,
  rollingWindowStart,
  PIPELINE_EVENTS,
  TickRequestedDataSchema,
  type PacingDecision,
} from '@scribe/core';
import { inngest } from '../inngest/client';

/**
 * The autopilot heartbeat.
 *
 * The cron is FIXED because Inngest cron strings are static in the function
 * definition and only take effect on re-registration. Every policy question —
 * how many articles a week, how far apart, within which hours, how big a review
 * backlog to tolerate — is answered from Settings on each run, so the dashboard
 * controls behaviour without a deploy or a restart.
 *
 * The function itself stays deliberately thin: all the arithmetic lives in the
 * pure `decidePacing` (packages/core/src/pipeline/pacing.ts), which is where
 * the tests are.
 *
 * `retries: 0` is correct here — the next tick in 15 minutes IS the retry, and
 * a retried tick would re-read state that has already moved on.
 */
export const PIPELINE_TICK_CONFIG = {
  id: 'pipeline-tick',
  name: 'Autopilot tick',
  retries: 0,
  concurrency: { limit: 1 },
} as const;

export const pipelineTick = inngest.createFunction(
  PIPELINE_TICK_CONFIG,
  [{ cron: '*/15 * * * *' }, { event: PIPELINE_EVENTS.tickRequested }],
  async ({ event, step, runId }) => {
    // Event payloads are external input even when we emitted them (§10.1.5).
    const requested =
      event?.name === PIPELINE_EVENTS.tickRequested
        ? TickRequestedDataSchema.parse(event.data)
        : null;

    const settings = await step.run('load-settings', () => getSettings(prisma));
    if (!settings.autopilot_enabled) {
      return { skipped: 'autopilot_enabled is false' };
    }

    // Return claims orphaned by a crashed worker before deciding anything, or
    // their keywords would be invisible to the queue count below.
    const reclaimed = await step.run('reclaim-stale-claims', () =>
      reclaimStaleKeywords(prisma, settings.autopilot_stale_claim_minutes),
    );

    // Stop BEFORE claiming rather than after paying. assertWithinBudget is a
    // soft pre-check, so without a reserve the autopilot would consume the last
    // dollar and leave the human no headroom to fix or regenerate a draft.
    const budget = await step.run('check-budget-reserve', async () => {
      if (settings.monthly_budget_usd <= 0) return { stop: false, spent: 0, stopAt: 0 };
      const spent = await monthToDateSpendUsd(prisma);
      const stopAt = settings.monthly_budget_usd * (1 - settings.autopilot_budget_reserve_pct / 100);
      return { stop: spent >= stopAt, spent, stopAt };
    });
    if (budget.stop) {
      logger.warn(budget, 'autopilot paused: monthly budget reserve reached');
      return { skipped: 'budget_reserve_reached', reclaimed, ...budget };
    }

    const sites = await step.run('list-sites', async () => {
      const all = await listAutopilotSites(prisma);
      return requested?.siteId ? all.filter((site) => site.id === requested.siteId) : all;
    });
    if (sites.length === 0) {
      return { skipped: 'no eligible sites', reclaimed };
    }

    const throughput = await step.run('load-throughput', async () => {
      const map = await loadSiteThroughput(
        prisma,
        sites.map((site) => site.id),
        rollingWindowStart(new Date()),
      );
      // step.run output must be JSON-serializable, so hand back an array.
      return [...map.values()].map((entry) => ({
        ...entry,
        lastArticleAt: entry.lastArticleAt?.toISOString() ?? null,
      }));
    });

    const results: Array<{ siteId: string; name: string; reason: string; claimed?: string }> = [];

    for (const site of sites) {
      const stats = throughput.find((entry) => entry.siteId === site.id);
      if (!stats) continue;

      const decision: PacingDecision = decidePacing(
        {
          articlesPerWeek: site.articlesPerWeek ?? settings.autopilot_articles_per_week,
          maxUnreviewed: settings.autopilot_max_unreviewed,
          minSpacingMinutes: settings.autopilot_min_spacing_minutes,
          runWindow: settings.autopilot_run_window,
        },
        {
          now: new Date(),
          articlesInWindow: stats.articlesInWindow,
          lastArticleAt: stats.lastArticleAt ? new Date(stats.lastArticleAt) : null,
          unreviewed: stats.unreviewed,
          queuedKeywords: stats.queuedKeywords,
        },
      );

      // Top the queue up on demand. discovery-run is rate-limited per site, so
      // this cannot pay for discovery twice in a day however often it fires.
      if (stats.queuedKeywords < settings.autopilot_keyword_buffer_low_water) {
        await step.sendEvent(`request-discovery-${site.id}`, {
          name: PIPELINE_EVENTS.discoveryRequested,
          data: { siteId: site.id, reason: 'buffer_low' as const },
        });
      }

      if (decision.slots === 0) {
        results.push({ siteId: site.id, name: site.name, reason: decision.reason });
        continue;
      }

      // One claim per site per tick. The cap is structural, not incidental: it
      // bounds worst-case budget overshoot to a single article.
      const claimed = await step.run(`claim-${site.id}`, () => claimNextKeyword(prisma, site.id));
      if (!claimed) {
        results.push({ siteId: site.id, name: site.name, reason: 'no_queued_keywords' });
        continue;
      }

      await step.sendEvent(`dispatch-${site.id}`, {
        name: PIPELINE_EVENTS.keywordClaimed,
        data: {
          siteId: site.id,
          keywordId: claimed.id,
          term: claimed.term,
          source: claimed.source,
          claimedAt: new Date().toISOString(),
          tickId: runId,
        },
      });

      results.push({ siteId: site.id, name: site.name, reason: 'ok', claimed: claimed.term });
    }

    // Returned verbatim so the Inngest dev UI explains an idle autopilot
    // instead of looking broken.
    return { reclaimed, sites: sites.length, results };
  },
);
