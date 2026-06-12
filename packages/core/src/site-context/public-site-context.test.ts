import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicHttpUrl,
  collectPublicSiteContext,
  extractReadableTextFromHtml,
} from './public-site-context';

describe('extractReadableTextFromHtml', () => {
  it('removes scripts, styles, tags, and common entities', () => {
    expect(
      extractReadableTextFromHtml(
        '<html><style>.x{}</style><script>alert(1)</script><h1>Wisely &amp; Rich</h1><p>Build&nbsp;wealth.</p></html>',
      ),
    ).toBe('Wisely & Rich Build wealth.');
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects private and localhost URLs', async () => {
    await expect(assertPublicHttpUrl('http://localhost:3000')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://127.0.0.1')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://192.168.1.10')).rejects.toThrow();
  });

  it('accepts public HTTP URLs after host resolution', async () => {
    await expect(
      assertPublicHttpUrl('https://example.com', async () => [
        { address: '93.184.216.34', family: 4 },
      ]),
    ).resolves.toMatchObject({ hostname: 'example.com' });
  });
});

describe('collectPublicSiteContext', () => {
  it('collects bounded text from common public pages', async () => {
    const fetchFn = vi.fn(async (url: string) => ({
      ok: url.endsWith('/') || url.endsWith('/about'),
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/html' },
      text: async () =>
        '<main><h1>Wisely Rich</h1><p>Personal finance articles for practical investors and savers who want clear money decisions, useful examples, and long-term wealth building guidance.</p></main>',
    }));

    const context = await collectPublicSiteContext({
      baseUrl: 'https://wiselyrich.example',
      fetchFn,
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    expect(fetchFn).toHaveBeenCalled();
    expect(context.pages).toHaveLength(2);
    expect(context.combinedText).toContain('Personal finance articles');
  });
});
