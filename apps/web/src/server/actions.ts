'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  prisma,
  createSite,
  getSite,
  updateSite,
  deleteSite,
  setSiteStatus,
  setSiteCredentials,
  getSiteCredentials,
  addKeywords,
  authorize,
  deleteKeyword,
  requeueKeyword,
  upsertStyleGuide,
  runSiteDiscovery,
  setGscServiceAccount,
  getSettingsForActor,
  updateSetting,
  parseKeywordSeedList,
  parseBannedPhrases,
  parseTopicLines,
  issueInviteCode,
  issuePasswordResetCode,
  changeOwnPassword,
  inviteEmail,
  resolveEmailConfig,
  sendEmailWith,
  EmailConfigError,
  EmailSendError,
  setEmailConfig,
  clearEmailConfig,
  sendTestEmail,
  getEnv,
  inviteUser,
  updateUserRole,
  setUserStatus,
  deleteInvitation,
  OpenRouterError,
  StyleGuideSuggestionError,
  ArticleDraftError,
  assertWithinBudget,
  recordUsage,
  computeTextCostUsd,
  GeminiImageError,
  collectPublicSiteContext,
  fetchOpenRouterTextModels,
  buildOpenRouterPricingCatalog,
  suggestStyleGuideWithOpenRouter,
  generateArticleDraft,
  updateArticleDraft,
  updateArticleKeyword,
  regenerateArticleDraft,
  autoAssignArticleTaxonomy,
  suggestArticleInlineImages,
  approveArticle,
  requestArticleChanges,
  rejectArticle,
  publishArticleToCms,
  uploadArticleImage,
  generateArticleImage,
  uploadArticleInlineImage,
  generateArticleInlineImage,
  ArticlePublishError,
  isArticleImageMimeType,
  MAX_ARTICLE_IMAGE_BYTES,
  getGeminiApiKeyForImageGeneration,
  getOpenRouterApiKey,
  setGeminiApiKey,
  setOpenRouterApiKey,
  logger,
  type SettingKey,
} from '@scribe/core';
import { emitArticleApproved, emitTickRequested } from './publish-events';
import { requireActor } from '@/lib/session';
import { absoluteUrl, appHost } from '@/lib/app-url';
import { toState, str, type FormState } from './form-state';

export type { FormState };

const optStr = (v: FormDataEntryValue | null): string | undefined => {
  const s = str(v).trim();
  return s.length > 0 ? s : undefined;
};

function fileFromForm(value: FormDataEntryValue | null): File | null {
  return value &&
    typeof value === 'object' &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function'
    ? (value as File)
    : null;
}

export async function createSiteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor();
    await createSite(prisma, actor, {
      name: str(formData.get('name')),
      baseUrl: str(formData.get('baseUrl')),
      articlePathPrefix: optStr(formData.get('articlePathPrefix')),
      cmsType: str(formData.get('cmsType')) === 'WORDPRESS' ? 'WORDPRESS' : 'STRAPI',
      defaultAuthor: optStr(formData.get('defaultAuthor')),
      briefAutoApprove: formData.get('briefAutoApprove') === 'on',
      gscPropertyUrl: optStr(formData.get('gscPropertyUrl')),
      discoveryEnabled: formData.get('discoveryEnabled') === 'on',
      autopilotEnabled: formData.get('autopilotEnabled') === 'on',
      autopilotArticlesPerWeek: numFromForm(formData.get('autopilotArticlesPerWeek')) ?? null,
    });
    revalidatePath('/sites');
    return { ok: true, message: 'Site created.' };
  } catch (e) {
    return toState('site.create', e);
  }
}

export async function updateSiteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await updateSite(prisma, actor, id, {
      name: str(formData.get('name')),
      baseUrl: str(formData.get('baseUrl')),
      articlePathPrefix: optStr(formData.get('articlePathPrefix')),
      cmsType: str(formData.get('cmsType')) === 'STRAPI' ? 'STRAPI' : 'WORDPRESS',
      defaultAuthor: optStr(formData.get('defaultAuthor')),
      briefAutoApprove: formData.get('briefAutoApprove') === 'on',
      gscPropertyUrl: optStr(formData.get('gscPropertyUrl')),
      discoveryEnabled: formData.get('discoveryEnabled') === 'on',
      autopilotEnabled: formData.get('autopilotEnabled') === 'on',
      autopilotArticlesPerWeek: numFromForm(formData.get('autopilotArticlesPerWeek')) ?? null,
    });
    revalidatePath(`/sites/${id}`);
    revalidatePath('/sites');
    return { ok: true, message: 'Site updated.' };
  } catch (e) {
    return toState('site.update', e);
  }
}

