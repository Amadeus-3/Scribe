import 'server-only';
import { EventSchemas, Inngest } from 'inngest';
import {
  PIPELINE_EVENTS,
  ArticleApprovedDataSchema,
  TickRequestedDataSchema,
  type ArticleApprovedEmitter,
  type ArticleApprovedData,
  type TickRequestedData,
} from '@scribe/core';

/**
 * Outbound-only Inngest client for the dashboard.
 *
 * The dashboard SENDS events; the worker SERVES them. There is deliberately no
 * `/api/inngest` route here: the auth middleware matcher would gate it, and
 * excluding it from the matcher would create a second, unauthenticated entry
 * point into publish logic. Sending needs no route.
 *
 * `import 'server-only'` keeps this out of the client bundle graph.
 */
const inngest = new Inngest({
  id: 'scribe-web',
  schemas: new EventSchemas().fromZod({
    [PIPELINE_EVENTS.articleApproved]: { data: ArticleApprovedDataSchema },
    [PIPELINE_EVENTS.tickRequested]: { data: TickRequestedDataSchema },
  }),
});

/**
 * Announce that a human approved an article.
 *
 * The event id is keyed on `reviewId`, NOT on version: a genuine re-approval
 * after a failed publish carries the same version and must not be swallowed by
 * Inngest's dedupe. Duplicate publishing is prevented at the CMS boundary by
 * the deterministic idempotency key instead.
 */
export const emitArticleApproved: ArticleApprovedEmitter = async (
  payload: ArticleApprovedData,
) => {
  await inngest.send({
    name: PIPELINE_EVENTS.articleApproved,
    id: `${PIPELINE_EVENTS.articleApproved}:${payload.reviewId}`,
    data: payload,
  });
};

/** Ask the autopilot to evaluate now instead of waiting for the next tick. */
export async function emitTickRequested(data: TickRequestedData): Promise<void> {
  await inngest.send({ name: PIPELINE_EVENTS.tickRequested, data });
}
