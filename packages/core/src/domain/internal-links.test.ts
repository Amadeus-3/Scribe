import { describe, it, expect } from 'vitest';
import {
  buildArticleUrl,
  normalizeArticlePathPrefix,
  stripDisallowedInternalLinks,
} from './internal-links';

describe('normalizeArticlePathPrefix', () => {
  it('normalizes to a leading-slash, no-trailing-slash form', () => {
    expect(normalizeArticlePathPrefix('blog')).toBe('/blog');
    expect(normalizeArticlePathPrefix('/blog')).toBe('/blog');
    expect(normalizeArticlePathPrefix('/blog/')).toBe('/blog');
    expect(normalizeArticlePathPrefix('  blog  ')).toBe('/blog');
  });

  it('treats empty/root values as no prefix', () => {
    expect(normalizeArticlePathPrefix('')).toBe('');
    expect(normalizeArticlePathPrefix('/')).toBe('');
    expect(normalizeArticlePathPrefix(null)).toBe('');
    expect(normalizeArticlePathPrefix(undefined)).toBe('');
  });
});

describe('buildArticleUrl', () => {
  it('joins base + prefix + slug', () => {
    expect(buildArticleUrl('https://wiselyrich.com', '/blog', 'beating-inflation')).toBe(
      'https://wiselyrich.com/blog/beating-inflation',
    );
  });

  it('works with no prefix (root)', () => {
    expect(buildArticleUrl('https://wiselyrich.com/', '', 'x')).toBe('https://wiselyrich.com/x');
  });

  it('returns null for an empty slug or invalid base', () => {
    expect(buildArticleUrl('https://x.com', '/blog', '  ')).toBeNull();
    expect(buildArticleUrl('not-a-url', '/blog', 'x')).toBeNull();
  });
});

describe('stripDisallowedInternalLinks', () => {
  const siteBaseUrl = 'https://wiselyrich.com';
  const allowedUrls = ['https://wiselyrich.com/blog/emergency-fund'];

  it('keeps an internal link that matches an allowed published post (absolute or relative)', () => {
    const md = 'See [our guide](https://wiselyrich.com/blog/emergency-fund) and [also](/blog/emergency-fund).';
    expect(stripDisallowedInternalLinks(md, { siteBaseUrl, allowedUrls })).toBe(md);
  });

  it('unwraps invented internal links (relative, bare, or same-host) to plain text', () => {
    const md =
      'Read [budgeting](/blog/does-not-exist), [savings](savings-guide), and [taxes](https://wiselyrich.com/blog/taxes).';
    expect(stripDisallowedInternalLinks(md, { siteBaseUrl, allowedUrls })).toBe(
      'Read budgeting, savings, and taxes.',
    );
  });

  it('strips ALL internal links when the allowlist is empty', () => {
    const md = 'Try [this](/blog/x) and [that](https://wiselyrich.com/y).';
    expect(stripDisallowedInternalLinks(md, { siteBaseUrl, allowedUrls: [] })).toBe(
      'Try this and that.',
    );
  });

  it('preserves external links, anchors, contact links, and images', () => {
    const md =
      '[Fed](https://federalreserve.gov/data) [jump](#section) [mail](mailto:a@b.com) ![chart](/img/c.png)';
    expect(stripDisallowedInternalLinks(md, { siteBaseUrl, allowedUrls })).toBe(md);
  });

  it('keeps an allowed link written with a trailing slash or title', () => {
    const md = '[g](https://wiselyrich.com/blog/emergency-fund/ "Emergency fund")';
    expect(stripDisallowedInternalLinks(md, { siteBaseUrl, allowedUrls })).toBe(md);
  });
});