export async function deleteSiteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    const site = await getSite(prisma, actor, id);
    if (!site) {
      return { ok: false, error: 'Site not found.' };
    }
    if (str(formData.get('confirmName')).trim() !== site.name) {
      return { ok: false, error: `Type "${site.name}" to delete this site.` };
    }
    await deleteSite(prisma, actor, id);
    revalidatePath('/sites');
  } catch (e) {
    return toState('site.delete', e);
  }

  redirect('/sites');
}

export async function setSiteStatusAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = str(formData.get('id'));
  const status = str(formData.get('status')) === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
  await setSiteStatus(prisma, actor, id, status);
  revalidatePath('/sites');
  revalidatePath(`/sites/${id}`);
}

export async function setCredentialsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    const cmsType = str(formData.get('cmsType'));
    const enteredStrapiToken = optStr(formData.get('apiToken'));
    const enteredWordPressPassword = optStr(formData.get('applicationPassword'));
    const existingCredentials =
      (cmsType === 'STRAPI' && !enteredStrapiToken) ||
      (cmsType !== 'STRAPI' && !enteredWordPressPassword)
        ? await getSiteCredentials(prisma, actor, id)
        : null;
    await setSiteCredentials(
      prisma,
      actor,
      id,
      cmsType === 'STRAPI'
        ? {
            cmsType: 'STRAPI',
            apiToken:
              enteredStrapiToken ??
              (existingCredentials?.cmsType === 'STRAPI' ? existingCredentials.apiToken : ''),
            apiBaseUrl: optStr(formData.get('apiBaseUrl')),
            collectionApiId: str(formData.get('collectionApiId')),
            fieldMap: {
              title: str(formData.get('fieldMap.title')),
              slug: str(formData.get('fieldMap.slug')),
              content: str(formData.get('fieldMap.content')),
              metaDescription: optStr(formData.get('fieldMap.metaDescription')),
              image: optStr(formData.get('fieldMap.image')),
              readTime: optStr(formData.get('fieldMap.readTime')),
              author: optStr(formData.get('fieldMap.author')),
              date: optStr(formData.get('fieldMap.date')),
              featured: optStr(formData.get('fieldMap.featured')),
            },
            contentFormat:
              str(formData.get('contentFormat')) === 'STRAPI_BLOCKS'
                ? 'STRAPI_BLOCKS'
                : str(formData.get('contentFormat')) === 'MARKDOWN'
                  ? 'MARKDOWN'
                  : 'HTML',
            publicationStatus:
              str(formData.get('publicationStatus')) === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
            locale: optStr(formData.get('locale')),
          }
        : {
            cmsType: 'WORDPRESS',
            username: str(formData.get('username')),
            applicationPassword:
              enteredWordPressPassword ??
              (existingCredentials?.cmsType === 'WORDPRESS'
                ? existingCredentials.applicationPassword
                : ''),
          },
    );
    revalidatePath(`/sites/${id}`);
    return { ok: true, message: 'Credentials saved (encrypted).' };
  } catch (e) {
    return toState('site.credentials.update', e);
  }
}

export async function addKeywordsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const actor = await requireActor();
    const siteId = str(formData.get('siteId'));
    const terms = parseKeywordSeedList(str(formData.get('terms')));
    const created = await addKeywords(prisma, actor, { siteId, terms });
    revalidatePath(`/sites/${siteId}`);
    return { ok: true, message: `Added ${created} keyword${created === 1 ? '' : 's'}.` };
  } catch (e) {
    return toState('keywords.add', e);
  }
}

export async function deleteKeywordAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const id = str(formData.get('id'));
  const siteId = str(formData.get('siteId'));
  await deleteKeyword(prisma, actor, id);
  revalidatePath(`/sites/${siteId}`);
}

