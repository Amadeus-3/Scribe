import {
  prisma,
  getEnv,
  getSettings,
  logger,
  buildReviewDigest,
  listUnnotifiedForReview,
  markReviewNotified,
  resolveDigestRecipients,
  sendEmail,
} from '@scribe/core';
import { inngest } from '../inngest/client';

/**
 * Tell the reviewer what is waiting for them.
 *
 * Runs hourly and checks the configured hour itself, rather than encoding the
 * hour in the cron, so the send time stays editable from the dashboard like
 * every other autopilot setting.
 */
export const REVIEW_DIGEST_CONFIG = {
  id: 'review-digest',
  name: 'Review digest email',
  retries: 1,
  concurrency: { limit: 1 },
} as const;

export const reviewDigest = inngest.createFunction(
  REVIEW_DIGEST_CONFIG,
  { cron: '0 * * * *' },
  async ({ step }) => {
    const settings = await step.run('load-settings', () => getSettings(prisma));
    if (!settings.review_digest_enabled) {
      return { skipped: 'review_digest_enabled is false' };
    }
    if (new Date().getUTCHours() !== settings.review_digest_hour_utc) {
      return { skipped: 'outside the configured digest hour' };
    }

    const articles = await step.run('list-pending', () => listUnnotifiedForReview(prisma));
    const digest = buildReviewDigest({
      articles: articles.map((article) => ({ ...article, createdAt: new Date(article.createdAt) })),
      appBaseUrl: getEnv().APP_BASE_URL,
      minArticles: settings.review_digest_min_articles,
    });
    if (!digest) {
      return { skipped: 'nothing to report', pending: articles.length };
    }

    const recipients = await step.run('resolve-recipients', () =>
      resolveDigestRecipients(prisma, settings.review_digest_recipients),
    );

    const sent = await step.run('send', () => sendEmail(prisma, { to: recipients, ...digest }));
    if (!sent) {
      return { skipped: 'email not configured', pending: articles.length };
    }

    // Marked AFTER a successful send, deliberately. This gives at-least-once
    // delivery: a send that succeeds and a mark that fails produces a duplicate
    // email, which is the right failure direction for a notification. Marking
    // first would risk silently never telling anyone.
    const marked = await step.run('mark-notified', () =>
      markReviewNotified(
        prisma,
        articles.map((article) => article.id),
      ),
    );

    logger.info({ recipients: recipients.length, articles: marked }, 'review digest sent');
    return { sent: true, recipients: recipients.length, articles: marked };
  },
);
