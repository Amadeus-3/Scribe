// Next.js instrumentation hook — loads the Sentry runtime config for the
// active server runtime (Spec §11). Client config is injected by the Sentry
// build plugin from sentry.client.config.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
