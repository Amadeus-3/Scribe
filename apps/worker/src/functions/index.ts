import type { inngest } from '../inngest/client';
import { weeklyKeywordDiscovery } from './keyword-discovery';

type ScribeFunction = ReturnType<typeof inngest.createFunction>;

/**
 * Pipeline function registry (Spec §6.8). The weekly trending-topic discovery
 * cron is registered here; sourcing/briefing/drafting/QA/publish land in later
 * phases.
 */
export const functions: ScribeFunction[] = [weeklyKeywordDiscovery];
