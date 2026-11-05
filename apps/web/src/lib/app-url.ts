import { getEnv } from '@scribe/core';

/** Absolute URL on this instance, for links that leave the app (emails, copy-paste). */
export function absoluteUrl(path: string): string {
  return new URL(path, getEnv().APP_BASE_URL).toString();
}

export function appHost(): string {
  return new URL(getEnv().APP_BASE_URL).host;
}

/**
 * Only same-origin relative paths may be used as a post-login destination;
 * anything else (absolute URLs, protocol-relative `//evil`) falls back to `/`.
 */
export function safeRedirectPath(candidate: unknown): string {
  if (typeof candidate !== 'string') return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}
