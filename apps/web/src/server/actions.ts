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
  deleteKeyword,
  upsertStyleGuide,
  getSettingsForActor,
  updateSetting,
  parseKeywordSeedList,
  parseBannedPhrases,
  AuthorizationError,
  OpenRouterError,
  StyleGuideSuggestionError,
  ArticleDraftError,
  GeminiImageError,
  collectPublicSiteContext,
  fetchOpenRouterTextModels,
  buildOpenRouterPricingCatalog,
  suggestStyleGuideWithOpenRouter,
  generateArticleDraft,
  updateArticleDraft,
  approveArticle,
  requestArticleChanges,
  rejectArticle,
  publishArticleToCms,
  uploadArticleImage,
  generateArticleImage,
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
import { requireActor } from '@/lib/session';

export type FormState = { ok: boolean; error?: string; message?: string };

function toState(action: string, e: unknown): FormState {
  if (e instanceof AuthorizationError) {
    logger.warn({ action, errorType: 'AuthorizationError' }, 'server action denied');
    return { ok: false, error: 'You are not permitted to perform this action.' };
  }
  if (e && typeof e === 'object' && (e as { name?: string }).name === 'ZodError') {
    const issues = (e as { issues?: Array<{ message: string }> }).issues ?? [];
    logger.warn(
      { action, errorType: 'ZodError', issues: issues.map((i) => i.message) },
      'server action validation failed',
    );
    return { ok: false, error: issues.map((i) => i.message).join('; ') || 'Invalid input.' };
  }
  logger.error(
    {
      action,
      errorType: e instanceof Error ? e.name : typeof e,
      errorMessage: e instanceof Error ? e.message : 'Unknown server action failure',
    },
    'server action failed',
  );
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
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
      cmsType: str(formData.get('cmsType')) === 'WORDPRESS' ? 'WORDPRESS' : 'STRAPI',
      defaultAuthor: optStr(formData.get('defaultAuthor')),
      briefAutoApprove: formData.get('briefAutoApprove') === 'on',
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
      cmsType: str(formData.get('cmsType')) === 'STRAPI' ? 'STRAPI' : 'WORDPRESS',
      defaultAuthor: optStr(formData.get('defaultAuthor')),
      briefAutoApprove: formData.get('briefAutoApprove') === 'on',
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
    const suggestion = await suggestStyleGuideWithOpenRouter({
      apiKey,
      model: settings.models.brief,
      siteName: site.name,
      siteUrl: site.baseUrl,
      siteText: context.combinedText,
      notes,
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

export async function updateArticleDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await updateArticleDraft(prisma, actor, id, {
      title: str(formData.get('title')),
      slug: optStr(formData.get('slug')),
      metaDescription: optStr(formData.get('metaDescription')),
      imagePrompt: optStr(formData.get('imagePrompt')),
      contentMarkdown: str(formData.get('contentMarkdown')),
    });
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Article saved.' };
  } catch (e) {
    return toState('article.update', e);
  }
}

export async function approveArticleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    const id = str(formData.get('id'));
    await approveArticle(prisma, actor, id);
    revalidatePath('/articles');
    revalidatePath(`/articles/${id}`);
    return { ok: true, message: 'Article approved.' };
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

const NUMERIC_SETTINGS: SettingKey[] = [
  'monthly_budget_usd',
  'per_article_cost_ceiling_usd',
  'keyword_buffer_target',
  'briefs_per_run',
  'max_regen',
];

export async function updateSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireActor();
    for (const key of NUMERIC_SETTINGS) {
      const raw = str(formData.get(key));
      if (raw === '') continue;
      await updateSetting(prisma, actor, key, Number(raw));
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
