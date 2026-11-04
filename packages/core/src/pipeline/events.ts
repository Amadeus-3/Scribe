import { z } from 'zod';

/**
 * Pipeline event contracts.
 *
 * Zod only — this module must never import `inngest`, so `packages/core` stays
 * free of transport concerns (CLAUDE.md: no framework imports). The worker and
 * the dashboard build their Inngest clients from these schemas.
 *
 * IMPORTANT: Inngest's `EventSchemas` gives COMPILE-TIME types only; it does
 * not validate `event.data` at runtime. An event payload is external input
 * (Spec §10.1.5), so every handler must `.parse(event.data)` as its first step.
 */
export const PIPELINE_EVENTS = {
  keywordClaimed: 'scribe/keyword.claimed',
  articleDrafted: 'scribe/article.drafted',
  discoveryRequested: 'scribe/discovery.requested',
  tickRequested: 'scribe/pipeline.tick.requested',
  /** Named exactly as Spec §10.1.1 names it. */
  articleApproved: 'article.approved',
} as const;

export const KeywordClaimedDataSchema = z.object({
  siteId: z.string().min(1),
  keywordId: z.string().min(1),
  term: z.string().min(1),
  source: z.string().nullable(),
  claimedAt: z.string().datetime(),
  /** Correlates every claim emitted by one tick run. */
  tickId: z.string().min(1),
});
export type KeywordClaimedData = z.infer<typeof KeywordClaimedDataSchema>;

export const EnrichmentOutcomeSchema = z.enum(['ok', 'skipped', 'failed']);

export const ArticleDraftedDataSchema = z.object({
  siteId: z.string().min(1),
  articleId: z.string().min(1),
  keywordId: z.string().min(1),
  title: z.string().nullable(),
  wordCount: z.number().int().nonnegative().nullable(),
  seoScore: z.number().nullable(),
  enrichment: z.object({
    heroImage: EnrichmentOutcomeSchema,
    inlineImages: z.object({
      ok: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
    taxonomy: EnrichmentOutcomeSchema,
  }),
});
export type ArticleDraftedData = z.infer<typeof ArticleDraftedDataSchema>;

export const DiscoveryRequestedDataSchema = z.object({
  siteId: z.string().min(1),
  reason: z.enum(['buffer_low', 'weekly_cron', 'manual']),
});
export type DiscoveryRequestedData = z.infer<typeof DiscoveryRequestedDataSchema>;

export const TickRequestedDataSchema = z.object({
  /** Omitted means every autopilot-enabled site. */
  siteId: z.string().min(1).optional(),
  /** Who asked for the manual run; null for the cron. Never an authorization. */
  actorId: z.string().min(1).nullable(),
});
export type TickRequestedData = z.infer<typeof TickRequestedDataSchema>;

/**
 * A human approved an article (Spec §10.1.1). Consumed by the publish worker.
 *
 * `actorId` is a CLAIM and is treated as untrusted: anyone who can reach the
 * event API can put any string there. `reviewId` is the load-bearing field —
 * it points at a Review row whose `reviewerId` is a foreign key to `User.id`,
 * written only behind an authenticated session. The publish step re-verifies
 * both against the database before touching the CMS.
 */
export const ArticleApprovedDataSchema = z.object({
  articleId: z.string().min(1),
  siteId: z.string().min(1),
  actorId: z.string().min(1),
  reviewId: z.string().min(1),
  /** Article.currentVersion at approval time; scopes the idempotency key. */
  version: z.number().int().nonnegative(),
  approvedAt: z.string().datetime(),
});
export type ArticleApprovedData = z.infer<typeof ArticleApprovedDataSchema>;
