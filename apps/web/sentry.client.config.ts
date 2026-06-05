import * as Sentry from '@sentry/nextjs';

// Browser error tracking (Spec §11). Disabled unless the public DSN is set.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}
