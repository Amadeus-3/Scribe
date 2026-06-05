import * as Sentry from '@sentry/nextjs';

// Server-side error tracking (Spec §11). Disabled unless SENTRY_DSN is set.
// Read process.env directly — Sentry init must not depend on full env validation.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    // Do not capture PII; secret scrubbing is hardened further in Phase 7.
    sendDefaultPii: false,
  });
}
