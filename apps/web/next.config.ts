import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @scribe/core is consumed as TypeScript source; Next must transpile it.
  transpilePackages: ['@scribe/core'],
};

// `silent` suppresses missing-config warnings during local/CI builds. Source
// map generation is disabled until upload is configured (auth token + org/project
// in Phase 7/8); without upload, generating maps is wasted work.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
});
