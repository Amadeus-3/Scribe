import { NonRetriableError } from 'inngest';
import {
  prisma,
  getSettings,
  logger,
  BudgetExceededError,
  SYSTEM_ACTOR,
  autoAssignArticleTaxonomy,
  generateArticleDraft,
  generateArticleImage,
  generateArticleInlineImage,
  getGeminiApiKeyForImageGeneration,
  getOpenRouterApiKey,
  recordKeywordSkipped,
  releaseKeyword,
  suggestArticleInlineImages,
  KeywordClaimedDataSchema,
  PIPELINE_EVENTS,
} from '@scribe/core';
import { inngest } from '../inngest/client';

/**
 * Draft one claimed keyword into a complete, review-ready article.
 *
 * One Inngest run per article, rather than a loop inside the tick, because:
 * the tick is cheap and 15-minutely while this is minutes of paid LLM calls;
 * they need opposite retry policies; per-site concurrency and per-keyword
 * idempotency are inexpressible in a loop; and an individually inspectable,
 * retryable run per article is what makes the autopilot watchable.
 *
 * Enrichment stays INLINE as steps here rather than fanning out further. The
 * extras are short, share the article context, and run after the draft
 * transaction has committed — so "the article reached PENDING_REVIEW" is a
 * structural guarantee rather than a convention.
 */
/** Inngest types concurrency as a fixed tuple, so annotate rather than widen. */
const AUTODRAFT_CONCURRENCY: [{ key: string; limit: number }, { limit: number }] = [
  // Serialize per site so two drafts never race on the same budget or CMS.
  { key: 'event.data.siteId', limit: 1 },
  // Global cap: bounds worst-case budget overshoot to one in-flight call.
  { limit: 1 },
];

export const ARTICLE_AUTODRAFT_CONFIG = {
  id: 'article-autodraft',
  name: 'Autopilot: draft and enrich an article',
  retries: 2,
  // A duplicated claim event starts exactly one run.
  idempotency: 'event.data.keywordId',
  concurrency: AUTODRAFT_CONCURRENCY,
} as const;

type EnrichmentOutcome = 'ok' | 'skipped' | 'failed';

