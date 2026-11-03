import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const isProd = process.env.NODE_ENV === 'production';

// Pragmatic CSP: there is no app-authored inline <script>/dangerouslySetInnerHTML,
// so 'unsafe-inline' here only covers Next's own hydration runtime. img-src allows
// data:/blob:/https: because hero & in-body images render as base64 data URLs and
// remote CMS URLs in the review UI. Applied in production only so dev HMR (eval +
// websockets) is untouched.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // *.ingest.*.sentry.io covers region-scoped ingest hosts (o123.ingest.us.sentry.io).
  "connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io https://*.ingest.*.sentry.io",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

// Always-safe headers everywhere; CSP + HSTS only in production (HSTS needs TLS,
// terminated at the reverse proxy in the self-hosted Docker setup).
const securityHeaders: Array<{ key: string; value: string }> = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(isProd
    ? [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '7mb',
    },
  },
  // @scribe/core is consumed as TypeScript source; Next must transpile it.
  transpilePackages: ['@scribe/core'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

// `silent` suppresses missing-config warnings during local/CI builds. Source
// map generation is disabled until upload is configured (auth token + org/project
// in Phase 7/8); without upload, generating maps is wasted work.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
});