/**
 * Put a keyword the autopilot gave up on back in the queue.
 *
 * Void-returning to match the sibling Remove button's plain-form usage.
 */
export async function requeueKeywordAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  authorize(actor, 'keyword.create');
  const id = str(formData.get('id'));
  const siteId = str(formData.get('siteId'));
  await requeueKeyword(prisma, actor, id);
  revalidatePath(`/sites/${siteId}`);
}

/**
 * Ask the autopilot to evaluate immediately rather than waiting for the next
 * tick. Grants no publish authority: the tick can only draft.
 */
export async function runAutopilotNowAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    authorize(actor, 'article.create');
    const siteId = str(formData.get('siteId'));
    await emitTickRequested({ actorId: actor.id, ...(siteId ? { siteId } : {}) });
    return { ok: true, message: 'Autopilot run requested.' };
  } catch (e) {
    return toState('autopilot.runNow', e);
  }
}

export async function discoverKeywordsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const siteId = str(formData.get('siteId'));
    const result = await runSiteDiscovery(prisma, actor, siteId);
    revalidatePath(`/sites/${siteId}`);
    const sourcesNote =
      Object.entries(result.bySource)
        .map(([source, n]) => `${source.replaceAll('_', ' ')}: ${n}`)
        .join(', ') || 'no sources active';
    const errorNote = result.errors.length > 0 ? ` (${result.errors.length} source error[s])` : '';
    return {
      ok: true,
      message: `Discovered ${result.candidates} candidate${result.candidates === 1 ? '' : 's'}; queued ${result.created} new (${sourcesNote})${errorNote}.`,
    };
  } catch (e) {
    if (e instanceof OpenRouterError || e instanceof ArticleDraftError) {
      return { ok: false, error: e.message };
    }
    return toState('keywords.discover', e);
  }
}

export async function setGscServiceAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    await setGscServiceAccount(prisma, actor, str(formData.get('serviceAccountJson')));
    revalidatePath('/settings');
    return { ok: true, message: 'Google Search Console key saved (encrypted).' };
  } catch (e) {
    return toState('gsc.credentials.update', e);
  }
}

export async function upsertStyleGuideAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const siteId = str(formData.get('siteId'));
    await upsertStyleGuide(prisma, actor, siteId, {
      systemPrompt: str(formData.get('systemPrompt')),
      businessContext: optStr(formData.get('businessContext')),
      audienceNotes: optStr(formData.get('audienceNotes')),
      seoGuidance: optStr(formData.get('seoGuidance')),
      imagePromptInstructions: optStr(formData.get('imagePromptInstructions')),
      toneNotes: optStr(formData.get('toneNotes')),
      formattingRules: optStr(formData.get('formattingRules')),
      readingLevel: optStr(formData.get('readingLevel')),
      bannedPhrases: parseBannedPhrases(str(formData.get('bannedPhrases'))),
      topicPillars: parseTopicLines(str(formData.get('topicPillars'))),
      topicClusters: parseTopicLines(str(formData.get('topicClusters'))),
      excludedTopics: parseTopicLines(str(formData.get('excludedTopics'))),
      geo: optStr(formData.get('geo')),
    });
    revalidatePath(`/sites/${siteId}`);
    return { ok: true, message: 'Style guide saved.' };
  } catch (e) {
    return toState('styleGuide.upsert', e);
  }
}

