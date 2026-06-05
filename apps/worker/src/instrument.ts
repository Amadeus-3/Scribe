import * as Sentry from '@sentry/node';

// Worker error tracking (Spec §11). Disabled unless SENTRY_DSN is set.
// Imported first in server.ts so instrumentation is active before anything else.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
