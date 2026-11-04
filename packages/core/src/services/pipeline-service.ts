import { Prisma, type PrismaClient } from '@prisma/client';
import { recordAudit } from '../audit/audit-log';
import { auditActorFields } from '../auth/system-actor';
import { parseSeoReport } from '../seo/seo-report';
import type { DigestArticle } from '../notify/review-digest';
import type { Actor } from '../auth/authorize';

/**
 * Database side of the autopilot: which sites are eligible, how much they have
 * produced, and the atomic keyword claim.
 *
 * The pacing DECISION is pure and lives in pipeline/pacing.ts; this module only
 * supplies its inputs and executes its outcome.
 */

export interface AutopilotSite {
  id: string;
  name: string;
  /** Per-site override; null inherits the global setting. */
  articlesPerWeek: number | null;
}

/**
 * Sites the autopilot may draft for.
 *
 * The style-guide requirement lives HERE rather than in the draft function on
 * purpose. `generateArticleDraft` hard-throws without a style guide, so a site
 * missing one would have its keyword claimed, fail, release, and be re-claimed
 * by the next tick — forever, 96 times a day. Never claim what you cannot
 * draft. The dashboard surfaces the missing style guide so the silence is
 * explained rather than mysterious.
 */
export async function listAutopilotSites(db: PrismaClient): Promise<AutopilotSite[]> {
  const sites = await db.site.findMany({
    where: { status: 'ACTIVE', autopilotEnabled: true, styleGuide: { isNot: null } },
    select: { id: true, name: true, autopilotArticlesPerWeek: true },
    orderBy: { createdAt: 'asc' },
  });
  return sites.map((site) => ({
    id: site.id,
    name: site.name,
    articlesPerWeek: site.autopilotArticlesPerWeek,
  }));
}

/** Autopilot-enabled sites blocked purely by a missing style guide. */
export async function listAutopilotSitesBlockedOnStyleGuide(
  db: PrismaClient,
): Promise<Array<{ id: string; name: string }>> {
  return db.site.findMany({
    where: { status: 'ACTIVE', autopilotEnabled: true, styleGuide: { is: null } },
    select: { id: true, name: true },
  });
}

export interface SiteThroughput {
  siteId: string;
  articlesInWindow: number;
  lastArticleAt: Date | null;
  unreviewed: number;
  queuedKeywords: number;
}

/**
 * Load pacing inputs for many sites in a fixed number of queries.
 *
 * Four grouped queries rather than four per site: the tick runs every 15
 * minutes and is mostly a no-op, so it must stay cheap when idle.
 *
 * `lastArticleAt` is deliberately a SEPARATE, unwindowed query — the newest
 * article can predate the rolling window, and spacing must still measure from
 * it.
 */
export async function loadSiteThroughput(
  db: PrismaClient,
  siteIds: string[],
  windowStart: Date,
): Promise<Map<string, SiteThroughput>> {
  const result = new Map<string, SiteThroughput>();
  if (siteIds.length === 0) return result;

  for (const siteId of siteIds) {
    result.set(siteId, {
      siteId,
      articlesInWindow: 0,
      lastArticleAt: null,
      unreviewed: 0,
      queuedKeywords: 0,
    });
  }

  const [inWindow, newest, unreviewed, queued] = await Promise.all([
    db.article.groupBy({
      by: ['siteId'],
      where: { siteId: { in: siteIds }, createdAt: { gte: windowStart } },
      _count: { _all: true },
    }),
    db.article.groupBy({
      by: ['siteId'],
      where: { siteId: { in: siteIds } },
      _max: { createdAt: true },
    }),
    // Both statuses are unreviewed human work. Capping only PENDING_REVIEW
    // would let an ignored changes-requested pile grow without ever throttling.
    db.article.groupBy({
      by: ['siteId'],
      where: { siteId: { in: siteIds }, status: { in: ['PENDING_REVIEW', 'CHANGES_REQUESTED'] } },
      _count: { _all: true },
    }),
    db.keyword.groupBy({
      by: ['siteId'],
      where: { siteId: { in: siteIds }, status: 'QUEUED', article: { is: null } },
      _count: { _all: true },
    }),
  ]);

  for (const row of inWindow) {
    const entry = result.get(row.siteId);
    if (entry) entry.articlesInWindow = row._count._all;
  }
  for (const row of newest) {
    const entry = result.get(row.siteId);
    if (entry) entry.lastArticleAt = row._max.createdAt;
  }
  for (const row of unreviewed) {
    const entry = result.get(row.siteId);
    if (entry) entry.unreviewed = row._count._all;
  }
  for (const row of queued) {
    const entry = result.get(row.siteId);
    if (entry) entry.queuedKeywords = row._count._all;
  }

  return result;
}

export interface ClaimedKeyword {
  id: string;
  term: string;
  siteId: string;
  source: string | null;
}