export async function suggestStyleGuideAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const siteId = str(formData.get('siteId'));
    const notes = optStr(formData.get('contextNotes'));
    const site = await getSite(prisma, actor, siteId);
    if (!site) {
      return { ok: false, error: 'Site not found.' };
    }

    const settings = await getSettingsForActor(prisma, actor);
    const apiKey = await getOpenRouterApiKey(prisma, actor);
    const context = await collectPublicSiteContext({ baseUrl: site.baseUrl });

    await assertWithinBudget(prisma, {});
    const { suggestion, usage } = await suggestStyleGuideWithOpenRouter({
      apiKey,
      model: settings.models.brief,
      siteName: site.name,
      siteUrl: site.baseUrl,
      siteText: context.combinedText,
      notes,
    });
    await recordUsage(prisma, {
      provider: 'openrouter',
      model: settings.models.brief,
      purpose: 'style_guide',
      usage,
      costUsd: computeTextCostUsd(settings.pricing, settings.models.brief, usage),
    });

    await upsertStyleGuide(prisma, actor, siteId, suggestion);
    revalidatePath(`/sites/${siteId}`);
    return {
      ok: true,
      message: `AI suggested a style guide from ${context.pages.length} public page${context.pages.length === 1 ? '' : 's'}.`,
    };
  } catch (e) {
    if (e instanceof StyleGuideSuggestionError) {
      logger.warn(
        { action: 'styleGuide.suggest', errorMessage: e.message },
        'AI suggestion failed',
      );
      return { ok: false, error: e.message };
    }
    return toState('styleGuide.suggest', e);
  }
}

export async function generateArticleDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let articleId: string | null = null;
  try {
    const actor = await requireActor();
    const siteId = str(formData.get('siteId'));
    const article = await generateArticleDraft(
      prisma,
      actor,
      {
        siteId,
        keyword: str(formData.get('keyword')),
        instructions: optStr(formData.get('instructions')),
      },
      {
        apiKey: await getOpenRouterApiKey(prisma, actor),
      },
    );
    articleId = article.id;
    revalidatePath(`/sites/${siteId}`);
    revalidatePath('/articles');
    revalidatePath(`/articles/${article.id}`);
  } catch (e) {
    if (e instanceof ArticleDraftError) {
      logger.warn({ action: 'article.draft', errorMessage: e.message }, 'article draft failed');
      return { ok: false, error: e.message };
    }
    return toState('article.draft', e);
  }

  redirect(`/articles/${articleId}`);
}

/**
 * One-click "Generate" from a queued keyword row. Drafts an article for the
 * keyword and redirects to its review page on success; on failure it returns the
 * error so the button can surface it inline (e.g. "An article already exists for
 * this keyword.").
 */
export async function generateFromKeywordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let articleId: string | null = null;
  try {
    const actor = await requireActor();
    const siteId = str(formData.get('siteId'));
    const article = await generateArticleDraft(
      prisma,
      actor,
      { siteId, keyword: str(formData.get('keyword')) },
      { apiKey: await getOpenRouterApiKey(prisma, actor) },
    );
    articleId = article.id;
    revalidatePath(`/sites/${siteId}`);
    revalidatePath('/articles');
  } catch (e) {
    if (e instanceof ArticleDraftError) {
      logger.warn({ action: 'keyword.generate', errorMessage: e.message }, 'generate failed');
      return { ok: false, error: e.message };
    }
    return toState('keyword.generate', e);
  }
  redirect(`/articles/${articleId}`);
}

export async function updateArticleDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    const hasTaxonomyPicker = formData.get('taxonomyPicker') === '1';
    await updateArticleDraft(prisma, actor, id, {
      title: str(formData.get('title')),
      slug: optStr(formData.get('slug')),
      metaDescription: optStr(formData.get('metaDescription')),
      imagePrompt: optStr(formData.get('imagePrompt')),
      contentMarkdown: str(formData.get('contentMarkdown')),
      ...(hasTaxonomyPicker
        ? {
            categorySlug: str(formData.get('categorySlug')),
            tagSlugs: formData.getAll('tagSlugs').map(String),
          }
        : {}),
    });
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Article saved.' };
  } catch (e) {
    return toState('article.update', e);
  }
}

export async function autoAssignTaxonomyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await autoAssignArticleTaxonomy(prisma, actor, id, {
      apiKey: await getOpenRouterApiKey(prisma, actor),
    });
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Category & tags assigned by AI.' };
  } catch (e) {
    if (e instanceof ArticleDraftError) {
      logger.warn(
        { action: 'article.taxonomy.assign', errorMessage: e.message },
        'classify failed',
      );
      return { ok: false, error: e.message };
    }
    return toState('article.taxonomy.assign', e);
  }
}

export async function updateArticleKeywordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await updateArticleKeyword(prisma, actor, id, str(formData.get('keyword')));
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Keyword updated and re-scored.' };
  } catch (e) {
    return toState('article.keyword.update', e);
  }
}

