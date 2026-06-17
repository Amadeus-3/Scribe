import { assertPublicHttpUrl } from '../site-context/public-site-context';
import { filterByTopicRelevance } from './llm-relevance';
import type { DiscoveredKeyword, DiscoveryContext, KeywordSource } from './types';

/**
 * Google Trends "Trending Now" RSS source (free, no auth). The feed is geo-only
 * (no niche filter), so we fetch the country feed through the SSRF guard, parse
 * it, and keep only items the AI relevance pass judges on-niche. Secondary
 * "momentum" signal — GSC is the primary niche source.
 *
 * NOTE: there is no official Google Trends API; this served RSS feed is the
 * reliable free path. A category-filtered paid provider (e.g. DataForSEO) can be
 * dropped in behind this same KeywordSource interface later.
 */
const TRENDS_RSS_BASE = 'https://trends.google.com/trending/rss';

export interface ParsedTrend {
  title: string;
  approxTraffic?: string;
  newsTitles: string[];
}

function cleanXmlText(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTrendingRss(xml: string): ParsedTrend[] {
  const out: ParsedTrend[] = [];
  for (const itemMatch of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = itemMatch[1] ?? '';
    const title = cleanXmlText(block.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    if (!title) continue;
    const approxTraffic = cleanXmlText(
      block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/)?.[1],
    );
    const newsTitles = [...block.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)]
      .map((m) => cleanXmlText(m[1]))
      .filter(Boolean);
    out.push({ title, approxTraffic: approxTraffic || undefined, newsTitles });
  }
  return out;
}

export const googleTrendsRssSource: KeywordSource = {
  id: 'google_trends',
  isEnabled(ctx: DiscoveryContext): boolean {
    // The relevance filter is integral (the feed is macro/geo-only).
    return Boolean(ctx.llm);
  },
  async discover(ctx: DiscoveryContext): Promise<DiscoveredKeyword[]> {
    const llm = ctx.llm;
    if (!llm) return [];

    const url = `${TRENDS_RSS_BASE}?geo=${encodeURIComponent(ctx.topics.geo)}`;
    await assertPublicHttpUrl(url, ctx.resolveHost); // SSRF guard on the outbound fetch
    const res = await ctx.fetchFn(url, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (!res.ok) {
      throw new Error(`Google Trends RSS failed (${res.status} ${res.statusText})`);
    }

    const trends = parseTrendingRss(await res.text());
    if (trends.length === 0) return [];

    const relevance = await filterByTopicRelevance({
      terms: trends.map((t) => t.title),
      topics: ctx.topics,
      llm,
      fetchFn: ctx.fetchFn,
      minRelevance: ctx.limits.minRelevance,
    });

    const out: DiscoveredKeyword[] = [];
    for (const trend of trends) {
      const rel = relevance.get(trend.title);
      if (rel === undefined) continue;
      out.push({
        term: trend.title,
        source: 'google_trends',
        score: rel,
        metadata: {
          kind: 'google_trends',
          approxTraffic: trend.approxTraffic,
          geo: ctx.topics.geo,
          newsTitles: trend.newsTitles.slice(0, 5),
          relevance: rel,
        },
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, ctx.limits.maxPerSource);
  },
};
