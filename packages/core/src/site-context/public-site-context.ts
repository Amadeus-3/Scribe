import { lookup as defaultLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';

interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

type FetchLike = (
  url: string,
  init?: {
    headers?: Record<string, string>;
    redirect?: 'follow' | 'manual' | 'error';
    signal?: AbortSignal;
  },
) => Promise<HttpResponseLike>;

type ResolveHost = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface PublicSiteContextPage {
  url: string;
  text: string;
}

export interface PublicSiteContext {
  baseUrl: string;
  pages: PublicSiteContextPage[];
  combinedText: string;
}

const DEFAULT_PATHS = ['/', '/about', '/about-us', '/blog', '/contact'];
const MAX_PAGE_CHARS = 12_000;
const MAX_COMBINED_CHARS = 28_000;

const PublicUrlSchema = z.string().url();

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const a = parts[0] ?? -1;
  const b = parts[1] ?? -1;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized === '::'
  );
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

export async function assertPublicHttpUrl(
  rawUrl: string,
  resolveHost: ResolveHost = async (hostname) => {
    const result = await defaultLookup(hostname, { all: true });
    return result.map(({ address, family }) => ({ address, family }));
  },
): Promise<URL> {
  const parsed = new URL(PublicUrlSchema.parse(rawUrl));
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP and HTTPS site URLs can be analyzed.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost URLs cannot be analyzed as public site context.');
  }

  const literalFamily = isIP(hostname);
  const addresses =
    literalFamily === 0
      ? await resolveHost(hostname)
      : [{ address: hostname, family: literalFamily }];
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Private or local network URLs cannot be analyzed.');
  }

  return parsed;
}

function buildCandidateUrls(baseUrl: URL, paths = DEFAULT_PATHS): string[] {
  const urls = new Set<string>();
  for (const path of paths) {
    const url = new URL(path, baseUrl);
    urls.add(url.toString());
  }
  return [...urls];
}

export function extractReadableTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPageText(
  url: string,
  fetchFn: FetchLike,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
        'User-Agent': 'ScribeSiteContextBot/0.1',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers?.get('content-type')?.toLowerCase() ?? '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null;
    }
    return extractReadableTextFromHtml(await response.text()).slice(0, MAX_PAGE_CHARS);
  } finally {
    clearTimeout(timeout);
  }
}

export async function collectPublicSiteContext({
  baseUrl,
  fetchFn = fetch,
  resolveHost,
  timeoutMs = 8_000,
}: {
  baseUrl: string;
  fetchFn?: FetchLike;
  resolveHost?: ResolveHost;
  timeoutMs?: number;
}): Promise<PublicSiteContext> {
  const parsed = await assertPublicHttpUrl(baseUrl, resolveHost);
  const pages: PublicSiteContextPage[] = [];

  for (const url of buildCandidateUrls(parsed)) {
    try {
      const text = await fetchPageText(url, fetchFn, timeoutMs);
      if (text && text.length > 80) {
        pages.push({ url, text });
      }
    } catch {
      // Site context collection is best-effort; one failed public page should
      // not block analysis of the rest of the site.
    }
  }

  const combinedText = pages
    .map((page) => `URL: ${page.url}\n${page.text}`)
    .join('\n\n')
    .slice(0, MAX_COMBINED_CHARS);

  return {
    baseUrl: parsed.toString(),
    pages,
    combinedText,
  };
}
