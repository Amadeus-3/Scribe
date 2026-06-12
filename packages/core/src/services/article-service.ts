import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { Article, Prisma, PrismaClient, PublishRecord } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { decryptSecret } from '../crypto/encryption';
import { getSettings } from '../domain/settings';
import { parseKeywordSeedList } from '../domain/keyword';
import { CmsCredentialsSchema, type CmsCredentials } from '../domain/site';
import { draftArticleWithOpenRouter, type DraftArticle } from '../ai/article-drafter';
import { generateGeminiImage } from '../ai/gemini-image';
import { publishToStrapi, StrapiPublishError } from '../cms/strapi-publisher';

export interface ArticleDTO {
  id: string;
  siteId: string;
  keywordId: string;
  title: string | null;
  slug: string | null;
  metaDescription: string | null;
  imagePrompt: string | null;
  imageMimeType: string | null;
  imageDataBase64: string | null;
  contentMarkdown: string | null;
  contentHtml: string | null;
  status: Article['status'];
  wordCount: number | null;
  llmModel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublishRecordDTO {
  id: string;
  articleId: string;
  cmsPostId: string | null;
  url: string | null;
  status: string;
  error: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface GenerateArticleDraftInput {
  siteId: string;
  keyword: string;
  instructions?: string;
}

export interface UpdateArticleDraftInput {
  title: string;
  slug?: string;
  metaDescription?: string;
  imagePrompt?: string;
  contentMarkdown: string;
}

export class ArticlePublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArticlePublishError';
  }
}

export const MAX_ARTICLE_IMAGE_BYTES = 5 * 1024 * 1024;
export const ARTICLE_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
] as const;

type ArticleImageMimeType = (typeof ARTICLE_IMAGE_MIME_TYPES)[number];

export function isArticleImageMimeType(mimeType: string): mimeType is ArticleImageMimeType {
  return ARTICLE_IMAGE_MIME_TYPES.includes(mimeType as ArticleImageMimeType);
}

