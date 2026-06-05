import type { inngest } from '../inngest/client';

type ScribeFunction = ReturnType<typeof inngest.createFunction>;

/**
 * Pipeline function registry (Spec §6.8). The sourcing, briefing, drafting, QA,
 * and publish functions are registered here in later phases. Empty for Phase 0.
 */
export const functions: ScribeFunction[] = [];
