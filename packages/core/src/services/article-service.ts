import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { Article, ArticleImage, Prisma, PrismaClient, PublishRecord } from '@prisma/client';
import { authorize, type Actor } from '../auth/authorize';
import { recordAudit } from '../audit/audit-log';
import { decryptSecret } from '../crypto/encryption';
import { getSettings } from '../domain/settings';
import { parseKeywordSeedList } from '../domain/keyword';
import { CmsCredentialsSchema, type CmsCredentials } from '../domain/site';
import {
  draftArticleWithOpenRouter,
  classifyArticleTaxonomyWithOpenRouter,
  suggestInlineImagesWithOpenRouter,
  type DraftArticle,
} from '../ai/article-drafter';
import { generateGeminiImage } from '../ai/gemini-image';
import { publishToStrapi, StrapiPublishError } from '../cms/strapi-publisher';
import { fetchStrapiCollection, resolveDocumentIdsBySlug } from '../cms/strapi-taxonomy';
import { scoreArticleSeo } from '../seo/seo-score';
import { parseSeoReport, type SeoReport } from '../seo/seo-report';

export interface ArticleDTO {
  id: string;
  siteId: string;
  keywordId: string;
  /** The primary keyword (SEO target) — editable; drives the SEO score. */
  keyword: string | null;
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
  /** Advisory deterministic SEO score + checklist; null until/unless scored. */
  seoReport: SeoReport | null;
  /** Reviewer-chosen CMS category (by slug); resolved to a documentId on publish. */
  categorySlug: string | null;
  /** Reviewer-chosen CMS tags (by slug); resolved to documentIds on publish. */
  tagSlugs: string[];
  llmModel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleImageDTO {
  id: string;
  position: number;
  placement: string | null;
  alt: string | null;
  prompt: string;
  aspectRatio: string | null;
  mimeType: string | null;
  dataBase64: string | null;
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
  /** Reviewer-chosen CMS category slug (empty string clears it). */
  categorySlug?: string;
  /** Reviewer-chosen CMS tag slugs. */
  tagSlugs?: string[];
}

export interface RegenerateArticleInput {
  /** Optional reviewer feedback to fold into the regeneration. */
  comments?: string;
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

/** Validate an uploaded image (type, base64 shape, size); returns the byte count. */
function decodeValidatedImage(input: { mimeType: string; dataBase64: string }): {
  mimeType: ArticleImageMimeType;
  dataBase64: string;
  bytes: number;
} {
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
  const bytes = Buffer.byteLength(dataBase64, 'base64');
  if (bytes > MAX_ARTICLE_IMAGE_BYTES) {
    throw new Error('Upload an image smaller than 5 MB.');
  }
  return { mimeType: input.mimeType, dataBase64, bytes };
}

function toArticleDTO(article: Article & { keyword?: { term: string } | null }): ArticleDTO {
  return {
    id: article.id,
    siteId: article.siteId,
    keywordId: article.keywordId,
    keyword: article.keyword?.term ?? null,
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
    seoReport: parseSeoReport(article.qaReport),
    categorySlug: article.categorySlug,
    tagSlugs: article.tagSlugs,
    llmModel: article.llmModel,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}

function toArticleImageDTO(image: ArticleImage): ArticleImageDTO {
  return {
    id: image.id,
    position: image.position,
    placement: image.placement,
    alt: image.alt,
    prompt: image.prompt,
    aspectRatio: image.aspectRatio,
    mimeType: image.mimeType,
    dataBase64: image.dataBase64,
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

function readTimeLabel(words: number | null): string {
  return `${Math.max(1, Math.ceil((words ?? 0) / 200))} min read`;
}

function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function coerceBannedPhrases(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
}

/**
 * Score an article's on-page SEO deterministically. Advisory only — the result
 * is stored on the article for the reviewer but never changes its status or the
 * human approval gate (Spec §10.1).
 */
function buildSeoReport(args: {
  title: string | null;
  slug: string | null;
  metaDescription: string | null;
  contentMarkdown: string | null;
  imagePrompt: string | null;
  keyword: string;
  bannedPhrases: string[];
  inlineImageCount: number;
}): SeoReport {
  return scoreArticleSeo({
    title: args.title ?? '',
    slug: args.slug ?? '',
    metaDescription: args.metaDescription ?? '',
    contentMarkdown: args.contentMarkdown ?? '',
    imagePrompt: args.imagePrompt,
    primaryKeyword: args.keyword,
    bannedPhrases: args.bannedPhrases,
    inlineImageCount: args.inlineImageCount,
  });
}

async function createDraftRecords(
  db: PrismaClient,
  actor: Actor,
  input: Required<GenerateArticleDraftInput>,
  model: string,
  draft: DraftArticle,
  seoReport: SeoReport,
  taxonomySelection: { categorySlug: string | null; tagSlugs: string[] },
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
        qaReport: seoReport as Prisma.InputJsonValue,
        categorySlug: taxonomySelection.categorySlug,
        tagSlugs: taxonomySelection.tagSlugs,
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
        images: {
          create: draft.inlineImages.map((image, index) => ({
            position: index,
            placement: image.placement,
            alt: image.alt,
            prompt: image.prompt,
            aspectRatio: image.aspectRatio,
          })),
        },
      },
      include: { keyword: true },
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
  const articles = await db.article.findMany({
    orderBy: { createdAt: 'desc' },
    include: { keyword: true },
  });
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
    include: { keyword: true },
  });
  return articles.map(toArticleDTO);
}

export async function getArticle(
  db: PrismaClient,
  actor: Actor,
  id: string,
): Promise<ArticleDTO | null> {
  authorize(actor, 'article.read');
  const article = await db.article.findUnique({ where: { id }, include: { keyword: true } });
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

export async function listArticleImages(
  db: PrismaClient,
  actor: Actor,
  articleId: string,
): Promise<ArticleImageDTO[]> {
  authorize(actor, 'article.read');
  const images = await db.articleImage.findMany({
    where: { articleId },
    orderBy: { position: 'asc' },
  });
  return images.map(toArticleImageDTO);
}

/**
 * Propose in-body images for an EXISTING article via the LLM (no content
 * rewrite), creating one ArticleImage row per suggestion for the reviewer to
 * generate/upload. Only runs when the article has no in-body images yet, and
 * refreshes the SEO report's in-body-image check to match.
 */
export async function suggestArticleInlineImages(
  db: PrismaClient,
  actor: Actor,
  id: string,
  options: {
    apiKey?: string;
    fetchFn?: Parameters<typeof suggestInlineImagesWithOpenRouter>[0]['fetchFn'];
  },
): Promise<ArticleImageDTO[]> {
  authorize(actor, 'article.edit');
  const [article, settings] = await Promise.all([
    db.article.findUnique({
      where: { id },
      include: { keyword: true, site: { include: { styleGuide: true } }, _count: { select: { images: true } } },
    }),
    getSettings(db),
  ]);
  if (!article) {
    throw new Error('Article not found.');
  }
  if (article._count.images > 0) {
    throw new Error('This article already has in-body images.');
  }
  if (!article.contentMarkdown?.trim()) {
    throw new Error('Add article content before suggesting images.');
  }

  const suggestions = await suggestInlineImagesWithOpenRouter({
    apiKey: options.apiKey,
    model: settings.models.draft,
    title: article.title ?? '',
    contentMarkdown: article.contentMarkdown,
    keyword: article.keyword.term,
    imagePromptInstructions: article.site.styleGuide?.imagePromptInstructions,
    fetchFn: options.fetchFn,
  });

  if (suggestions.length === 0) {
    return [];
  }

  const seoReport = buildSeoReport({
    title: article.title,
    slug: article.slug,
    metaDescription: article.metaDescription,
    contentMarkdown: article.contentMarkdown,
    imagePrompt: article.imagePrompt,
    keyword: article.keyword.term,
    bannedPhrases: coerceBannedPhrases(article.site.styleGuide?.bannedPhrases),
    inlineImageCount: suggestions.length,
  });

  const images = await db.$transaction(async (tx) => {
    await tx.articleImage.createMany({
      data: suggestions.map((image, index) => ({
        articleId: id,
        position: index,
        placement: image.placement,
        alt: image.alt,
        prompt: image.prompt,
        aspectRatio: image.aspectRatio,
      })),
    });
    await tx.article.update({
      where: { id },
      data: { qaReport: seoReport as Prisma.InputJsonValue },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.inlineImagesSuggested',
      entityType: 'Article',
      entityId: id,
      metadata: { count: suggestions.length },
    });
    return tx.articleImage.findMany({ where: { articleId: id }, orderBy: { position: 'asc' } });
  });

  return images.map(toArticleImageDTO);
}

export interface SiteTaxonomyDTO {
  categories: Array<{ name: string; slug: string }>;
  tags: Array<{ name: string; slug: string }>;
}

/**
 * Fetch the publishable categories + tags from a site's Strapi so the reviewer
 * can choose them. Returns null for non-Strapi sites or sites without
 * credentials. Network/parse failures propagate to the caller to handle.
 */
export async function listSiteTaxonomy(
  db: PrismaClient,
  actor: Actor,
  siteId: string,
  options: { fetchFn?: Parameters<typeof fetchStrapiCollection>[0]['fetchFn'] } = {},
): Promise<SiteTaxonomyDTO | null> {
  authorize(actor, 'article.read');
  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site || site.cmsType !== 'STRAPI' || !site.cmsCredentialsEnc) {
    return null;
  }
  const credentials = parseStoredCmsCredentials(site.cmsType, site.cmsCredentialsEnc);
  if (credentials.cmsType !== 'STRAPI') {
    return null;
  }
  const [categories, tags] = await Promise.all([
    fetchStrapiCollection({
      baseUrl: site.baseUrl,
      credentials,
      pluralApiId: credentials.categoryApiId,
      fetchFn: options.fetchFn,
    }),
    fetchStrapiCollection({
      baseUrl: site.baseUrl,
      credentials,
      pluralApiId: credentials.tagApiId,
      fetchFn: options.fetchFn,
    }),
  ]);
  return {
    categories: categories.map((entry) => ({ name: entry.name, slug: entry.slug })),
    tags: tags.map((entry) => ({ name: entry.name, slug: entry.slug })),
  };
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

  // Offer the site's existing CMS taxonomy so the model can self-assign a
  // category + tags. Best-effort: never block drafting on CMS availability.
  let taxonomy: SiteTaxonomyDTO | null = null;
  try {
    taxonomy = await listSiteTaxonomy(db, actor, input.siteId, { fetchFn: options.fetchFn });
  } catch {
    taxonomy = null;
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
    taxonomy: taxonomy ?? undefined,
    fetchFn: options.fetchFn,
  });

