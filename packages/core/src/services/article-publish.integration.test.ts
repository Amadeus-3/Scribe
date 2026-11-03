import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestPrisma, truncateAll } from '../test/db';
import type { Actor } from '../auth/authorize';
import { SYSTEM_ACTOR } from '../auth/system-actor';
import { HumanActorRequiredError, assertHumanPublishActor } from '../auth/human-actor';
import { IllegalArticleTransitionError } from '../domain/article-transitions';
import { ArticleApprovedDataSchema, type ArticleApprovedData } from '../pipeline/events';
import { encryptSecret } from '../crypto/encryption';
import {
  approveArticle,
  publishArticleToCms,
  rejectArticle,
  ArticlePublishError,
} from './article-service';

const db = getTestPrisma();

let admin: Actor;
let editor: Actor;
let viewer: Actor;
let siteId: string;
let articleId: string;

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

/** A Strapi response good enough for publishToStrapi to succeed. */
function okFetch() {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/api/upload')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify([{ id: 1, url: '/uploads/x.png' }]),
        json: async () => [{ id: 1, url: '/uploads/x.png' }],
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({ data: { documentId: 'doc_1', id: 1, slug: 'post', title: 'Post' } }),
      json: async () => ({ data: { documentId: 'doc_1', id: 1, slug: 'post', title: 'Post' } }),
    };
  });
}

beforeEach(async () => {
  await truncateAll(db);
  const a = await db.user.create({ data: { email: 'admin@test.local', role: 'ADMIN' } });
  const e = await db.user.create({ data: { email: 'editor@test.local', role: 'EDITOR' } });
  const v = await db.user.create({ data: { email: 'viewer@test.local', role: 'VIEWER' } });
  admin = { id: a.id, role: 'ADMIN' };
  editor = { id: e.id, role: 'EDITOR' };
  viewer = { id: v.id, role: 'VIEWER' };

  const site = await db.site.create({
    data: {
      name: 'Blog',
      baseUrl: 'https://blog.example.com',
      cmsType: 'STRAPI',
      cmsCredentialsEnc: encryptSecret(
        JSON.stringify({ cmsType: 'STRAPI', apiToken: 't', collectionApiId: 'articles' }),
      ),
    },
  });
  siteId = site.id;

  const keyword = await db.keyword.create({ data: { siteId, term: 'a keyword', status: 'DONE' } });
  const article = await db.article.create({
    data: {
      siteId,
      keywordId: keyword.id,
      title: 'A Title',
      slug: 'a-title',
      contentMarkdown: '# Body',
      contentHtml: '<h1>Body</h1>',
      status: 'PENDING_REVIEW',
      currentVersion: 1,
    },
  });
  articleId = article.id;
});