/**
 * Atomically move ONE eligible QUEUED keyword to IN_PROGRESS and return it.
 *
 * This is the only thing that truly prevents the same keyword being drafted
 * twice; everything else (Inngest idempotency, the Article.keywordId unique
 * constraint) is a backstop layered on top.
 *
 * Raw SQL is justified here because database-level atomicity IS the behaviour:
 * `FOR UPDATE SKIP LOCKED` makes concurrent ticks select DIFFERENT rows instead
 * of racing for the same one, and Prisma's `updateMany` cannot express
 * RETURNING over a locked subselect. The NOT EXISTS guard means a keyword that
 * somehow already produced an article is never handed out again.
 */
export async function claimNextKeyword(
  db: PrismaClient,
  siteId: string,
): Promise<ClaimedKeyword | null> {
  const rows = await db.$queryRaw<ClaimedKeyword[]>(Prisma.sql`
    UPDATE "Keyword" k
       SET status = 'IN_PROGRESS'::"KeywordStatus",
           "claimedAt" = NOW()
     WHERE k.id = (
       SELECT c.id
         FROM "Keyword" c
        WHERE c."siteId" = ${siteId}
          AND c.status = 'QUEUED'::"KeywordStatus"
          AND NOT EXISTS (SELECT 1 FROM "Article" a WHERE a."keywordId" = c.id)
        ORDER BY c.priority DESC,
                 c."discoveryScore" DESC NULLS LAST,
                 c."sourcedAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING k.id, k.term, k."siteId", k.source
  `);
  return rows[0] ?? null;
}

/**
 * Release a claim.
 *
 * The `status: 'IN_PROGRESS'` predicate is load-bearing, not defensive noise.
 * On a successful draft `createDraftRecords` has already set the keyword to
 * DONE; without this compare-and-set a late failure handler would flip a DONE
 * keyword back to QUEUED and the article would be drafted a second time.
 *
 * Returns true when a claim was actually released.
 */
export async function releaseKeyword(
  db: PrismaClient,
  keywordId: string,
  to: 'QUEUED' | 'SKIPPED',
): Promise<boolean> {
  const result = await db.keyword.updateMany({
    where: { id: keywordId, status: 'IN_PROGRESS' },
    data: { status: to, claimedAt: null },
  });
  return result.count === 1;
}

/**
 * Return claims orphaned by a crashed worker to the queue.
 *
 * Keyword has no `updatedAt`, which is why `claimedAt` exists: without a
 * timestamp set at claim time, an interrupted run would leave a keyword in
 * IN_PROGRESS with no way to tell how long it had been there.
 */
export async function reclaimStaleKeywords(
  db: PrismaClient,
  staleAfterMinutes: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMinutes * 60_000);
  const result = await db.keyword.updateMany({
    where: { status: 'IN_PROGRESS', claimedAt: { lt: cutoff } },
    data: { status: 'QUEUED', claimedAt: null },
  });
  return result.count;
}

/** Put a SKIPPED keyword back in the queue (dashboard "Requeue" action). */
export async function requeueKeyword(
  db: PrismaClient,
  actor: Actor,
  keywordId: string,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const result = await tx.keyword.updateMany({
      where: { id: keywordId, status: 'SKIPPED' },
      data: { status: 'QUEUED', claimedAt: null },
    });
    if (result.count !== 1) return false;
    await recordAudit(tx, {
      ...auditActorFields(actor),
      action: 'keyword.requeued',
      entityType: 'Keyword',
      entityId: keywordId,
    });
    return true;
  });
}

/** Articles awaiting review that nobody has been told about yet. */
export async function listUnnotifiedForReview(db: PrismaClient): Promise<DigestArticle[]> {
  const articles = await db.article.findMany({
    where: { status: 'PENDING_REVIEW', reviewNotifiedAt: null },
    include: { site: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  return articles.map((article) => ({
    id: article.id,
    title: article.title,
    siteName: article.site.name,
    autoGenerated: article.autoGenerated,
    seoScore: parseSeoReport(article.qaReport)?.score ?? null,
    createdAt: article.createdAt,
  }));
}

/** Mark digest articles as notified, AFTER a successful send. */
export async function markReviewNotified(db: PrismaClient, articleIds: string[]): Promise<number> {
  if (articleIds.length === 0) return 0;
  const result = await db.article.updateMany({
    where: { id: { in: articleIds } },
    data: { reviewNotifiedAt: new Date() },
  });
  return result.count;
}

/** Digest recipients: the configured list, else every ADMIN/EDITOR. */
export async function resolveDigestRecipients(
  db: PrismaClient,
  configured: string[],
): Promise<string[]> {
  if (configured.length > 0) return configured;
  const users = await db.user.findMany({
    where: { role: { in: ['ADMIN', 'EDITOR'] }, status: 'ACTIVE' },
    select: { email: true },
  });
  return users.map((user) => user.email).filter((email): email is string => Boolean(email));
}

/** Audit that the autopilot gave up on a keyword, so the silence is explained. */
export async function recordKeywordSkipped(
  db: PrismaClient,
  actor: Actor,
  keywordId: string,
  error: string,
): Promise<void> {
  await recordAudit(db, {
    ...auditActorFields(actor),
    action: 'keyword.autopilotFailed',
    entityType: 'Keyword',
    entityId: keywordId,
    metadata: { error: error.slice(0, 240) },
  });
}
