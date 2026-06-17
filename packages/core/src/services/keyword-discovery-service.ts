import type { Prisma, PrismaClient, SearchIntent } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { getSettings } from '../domain/settings';
import { logger } from '../observability/logger';
import {
  DEFAULT_DISCOVERY_LIMITS,
  DiscoveredKeywordSchema,
  type DiscoveredKeyword,
  type DiscoveryContext,
  type DiscoveryFetch,
  type DiscoveryResolveHost,
  type KeywordSource,
} from '../keyword-sources/types';
import { resolveSiteTopics } from '../keyword-sources/site-topics';
import { runDiscovery } from '../keyword-sources/run-discovery';
import { DEFAULT_KEYWORD_SOURCES } from '../keyword-sources/sources';
import { getGscServiceAccount, getOpenRouterApiKey } from './provider-credential-service';

/**
 * Sentinel actor for cron/system-triggered discovery. Has ADMIN authority for
 * the authorize() check but is recorded in the audit log as actorType 'system'
 * with a null actorId (Spec §10.1.6) — never attributed to a human.
 */
export const SYSTEM_ACTOR: Actor = { id: 'system', role: 'ADMIN' };

function isSystemActor(actor: Actor): boolean {
  return actor.id === SYSTEM_ACTOR.id;
}

export interface EnqueueDiscoveredKeywordsInput {
  siteId: string;
  keywords: DiscoveredKeyword[];
}

export interface EnqueueDiscoveredKeywordsResult {
  created: number;
  skipped: number;
  bySource: Record<string, number>;
}

/**
 * Persist discovered candidates as QUEUED keywords with provenance + ranking
 * score. Validated per row, deduped vs existing site keywords (the unique
 * [siteId, term] constraint is the backstop), audited in-transaction. This is
 * the ONLY side effect of discovery — it never drafts or publishes.
 */
export async function enqueueDiscoveredKeywords(
  db: PrismaClient,
  actor: Actor,
  input: EnqueueDiscoveredKeywordsInput,
): Promise<EnqueueDiscoveredKeywordsResult> {
  authorize(actor, 'keyword.create');

  // Defensive re-validation (discovery data originates from external sources).
  const valid = input.keywords.map((k) => DiscoveredKeywordSchema.parse(k));

  // Within-input dedupe (case-insensitive), keeping the highest score.
  const best = new Map<string, DiscoveredKeyword>();
  for (const candidate of valid) {
    const key = candidate.term.trim().toLowerCase();
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || candidate.score > prev.score) best.set(key, candidate);
  }
  const deduped = [...best.values()];

  const existing = await db.keyword.findMany({
    where: { siteId: input.siteId },
    select: { term: true },
  });
  const existingTerms = new Set(existing.map((e) => e.term.toLowerCase()));
  const fresh = deduped.filter((k) => !existingTerms.has(k.term.toLowerCase()));
  const skipped = deduped.length - fresh.length;

  const bySource: Record<string, number> = {};
  for (const k of fresh) bySource[k.source] = (bySource[k.source] ?? 0) + 1;

  const actorType = isSystemActor(actor) ? 'system' : 'human';
  const actorId = isSystemActor(actor) ? null : actor.id;

  if (fresh.length === 0) {
    await db.$transaction(async (tx) => {
      await recordAudit(tx, {
        actorId,
        actorType,
        action: 'keywords.discovered',
        entityType: 'Site',
        entityId: input.siteId,
        metadata: { created: 0, skipped, bySource: {} },
      });
    });
    return { created: 0, skipped, bySource: {} };
  }

  return db.$transaction(async (tx) => {
    const result = await tx.keyword.createMany({
      data: fresh.map((k) => ({
        siteId: input.siteId,
        term: k.term,
        intent: (k.intent ?? null) as SearchIntent | null,
        searchVolume: k.searchVolume ?? null,
        difficulty: k.difficulty ?? null,
        priority: Math.round(k.score * 100),
        status: 'QUEUED' as const,
        source: k.source,
        discoveryScore: k.score,
        sourceMetadata: k.metadata
          ? (k.metadata as unknown as Prisma.InputJsonValue)
          : undefined,
      })),
      skipDuplicates: true,
    });

    await recordAudit(tx, {
      actorId,
      actorType,
      action: 'keywords.discovered',
      entityType: 'Site',
      entityId: input.siteId,
      metadata: { created: result.count, skipped, bySource },
    });

    return { created: result.count, skipped, bySource };
  });
}

export interface RunSiteDiscoveryOptions {
  fetchFn?: DiscoveryFetch;
  resolveHost?: DiscoveryResolveHost;
  /** Override the default source list (e.g. to run a single source). */
  sources?: KeywordSource[];
}

export interface RunSiteDiscoveryResult extends EnqueueDiscoveredKeywordsResult {
  candidates: number;
  errors: Array<{ source: string; message: string }>;
}

/**
 * End-to-end discovery for one site: build the context (resolve topics, decrypt
 * GSC creds, get the OpenRouter key + models), run the enabled sources, and
 * enqueue the results. Used by the manual "Discover topics" action and the
 * opt-in weekly cron (which passes SYSTEM_ACTOR).
 */
export async function runSiteDiscovery(
  db: PrismaClient,
  actor: Actor,
  siteId: string,
  options: RunSiteDiscoveryOptions = {},
): Promise<RunSiteDiscoveryResult> {
  authorize(actor, 'keyword.create');
  const site = await db.site.findUnique({ where: { id: siteId }, include: { styleGuide: true } });
  if (!site) {
    throw new Error('Site not found.');
  }

  const topics = resolveSiteTopics(site.styleGuide);
  const settings = await getSettings(db);
  const [serviceAccount, openRouterKey] = await Promise.all([
    getGscServiceAccount(db, actor, 'keyword.create').catch(() => undefined),
    getOpenRouterApiKey(db, actor).catch(() => undefined),
  ]);

  const fetchFn: DiscoveryFetch =
    options.fetchFn ?? (fetch as unknown as DiscoveryFetch);

  const ctx: DiscoveryContext = {
    site: {
      id: site.id,
      name: site.name,
      baseUrl: site.baseUrl,
      gscPropertyUrl: site.gscPropertyUrl,
    },
    topics,
    now: new Date(),
    fetchFn,
    resolveHost: options.resolveHost,
    logger,
    gsc: serviceAccount ? { serviceAccount } : undefined,
    llm: openRouterKey
      ? {
          apiKey: openRouterKey,
          relevanceModel: settings.models.qa,
          webModel: settings.models.draft,
        }
      : undefined,
    limits: DEFAULT_DISCOVERY_LIMITS,
  };

  const discovery = await runDiscovery(ctx, options.sources ?? DEFAULT_KEYWORD_SOURCES, {
    maxTotal: settings.keyword_buffer_target,
  });
  const enqueue = await enqueueDiscoveredKeywords(db, actor, {
    siteId,
    keywords: discovery.keywords,
  });

  return { ...enqueue, candidates: discovery.keywords.length, errors: discovery.errors };
}