  // Keep only choices that match an existing slug (no hallucinated/auto-created taxonomy).
  const allowedCategories = new Set(taxonomy?.categories.map((entry) => entry.slug) ?? []);
  const allowedTags = new Set(taxonomy?.tags.map((entry) => entry.slug) ?? []);
  const taxonomySelection = {
    categorySlug:
      draft.categorySlug && allowedCategories.has(draft.categorySlug) ? draft.categorySlug : null,
    tagSlugs: draft.tagSlugs.filter((slug) => allowedTags.has(slug)),
  };

  const seoReport = buildSeoReport({
    title: draft.title,
    slug: normalizeSlug(draft.slug),
    metaDescription: draft.metaDescription,
    contentMarkdown: draft.contentMarkdown,
    imagePrompt: draft.imagePrompt,
    keyword,
    bannedPhrases: coerceBannedPhrases(styleGuide.bannedPhrases),
    inlineImageCount: draft.inlineImages.length,
  });

  const article = await createDraftRecords(
    db,
    actor,
    { siteId: input.siteId, keyword, instructions: input.instructions ?? '' },
    model,
    draft,
    seoReport,
    taxonomySelection,
  );
  return toArticleDTO(article);
}

/**
 * Classify an EXISTING article into the site's taxonomy using the LLM, without
 * rewriting its content. Validated to existing slugs (no auto-create). Lets
 * articles drafted before auto-assignment get a category + tags on demand.
 */
export async function autoAssignArticleTaxonomy(
  db: PrismaClient,
  actor: Actor,
  id: string,
  options: {
    apiKey?: string;
    fetchFn?: Parameters<typeof classifyArticleTaxonomyWithOpenRouter>[0]['fetchFn'];
  },
): Promise<ArticleDTO> {
  authorize(actor, 'article.edit');
  const [article, settings] = await Promise.all([
    db.article.findUnique({ where: { id }, include: { keyword: true } }),
    getSettings(db),
  ]);
  if (!article) {
    throw new Error('Article not found.');
  }
  if (!article.contentMarkdown?.trim() && !article.title?.trim()) {
    throw new Error('Add article content before classifying it.');
  }

  const taxonomy = await listSiteTaxonomy(db, actor, article.siteId, { fetchFn: options.fetchFn });
  if (!taxonomy || (taxonomy.categories.length === 0 && taxonomy.tags.length === 0)) {
    throw new Error(
      "No CMS categories or tags found to classify against. Configure the site's Strapi taxonomy first.",
    );
  }

  const classification = await classifyArticleTaxonomyWithOpenRouter({
    apiKey: options.apiKey,
    model: settings.models.draft,
    title: article.title ?? '',
    contentMarkdown: article.contentMarkdown ?? '',
    keyword: article.keyword.term,
    taxonomy,
    fetchFn: options.fetchFn,
  });

  const allowedCategories = new Set(taxonomy.categories.map((entry) => entry.slug));
  const allowedTags = new Set(taxonomy.tags.map((entry) => entry.slug));
  const categorySlug =
    classification.categorySlug && allowedCategories.has(classification.categorySlug)
      ? classification.categorySlug
      : null;
  const tagSlugs = classification.tagSlugs.filter((slug) => allowedTags.has(slug));

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.article.update({
      where: { id },
      data: { categorySlug, tagSlugs },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.taxonomyAssigned',
      entityType: 'Article',
      entityId: id,
      metadata: { categorySlug, tagSlugs },
    });
    return saved;
  });

  return toArticleDTO(updated);
}

