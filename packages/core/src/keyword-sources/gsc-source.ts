import { createSign } from 'node:crypto';
import { z } from 'zod';
import {
  type DiscoveredKeyword,
  type DiscoveryContext,
  type DiscoveryFetch,
  type GscServiceAccount,
  type KeywordSource,
} from './types';

/**
 * Google Search Console source (PRIMARY, free). Reads the site's OWN Search
 * Analytics and queues two opportunity signals — "striking distance" (ranking
 * ~5–20 with impressions) and "rising" (week-over-week impression growth).
 *
 * Auth: a service account (added as a GSC property user) — fully non-interactive.
 * We mint the access token by signing a JWT with node:crypto and exchanging it,
 * so there is no extra dependency and the whole path is fetch-mockable in tests.
 * The Google API hosts are fixed (no SSRF surface); the per-site property id is
 * only ever used as an encoded path segment, never as a fetch host.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SEARCH_ANALYTICS_HOST = 'https://www.googleapis.com';

const TokenResponseSchema = z.object({ access_token: z.string().min(1) }).passthrough();

export const GscRowSchema = z.object({
  keys: z.array(z.string()).default([]),
  clicks: z.number().default(0),
  impressions: z.number().default(0),
  ctr: z.number().default(0),
  position: z.number().default(0),
});
export type GscRow = z.infer<typeof GscRowSchema>;

const GscQueryResponseSchema = z.object({ rows: z.array(GscRowSchema).optional() }).passthrough();

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 86_400_000);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Build + sign a service-account JWT assertion (RS256). */
export function buildGscJwtAssertion(sa: GscServiceAccount, nowSeconds: number): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const aud = sa.token_uri ?? TOKEN_URL;
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  // Service-account JSON often carries escaped newlines; normalize to a real PEM.
  const pem = sa.private_key.replace(/\\n/g, '\n');
  const signature = signer.sign(pem).toString('base64url');
  return `${unsigned}.${signature}`;
}

export async function getGscAccessToken(
  sa: GscServiceAccount,
  fetchFn: DiscoveryFetch,
  now: Date,
): Promise<string> {
  const assertion = buildGscJwtAssertion(sa, Math.floor(now.getTime() / 1000));
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString();
  const res = await fetchFn(sa.token_uri ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    throw new Error(`GSC token exchange failed (${res.status} ${res.statusText})`);
  }
  return TokenResponseSchema.parse(await res.json()).access_token;
}

interface SearchAnalyticsBody {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit?: number;
  dataState?: 'final' | 'all';
}

export async function queryGscSearchAnalytics(
  propertyUrl: string,
  accessToken: string,
  body: SearchAnalyticsBody,
  fetchFn: DiscoveryFetch,
): Promise<GscRow[]> {
  const url = `${SEARCH_ANALYTICS_HOST}/webmasters/v3/sites/${encodeURIComponent(propertyUrl)}/searchAnalytics/query`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GSC searchAnalytics failed (${res.status} ${res.statusText})`);
  }
  return GscQueryResponseSchema.parse(await res.json()).rows ?? [];
}

/** Striking distance: position ~5–20 with enough impressions, scored by closeness + volume. */
export function scoreStrikingDistance(rows: GscRow[], minImpressions: number): DiscoveredKeyword[] {
  const out: DiscoveredKeyword[] = [];
  for (const row of rows) {
    const term = row.keys[0]?.trim();
    if (!term) continue;
    if (row.position < 5 || row.position > 20) continue;
    if (row.impressions < minImpressions) continue;
    const posCloseness = clamp01((20 - row.position) / 15);
    const imprNorm = clamp01(row.impressions / 2000);
    const score = clamp01(0.5 * posCloseness + 0.5 * imprNorm);
    out.push({
      term,
      source: 'google_search_console',
      score,
      metadata: {
        kind: 'google_search_console',
        signal: 'striking_distance',
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: clamp01(row.ctr),
        position: row.position,
      },
    });
  }
  return out;
}

/** Rising: impression growth recent-vs-prior window, scored by growth + recent volume. */
export function scoreRising(
  recent: GscRow[],
  prior: GscRow[],
  minImpressions: number,
): DiscoveredKeyword[] {
  const priorByTerm = new Map<string, number>();
  for (const row of prior) {
    const term = row.keys[0]?.trim().toLowerCase();
    if (term) priorByTerm.set(term, row.impressions);
  }
  const out: DiscoveredKeyword[] = [];
  for (const row of recent) {
    const term = row.keys[0]?.trim();
    if (!term) continue;
    if (row.impressions < minImpressions) continue;
    const before = priorByTerm.get(term.toLowerCase()) ?? 0;
    const delta = row.impressions - before;
    if (delta <= 0) continue;
    const growth = before > 0 ? delta / before : 1;
    if (growth < 0.2) continue;
    const growthNorm = clamp01(growth);
    const imprNorm = clamp01(row.impressions / 2000);
    const score = clamp01(0.6 * growthNorm + 0.4 * imprNorm);
    out.push({
      term,
      source: 'google_search_console',
      score,
      metadata: {
        kind: 'google_search_console',
        signal: 'rising',
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: clamp01(row.ctr),
        position: row.position,
        impressionsDelta: delta,
      },
    });
  }
  return out;
}

export const googleSearchConsoleSource: KeywordSource = {
  id: 'google_search_console',
  isEnabled(ctx: DiscoveryContext): boolean {
    return Boolean(ctx.gsc?.serviceAccount && ctx.site.gscPropertyUrl);
  },
  async discover(ctx: DiscoveryContext): Promise<DiscoveredKeyword[]> {
    const sa = ctx.gsc?.serviceAccount;
    const property = ctx.site.gscPropertyUrl;
    if (!sa || !property) return [];

    const token = await getGscAccessToken(sa, ctx.fetchFn, ctx.now);
    const min = ctx.limits.gscMinImpressions;

    // Striking distance over ~90 days (skip the last ~3 incomplete days).
    const striking = await queryGscSearchAnalytics(
      property,
      token,
      {
        startDate: isoDate(daysAgo(ctx.now, 93)),
        endDate: isoDate(daysAgo(ctx.now, 3)),
        dimensions: ['query'],
        rowLimit: 1000,
      },
      ctx.fetchFn,
    );

    // Rising: last 28 days vs the prior 28 days.
    const [recent, prior] = await Promise.all([
      queryGscSearchAnalytics(
        property,
        token,
        {
          startDate: isoDate(daysAgo(ctx.now, 31)),
          endDate: isoDate(daysAgo(ctx.now, 3)),
          dimensions: ['query'],
          rowLimit: 1000,
          dataState: 'all',
        },
        ctx.fetchFn,
      ),
      queryGscSearchAnalytics(
        property,
        token,
        {
          startDate: isoDate(daysAgo(ctx.now, 59)),
          endDate: isoDate(daysAgo(ctx.now, 31)),
          dimensions: ['query'],
          rowLimit: 1000,
        },
        ctx.fetchFn,
      ),
    ]);

    const candidates = [
      ...scoreStrikingDistance(striking, min),
      ...scoreRising(recent, prior, Math.max(min, 200)),
    ];
    // dedupe within GSC by term, keep best score, cap.
    const best = new Map<string, DiscoveredKeyword>();
    for (const c of candidates) {
      const key = c.term.toLowerCase();
      const prev = best.get(key);
      if (!prev || c.score > prev.score) best.set(key, c);
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, ctx.limits.maxPerSource);
  },
};