export async function regenerateArticleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await regenerateArticleDraft(
      prisma,
      actor,
      id,
      { comments: optStr(formData.get('comments')) },
      { apiKey: await getOpenRouterApiKey(prisma, actor) },
    );
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Article regenerated.' };
  } catch (e) {
    if (e instanceof ArticleDraftError) {
      logger.warn({ action: 'article.regenerate', errorMessage: e.message }, 'regenerate failed');
      return { ok: false, error: e.message };
    }
    return toState('article.regenerate', e);
  }
}

export async function suggestInlineImagesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    const created = await suggestArticleInlineImages(prisma, actor, id, {
      apiKey: await getOpenRouterApiKey(prisma, actor),
    });
    revalidatePath(`/articles/${id}`);
    return {
      ok: true,
      message:
        created.length > 0
          ? `Suggested ${created.length} in-body image${created.length === 1 ? '' : 's'}.`
          : 'No in-body images needed for this article.',
    };
  } catch (e) {
    if (e instanceof ArticleDraftError) {
      logger.warn(
        { action: 'article.inlineImages.suggest', errorMessage: e.message },
        'suggest failed',
      );
      return { ok: false, error: e.message };
    }
    return toState('article.inlineImages.suggest', e);
  }
}

export async function approveArticleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    const result = await approveArticle(prisma, actor, id, { emit: emitArticleApproved });
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);

    // The approval always stands; only the publishing half can degrade, and the
    // reviewer is told exactly how so they can use the Publish button.
    switch (result.publish) {
      case 'queued':
        return { ok: true, message: 'Article approved. Publishing to the CMS now.' };
      case 'blocked_preconditions':
        return {
          ok: true,
          message: `Article approved, but not published: ${result.publishNote}`,
        };
      case 'emit_failed':
        return { ok: true, message: `Article approved. ${result.publishNote}` };
      default:
        return { ok: true, message: 'Article approved.' };
    }
  } catch (e) {
    return toState('article.approve', e);
  }
}

export async function requestArticleChangesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await requestArticleChanges(prisma, actor, id, optStr(formData.get('reason')));
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Changes requested.' };
  } catch (e) {
    return toState('article.requestChanges', e);
  }
}

export async function rejectArticleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await rejectArticle(prisma, actor, id, optStr(formData.get('reason')));
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Article rejected.' };
  } catch (e) {
    return toState('article.reject', e);
  }
}

export async function publishArticleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await publishArticleToCms(prisma, actor, id);
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Article published to the CMS.' };
  } catch (e) {
    if (e instanceof ArticlePublishError) {
      logger.warn({ action: 'article.publish', errorMessage: e.message }, 'publish failed');
      return { ok: false, error: e.message };
    }
    return toState('article.publish', e);
  }
}

export async function uploadArticleImageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    const imageFile = fileFromForm(formData.get('imageFile'));
    if (!imageFile || imageFile.size === 0) {
      return { ok: false, error: 'Choose an image file to upload.' };
    }
    if (imageFile.size > MAX_ARTICLE_IMAGE_BYTES) {
      return { ok: false, error: 'Upload an image smaller than 5 MB.' };
    }
    if (!isArticleImageMimeType(imageFile.type)) {
      return { ok: false, error: 'Upload a JPEG, PNG, WebP, AVIF, or GIF image.' };
    }

    const dataBase64 = Buffer.from(await imageFile.arrayBuffer()).toString('base64');
    await uploadArticleImage(prisma, actor, id, {
      mimeType: imageFile.type,
      dataBase64,
    });
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Image uploaded.' };
  } catch (e) {
    return toState('article.image.upload', e);
  }
}

export async function generateArticleImageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await generateArticleImage(prisma, actor, id, {
      apiKey: await getGeminiApiKeyForImageGeneration(prisma, actor),
    });
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Image generated.' };
  } catch (e) {
    if (e instanceof GeminiImageError) {
      logger.warn({ action: 'article.image.generate', errorMessage: e.message }, 'image failed');
      return { ok: false, error: e.message };
    }
    return toState('article.image.generate', e);
  }
}

