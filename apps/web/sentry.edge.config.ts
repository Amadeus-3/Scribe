import * as Sentry from '@sentry/nextjs';

// Edge-runtime error tracking (Spec §11). Disabled unless SENTRY_DSN is set.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
