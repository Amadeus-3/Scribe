import type { DiscoveredKeyword, DiscoveryContext, KeywordSource } from './types';

export interface DiscoveryRunResult {
  /** Deduped, scored, sorted, capped candidates ready to enqueue. */
  keywords: DiscoveredKeyword[];
  /** Raw candidate count per source (before cross-source dedupe). */
  bySource: Record<string, number>;
  /** Sources that threw — isolated so one failure never aborts the rest. */
  errors: Array<{ source: string; message: string }>;
}

/**
 * Run all enabled sources concurrently, isolate per-source failures, drop
 * excluded/off-niche terms, dedupe within the batch (keep the highest score),
 * sort by score, and cap. Pure aside from the injected source I/O — so it is
 * unit-testable with mock sources.
 */
export async function runDiscovery(
  ctx: DiscoveryContext,
  sources: KeywordSource[],
  options: { maxTotal?: number } = {},
): Promise<DiscoveryRunResult> {
  const enabled = sources.filter((source) => source.isEnabled(ctx));
  const settled = await Promise.allSettled(enabled.map((source) => source.discover(ctx)));

  const collected: DiscoveredKeyword[] = [];
  const bySource: Record<string, number> = {};
  const errors: Array<{ source: string; message: string }> = [];

  for (let i = 0; i < enabled.length; i += 1) {
    const source = enabled[i];
    const result = settled[i];
    if (!source || !result) continue;
    if (result.status === 'fulfilled') {
      bySource[source.id] = result.value.length;
      collected.push(...result.value);
    } else {
      const message =
        result.reason instanceof Error ? result.reason.message : 'unknown discovery error';
      errors.push({ source: source.id, message });
      ctx.logger.warn({ source: source.id, message }, 'discovery source failed');
    }
  }

  const excluded = ctx.topics.excluded.map((t) => t.toLowerCase().trim()).filter(Boolean);
  const isExcluded = (term: string): boolean => {
    const lower = term.toLowerCase();
    return excluded.some((phrase) => lower.includes(phrase));
  };

  // Within-batch dedupe by lowercased term; keep the highest-scoring instance.
  const best = new Map<string, DiscoveredKeyword>();
  for (const candidate of collected) {
    const term = candidate.term.trim();
    if (!term || isExcluded(term)) continue;
    const key = term.toLowerCase();
    const prev = best.get(key);
    if (!prev || candidate.score > prev.score) {
      best.set(key, { ...candidate, term });
    }
  }

  const keywords = [...best.values()].sort((a, b) => b.score - a.score);
  return {
    keywords: options.maxTotal ? keywords.slice(0, options.maxTotal) : keywords,
    bySource,
    errors,
  };
}
