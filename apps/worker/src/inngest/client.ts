import { EventSchemas, Inngest } from 'inngest';
import {
  PIPELINE_EVENTS,
  KeywordClaimedDataSchema,
  ArticleDraftedDataSchema,
  DiscoveryRequestedDataSchema,
  TickRequestedDataSchema,
  ArticleApprovedDataSchema,
} from '@scribe/core';

/**
 * Shared Inngest client (Spec §3.1, §6.8). The dashboard emits events
 * (`article.approved`, a manual tick) and the worker reacts. Event keys and
 * signing keys are supplied via env in non-dev environments.
 *
 * The schema map is the single registry of event names. A function that
 * triggers on a name missing from here is a silent dead end — nothing fires and
 * nothing errors — which is exactly what the wiring test in functions/
 * registry.test.ts exists to catch.
 *
 * NOTE: `EventSchemas` is COMPILE-TIME only. It does not validate `event.data`
 * at runtime, so every handler re-parses its payload with the same Zod schema
 * (Spec §10.1.5).
 */
export const inngest = new Inngest({
  id: 'scribe',
  schemas: new EventSchemas().fromZod({
    [PIPELINE_EVENTS.keywordClaimed]: { data: KeywordClaimedDataSchema },
    [PIPELINE_EVENTS.articleDrafted]: { data: ArticleDraftedDataSchema },
    [PIPELINE_EVENTS.discoveryRequested]: { data: DiscoveryRequestedDataSchema },
    [PIPELINE_EVENTS.tickRequested]: { data: TickRequestedDataSchema },
    [PIPELINE_EVENTS.articleApproved]: { data: ArticleApprovedDataSchema },
  }),
});
