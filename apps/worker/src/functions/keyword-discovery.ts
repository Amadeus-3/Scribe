import {
  prisma,
  getSettings,
  runSiteDiscovery,
  SYSTEM_ACTOR,
  logger,
  DiscoveryRequestedDataSchema,
  PIPELINE_EVENTS,
} from '@scribe/core';
import { inngest } from '../inngest/client';

/**
 * Weekly trending-topic discovery (opt-in). It is OFF unless the global
 * `discovery_cron_enabled` setting is true, and only runs for ACTIVE sites that
 * have `discoveryEnabled`.
 *
 * The cron only REQUESTS discovery; `discoveryRun` below does the work. One
 * code path means one place for flow control, and the autopilot tick reuses it
 * to top up a site whose keyword buffer has run low.
 */
export const WEEKLY_DISCOVERY_CONFIG = {
  id: 'discovery-weekly',
  name: 'Weekly trending-topic discovery',
} as const;

export const weeklyKeywordDiscovery = inngest.createFunction(
  WEEKLY_DISCOVERY_CONFIG,
  { cron: '0 9 * * 1' },
  async ({ step }) => {
    const enabled = await step.run('check-enabled', async () => {
      const settings = await getSettings(prisma);
      return settings.discovery_cron_enabled;
    });
    if (!enabled) {
      return { skipped: 'discovery_cron_enabled is false' };
    }

    const sites = await step.run('list-sites', () =>
      prisma.site.findMany({
        where: { status: 'ACTIVE', discoveryEnabled: true },
        select: { id: true },
      }),
    );

    if (sites.length > 0) {
      await step.sendEvent(
        'request-discovery',
        sites.map((site) => ({
          name: PIPELINE_EVENTS.discoveryRequested,
          data: { siteId: site.id, reason: 'weekly_cron' as const },
        })),
      );
    }

    return { sites: sites.length };
  },
);

/**
 * Run discovery for one site. Runs as SYSTEM_ACTOR so the audit log attributes
 * it to the system (actorType 'system', null actorId), never a human.
 *
 * Discovery only enqueues QUEUED keywords — it never drafts or publishes. The
 * autopilot tick is what turns a queued keyword into a draft.
 *
 * The per-site rate limit is the reason this is a separate function: the weekly
 * cron and a buffer-low tick can both ask for the same site on the same day,
 * and discovery costs money.
 */
export const DISCOVERY_RUN_CONFIG = {
  id: 'discovery-run',
  name: 'Run keyword discovery for a site',
  retries: 1,
  rateLimit: { limit: 1, period: '24h', key: 'event.data.siteId' },
} as const;

export const discoveryRun = inngest.createFunction(
  DISCOVERY_RUN_CONFIG,
  { event: PIPELINE_EVENTS.discoveryRequested },
  async ({ event, step }) => {
    const data = DiscoveryRequestedDataSchema.parse(event.data);

    return step.run(`discover-${data.siteId}`, async () => {
      try {
        const result = await runSiteDiscovery(prisma, SYSTEM_ACTOR, data.siteId);
        return { siteId: data.siteId, created: result.created, skipped: result.skipped };
      } catch (e) {
        // Isolated: a failing site must not stop the others, and discovery
        // failing is never a reason to hold up the pipeline.
        logger.warn(
          {
            siteId: data.siteId,
            reason: data.reason,
            error: e instanceof Error ? e.message : 'unknown',
          },
          'site discovery failed',
        );
        return { siteId: data.siteId, failed: true };
      }
    });
  },
);