export async function uploadArticleInlineImageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const articleId = str(formData.get('articleId'));
    const imageId = str(formData.get('imageId'));
    const imageFile = fileFromForm(formData.get('imageFile'));
    if (!imageFile || imageFile.size === 0) {
      return { ok: false, error: 'Choose an image file to upload.' };
    }
    if (imageFile.size > MAX_ARTICLE_IMAGE_BYTES) {
      return { ok: false, error: 'Upload an image smaller than 5 MB.' };
    }
    if (!isArticleImageMimeType(imageFile.type)) {
      return { ok: false, error: 'Upload a JPEG, PNG, WebP, AVIF, or GIF image.' };
    }

    const dataBase64 = Buffer.from(await imageFile.arrayBuffer()).toString('base64');
    await uploadArticleInlineImage(prisma, actor, imageId, {
      mimeType: imageFile.type,
      dataBase64,
    });
    revalidatePath(`/articles/${articleId}`);
    return { ok: true, message: 'In-body image uploaded.' };
  } catch (e) {
    return toState('article.inlineImage.upload', e);
  }
}

export async function generateArticleInlineImageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const articleId = str(formData.get('articleId'));
    const imageId = str(formData.get('imageId'));
    await generateArticleInlineImage(prisma, actor, imageId, {
      apiKey: await getGeminiApiKeyForImageGeneration(prisma, actor),
    });
    revalidatePath(`/articles/${articleId}`);
    return { ok: true, message: 'In-body image generated.' };
  } catch (e) {
    if (e instanceof GeminiImageError) {
      logger.warn(
        { action: 'article.inlineImage.generate', errorMessage: e.message },
        'image failed',
      );
      return { ok: false, error: e.message };
    }
    return toState('article.inlineImage.generate', e);
  }
}

const NUMERIC_SETTINGS: SettingKey[] = [
  'monthly_budget_usd',
  'per_article_cost_ceiling_usd',
  'keyword_buffer_target',
  'briefs_per_run',
  'max_regen',
  'autopilot_articles_per_week',
  'autopilot_min_spacing_minutes',
  'autopilot_max_unreviewed',
  'autopilot_max_concurrent_drafts',
  'autopilot_max_inline_images',
  'autopilot_budget_reserve_pct',
  'autopilot_stale_claim_minutes',
  'autopilot_keyword_buffer_low_water',
  'review_digest_hour_utc',
  'review_digest_min_articles',
];

/**
 * Booleans need their own pass and cannot join the numeric loop: an unchecked
 * HTML checkbox submits NOTHING, so absence has to be written as an explicit
 * `false` rather than skipped like a blank number field.
 */
const BOOLEAN_SETTINGS: SettingKey[] = [
  'discovery_cron_enabled',
  'autopilot_enabled',
  'autopilot_generate_hero_image',
  'autopilot_generate_inline_images',
  'autopilot_assign_taxonomy',
  'review_digest_enabled',
];

/**
 * Parse a numeric form field, or undefined when it is blank or unparseable.
 * `Number('abc')` is NaN, which Zod rejects with a raw ZodError that would
 * surface at the user and fail the whole save over one stray character.
 */