/**
 * Change an article's primary keyword (the SEO target) and re-score against it.
 * The keyword is unique per site, so a term already used by another keyword is
 * rejected. Refinement only — content, taxonomy, and images are untouched.
 */
export async function updateArticleKeyword(
  db: PrismaClient,
  actor: Actor,
  id: string,
  newKeyword: string,
): Promise<ArticleDTO> {
  authorize(actor, 'article.edit');
  const [term] = parseKeywordSeedList(newKeyword);
  if (!term) {
    throw new Error('Keyword is required.');
  }

  const article = await db.article.findUnique({
    where: { id },
    include: {
      keyword: true,
      site: { include: { styleGuide: true } },
      _count: { select: { images: true } },
    },
  });
  if (!article) {
    throw new Error('Article not found.');
  }
  if (article.keyword.term === term) {
    return toArticleDTO(article);
  }

  const clash = await db.keyword.findUnique({
    where: { siteId_term: { siteId: article.siteId, term } },
  });
  if (clash && clash.id !== article.keywordId) {
    throw new Error('Another keyword with that term already exists for this site.');
  }

  const seoReport = buildSeoReport({
    title: article.title,
    slug: article.slug,
    metaDescription: article.metaDescription,
    contentMarkdown: article.contentMarkdown,
    imagePrompt: article.imagePrompt,
    keyword: term,
    bannedPhrases: coerceBannedPhrases(article.site.styleGuide?.bannedPhrases),
    inlineImageCount: article._count.images,
  });

  const updated = await db.$transaction(async (tx) => {
    await tx.keyword.update({ where: { id: article.keywordId }, data: { term } });
    const saved = await tx.article.update({
      where: { id },
      data: { qaReport: seoReport as Prisma.InputJsonValue },
      include: { keyword: true },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.keywordUpdated',
      entityType: 'Article',
      entityId: id,
      metadata: { from: article.keyword.term, to: term },
    });
    return saved;
  });

  return toArticleDTO(updated);
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
    const current = await tx.article.findUniqueOrThrow({
      where: { id },
      include: {
        keyword: true,
        site: { include: { styleGuide: true } },
        _count: { select: { images: true } },
      },
    });
    const version = current.currentVersion + 1;
    const nextSlug = input.slug ? normalizeSlug(input.slug) : current.slug;
    const nextMeta = input.metaDescription?.trim() || null;
    const nextImagePrompt = input.imagePrompt?.trim() || null;
    const seoReport = buildSeoReport({
      title: input.title.trim(),
      slug: nextSlug,
      metaDescription: nextMeta,
      contentMarkdown: input.contentMarkdown,
      imagePrompt: nextImagePrompt,
      keyword: current.keyword.term,
      bannedPhrases: coerceBannedPhrases(current.site.styleGuide?.bannedPhrases),
      inlineImageCount: current._count.images,
    });
    const article = await tx.article.update({
      where: { id },
      data: {
        title: input.title.trim(),
        slug: nextSlug,
        metaDescription: nextMeta,
        imagePrompt: nextImagePrompt,
        contentMarkdown: input.contentMarkdown,
        contentHtml: renderBasicMarkdownToHtml(input.contentMarkdown),
        wordCount: wordCount(input.contentMarkdown),
        qaReport: seoReport as Prisma.InputJsonValue,
        ...(input.categorySlug !== undefined
          ? { categorySlug: input.categorySlug.trim() || null }
          : {}),
        ...(input.tagSlugs !== undefined ? { tagSlugs: input.tagSlugs } : {}),
        // Editing approved/published content sends it back through the review gate
        // before it can be (re)published.
        status:
          current.status === 'APPROVED' || current.status === 'PUBLISHED'
            ? 'PENDING_REVIEW'
            : current.status,
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

/**
 * Regenerate an existing article with the LLM, folding in reviewer comments and
 * the current SEO findings so each pass is stronger. Preserves the reviewer's
 * taxonomy and any in-body images, re-scores, stores a new AI revision, and
 * returns the article to PENDING_REVIEW (never auto-publishes; Spec §10.1).
 */
export async function regenerateArticleDraft(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: RegenerateArticleInput,
  options: {
    apiKey?: string;
    fetchFn?: Parameters<typeof draftArticleWithOpenRouter>[0]['fetchFn'];
  },
): Promise<ArticleDTO> {
  authorize(actor, 'article.edit');
  const article = await db.article.findUnique({
    where: { id },
    include: {
      site: { include: { styleGuide: true } },
      keyword: true,
      _count: { select: { images: true } },
    },
  });
  if (!article) {
    throw new Error('Article not found.');
  }
  if (article.status === 'PUBLISHING') {
    throw new Error('This article is publishing — wait for it to finish before regenerating.');
  }
  if (!article.site.styleGuide) {
    throw new Error('Create or suggest a style guide before regenerating articles.');
  }
  if (!article.contentMarkdown?.trim()) {
    throw new Error('Add article content before regenerating.');
  }

  const styleGuide = article.site.styleGuide;
  const settings = await getSettings(db);
  const model = settings.models.draft;
  const bannedPhrases = coerceBannedPhrases(styleGuide.bannedPhrases);
  const inlineImageCount = article._count.images;

  // Derive concrete SEO issues from the stored report, or score the current
  // content if it was never scored, so the model always gets actionable fixes.
  const baseReport =
    parseSeoReport(article.qaReport) ??
    buildSeoReport({
      title: article.title,
      slug: article.slug,
      metaDescription: article.metaDescription,
      contentMarkdown: article.contentMarkdown,
      imagePrompt: article.imagePrompt,
      keyword: article.keyword.term,
      bannedPhrases,
      inlineImageCount,
    });
  const seoIssues = baseReport.checks
    .filter((check) => check.status !== 'pass')
    .map((check) => check.detail);

  const draft = await draftArticleWithOpenRouter({
    apiKey: options.apiKey,
    model,
    siteName: article.site.name,
    siteUrl: article.site.baseUrl,
    keyword: article.keyword.term,
    styleGuide,
    revision: {
      currentTitle: article.title,
      currentSlug: article.slug,
      currentMetaDescription: article.metaDescription,
      currentContentMarkdown: article.contentMarkdown,
      currentImagePrompt: article.imagePrompt,
      comments: input.comments,
      seoIssues,
    },
    fetchFn: options.fetchFn,
  });

  const nextSlug = normalizeSlug(draft.slug);
  const seoReport = buildSeoReport({
    title: draft.title,
    slug: nextSlug,
    metaDescription: draft.metaDescription,
    contentMarkdown: draft.contentMarkdown,
    imagePrompt: draft.imagePrompt,
    keyword: article.keyword.term,
    bannedPhrases,
    inlineImageCount,
  });

  const updated = await db.$transaction(async (tx) => {
    const current = await tx.article.findUniqueOrThrow({ where: { id } });
    const version = current.currentVersion + 1;
    const saved = await tx.article.update({
      where: { id },
      data: {
        title: draft.title,
        slug: nextSlug,
        metaDescription: draft.metaDescription,
        imagePrompt: draft.imagePrompt,
        contentMarkdown: draft.contentMarkdown,
        contentHtml: renderBasicMarkdownToHtml(draft.contentMarkdown),
        wordCount: wordCount(draft.contentMarkdown),
        qaReport: seoReport as Prisma.InputJsonValue,
        status: 'PENDING_REVIEW',
        regenAttempts: { increment: 1 },
        currentVersion: version,
        revisions: {
          create: {
            version,
            contentMarkdown: draft.contentMarkdown,
            authorType: 'AI',
            note: input.comments?.trim()
              ? 'ai regeneration (comments + SEO)'
              : 'ai regeneration (SEO)',
          },
        },
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.regenerated',
      entityType: 'Article',
      entityId: id,
      metadata: {
        version,
        hasComments: Boolean(input.comments?.trim()),
        seoIssueCount: seoIssues.length,
      },
    });
    return saved;
  });

  return toArticleDTO(updated);
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
  const { mimeType, dataBase64, bytes } = decodeValidatedImage(input);

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.article.update({
      where: { id },
      data: {
        imageMimeType: mimeType,
        imageDataBase64: dataBase64,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.imageUploaded',
      entityType: 'Article',
      entityId: id,
      metadata: { mimeType, imageBytes: bytes },
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
    include: { site: true, images: { orderBy: { position: 'asc' } } },
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

  // Resolve the reviewer's chosen category/tag slugs to Strapi v5 documentIds.
  // Existing taxonomy only — unknown slugs are silently skipped (no auto-create).
  let categoryDocumentId: string | null = null;
  let tagDocumentIds: string[] = [];
  if (article.categorySlug) {
    const categories = await fetchStrapiCollection({
      baseUrl: article.site.baseUrl,
      credentials,
      pluralApiId: credentials.categoryApiId,
      fetchFn: options.fetchFn,
    });
    categoryDocumentId = resolveDocumentIdsBySlug(categories, [article.categorySlug])[0] ?? null;
  }
  if (article.tagSlugs.length > 0) {
    const tags = await fetchStrapiCollection({
      baseUrl: article.site.baseUrl,
      credentials,
      pluralApiId: credentials.tagApiId,
      fetchFn: options.fetchFn,
    });
    tagDocumentIds = resolveDocumentIdsBySlug(tags, article.tagSlugs);
  }

  // In-body images that have an asset; uploaded to media and embedded on publish.
  const inlineImages = article.images.flatMap((image) => {
    if (!image.dataBase64 || !image.mimeType) return [];
    const ext = image.mimeType.split('/')[1] ?? 'png';
    return [
      {
        mimeType: image.mimeType,
        dataBase64: image.dataBase64,
        alt: image.alt,
        placement: image.placement,
        filename: `${article.slug ?? article.id}-inline-${image.position}.${ext}`,
      },
    ];
  });

  // If this article was published before, update that CMS entry in place rather
  // than creating a duplicate (the enhance → republish loop).
  const priorPublish = await db.publishRecord.findFirst({
    where: { articleId: id, status: 'success', cmsPostId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  const existingDocumentId = priorPublish?.cmsPostId ?? null;

  await db.article.update({
    where: { id },
    data: { status: 'PUBLISHING' },
  });

  const idempotencyKey = `article:${id}:${randomUUID()}`;
  try {
    const result = await publishToStrapi({
      baseUrl: article.site.baseUrl,
      credentials,
      existingDocumentId,
      article: {
        title: article.title,
        slug: article.slug,
        metaDescription: article.metaDescription,
        contentMarkdown: article.contentMarkdown,
        contentHtml: article.contentHtml,
        image:
          article.imageMimeType && article.imageDataBase64
            ? {
                mimeType: article.imageMimeType,
                dataBase64: article.imageDataBase64,
                filename: `${article.slug ?? article.id}.${article.imageMimeType.split('/')[1] ?? 'png'}`,
              }
            : null,
        inlineImages,
        categoryDocumentId,
        tagDocumentIds,
        readTime: readTimeLabel(article.wordCount),
        author: article.site.defaultAuthor,
        date: new Date().toISOString().slice(0, 10),
        featured: false,
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
          updated: Boolean(existingDocumentId),
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

export async function uploadArticleInlineImage(
  db: PrismaClient,
  actor: Actor,
  imageId: string,
  input: {
    mimeType: string;
    dataBase64: string;
  },
): Promise<ArticleImageDTO> {
  authorize(actor, 'article.edit');
  const { mimeType, dataBase64, bytes } = decodeValidatedImage(input);

  const updated = await db.$transaction(async (tx) => {
    const image = await tx.articleImage.findUniqueOrThrow({ where: { id: imageId } });
    const saved = await tx.articleImage.update({
      where: { id: imageId },
      data: { mimeType, dataBase64 },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.inlineImageUploaded',
      entityType: 'Article',
      entityId: image.articleId,
      metadata: { imageId, mimeType, imageBytes: bytes },
    });
    return saved;
  });

  return toArticleImageDTO(updated);
}

export async function generateArticleInlineImage(
  db: PrismaClient,
  actor: Actor,
  imageId: string,
  options: {
    apiKey?: string;
    fetchFn?: Parameters<typeof generateGeminiImage>[0]['fetchFn'];
  },
): Promise<ArticleImageDTO> {
  authorize(actor, 'article.edit');
  const [image, settings] = await Promise.all([
    db.articleImage.findUnique({ where: { id: imageId } }),
    getSettings(db),
  ]);
  if (!image) {
    throw new Error('Image not found.');
  }
  if (!image.prompt.trim()) {
    throw new Error('This image has no prompt to generate from.');
  }

  const result = await generateGeminiImage({
    apiKey: options.apiKey ?? '',
    model: settings.imageGeneration.model,
    prompt: image.prompt,
    fetchFn: options.fetchFn,
  });
  const generated = result.images[0];
  if (!generated) {
    throw new Error('Gemini returned no image.');
  }

  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.articleImage.update({
      where: { id: imageId },
      data: {
        mimeType: generated.mimeType,
        dataBase64: generated.dataBase64,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      actorType: 'human',
      action: 'article.inlineImageGenerated',
      entityType: 'Article',
      entityId: image.articleId,
      metadata: { imageId, model: settings.imageGeneration.model, mimeType: generated.mimeType },
    });
    return saved;
  });

  return toArticleImageDTO(updated);
}