describe('Spec §10.1.1 — no autonomous publishing', () => {
  it('refuses to publish for the system actor, and never reaches the CMS', async () => {
    // THE non-negotiable. Asserting the fetch call count, not merely that it
    // rejected, is what proves nothing left the process.
    const fetchFn = okFetch();
    await approveArticle(db, admin, articleId);

    await expect(
      // A cast is required precisely because the type system rejects this too.
      publishArticleToCms(db, SYSTEM_ACTOR as never, articleId, { fetchFn }),
    ).rejects.toBeInstanceOf(HumanActorRequiredError);

    expect(fetchFn).not.toHaveBeenCalled();
    await expect(db.article.findUniqueOrThrow({ where: { id: articleId } })).resolves.toMatchObject(
      { status: 'APPROVED' },
    );
  });

  it('audits a blocked publish with a null actorId so the FK cannot eat the signal', async () => {
    const fetchFn = okFetch();
    await approveArticle(db, admin, articleId);
    await expect(
      publishArticleToCms(db, SYSTEM_ACTOR as never, articleId, { fetchFn }),
    ).rejects.toThrow();

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'article.publishBlocked' },
    });
    expect(audit.actorId).toBeNull();
    expect(audit.actorType).toBe('system');
    expect(audit.metadata).toMatchObject({ reason: 'reserved_actor_id', claimedActorId: 'system' });
  });

  it('refuses an id that has no User row', async () => {
    await approveArticle(db, admin, articleId);
    const fetchFn = okFetch();
    await expect(
      publishArticleToCms(db, { id: 'clzzzzzzzzzzzzzzzzzzzzzzz' }, articleId, { fetchFn }),
    ).rejects.toMatchObject({ reason: 'actor_not_found' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a VIEWER and an EDITOR (publish is ADMIN-only)', async () => {
    await approveArticle(db, admin, articleId);
    const fetchFn = okFetch();
    await expect(
      publishArticleToCms(db, { id: viewer.id }, articleId, { fetchFn }),
    ).rejects.toMatchObject({ reason: 'role_not_permitted' });
    await expect(
      publishArticleToCms(db, { id: editor.id }, articleId, { fetchFn }),
    ).rejects.toMatchObject({ reason: 'role_not_permitted' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a stale session claiming a role the database no longer grants', async () => {
    // Auth.js uses JWT sessions and only re-reads the role at sign-in, so a
    // demoted user keeps asserting ADMIN until they log in again.
    await approveArticle(db, admin, articleId);
    await db.user.update({ where: { id: admin.id }, data: { role: 'VIEWER' } });
    const fetchFn = okFetch();

    await expect(
      publishArticleToCms(db, { id: admin.id, role: 'ADMIN' }, articleId, { fetchFn }),
    ).rejects.toMatchObject({ reason: 'role_not_permitted' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses to approve as the system actor', async () => {
    await expect(approveArticle(db, SYSTEM_ACTOR, articleId)).rejects.toThrow(
      /authenticated human reviewer/,
    );
  });
});

describe('approval-event proof (the reviewId anchor)', () => {
  it('requires a reviewId when the publish came from an event', async () => {
    await approveArticle(db, admin, articleId);
    await expect(
      assertHumanPublishActor(db, {
        claimed: { id: admin.id },
        articleId,
        origin: 'approval_event',
      }),
    ).rejects.toMatchObject({ reason: 'missing_review_proof' });
  });

  it('rejects a review belonging to a different article', async () => {
    const other = await db.keyword.create({ data: { siteId, term: 'other', status: 'DONE' } });
    const otherArticle = await db.article.create({
      data: { siteId, keywordId: other.id, status: 'PENDING_REVIEW' },
    });
    const { reviewId } = await approveArticleWithReview(otherArticle.id);

    await expect(
      assertHumanPublishActor(db, {
        claimed: { id: admin.id },
        articleId,
        origin: 'approval_event',
        reviewId,
      }),
    ).rejects.toMatchObject({ reason: 'review_article_mismatch' });
  });

  it('rejects a review that is not an approval', async () => {
    await rejectArticle(db, admin, articleId, 'no');
    const review = await db.review.findFirstOrThrow({ where: { articleId } });
    await expect(
      assertHumanPublishActor(db, {
        claimed: { id: admin.id },
        articleId,
        origin: 'approval_event',
        reviewId: review.id,
      }),
    ).rejects.toMatchObject({ reason: 'review_not_approval' });
  });

  it('rejects a review written by a different person', async () => {
    const { reviewId } = await approveArticleWithReview(articleId);
    await db.review.update({ where: { id: reviewId }, data: { reviewerId: editor.id } });
    await expect(
      assertHumanPublishActor(db, {
        claimed: { id: admin.id },
        articleId,
        origin: 'approval_event',
        reviewId,
      }),
    ).rejects.toMatchObject({ reason: 'review_actor_mismatch' });
  });

  it('rejects an approval that has gone stale', async () => {
    const { reviewId } = await approveArticleWithReview(articleId);
    await db.review.update({
      where: { id: reviewId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    await expect(
      assertHumanPublishActor(db, {
        claimed: { id: admin.id },
        articleId,
        origin: 'approval_event',
        reviewId,
      }),
    ).rejects.toMatchObject({ reason: 'review_stale' });
  });

  it('grants publish for the approving admin, with the role read from the DB', async () => {
    const { reviewId } = await approveArticleWithReview(articleId);
    const grant = await assertHumanPublishActor(db, {
      claimed: { id: admin.id },
      articleId,
      origin: 'approval_event',
      reviewId,
    });
    expect(grant.actor).toEqual({ id: admin.id, role: 'ADMIN' });
    expect(grant.reviewId).toBe(reviewId);
  });
});

async function approveArticleWithReview(id: string): Promise<{ reviewId: string }> {
  await approveArticle(db, admin, id);
  const review = await db.review.findFirstOrThrow({
    where: { articleId: id, decision: 'APPROVED' },
  });
  return { reviewId: review.id };
}

describe('approveArticle emitter contract', () => {
  it('emits exactly one schema-valid payload and makes no CMS call itself', async () => {
    const payloads: ArticleApprovedData[] = [];
    const emit = async (payload: ArticleApprovedData) => {
      payloads.push(payload);
    };
    const result = await approveArticle(db, admin, articleId, { emit });

    expect(result.publish).toBe('queued');
    expect(payloads).toHaveLength(1);
    // Must satisfy the schema the worker will re-parse it against.
    const parsed = ArticleApprovedDataSchema.parse(payloads[0]);
    expect(parsed).toMatchObject({ articleId, siteId, actorId: admin.id, version: 1 });

    const review = await db.review.findFirstOrThrow({ where: { articleId } });
    expect(parsed.reviewId).toBe(review.id);
    // Approving does not itself touch the CMS.
    await expect(db.publishRecord.count()).resolves.toBe(0);
  });

  it('keeps the approval when the emitter throws', async () => {
    // Losing an approval because the event bus is down would be worse than not
    // auto-publishing, and the Publish button remains as the retry path.
    const emit = vi.fn(async () => {
      throw new Error('inngest unreachable');
    });
    const result = await approveArticle(db, admin, articleId, { emit });

    expect(result.publish).toBe('emit_failed');
    expect(result.article.status).toBe('APPROVED');
  });

  it('does not queue a publish when a precondition already fails', async () => {
    await db.site.update({ where: { id: siteId }, data: { status: 'PAUSED' } });
    const emit = vi.fn(async () => {});
    const result = await approveArticle(db, admin, articleId, { emit });

    expect(result.publish).toBe('blocked_preconditions');
    expect(result.publishNote).toMatch(/paused/i);
    expect(emit).not.toHaveBeenCalled();
  });

  it('refuses to approve an article that was already rejected', async () => {
    await rejectArticle(db, admin, articleId, 'no');
    // Previously this silently succeeded, because nothing validated from-state.
    await expect(approveArticle(db, admin, articleId)).rejects.toBeInstanceOf(
      IllegalArticleTransitionError,
    );
  });
});

describe('publish idempotency', () => {
  it('uses a deterministic key scoped to the article version', async () => {
    await approveArticle(db, admin, articleId);
    await publishArticleToCms(db, { id: admin.id }, articleId, { fetchFn: okFetch() });

    const record = await db.publishRecord.findFirstOrThrow({ where: { articleId } });
    expect(record.idempotencyKey).toBe(`publish:${articleId}:1`);
    expect(record.status).toBe('success');
  });

  it('does not call the CMS twice for the same version', async () => {
    await approveArticle(db, admin, articleId);
    const first = okFetch();
    await publishArticleToCms(db, { id: admin.id }, articleId, { fetchFn: first });

    const second = okFetch();
    await publishArticleToCms(db, { id: admin.id }, articleId, { fetchFn: second });

    expect(second).not.toHaveBeenCalled();
    await expect(db.publishRecord.count({ where: { articleId } })).resolves.toBe(1);
  });

  it('lets a failed publish be retried at the same version', async () => {
    // Keying on version would otherwise break the retry path with a unique
    // constraint violation on the existing row.
    await approveArticle(db, admin, articleId);
    const failing = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: async () => 'boom',
      json: async () => ({}),
    }));
    await expect(
      publishArticleToCms(db, { id: admin.id }, articleId, { fetchFn: failing }),
    ).rejects.toBeInstanceOf(ArticlePublishError);

    await expect(db.article.findUniqueOrThrow({ where: { id: articleId } })).resolves.toMatchObject(
      { status: 'PUBLISH_FAILED' },
    );

    const retry = okFetch();
    const published = await publishArticleToCms(db, { id: admin.id }, articleId, {
      fetchFn: retry,
    });
    expect(published.status).toBe('PUBLISHED');
    await expect(db.publishRecord.count({ where: { articleId } })).resolves.toBe(1);
  });

  it('leaves a paused site at APPROVED rather than PUBLISH_FAILED', async () => {
    await approveArticle(db, admin, articleId);
    await db.site.update({ where: { id: siteId }, data: { status: 'PAUSED' } });
    const fetchFn = okFetch();

    await expect(
      publishArticleToCms(db, { id: admin.id }, articleId, { fetchFn }),
    ).rejects.toBeInstanceOf(ArticlePublishError);

    // Nothing was attempted, so nothing failed.
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(db.article.findUniqueOrThrow({ where: { id: articleId } })).resolves.toMatchObject(
      { status: 'APPROVED' },
    );
  });

  it('audits the publish with the verified human actor', async () => {
    await approveArticle(db, admin, articleId);
    await publishArticleToCms(db, { id: admin.id }, articleId, { fetchFn: okFetch() });

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'article.published' } });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.actorType).toBe('human');
  });
});
