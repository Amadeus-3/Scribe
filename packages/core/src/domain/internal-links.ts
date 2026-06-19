/**
 * Internal-link handling for generated articles.
 *
 * The drafting model cannot know which pages exist on the target site, so any
 * internal link it invents usually 404s. We instead give it the real URLs of the
 * site's existing published posts (the only valid internal targets) and, as a
 * hard guarantee, strip any internal link the output still contains that is not
 * on that allowlist. External links, in-page `#anchors`, contact links, and
 * images are always preserved.
 */

/**
 * Normalize a site's article path prefix to a leading-slash, no-trailing-slash
 * form ("" means posts live at the site root). Accepts "blog", "/blog",
 * "/blog/", "  blog  " → "/blog"; "", "/", null, undefined → "".
 */
export function normalizeArticlePathPrefix(prefix: string | null | undefined): string {
  const trimmed = (prefix ?? '').trim();
  if (!trimmed || trimmed === '/') return '';
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLead.replace(/\/+$/, '');
}

/**
 * Build the public URL of a published post: `{baseUrl}{prefix}/{slug}`.
 * Returns null when the base URL is invalid or the slug is empty.
 */
export function buildArticleUrl(
  baseUrl: string,
  prefix: string | null | undefined,
  slug: string,
): string | null {
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, '');
  if (!cleanSlug) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  url.pathname = `${normalizeArticlePathPrefix(prefix)}/${cleanSlug}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** A canonical `host/path` (lowercased, no trailing slash, no query/hash) for comparison. */
function canonicalKey(absoluteUrl: string): string | null {
  try {
    const url = new URL(absoluteUrl);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

const LINK_PATTERN = /(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/**
 * Remove internal Markdown links whose target is not in `allowedUrls`, keeping
 * the anchor text. A link is "internal" when it is a relative path or an
 * absolute URL on the same host as the site. External links, `#fragment`
 * anchors, `mailto:`/`tel:` links, and images (`![alt](src)`) are left intact.
 * An empty allowlist therefore strips every internal link.
 */
export function stripDisallowedInternalLinks(
  markdown: string,
  args: { siteBaseUrl: string; allowedUrls: string[] },
): string {
  if (!markdown) return markdown;

  let siteOrigin: string;
  let siteHost: string;
  try {
    const base = new URL(args.siteBaseUrl);
    siteOrigin = base.origin;
    siteHost = base.host.toLowerCase();
  } catch {
    // Without a valid site URL we cannot tell internal from external — leave the
    // content untouched rather than risk stripping legitimate external links.
    return markdown;
  }

  const allowed = new Set(
    args.allowedUrls.map((u) => canonicalKey(u)).filter((k): k is string => k !== null),
  );

  return markdown.replace(LINK_PATTERN, (match, bang: string, text: string, href: string) => {
    if (bang === '!') return match; // image — never touch
    const target = href.trim();
    if (!target) return text;
    if (target.startsWith('#')) return match; // in-page anchor
    if (/^(mailto:|tel:|sms:)/i.test(target)) return match; // contact link

    let resolved: URL;
    try {
      resolved = new URL(target, `${siteOrigin}/`);
    } catch {
      return text; // unparseable → treat as a broken internal reference
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return match;
    if (resolved.host.toLowerCase() !== siteHost) return match; // external — keep

    // Internal link: keep only if it resolves to a known published post.
    const key = `${resolved.host.toLowerCase()}${resolved.pathname.replace(/\/+$/, '')}`;
    return allowed.has(key) ? match : text;
  });
}