function numFromForm(value: FormDataEntryValue | null): number | undefined {
  const raw = str(value);
  if (raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Split a comma/newline separated email list, dropping blanks. */
function parseEmailList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function updateSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    for (const key of NUMERIC_SETTINGS) {
      const value = numFromForm(formData.get(key));
      if (value === undefined) continue;
      await updateSetting(prisma, actor, key, value);
    }
    for (const key of BOOLEAN_SETTINGS) {
      await updateSetting(prisma, actor, key, formData.get(key) === 'on');
    }
    const models = {
      brief: str(formData.get('models.brief')),
      draft: str(formData.get('models.draft')),
      qa: str(formData.get('models.qa')),
    };
    if (models.brief && models.draft && models.qa) {
      await updateSetting(prisma, actor, 'models', models);
    }
    const imageModel = str(formData.get('imageGeneration.model'));
    if (imageModel) {
      await updateSetting(prisma, actor, 'imageGeneration', {
        provider: 'gemini',
        model: imageModel,
      });
    }
    // Nested objects and arrays need bespoke assembly, like `models` above.
    const startHour = numFromForm(formData.get('autopilot_run_window.startHour'));
    const endHour = numFromForm(formData.get('autopilot_run_window.endHour'));
    const tzOffset = numFromForm(formData.get('autopilot_run_window.timezoneOffsetMinutes'));
    if (startHour !== undefined || endHour !== undefined || tzOffset !== undefined) {
      const days = formData
        .getAll('autopilot_run_window.daysOfWeek')
        .map((entry) => Number(str(entry)))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
      await updateSetting(prisma, actor, 'autopilot_run_window', {
        daysOfWeek: days,
        startHour: startHour ?? 0,
        endHour: endHour ?? 24,
        timezoneOffsetMinutes: tzOffset ?? 0,
      });
    }

    const recipientsRaw = formData.get('review_digest_recipients');
    if (recipientsRaw !== null) {
      // Zod's .email() rejects malformed entries, surfaced via toState.
      await updateSetting(
        prisma,
        actor,
        'review_digest_recipients',
        parseEmailList(str(recipientsRaw)),
      );
    }

    revalidatePath('/settings');
    return { ok: true, message: 'Settings saved.' };
  } catch (e) {
    return toState('settings.update', e);
  }
}

export async function setOpenRouterApiKeyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    await setOpenRouterApiKey(prisma, actor, str(formData.get('openrouterApiKey')));
    revalidatePath('/settings');
    return { ok: true, message: 'OpenRouter API key saved encrypted.' };
  } catch (e) {
    return toState('openrouter.apiKey.update', e);
  }
}

export async function setGeminiApiKeyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    await setGeminiApiKey(prisma, actor, str(formData.get('geminiApiKey')));
    revalidatePath('/settings');
    return { ok: true, message: 'Gemini API key saved encrypted.' };
  } catch (e) {
    return toState('gemini.apiKey.update', e);
  }
}

export async function syncOpenRouterModelsAction(
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const settings = await getSettingsForActor(prisma, actor);
    const apiKey = await getOpenRouterApiKey(prisma, actor);
    if (!apiKey) {
      return { ok: false, error: 'Save an OpenRouter API key first.' };
    }
    const models = await fetchOpenRouterTextModels({
      apiKey,
    });
    const pricing = {
      ...settings.pricing,
      ...buildOpenRouterPricingCatalog(models),
    };

    await updateSetting(prisma, actor, 'openrouter', {
      modelCatalogSyncedAt: new Date().toISOString(),
      modelCatalog: models,
    });
    await updateSetting(prisma, actor, 'pricing', pricing);

    revalidatePath('/settings');
    return {
      ok: true,
      message: `Synced ${models.length} OpenRouter text model${models.length === 1 ? '' : 's'}.`,
    };
  } catch (e) {
    if (e instanceof OpenRouterError) {
      return { ok: false, error: e.message };
    }
    return toState('openrouter.models.sync', e);
  }
}

// ── Team (Spec §10.2: invitation-only access) ─────────────────────────────────

