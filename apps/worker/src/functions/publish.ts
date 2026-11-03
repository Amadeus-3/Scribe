import { NonRetriableError } from 'inngest';
import { ZodError } from 'zod';
import {
  prisma,
  logger,
  publishArticleToCms,
  ArticlePublishError,
  HumanActorRequiredError,
  IllegalArticleTransitionError,
  ArticleApprovedDataSchema,
  PIPELINE_EVENTS,
} from '@scribe/core';
import { inngest } from '../inngest/client';

/**
 * Publish an article a human approved (Spec §10.1.1).
 *
 * This is the ONLY automated path to the CMS, and it exists only because a
 * human pressed Approve. The `actorId` in the payload is a claim, not proof:
 * `publishArticleToCms` re-loads that user from the database, confirms they are
 * a real human with publish rights, and matches the payload's `reviewId`
 * against a Review row that only an authenticated session could have written.
 * A cron cannot satisfy any of that.
 *
 * Per-article concurrency of 1 means a double-clicked Approve is serialized
 * rather than raced; the deterministic idempotency key then makes the second
 * attempt a no-op.
 */
export const PUBLISH_RUN_CONFIG = {
  id: 'publish-run',
  name: 'Publish approved article',
  retries: 3,
  concurrency: { key: 'event.data.articleId', limit: 1 },
} as const;

export const publishOnApproval = inngest.createFunction(
  PUBLISH_RUN_CONFIG,
  { event: PIPELINE_EVENTS.articleApproved },
  async ({ event, step }) => {
    // An event payload is external input, and EventSchemas is compile-time
    // only, so validate before trusting a single field (Spec §10.1.5).
    const data = ArticleApprovedDataSchema.parse(event.data);

    return step.run('publish', async () => {
      try {
        const article = await publishArticleToCms(
          prisma,
          { id: data.actorId },
          data.articleId,
          { approval: { origin: 'approval_event', reviewId: data.reviewId } },
        );
        return { articleId: article.id, status: article.status };
      } catch (e) {
        // A security denial, an illegal state, or a malformed payload is
        // permanent. Retrying turns one blocked attempt into four, spamming the
        // audit log with identical publishBlocked rows and hiding the signal.
        if (
          e instanceof HumanActorRequiredError ||
          e instanceof IllegalArticleTransitionError ||
          e instanceof ZodError
        ) {
          logger.warn(
            { articleId: data.articleId, reason: e.name },
            'publish refused permanently; not retrying',
          );
          throw new NonRetriableError(e.message, { cause: e });
        }
        // ArticlePublishError wraps CMS/network failures, which are worth
        // retrying; the article is already at PUBLISH_FAILED and the human can
        // also retry by hand.
        if (e instanceof ArticlePublishError) throw e;
        throw e;
      }
    });
  },
);
