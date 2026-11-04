import { generateKeyPairSync } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import {
  buildGscJwtAssertion,
  googleSearchConsoleSource,
  scoreRising,
  scoreStrikingDistance,
  type GscRow,
} from './gsc-source';
import type { DiscoveryContext, GscServiceAccount } from './types';

const NOW = new Date('2026-06-17T00:00:00Z');
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDate(new Date(NOW.getTime() - n * 86_400_000));

// A real (throwaway) RSA key so JWT signing actually runs in tests.
const TEST_PRIVATE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

const row = (term: string, impressions: number, position: number, clicks = 0): GscRow => ({
  keys: [term],
  clicks,
  impressions,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position,
});

describe('scoreStrikingDistance', () => {
  it('keeps position 5–20 with enough impressions and drops the rest', () => {
    const out = scoreStrikingDistance(
      [row('near page one', 800, 8), row('too deep', 5000, 30), row('thin', 20, 7)],
      100,
    );
    expect(out.map((k) => k.term)).toEqual(['near page one']);
    expect(out[0]?.metadata).toMatchObject({ kind: 'google_search_console', signal: 'striking_distance' });
    expect(out[0]?.score).toBeGreaterThan(0);
  });
});

describe('scoreRising', () => {
  it('keeps terms with >=20% impression growth and a recent volume floor', () => {
    const recent = [row('surging', 1200, 12), row('flat', 1000, 9)];
    const prior = [row('surging', 300, 18), row('flat', 1000, 9)];
    const out = scoreRising(recent, prior, 200);
    expect(out.map((k) => k.term)).toEqual(['surging']);
    expect(out[0]?.metadata).toMatchObject({ signal: 'rising', impressionsDelta: 900 });
  });
});

describe('buildGscJwtAssertion', () => {
  it('produces a three-segment JWT with the service-account issuer', () => {
    const sa: GscServiceAccount = {
      type: 'service_account',
      client_email: 'svc@proj.iam.gserviceaccount.com',
      private_key: TEST_PRIVATE_KEY,
    };
    const jwt = buildGscJwtAssertion(sa, 1_700_000_000);
    const [header, claims, signature] = jwt.split('.');
    expect(jwt.split('.')).toHaveLength(3);
    expect(signature).toBeTruthy();
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toMatchObject({ alg: 'RS256' });
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString())).toMatchObject({
      iss: 'svc@proj.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    });
  });
});

describe('googleSearchConsoleSource.discover', () => {
  function ctx(over: Partial<DiscoveryContext> = {}): DiscoveryContext {
    return {
      site: { id: 's1', name: 'Site', baseUrl: 'https://example.com', gscPropertyUrl: 'sc-domain:example.com' },
      topics: { pillars: [], clusters: [], excluded: [], geo: 'US' },
      nicheDescription: '',
      now: NOW,
      fetchFn: async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({}), text: async () => '' }),
      logger: { warn: vi.fn() },
      gsc: {
        serviceAccount: {
          type: 'service_account',
          client_email: 'svc@proj.iam.gserviceaccount.com',
          private_key: TEST_PRIVATE_KEY,
        },
      },
      limits: { maxPerSource: 25, gscMinImpressions: 100, minRelevance: 0.5 },
      ...over,
    };
  }

  it('is disabled without a property url or service account', () => {
    expect(googleSearchConsoleSource.isEnabled(ctx({ gsc: undefined }))).toBe(false);
    expect(
      googleSearchConsoleSource.isEnabled(
        ctx({ site: { id: 's', name: 'n', baseUrl: 'https://x.com', gscPropertyUrl: null } }),
      ),
    ).toBe(false);
    expect(googleSearchConsoleSource.isEnabled(ctx())).toBe(true);
  });

  it('mints a token then queries striking-distance + rising signals', async () => {
    const fetchFn = vi.fn(async (url: string, init?: { body?: string }) => {
      const json = (value: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => value, text: async () => '' });
      if (url.includes('/token')) return json({ access_token: 'tok_123' });
      const body = init?.body ? (JSON.parse(init.body) as { startDate: string }) : { startDate: '' };
      if (body.startDate === daysAgo(93)) return json({ rows: [row('near page one', 900, 8)] }); // striking
      if (body.startDate === daysAgo(31)) return json({ rows: [row('surging term', 1500, 11)] }); // recent
      if (body.startDate === daysAgo(59)) return json({ rows: [row('surging term', 200, 16)] }); // prior
      return json({ rows: [] });
    });

    const result = await googleSearchConsoleSource.discover(ctx({ fetchFn }));
    const terms = result.map((k) => k.term).sort();
    expect(terms).toEqual(['near page one', 'surging term']);
    expect(fetchFn.mock.calls[0]?.[0]).toContain('/token');
    expect(result.every((k) => k.source === 'google_search_console')).toBe(true);
  });
});
