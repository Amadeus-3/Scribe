import { describe, it, expect, vi } from 'vitest';
import { runDiscovery } from './run-discovery';
import type { DiscoveredKeyword, DiscoveryContext, KeywordSource } from './types';

function ctx(excluded: string[] = []): DiscoveryContext {
  return {
    site: { id: 's1', name: 'Site', baseUrl: 'https://example.com', gscPropertyUrl: null },
    topics: { pillars: ['coffee'], clusters: [], excluded, geo: 'US' },
    now: new Date('2026-06-17T00:00:00Z'),
    fetchFn: async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}), text: async () => '' }),
    logger: { warn: vi.fn() },
    limits: { maxPerSource: 25, gscMinImpressions: 100, minRelevance: 0.5 },
  };
}

function source(
  id: KeywordSource['id'],
  enabled: boolean,
  discover: () => Promise<DiscoveredKeyword[]>,
): KeywordSource {
  return { id, isEnabled: () => enabled, discover };
}

describe('runDiscovery', () => {
  it('dedupes (keeps highest score), drops excluded, sorts, and reports per-source counts', async () => {
    const a = source('google_trends', true, async () => [
      { term: 'best grinder', score: 0.9, source: 'google_trends' },
      { term: 'Cold Brew', score: 0.4, source: 'google_trends' },
    ]);
    const b = source('llm_web', true, async () => [
      { term: 'cold brew', score: 0.8, source: 'llm_web' }, // dup of "Cold Brew", higher score
      { term: 'crypto coffee coin', score: 0.99, source: 'llm_web' }, // excluded
    ]);
    const disabled = source('google_search_console', false, async () => [
      { term: 'should not appear', score: 1, source: 'google_search_console' },
    ]);

    const result = await runDiscovery(ctx(['crypto']), [a, b, disabled]);

    expect(result.keywords.map((k) => k.term)).toEqual(['best grinder', 'cold brew']);
    expect(result.keywords[1]?.score).toBe(0.8); // higher-scoring dup kept
    expect(result.keywords[1]?.source).toBe('llm_web');
    expect(result.keywords.some((k) => k.term.includes('crypto'))).toBe(false);
    expect(result.bySource).toEqual({ google_trends: 2, llm_web: 2 });
    expect(result.errors).toHaveLength(0);
  });

  it('isolates a failing source without aborting the others', async () => {
    const ok = source('google_trends', true, async () => [
      { term: 'pour over', score: 0.7, source: 'google_trends' },
    ]);
    const boom = source('llm_web', true, async () => {
      throw new Error('rate limited');
    });
    const c = ctx();

    const result = await runDiscovery(c, [ok, boom]);

    expect(result.keywords.map((k) => k.term)).toEqual(['pour over']);
    expect(result.errors).toEqual([{ source: 'llm_web', message: 'rate limited' }]);
    expect(c.logger.warn).toHaveBeenCalled();
  });

  it('caps the total when maxTotal is given', async () => {
    const many = source('google_trends', true, async () =>
      Array.from({ length: 10 }, (_, i) => ({
        term: `term ${i}`,
        score: i / 10,
        source: 'google_trends' as const,
      })),
    );
    const result = await runDiscovery(ctx(), [many], { maxTotal: 3 });
    expect(result.keywords).toHaveLength(3);
    expect(result.keywords[0]?.score).toBe(0.9);
  });
});
