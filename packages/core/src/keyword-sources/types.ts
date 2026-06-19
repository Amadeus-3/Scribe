import { z } from 'zod';

/**
 * Pluggable trending-topic discovery (Spec §6, Phase 6). Each KeywordSource
 * turns a site's niche into candidate keywords; the orchestrator scores,
 * dedupes, and the service enqueues them as QUEUED keywords. Discovery NEVER
 * drafts or publishes — the human approval gate is untouched (Spec §10.1).
 *
 * All I/O (fetch, host resolution, LLM, credentials) is injected via
 * DiscoveryContext so sources are pure-ish and testable with mocks, matching
 * the existing collectPublicSiteContext / openrouter style. @scribe/core stays
 * framework-free.
 */

export const KEYWORD_SOURCE_IDS = [
  'manual_seed',
  'google_search_console',
  'google_trends',
  'llm_web',
] as const;
export const KeywordSourceIdSchema = z.enum(KEYWORD_SOURCE_IDS);
export type KeywordSourceId = z.infer<typeof KeywordSourceIdSchema>;

/** Mirrors the Prisma SearchIntent enum (kept as a Zod enum to avoid runtime coupling). */
export const SearchIntentSchema = z.enum([
  'INFORMATIONAL',
  'COMMERCIAL',
  'TRANSACTIONAL',
  'NAVIGATIONAL',
]);
export type DiscoverySearchIntent = z.infer<typeof SearchIntentSchema>;

// ── Per-source provenance ("why queued"), validated before the Json write ────
export const GscMetadataSchema = z.object({
  kind: z.literal('google_search_console'),
  signal: z.enum(['striking_distance', 'rising', 'low_ctr']),
  impressions: z.number().nonnegative().optional(),
  clicks: z.number().nonnegative().optional(),
  ctr: z.number().min(0).max(1).optional(),
  position: z.number().nonnegative().optional(),
  impressionsDelta: z.number().optional(),
});

export const TrendsMetadataSchema = z.object({
  kind: z.literal('google_trends'),
  approxTraffic: z.string().optional(),
  geo: z.string().optional(),
  newsTitles: z.array(z.string()).max(10).optional(),
  relevance: z.number().min(0).max(1).optional(),
});

export const LlmWebMetadataSchema = z.object({
  kind: z.literal('llm_web'),
  rationale: z.string().max(2000).optional(),
  citations: z.array(z.string()).max(20).optional(),
  relevance: z.number().min(0).max(1).optional(),
});

export const SourceMetadataSchema = z.discriminatedUnion('kind', [
  GscMetadataSchema,
  TrendsMetadataSchema,
  LlmWebMetadataSchema,
]);
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;

/** A candidate keyword produced by a source (pre-enqueue). */
export const DiscoveredKeywordSchema = z.object({
  term: z.string().trim().min(1).max(200),
  intent: SearchIntentSchema.optional(),
  searchVolume: z.number().int().nonnegative().nullable().optional(),
  difficulty: z.number().int().min(0).max(100).nullable().optional(),
  source: KeywordSourceIdSchema,
  /** 0..1 blended ranking score; mapped to `priority` (Int) at enqueue. */
  score: z.number().min(0).max(1),
  metadata: SourceMetadataSchema.optional(),
});
export type DiscoveredKeyword = z.infer<typeof DiscoveredKeywordSchema>;

/** A Google Cloud service-account key (read-only GSC). Secret — never logged. */
export const GscServiceAccountSchema = z.object({
  type: z.literal('service_account'),
  client_email: z.string().email(),
  private_key: z.string().min(1),
  project_id: z.string().optional(),
  token_uri: z.string().url().optional(),
});
export type GscServiceAccount = z.infer<typeof GscServiceAccountSchema>;

/** The site's resolved structured niche (see site-topics.ts). */
export interface SiteTopics {
  pillars: string[];
  clusters: string[];
  excluded: string[];
  /** ISO country code for Trends/geo scoping (default 'US'). */
  geo: string;
}

export interface DiscoveryHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type DiscoveryFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<DiscoveryHttpResponse>;

export type DiscoveryResolveHost = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export interface DiscoveryLogger {
  warn(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
}

/** Everything a source needs; presence of a config block enables that source. */
export interface DiscoveryContext {
  site: { id: string; name: string; baseUrl: string; gscPropertyUrl: string | null };
  topics: SiteTopics;
  /**
   * The niche the Trends + LLM-web sources search/filter against. Derived from
   * the structured topics, falling back to the style guide's business context.
   * Empty => those sources return nothing (rather than random macro trends).
   */
  nicheDescription: string;
  now: Date;
  fetchFn: DiscoveryFetch;
  resolveHost?: DiscoveryResolveHost;
  logger: DiscoveryLogger;
  /** Present => GSC source enabled. */
  gsc?: { serviceAccount: GscServiceAccount };
  /** Present => Trends + LLM-web sources may use the LLM (relevance / web search). */
  llm?: { apiKey: string; relevanceModel: string; webModel: string };
  limits: {
    /** Max candidates kept per source after scoring. */
    maxPerSource: number;
    /** GSC: minimum impressions for a query to be considered. */
    gscMinImpressions: number;
    /** Trends/LLM: minimum relevance (0..1) to keep an off-niche-prone candidate. */
    minRelevance: number;
  };
}

export interface KeywordSource {
  readonly id: KeywordSourceId;
  /** Cheap, side-effect-free check of whether this source can run for the context. */
  isEnabled(ctx: DiscoveryContext): boolean;
  discover(ctx: DiscoveryContext): Promise<DiscoveredKeyword[]>;
}

export const DEFAULT_DISCOVERY_LIMITS: DiscoveryContext['limits'] = {
  maxPerSource: 25,
  gscMinImpressions: 100,
  minRelevance: 0.5,
};
