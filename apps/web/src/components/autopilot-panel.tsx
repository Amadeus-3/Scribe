import {
  prisma,
  decidePacing,
  getSettings,
  listAutopilotSites,
  listAutopilotSitesBlockedOnStyleGuide,
  loadSiteThroughput,
  rollingWindowStart,
  type PacingDecision,
} from '@scribe/core';
import { Card, Badge } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { runAutopilotNowAction } from '@/server/actions';

/**
 * What the autopilot is doing, and why it is not doing anything.
 *
 * The whole point: a cron that silently does nothing is indistinguishable from
 * a broken one. This runs the same pure `decidePacing` the tick runs, so the
 * reason shown here is the reason the tick will act on.
 */

const REASON_LABEL: Record<PacingDecision['reason'], string> = {
  ok: 'Drafting next tick',
  paused: 'Paused (0 per week)',
  outside_run_window: 'Outside the run window',
  weekly_target_met: 'Weekly target met',
  unreviewed_backlog_full: 'Waiting on your review',
  spacing_not_elapsed: 'Waiting for the next slot',
  no_queued_keywords: 'No keywords queued',
};

function formatWhen(date: Date | null): string {
  if (!date) return '—';
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export async function AutopilotPanel({ canRun }: { canRun: boolean }) {
  const settings = await getSettings(prisma);
  const [sites, blocked] = await Promise.all([
    listAutopilotSites(prisma),
    listAutopilotSitesBlockedOnStyleGuide(prisma),
  ]);

  const throughput = await loadSiteThroughput(
    prisma,
    sites.map((site) => site.id),
    rollingWindowStart(new Date()),
  );

  const rows = sites.map((site) => {
    const stats = throughput.get(site.id);
    const target = site.articlesPerWeek ?? settings.autopilot_articles_per_week;
    const decision = decidePacing(
      {
        articlesPerWeek: target,
        maxUnreviewed: settings.autopilot_max_unreviewed,
        minSpacingMinutes: settings.autopilot_min_spacing_minutes,
        runWindow: settings.autopilot_run_window,
      },
      {
        now: new Date(),
        articlesInWindow: stats?.articlesInWindow ?? 0,
        lastArticleAt: stats?.lastArticleAt ?? null,
        unreviewed: stats?.unreviewed ?? 0,
        queuedKeywords: stats?.queuedKeywords ?? 0,
      },
    );
    return { site, target, stats, decision };
  });

  return (
    <Card
      title="Autopilot"
      description="Discovers topics and drafts complete articles. Nothing publishes until you approve it."
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">Status</span>
        <Badge tone={settings.autopilot_enabled ? 'ok' : 'muted'}>
          {settings.autopilot_enabled ? 'enabled' : 'off'}
        </Badge>
      </div>

      {!settings.autopilot_enabled ? (
        <p className="mt-2 text-sm text-muted">
          Turn it on in Settings, then opt in each site you want drafted.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No sites opted in yet. Enable autopilot on a site to start.
        </p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {rows.map(({ site, target, stats, decision }) => (
            <li key={site.id} className="rounded-md border border-border bg-panel-2 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{site.name}</span>
                <Badge tone={decision.slots === 1 ? 'ok' : 'muted'}>
                  {REASON_LABEL[decision.reason]}
                </Badge>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted">
                <span>
                  This week: {stats?.articlesInWindow ?? 0} / {target}
                </span>
                <span>
                  Awaiting review: {stats?.unreviewed ?? 0}
                  {settings.autopilot_max_unreviewed > 0
                    ? ` / ${settings.autopilot_max_unreviewed}`
                    : ''}
                </span>
                <span>Keywords queued: {stats?.queuedKeywords ?? 0}</span>
                <span>Next slot: {formatWhen(decision.detail.nextEligibleAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {blocked.length > 0 ? (
        <p className="mt-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-xs text-muted">
          Blocked, needs a style guide: {blocked.map((site) => site.name).join(', ')}
        </p>
      ) : null}

      {canRun && settings.autopilot_enabled ? (
        <ActionForm
          action={runAutopilotNowAction}
          submitLabel="Run now"
          submitVariant="secondary"
          className="mt-3 border-t border-border pt-3"
        >
          <input type="hidden" name="siteId" value="" />
        </ActionForm>
      ) : null}
    </Card>
  );
}
