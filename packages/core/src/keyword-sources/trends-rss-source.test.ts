import { describe, it, expect, vi } from 'vitest';
import { parseTrendingRss, googleTrendsRssSource } from './trends-rss-source';
import type { DiscoveryContext } from './types';

const RSS = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Best Espresso Machine</title>
  <ht:approx_traffic>50,000+</ht:approx_traffic>
  <ht:news_item><ht:news_item_title>New espresso machine launches</ht:news_item_title></ht:news_item>
</item>
<item>
  <title><![CDATA[Local Sports Score]]></title>
  <ht:approx_traffic>200,000+</ht:approx_traffic>
</item>
</channel></rss>`;

const PUBLIC_HOST = async () => [{ address: '142.250.1.1', family: 4 }];

function ctx(over: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    site: { id: 's1', name: 'Coffee Blog', baseUrl: 'https://coffee.example', gscPropertyUrl: null },
    topics: { pillars: ['home espresso', 'coffee'], clusters: [], excluded: [], geo: 'US' },
    now: new Date('2026-06-17T00:00:00Z'),
    fetchFn: async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}), text: async () => '' }),
    resolveHost: PUBLIC_HOST,
    logger: { warn: vi.fn() },
    llm: { apiKey: 'k', relevanceModel: 'm', webModel: 'm' },
    limits: { maxPerSource: 25, gscMinImpressions: 100, minRelevance: 0.5 },
    ...over,
  };
}

describe('parseTrendingRss', () => {
  it('extracts titles, traffic, and news (handling CDATA)', () => {
    const trends = parseTrendingRss(RSS);
    expect(trends.map((t) => t.title)).toEqual(['Best Espresso Machine', 'Local Sports Score']);
    expect(trends[0]?.approxTraffic).toBe('50,000+');
    expect(trends[0]?.newsTitles).toEqual(['New espresso machine launches']);
  });
});

describe('googleTrendsRssSource.discover', () => {
  it('keeps only on-niche trends per the AI relevance filter', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('trends.google.com')) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({}), text: async () => RSS };
      }
      // OpenRouter relevance call
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    { term: 'Best Espresso Machine', relevance: 0.9 },
                    { term: 'Local Sports Score', relevance: 0.1 },
                  ],
                }),
              },
            },
          ],
        }),
      };
    });

    const result = await googleTrendsRssSource.discover(ctx({ fetchFn }));
    expect(result.map((k) => k.term)).toEqual(['Best Espresso Machine']);
    expect(result[0]).toMatchObject({ source: 'google_trends', metadata: { kind: 'google_trends' } });
  });

  it('refuses to fetch a feed host that resolves to a private IP (SSRF guard)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}), text: async () => RSS }));
    await expect(
      googleTrendsRssSource.discover(
        ctx({ fetchFn, resolveHost: async () => [{ address: '127.0.0.1', family: 4 }] }),
      ),
    ).rejects.toThrow(/Private or local/);
    // The guard runs before the fetch.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('is disabled without an LLM (the relevance filter is integral)', () => {
    expect(googleTrendsRssSource.isEnabled(ctx({ llm: undefined }))).toBe(false);
  });
});
