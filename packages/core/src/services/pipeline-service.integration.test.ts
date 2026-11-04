import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPrisma, truncateAll } from '../test/db';
import type { Actor } from '../auth/authorize';
import { SYSTEM_ACTOR } from '../auth/system-actor';
import { rollingWindowStart } from '../pipeline/pacing';
import {
  claimNextKeyword,
  listAutopilotSites,
  listAutopilotSitesBlockedOnStyleGuide,
  loadSiteThroughput,
  reclaimStaleKeywords,
  releaseKeyword,
  requeueKeyword,
} from './pipeline-service';

const db = getTestPrisma();

let admin: Actor;
let siteId: string;

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await truncateAll(db);
  const a = await db.user.create({ data: { email: 'admin@test.local', role: 'ADMIN' } });
  admin = { id: a.id, role: 'ADMIN' };
  const site = await db.site.create({
    data: {
      name: 'Blog',
      baseUrl: 'https://blog.example.com',
      autopilotEnabled: true,
      styleGuide: { create: { systemPrompt: 'Write well.' } },
    },
  });
  siteId = site.id;
});

async function seedKeywords(count: number, over: Record<string, unknown> = {}): Promise<void> {
  await db.keyword.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      siteId,
      term: `keyword ${i}`,
      status: 'QUEUED' as const,
      ...over,
    })),
  });
}

describe('claimNextKeyword (atomicity IS the behaviour)', () => {
  it('hands a distinct keyword to every concurrent caller, never the same one twice', async () => {
    // The core race: two ticks (or a tick and a retry) running at once must not
    // both draft the same keyword. FOR UPDATE SKIP LOCKED is what guarantees it,
    // and only a real database can demonstrate that.
    await seedKeywords(5);

    const claims = await Promise.all(
      Array.from({ length: 5 }, () => claimNextKeyword(db, siteId)),
    );

    const ids = claims.map((c) => c?.id).filter((id): id is string => Boolean(id));
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    await expect(db.keyword.count({ where: { status: 'IN_PROGRESS' } })).resolves.toBe(5);
  });

  it('returns null when the queue is empty', async () => {
    await seedKeywords(1);
    await claimNextKeyword(db, siteId);
    await expect(claimNextKeyword(db, siteId)).resolves.toBeNull();
  });

  it('sets claimedAt so a crashed claim can later be detected as stale', async () => {
    await seedKeywords(1);
    const claimed = await claimNextKeyword(db, siteId);
    const row = await db.keyword.findUniqueOrThrow({ where: { id: claimed?.id } });
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.claimedAt).toBeInstanceOf(Date);
  });

  it('never returns a keyword that already produced an article', async () => {
    await seedKeywords(1);
    const keyword = await db.keyword.findFirstOrThrow();
    await db.article.create({
      data: { siteId, keywordId: keyword.id, status: 'PENDING_REVIEW' },
    });
    // Force it back to QUEUED to prove the NOT EXISTS guard, not the status.
    await db.keyword.update({ where: { id: keyword.id }, data: { status: 'QUEUED' } });
    await expect(claimNextKeyword(db, siteId)).resolves.toBeNull();
  });

  it('claims the highest priority first, then the best discovery score', async () => {
    await db.keyword.createMany({
      data: [
        { siteId, term: 'low', priority: 0, discoveryScore: 0.9 },
        { siteId, term: 'high', priority: 10, discoveryScore: 0.1 },
        { siteId, term: 'mid', priority: 0, discoveryScore: 0.95 },
      ],
    });
    await expect(claimNextKeyword(db, siteId)).resolves.toMatchObject({ term: 'high' });
    await expect(claimNextKeyword(db, siteId)).resolves.toMatchObject({ term: 'mid' });
  });

  it('does not cross site boundaries', async () => {
    const other = await db.site.create({
      data: { name: 'Other', baseUrl: 'https://other.example.com' },
    });
    await db.keyword.create({ data: { siteId: other.id, term: 'theirs' } });
    await expect(claimNextKeyword(db, siteId)).resolves.toBeNull();
  });
});

describe('releaseKeyword', () => {
  it('releases an in-progress claim and clears claimedAt', async () => {
    await seedKeywords(1);
    const claimed = await claimNextKeyword(db, siteId);
    await expect(releaseKeyword(db, claimed!.id, 'SKIPPED')).resolves.toBe(true);
    const row = await db.keyword.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(row.status).toBe('SKIPPED');
    expect(row.claimedAt).toBeNull();
  });

  it('refuses to clobber a keyword that already completed', async () => {
    // Without the IN_PROGRESS compare-and-set, a late failure handler would
    // flip a DONE keyword back to QUEUED and the article would be drafted twice.
    await seedKeywords(1);
    const claimed = await claimNextKeyword(db, siteId);
    await db.keyword.update({ where: { id: claimed!.id }, data: { status: 'DONE' } });

    await expect(releaseKeyword(db, claimed!.id, 'QUEUED')).resolves.toBe(false);
    await expect(
      db.keyword.findUniqueOrThrow({ where: { id: claimed!.id } }),
    ).resolves.toMatchObject({ status: 'DONE' });
  });
});

