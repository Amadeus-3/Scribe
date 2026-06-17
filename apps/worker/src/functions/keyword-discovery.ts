import { prisma, getSettings, runSiteDiscovery, SYSTEM_ACTOR, logger } from '@scribe/core';
import { inngest } from '../inngest/client';

/**
 * Weekly trending-topic discovery (opt-in). It is OFF unless the global
 * `discovery_cron_enabled` setting is true, and only runs for ACTIVE sites that
 * have `discoveryEnabled`. Runs as SYSTEM_ACTOR so the audit log attributes it
 * to the system (actorType 'system'), never a human. Per-site failures are
 * isolated. Discovery only enqueues QUEUED keywords — it never drafts/publishes.
 */
export const weeklyKeywordDiscovery = inngest.createFunction(
  { id: 'discovery-weekly', name: 'Weekly trending-topic discovery' },
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

    const results: Array<Record<string, unknown>> = [];
    for (const site of sites) {
      const result = await step.run(`discover-${site.id}`, async () => {
        try {
          const res = await runSiteDiscovery(prisma, SYSTEM_ACTOR, site.id);
          return { siteId: site.id, created: res.created, skipped: res.skipped };
        } catch (e) {
          logger.warn(
            { siteId: site.id, error: e instanceof Error ? e.message : 'unknown' },
            'weekly discovery failed',
          );
          return { siteId: site.id, failed: true };
        }
      });
      results.push(result);
    }

    return { sites: sites.length, results };
  },
);