export const articleAutodraft = inngest.createFunction(
  {
    ...ARTICLE_AUTODRAFT_CONFIG,
    onFailure: async ({ event }) => {
      // Release to SKIPPED, never QUEUED. SKIPPED means "attempted, failed,
      // needs a human" — releasing to QUEUED would let the next tick re-claim
      // a structurally undraftable keyword and loop forever, 96 times a day.
      const inner = KeywordClaimedDataSchema.safeParse(event.data.event?.data);
      if (!inner.success) return;
      await releaseKeyword(prisma, inner.data.keywordId, 'SKIPPED');
      await recordKeywordSkipped(
        prisma,
        SYSTEM_ACTOR,
        inner.data.keywordId,
        event.data.error?.message ?? 'autodraft failed',
      );
    },
  },
  { event: PIPELINE_EVENTS.keywordClaimed },
  async ({ event, step }) => {
    const data = KeywordClaimedDataSchema.parse(event.data);
    const settings = await step.run('load-settings', () => getSettings(prisma));

    // FATAL: without a draft there is nothing to review.
    const drafted = await step.run('draft', async () => {
      const apiKey = await getOpenRouterApiKey(prisma, SYSTEM_ACTOR).catch(() => undefined);
      try {
        const article = await generateArticleDraft(
          prisma,
          SYSTEM_ACTOR,
          { siteId: data.siteId, keyword: data.term, keywordId: data.keywordId },
          { apiKey: apiKey ?? undefined },
        );
        // Never return the DTO: it carries imageDataBase64, which would persist
        // multi-megabyte blobs into Inngest step state on every attempt.
        return {
          articleId: article.id,
          title: article.title,
          wordCount: article.wordCount,
          seoScore: article.seoReport?.score ?? null,
        };
      } catch (e) {
        // The budget will not change inside a retry backoff, so retrying burns
        // four runs for one deterministic outcome.
        if (e instanceof BudgetExceededError) {
          throw new NonRetriableError(e.message, { cause: e });
        }
        throw e;
      }
    });

    const articleId = drafted.articleId;
    let taxonomy: EnrichmentOutcome = 'skipped';
    let heroImage: EnrichmentOutcome = 'skipped';
    let inlineOk = 0;
    let inlineFailed = 0;

    /**
     * Everything below is best-effort by design. The article has already
     * reached PENDING_REVIEW, every extra has a one-click dashboard button for
     * the reviewer to fill any gap, and each call re-checks the per-article
     * budget ceiling. A missing image is visible and recoverable; losing the
     * article would not be.
     */
    const bestEffort = async (
      name: string,
      run: () => Promise<void>,
    ): Promise<EnrichmentOutcome> => {
      try {
        await run();
        return 'ok';
      } catch (e) {
        logger.warn(
          { articleId, step: name, error: e instanceof Error ? e.message : 'unknown' },
          'autopilot enrichment step failed; article still reaches review',
        );
        return 'failed';
      }
    };

    if (settings.autopilot_assign_taxonomy) {
      taxonomy = await step.run('taxonomy', () =>
        bestEffort('taxonomy', async () => {
          const apiKey = await getOpenRouterApiKey(prisma, SYSTEM_ACTOR).catch(() => undefined);
          await autoAssignArticleTaxonomy(prisma, SYSTEM_ACTOR, articleId, {
            apiKey: apiKey ?? undefined,
          });
        }),
      );
    }

    if (settings.autopilot_generate_hero_image) {
      heroImage = await step.run('hero-image', () =>
        bestEffort('hero-image', async () => {
          const apiKey = await getGeminiApiKeyForImageGeneration(prisma, SYSTEM_ACTOR).catch(
            () => undefined,
          );
          await generateArticleImage(prisma, SYSTEM_ACTOR, articleId, {
            apiKey: apiKey ?? undefined,
          });
        }),
      );
    }

    if (settings.autopilot_generate_inline_images) {
      await step.run('suggest-inline-images', () =>
        bestEffort('suggest-inline-images', async () => {
          const existing = await prisma.articleImage.count({ where: { articleId } });
          if (existing > 0) return;
          const apiKey = await getOpenRouterApiKey(prisma, SYSTEM_ACTOR).catch(() => undefined);
          await suggestArticleInlineImages(prisma, SYSTEM_ACTOR, articleId, {
            apiKey: apiKey ?? undefined,
          });
        }),
      );

      // Freeze the list in its own step. Re-reading the DB on each attempt
      // would shift the step ids below between attempts and diverge Inngest's
      // memoization.
      const pending = await step.run('list-inline-images', async () => {
        const images = await prisma.articleImage.findMany({
          where: { articleId, dataBase64: null },
          orderBy: { position: 'asc' },
          select: { id: true },
          take: settings.autopilot_max_inline_images,
        });
        return images.map((image) => image.id);
      });

      for (const imageId of pending) {
        const outcome = await step.run(`inline-image-${imageId}`, () =>
          bestEffort(`inline-image-${imageId}`, async () => {
            const apiKey = await getGeminiApiKeyForImageGeneration(prisma, SYSTEM_ACTOR).catch(
              () => undefined,
            );
            await generateArticleInlineImage(prisma, SYSTEM_ACTOR, imageId, {
              apiKey: apiKey ?? undefined,
            });
          }),
        );
        if (outcome === 'ok') inlineOk += 1;
        else inlineFailed += 1;
      }
    }

    await step.sendEvent('emit-drafted', {
      name: PIPELINE_EVENTS.articleDrafted,
      data: {
        siteId: data.siteId,
        articleId,
        keywordId: data.keywordId,
        title: drafted.title,
        wordCount: drafted.wordCount,
        seoScore: drafted.seoScore,
        enrichment: {
          heroImage,
          inlineImages: { ok: inlineOk, failed: inlineFailed },
          taxonomy,
        },
      },
    });

    return {
      articleId,
      title: drafted.title,
      seoScore: drafted.seoScore,
      enrichment: { taxonomy, heroImage, inlineImages: { ok: inlineOk, failed: inlineFailed } },
    };
  },
);