function hoursLeft(expiresAt: Date): string {
  const h = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 3_600_000));
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h} hour${h === 1 ? '' : 's'}`;
}

/** Create the invitation; email the join link when SMTP exists, always show it. */
export async function inviteUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let invited: Awaited<ReturnType<typeof inviteUser>>;
  try {
    const actor = await requireActor();
    invited = await inviteUser(prisma, actor, {
      email: str(formData.get('email')),
      role: str(formData.get('role')),
    });
    revalidatePath('/team');
  } catch (e) {
    return toState('user.invite', e);
  }
  const joinUrl = absoluteUrl(`/join?code=${invited.code}`);
  const validity = hoursLeft(invited.expiresAt);
  // Delivery is best-effort: the row and the code exist either way.
  const resolved = await resolveEmailConfig(prisma);
  if (resolved) {
    try {
      await sendEmailWith(resolved.config, {
        to: [invited.email],
        ...inviteEmail({ joinUrl, host: appHost(), role: invited.role }),
      });
      return {
        ok: true,
        message: `Invitation emailed to ${invited.email} (valid ${validity}). You can also hand them this link:`,
        detail: joinUrl,
      };
    } catch (e) {
      logger.warn(
        { errorType: e instanceof Error ? e.name : typeof e },
        'invitation created but the email could not be sent',
      );
    }
  }
  return {
    ok: true,
    message: `Invitation created. Send ${invited.email} this link (valid ${validity}, works once):`,
    detail: joinUrl,
  };
}

export async function reissueInviteCodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const issued = await issueInviteCode(prisma, actor, str(formData.get('userId')));
    return {
      ok: true,
      message: `New invite link for ${issued.email} (valid ${hoursLeft(issued.expiresAt)}); the old one no longer works:`,
      detail: absoluteUrl(`/join?code=${issued.code}`),
    };
  } catch (e) {
    return toState('user.invite.reissue', e);
  }
}

export async function issuePasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const issued = await issuePasswordResetCode(prisma, actor, str(formData.get('userId')));
    return {
      ok: true,
      message: `Reset link for ${issued.email} (valid ${hoursLeft(issued.expiresAt)}, works once):`,
      detail: absoluteUrl(`/reset?code=${issued.code}`),
    };
  } catch (e) {
    return toState('user.passwordReset.issue', e);
  }
}

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (str(formData.get('newPassword')) !== str(formData.get('confirmPassword'))) {
    return { ok: false, error: 'The two new passwords do not match.' };
  }
  try {
    const actor = await requireActor();
    await changeOwnPassword(prisma, actor, {
      currentPassword: str(formData.get('currentPassword')),
      newPassword: str(formData.get('newPassword')),
    });
    return { ok: true, message: 'Password changed.' };
  } catch (e) {
    return toState('user.password.change', e);
  }
}

export async function updateUserRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const role = str(formData.get('role'));
    if (role !== 'ADMIN' && role !== 'EDITOR' && role !== 'VIEWER') {
      return { ok: false, error: 'Unknown role.' };
    }
    await updateUserRole(prisma, actor, str(formData.get('userId')), role);
    revalidatePath('/team');
    return { ok: true, message: 'Role saved.' };
  } catch (e) {
    return toState('user.role.update', e);
  }
}

export async function setUserStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const status = str(formData.get('status'));
    if (status !== 'ACTIVE' && status !== 'DISABLED') {
      return { ok: false, error: 'Unknown status.' };
    }
    await setUserStatus(prisma, actor, str(formData.get('userId')), status);
    revalidatePath('/team');
    return { ok: true, message: status === 'DISABLED' ? 'Account disabled.' : 'Account enabled.' };
  } catch (e) {
    return toState('user.status.update', e);
  }
}

export async function deleteInvitationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    await deleteInvitation(prisma, actor, str(formData.get('userId')));
    revalidatePath('/team');
    return { ok: true, message: 'Invitation deleted.' };
  } catch (e) {
    return toState('user.invitation.delete', e);
  }
}

// ── Email delivery (Settings > Email) ────────────────────────────────────────

export async function setEmailConfigAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    await setEmailConfig(prisma, actor, {
      serverUrl: str(formData.get('serverUrl')),
      from: str(formData.get('from')),
    });
    revalidatePath('/settings');
    return { ok: true, message: 'Email settings saved encrypted. Send a test email to confirm.' };
  } catch (e) {
    return toState('email.config.update', e);
  }
}

export async function clearEmailConfigAction(
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    await clearEmailConfig(prisma, actor);
    revalidatePath('/settings');
    return {
      ok: true,
      message: 'Stored email settings removed; the environment fallback applies.',
    };
  } catch (e) {
    return toState('email.config.clear', e);
  }
}

export async function sendTestEmailAction(
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const result = await sendTestEmail(prisma, actor, getEnv().APP_BASE_URL);
    return {
      ok: true,
      message: `Test email sent to ${result.to} using the ${result.source} config.`,
    };
  } catch (e) {
    if (e instanceof Error && !(e instanceof EmailConfigError) && !(e instanceof EmailSendError)) {
      // nodemailer connection/auth failures: surface the class of problem, not the URL.
      logger.warn({ action: 'email.test', errorType: e.name }, 'test email failed');
      return {
        ok: false,
        error: `Could not send: ${(e.message.split('\n')[0] ?? e.name).slice(0, 160)}`,
      };
    }
    return toState('email.test', e);
  }
}
