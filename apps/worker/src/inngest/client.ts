import { Inngest } from 'inngest';

/**
 * Shared Inngest client (Spec §3.1, §6.8). The dashboard emits events
 * (e.g. `article.approved`) and the worker reacts. Event keys/signing keys are
 * supplied via env in non-dev environments.
 */
export const inngest = new Inngest({ id: 'scribe' });