function toArticleDTO(article: Article): ArticleDTO {
  return {
    id: article.id,
    siteId: article.siteId,
    keywordId: article.keywordId,
    title: article.title,
    slug: article.slug,
    metaDescription: article.metaDescription,
    imagePrompt: article.imagePrompt,
    imageMimeType: article.imageMimeType,
    imageDataBase64: article.imageDataBase64,
    contentMarkdown: article.contentMarkdown,
    contentHtml: article.contentHtml,
    status: article.status,
    wordCount: article.wordCount,
    llmModel: article.llmModel,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}

function toPublishRecordDTO(record: PublishRecord): PublishRecordDTO {
  return {
    id: record.id,
    articleId: record.articleId,
    cmsPostId: record.cmsPostId,
    url: record.url,
    status: record.status,
    error: record.error,
    publishedAt: record.publishedAt,
    createdAt: record.createdAt,
  };
}

function parseStoredCmsCredentials(
  cmsType: CmsCredentials['cmsType'],
  ciphertext: string | null,
): CmsCredentials {
  if (!ciphertext) {
    throw new ArticlePublishError('Add CMS credentials to the site before publishing.');
  }
  const raw = JSON.parse(decryptSecret(ciphertext)) as unknown;
  const base = raw && typeof raw === 'object' ? raw : {};
  return CmsCredentialsSchema.parse('cmsType' in base ? base : { cmsType, ...base });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderBasicMarkdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1]?.length ?? 2;
      html.push(`<h${level}>${escapeHtml(heading[2] ?? '')}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${escapeHtml(listItem[1] ?? '')}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }

  closeList();
  return html.join('\n');
}

function wordCount(markdown: string): number {
  const words = markdown.trim().match(/\S+/g);
  return words?.length ?? 0;
}

function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function createDraftRecords(
  db: PrismaClient,
  actor: Actor,
  input: Required<GenerateArticleDraftInput>,
  model: string,
  draft: DraftArticle,
): Promise<Article> {
  return db.$transaction(async (tx) => {
    const keyword = await tx.keyword.upsert({
      where: { siteId_term: { siteId: input.siteId, term: input.keyword } },
      create: { siteId: input.siteId, term: input.keyword, status: 'DONE' },
      update: { status: 'DONE' },
    });

    const existingArticle = await tx.article.findUnique({ where: { keywordId: keyword.id } });
    if (existingArticle) {
      throw new Error('An article already exists for this keyword.');
    }

    const contentHtml = renderBasicMarkdownToHtml(draft.contentMarkdown);
    const article = await tx.article.create({
      data: {
        siteId: input.siteId,
        keywordId: keyword.id,
        title: draft.title,
        slug: normalizeSlug(draft.slug),
        metaDescription: draft.metaDescription,
        imagePrompt: draft.imagePrompt,
        contentMarkdown: draft.contentMarkdown,
        contentHtml,
        status: 'PENDING_REVIEW',
        wordCount: wordCount(draft.contentMarkdown),
        llmModel: model,
        currentVersion: 1,
        revisions: {
          create: {
            version: 1,
            contentMarkdown: draft.contentMarkdown,
            authorType: 'AI',
            note: 'ai initial draft',
          },
        },
      },
    });

    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.drafted',
      entityType: 'Article',
      entityId: article.id,
      metadata: {
        siteId: input.siteId,
        keyword: input.keyword,
        model,
      } as Prisma.InputJsonValue,
    });

    return article;
  });
}

export async function listArticles(db: PrismaClient, actor: Actor): Promise<ArticleDTO[]> {
  authorize(actor, 'article.read');
  const articles = await db.article.findMany({ orderBy: { createdAt: 'desc' } });
  return articles.map(toArticleDTO);
}

export async function listSiteArticles(
  db: PrismaClient,
  actor: Actor,
  siteId: string,
): Promise<ArticleDTO[]> {
  authorize(actor, 'article.read');
  const articles = await db.article.findMany({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
  });
  return articles.map(toArticleDTO);
}

export async function getArticle(
  db: PrismaClient,
  actor: Actor,
  id: string,
): Promise<ArticleDTO | null> {
  authorize(actor, 'article.read');
  const article = await db.article.findUnique({ where: { id } });
  return article ? toArticleDTO(article) : null;
}

export async function listArticlePublishRecords(
  db: PrismaClient,
  actor: Actor,
  articleId: string,
): Promise<PublishRecordDTO[]> {
  authorize(actor, 'article.read');
  const records = await db.publishRecord.findMany({
    where: { articleId },
    orderBy: { createdAt: 'desc' },
  });
  return records.map(toPublishRecordDTO);
}

export async function generateArticleDraft(
  db: PrismaClient,
  actor: Actor,
  input: GenerateArticleDraftInput,
  options: {
    apiKey?: string;
    fetchFn?: Parameters<typeof draftArticleWithOpenRouter>[0]['fetchFn'];
  },
): Promise<ArticleDTO> {
  authorize(actor, 'article.create');
  const [keyword] = parseKeywordSeedList(input.keyword);
  if (!keyword) {
    throw new Error('Keyword is required.');
  }

  const [site, styleGuide, settings] = await Promise.all([
    db.site.findUnique({ where: { id: input.siteId } }),
    db.styleGuide.findUnique({ where: { siteId: input.siteId } }),
    getSettings(db),
  ]);

  if (!site) {
    throw new Error('Site not found.');
  }
  if (!styleGuide) {
    throw new Error('Create or suggest a style guide before generating articles.');
  }

  const model = settings.models.draft;
  const draft = await draftArticleWithOpenRouter({
    apiKey: options.apiKey,
    model,
    siteName: site.name,
    siteUrl: site.baseUrl,
    keyword,
    instructions: input.instructions,
    styleGuide,
    fetchFn: options.fetchFn,
  });

  const article = await createDraftRecords(
    db,
    actor,
    { siteId: input.siteId, keyword, instructions: input.instructions ?? '' },
    model,
    draft,
  );
  return toArticleDTO(article);
}

export async function updateArticleDraft(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: UpdateArticleDraftInput,
): Promise<ArticleDTO> {
  authorize(actor, 'article.edit');
  if (!input.title.trim()) {
    throw new Error('Title is required.');
  }
  if (!input.contentMarkdown.trim()) {
    throw new Error('Article content is required.');
  }

  return db.$transaction(async (tx) => {
    const current = await tx.article.findUniqueOrThrow({ where: { id } });
    const version = current.currentVersion + 1;
    const article = await tx.article.update({
      where: { id },
      data: {
        title: input.title.trim(),
        slug: input.slug ? normalizeSlug(input.slug) : current.slug,
        metaDescription: input.metaDescription?.trim() || null,
        imagePrompt: input.imagePrompt?.trim() || null,
        contentMarkdown: input.contentMarkdown,
        contentHtml: renderBasicMarkdownToHtml(input.contentMarkdown),
        wordCount: wordCount(input.contentMarkdown),
        status: current.status === 'APPROVED' ? 'PENDING_REVIEW' : current.status,
        currentVersion: version,
        revisions: {
          create: {
            version,
            contentMarkdown: input.contentMarkdown,
            authorType: 'HUMAN',
            editedById: actor.id,
            note: 'human edit',
          },
        },
      },
    });

    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.updated',
      entityType: 'Article',
      entityId: article.id,
      metadata: { version },
    });

    return toArticleDTO(article);
  });
}

async function recordReviewDecision(
  db: PrismaClient,
  actor: Actor,
  id: string,
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED',
  status: Article['status'],
  action: string,
  reason?: string,
): Promise<ArticleDTO> {
  return db.$transaction(async (tx) => {
    const article = await tx.article.update({
      where: { id },
      data: {
        status,
        reviews: {
          create: {
            reviewerId: actor.id,
            decision,
            reason: reason?.trim() || null,
          },
        },
      },
    });

    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action,
      entityType: 'Article',
      entityId: article.id,
      metadata: reason ? { reason } : undefined,
    });

    return toArticleDTO(article);
  });
}

export async function approveArticle(
  db: PrismaClient,
  actor: Actor,
  id: string,
): Promise<ArticleDTO> {
  authorize(actor, 'article.approve');
  return recordReviewDecision(db, actor, id, 'APPROVED', 'APPROVED', 'article.approved');
}

export async function requestArticleChanges(
  db: PrismaClient,
  actor: Actor,
  id: string,
  reason?: string,
): Promise<ArticleDTO> {
  authorize(actor, 'article.requestChanges');
  return recordReviewDecision(
    db,
    actor,
    id,
    'CHANGES_REQUESTED',
    'CHANGES_REQUESTED',
    'article.changesRequested',
    reason,
  );
}

export async function rejectArticle(
  db: PrismaClient,
  actor: Actor,
  id: string,
  reason?: string,
): Promise<ArticleDTO> {
  authorize(actor, 'article.reject');
  return recordReviewDecision(db, actor, id, 'REJECTED', 'REJECTED', 'article.rejected', reason);
}

export async function uploadArticleImage(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: {
    mimeType: string;
    dataBase64: string;
  },
): Promise<ArticleDTO> {
  authorize(actor, 'article.edit');
  if (!isArticleImageMimeType(input.mimeType)) {
    throw new Error('Upload a JPEG, PNG, WebP, AVIF, or GIF image.');
  }

  const dataBase64 = input.dataBase64.trim();
  if (!dataBase64) {
    throw new Error('Choose an image file to upload.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) {
    throw new Error('Uploaded image data is not valid base64.');
  }

  const imageBytes = Buffer.byteLength(dataBase64, 'base64');
  if (imageBytes > MAX_ARTICLE_IMAGE_BYTES) {
    throw new Error('Upload an image smaller than 5 MB.');
  }

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.article.update({
      where: { id },
      data: {
        imageMimeType: input.mimeType,
        imageDataBase64: dataBase64,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.imageUploaded',
      entityType: 'Article',
      entityId: id,
      metadata: { mimeType: input.mimeType, imageBytes },
    });
    return saved;
  });

  return toArticleDTO(updated);
}

export async function publishArticleToCms(
  db: PrismaClient,
  actor: Actor,
  id: string,
  options: {
    fetchFn?: Parameters<typeof publishToStrapi>[0]['fetchFn'];
  } = {},
): Promise<ArticleDTO> {
  authorize(actor, 'article.publish');
  const article = await db.article.findUnique({
    where: { id },
    include: { site: true },
  });
  if (!article) {
    throw new ArticlePublishError('Article not found.');
  }
  if (article.status === 'PUBLISHED') {
    throw new ArticlePublishError('This article is already published.');
  }
  if (article.status !== 'APPROVED' && article.status !== 'PUBLISH_FAILED') {
    throw new ArticlePublishError('Approve the article before publishing it.');
  }
  if (article.site.status !== 'ACTIVE') {
    throw new ArticlePublishError('The site is paused. Activate it before publishing.');
  }
  if (!article.title?.trim()) {
    throw new ArticlePublishError('Add an article title before publishing.');
  }
  if (!article.contentMarkdown?.trim() && !article.contentHtml?.trim()) {
    throw new ArticlePublishError('Add article content before publishing.');
  }

  const credentials = parseStoredCmsCredentials(
    article.site.cmsType,
    article.site.cmsCredentialsEnc,
  );
  if (credentials.cmsType !== 'STRAPI') {
    throw new ArticlePublishError('Publishing is currently available for Strapi sites only.');
  }

  await db.article.update({
    where: { id },
    data: { status: 'PUBLISHING' },
  });

  const idempotencyKey = `article:${id}:${randomUUID()}`;
  try {
    const result = await publishToStrapi({
      baseUrl: article.site.baseUrl,
      credentials,
      article: {
        title: article.title,
        slug: article.slug,
        metaDescription: article.metaDescription,
        contentMarkdown: article.contentMarkdown,
        contentHtml: article.contentHtml,
      },
      fetchFn: options.fetchFn,
    });

    const published = await db.$transaction(async (tx) => {
      await tx.publishRecord.create({
        data: {
          articleId: id,
          cmsPostId: result.cmsPostId,
          url: result.url,
          idempotencyKey,
          status: 'success',
          publishedAt: new Date(),
        },
      });
      const saved = await tx.article.update({
        where: { id },
        data: { status: 'PUBLISHED' },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        actorType: 'human',
        action: 'article.published',
        entityType: 'Article',
        entityId: id,
        metadata: {
          cmsType: credentials.cmsType,
          cmsPostId: result.cmsPostId,
          url: result.url,
        },
      });
      return saved;
    });

    return toArticleDTO(published);
  } catch (e) {
    const message =
      e instanceof StrapiPublishError || e instanceof Error
        ? e.message
        : 'Publishing failed with an unknown error.';
    await db.$transaction(async (tx) => {
      await tx.publishRecord.create({
        data: {
          articleId: id,
          idempotencyKey,
          status: 'failed',
          error: message.slice(0, 1000),
        },
      });
      await tx.article.update({
        where: { id },
        data: { status: 'PUBLISH_FAILED' },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        actorType: 'human',
        action: 'article.publishFailed',
        entityType: 'Article',
        entityId: id,
        metadata: { cmsType: credentials.cmsType, error: message.slice(0, 240) },
      });
    });
    throw new ArticlePublishError(message);
  }
}

export async function generateArticleImage(
  db: PrismaClient,
  actor: Actor,
  id: string,
  options: {
    apiKey?: string;
    fetchFn?: Parameters<typeof generateGeminiImage>[0]['fetchFn'];
  },
): Promise<ArticleDTO> {
  authorize(actor, 'article.edit');
  const [article, settings] = await Promise.all([
    db.article.findUnique({ where: { id } }),
    getSettings(db),
  ]);
  if (!article) {
    throw new Error('Article not found.');
  }
  if (!article.imagePrompt?.trim()) {
    throw new Error('Add an image prompt before generating an image.');
  }

  const result = await generateGeminiImage({
    apiKey: options.apiKey ?? '',
    model: settings.imageGeneration.model,
    prompt: article.imagePrompt,
    fetchFn: options.fetchFn,
  });
  const image = result.images[0];
  if (!image) {
    throw new Error('Gemini returned no image.');
  }

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.article.update({
      where: { id },
      data: {
        imageMimeType: image.mimeType,
        imageDataBase64: image.dataBase64,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.imageGenerated',
      entityType: 'Article',
      entityId: id,
      metadata: { model: settings.imageGeneration.model, mimeType: image.mimeType },
    });
    return saved;
  });

  return toArticleDTO(updated);
}
