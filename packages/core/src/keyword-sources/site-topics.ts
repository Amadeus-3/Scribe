import { z } from 'zod';
import type { SiteTopics } from './types';

/**
 * A site's structured niche, stored on StyleGuide (topicPillars / topicClusters
 * / excludedTopics Json + geo). Discovery uses these to target each site and to
 * filter off-niche trend noise. Json columns are parsed through these schemas
 * before any read/write (Spec §5.1).
 */
const TopicListSchema = z.array(z.string().trim().min(1).max(120)).max(50);

export const SiteTopicsInputSchema = z.object({
  pillars: TopicListSchema.default([]),
  clusters: TopicListSchema.default([]),
  excluded: TopicListSchema.default([]),
  geo: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter ISO country code (e.g. US)')
    .transform((s) => s.toUpperCase())
    .default('US'),
});
export type SiteTopicsInput = z.infer<typeof SiteTopicsInputSchema>;

/** Tolerantly parse a Json topic list from the DB (drops invalid entries). */
export function parseTopicList(value: unknown): string[] {
  const result = TopicListSchema.safeParse(value);
  if (result.success) return result.data;
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  return [];
}

export interface StyleGuideTopicFields {
  topicPillars?: unknown;
  topicClusters?: unknown;
  excludedTopics?: unknown;
  geo?: string | null;
}

/** Resolve a StyleGuide's stored topic fields into a normalized SiteTopics. */
export function resolveSiteTopics(styleGuide: StyleGuideTopicFields | null | undefined): SiteTopics {
  const geoRaw = (styleGuide?.geo ?? '').trim();
  const geo = /^[A-Za-z]{2}$/.test(geoRaw) ? geoRaw.toUpperCase() : 'US';
  return {
    pillars: parseTopicList(styleGuide?.topicPillars),
    clusters: parseTopicList(styleGuide?.topicClusters),
    excluded: parseTopicList(styleGuide?.excludedTopics),
    geo,
  };
}

export function hasStructuredTopics(topics: SiteTopics): boolean {
  return topics.pillars.length > 0 || topics.clusters.length > 0;
}

/** Human-readable niche descriptor for LLM prompts / relevance scoring. */
export function describeTopics(topics: SiteTopics): string {
  const parts: string[] = [];
  if (topics.pillars.length > 0) parts.push(`Primary topics: ${topics.pillars.join(', ')}`);
  if (topics.clusters.length > 0) parts.push(`Subtopics: ${topics.clusters.join(', ')}`);
  if (topics.excluded.length > 0) parts.push(`Never include: ${topics.excluded.join(', ')}`);
  return parts.join('. ');
}

/**
 * The niche string the Trends + LLM-web sources search/filter against. Prefers
 * the structured topics; falls back to the style guide's business/SEO context so
 * a site with no Topics still gets niche-relevant (not random) discovery.
 * Returns '' only when there's genuinely nothing to anchor to.
 */
export function buildNicheDescription(
  topics: SiteTopics,
  styleGuide?: { businessContext?: string | null; seoGuidance?: string | null } | null,
): string {
  const structured = describeTopics(topics);
  if (structured) return structured;
  const fallback = [styleGuide?.businessContext, styleGuide?.seoGuidance]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n')
    .trim();
  return fallback.slice(0, 1500);
}