describe('reclaimStaleKeywords', () => {
  it('returns claims older than the threshold and leaves fresh ones alone', async () => {
    await seedKeywords(2);
    const stale = await claimNextKeyword(db, siteId);
    const fresh = await claimNextKeyword(db, siteId);
    await db.keyword.update({
      where: { id: stale!.id },
      data: { claimedAt: new Date(Date.now() - 120 * 60_000) },
    });

    await expect(reclaimStaleKeywords(db, 60)).resolves.toBe(1);
    await expect(db.keyword.findUniqueOrThrow({ where: { id: stale!.id } })).resolves.toMatchObject(
      { status: 'QUEUED', claimedAt: null },
    );
    await expect(db.keyword.findUniqueOrThrow({ where: { id: fresh!.id } })).resolves.toMatchObject(
      { status: 'IN_PROGRESS' },
    );
  });
});

describe('requeueKeyword', () => {
  it('moves a SKIPPED keyword back to QUEUED and audits it', async () => {
    await seedKeywords(1);
    const claimed = await claimNextKeyword(db, siteId);
    await releaseKeyword(db, claimed!.id, 'SKIPPED');

    await expect(requeueKeyword(db, admin, claimed!.id)).resolves.toBe(true);
    await expect(
      db.keyword.findUniqueOrThrow({ where: { id: claimed!.id } }),
    ).resolves.toMatchObject({ status: 'QUEUED' });
    await expect(db.auditLog.count({ where: { action: 'keyword.requeued' } })).resolves.toBe(1);
  });

  it('is a no-op on a keyword that is not SKIPPED', async () => {
    await seedKeywords(1);
    const keyword = await db.keyword.findFirstOrThrow();
    await expect(requeueKeyword(db, admin, keyword.id)).resolves.toBe(false);
  });

  it('records a system requeue with a null actorId (AuditLog FK safety)', async () => {
    await seedKeywords(1);
    const claimed = await claimNextKeyword(db, siteId);
    await releaseKeyword(db, claimed!.id, 'SKIPPED');

    await expect(requeueKeyword(db, SYSTEM_ACTOR, claimed!.id)).resolves.toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'keyword.requeued' } });
    expect(audit.actorId).toBeNull();
    expect(audit.actorType).toBe('system');
  });
});

describe('listAutopilotSites', () => {
  it('includes only ACTIVE, autopilot-enabled sites that have a style guide', async () => {
    await db.site.create({
      data: { name: 'No style guide', baseUrl: 'https://a.example.com', autopilotEnabled: true },
    });
    await db.site.create({
      data: {
        name: 'Autopilot off',
        baseUrl: 'https://b.example.com',
        styleGuide: { create: { systemPrompt: 'x' } },
      },
    });
    await db.site.create({
      data: {
        name: 'Paused',
        baseUrl: 'https://c.example.com',
        status: 'PAUSED',
        autopilotEnabled: true,
        styleGuide: { create: { systemPrompt: 'x' } },
      },
    });

    const sites = await listAutopilotSites(db);
    expect(sites.map((s) => s.name)).toEqual(['Blog']);
  });

  it('surfaces sites blocked purely by a missing style guide', async () => {
    await db.site.create({
      data: { name: 'Needs guide', baseUrl: 'https://a.example.com', autopilotEnabled: true },
    });
    const blocked = await listAutopilotSitesBlockedOnStyleGuide(db);
    expect(blocked.map((s) => s.name)).toEqual(['Needs guide']);
  });

  it('exposes the per-site weekly override', async () => {
    await db.site.update({ where: { id: siteId }, data: { autopilotArticlesPerWeek: 9 } });
    const [site] = await listAutopilotSites(db);
    expect(site?.articlesPerWeek).toBe(9);
  });
});

describe('loadSiteThroughput', () => {
  it('counts articles in the window, the newest of any age, and unreviewed work', async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const k1 = await db.keyword.create({ data: { siteId, term: 'a', status: 'DONE' } });
    const k2 = await db.keyword.create({ data: { siteId, term: 'b', status: 'DONE' } });
    await db.article.create({
      data: { siteId, keywordId: k1.id, status: 'PUBLISHED', createdAt: old },
    });
    await db.article.create({
      data: { siteId, keywordId: k2.id, status: 'PENDING_REVIEW', createdAt: recent },
    });
    await db.keyword.createMany({
      data: [
        { siteId, term: 'queued-1' },
        { siteId, term: 'queued-2' },
      ],
    });

    const map = await loadSiteThroughput(db, [siteId], rollingWindowStart(new Date()));
    const entry = map.get(siteId);

    expect(entry?.articlesInWindow).toBe(1); // the 30-day-old one is outside
    expect(entry?.lastArticleAt?.getTime()).toBe(recent.getTime()); // unwindowed
    expect(entry?.unreviewed).toBe(1);
    expect(entry?.queuedKeywords).toBe(2);
  });

  it('reports zeroes for a site with no activity rather than omitting it', async () => {
    const map = await loadSiteThroughput(db, [siteId], rollingWindowStart(new Date()));
    expect(map.get(siteId)).toEqual({
      siteId,
      articlesInWindow: 0,
      lastArticleAt: null,
      unreviewed: 0,
      queuedKeywords: 0,
    });
  });

  it('does not count a queued keyword that already has an article', async () => {
    const k = await db.keyword.create({ data: { siteId, term: 'used' } });
    await db.article.create({ data: { siteId, keywordId: k.id, status: 'PENDING_REVIEW' } });
    const map = await loadSiteThroughput(db, [siteId], rollingWindowStart(new Date()));
    expect(map.get(siteId)?.queuedKeywords).toBe(0);
  });
});
