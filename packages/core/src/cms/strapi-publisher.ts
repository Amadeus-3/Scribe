import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { StrapiCredentials } from '../domain/site';

interface HttpResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | FormData;
  },
) => Promise<HttpResponseLike>;

export interface StrapiInlineImageInput {
  mimeType: string;
  dataBase64: string;
  filename?: string;
  alt?: string | null;
  /** Heading text the image should appear under (matched in the Markdown body). */
  placement?: string | null;
}

export interface StrapiArticleInput {
  title: string;
  slug?: string | null;
  metaDescription?: string | null;
  contentMarkdown?: string | null;
  contentHtml?: string | null;
  image?: {
    mimeType: string;
    dataBase64: string;
    filename?: string;
  } | null;
  /** In-body images, uploaded to media and embedded into the Markdown content. */
  inlineImages?: StrapiInlineImageInput[];
  /** Resolved Strapi v5 documentId of the chosen category (oneToOne). */
  categoryDocumentId?: string | null;
  /** Resolved Strapi v5 documentIds of the chosen tags (manyToMany). */
  tagDocumentIds?: string[];
  readTime?: string | null;
  author?: string | null;
  date?: string | null;
  featured?: boolean | null;
}

export interface StrapiPublishResult {
  cmsPostId: string;
  documentId: string | null;
  url: string | null;
  raw: unknown;
}

export class StrapiPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrapiPublishError';
  }
}

const StrapiCreateResponseSchema = z
  .object({
    data: z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        documentId: z.string().optional(),
        slug: z.string().optional().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

const StrapiUploadResponseSchema = z
  .array(
    z
      .object({
        id: z.union([z.string(), z.number()]),
        url: z.string().optional(),
      })
      .passthrough(),
  )
  .min(1);

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function contentForFormat(
  article: StrapiArticleInput,
  format: StrapiCredentials['contentFormat'],
): string | Array<{ type: 'paragraph'; children: Array<{ type: 'text'; text: string }> }> {
  if (format === 'MARKDOWN') {
    return article.contentMarkdown ?? article.contentHtml ?? '';
  }

  if (format === 'STRAPI_BLOCKS') {
    const source = article.contentMarkdown ?? article.contentHtml ?? '';
    return source
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0)
      .map((paragraph) => ({
        type: 'paragraph' as const,
        children: [{ type: 'text' as const, text: paragraph }],
      }));
  }

  return article.contentHtml ?? article.contentMarkdown ?? '';
}

export function buildStrapiArticlePayload(
  credentials: StrapiCredentials,
  article: StrapiArticleInput,
  uploadedImageId?: string | number | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    [credentials.fieldMap.title]: article.title,
    [credentials.fieldMap.content]: contentForFormat(article, credentials.contentFormat),
  };

  if (article.slug) {
    data[credentials.fieldMap.slug] = article.slug;
  }

  if (credentials.fieldMap.metaDescription && article.metaDescription) {
    data[credentials.fieldMap.metaDescription] = article.metaDescription;
  }

  if (credentials.fieldMap.image && uploadedImageId !== undefined && uploadedImageId !== null) {
    data[credentials.fieldMap.image] = uploadedImageId;
  }

  if (credentials.fieldMap.readTime && article.readTime) {
    data[credentials.fieldMap.readTime] = article.readTime;
  }

  if (credentials.fieldMap.author && article.author) {
    data[credentials.fieldMap.author] = article.author;
  }

  if (credentials.fieldMap.date && article.date) {
    data[credentials.fieldMap.date] = article.date;
  }

  if (credentials.fieldMap.featured && typeof article.featured === 'boolean') {
    data[credentials.fieldMap.featured] = article.featured;
  }

  // Strapi v5 connects relations by documentId. Category is oneToOne (a single
  // entry); tags are manyToMany. Only set when something was resolved.
  if (credentials.fieldMap.category && article.categoryDocumentId) {
    data[credentials.fieldMap.category] = {
      connect: [{ documentId: article.categoryDocumentId }],
    };
  }

  if (credentials.fieldMap.tags && article.tagDocumentIds && article.tagDocumentIds.length > 0) {
    data[credentials.fieldMap.tags] = {
      connect: article.tagDocumentIds.map((documentId) => ({ documentId })),
    };
  }

  if (credentials.locale) {
    data.locale = credentials.locale;
  }

  return { data };
}

/**
 * Embed uploaded in-body images into Markdown as `![alt](url)`, placed right
 * after the heading named by each image's `placement`. Images with no/unknown
 * placement are appended at the end. Pure and order-preserving.
 */
export function embedInlineImagesIntoMarkdown(
  markdown: string,
  images: Array<{ placement?: string | null; alt?: string | null; url: string }>,
): string {
  if (images.length === 0) return markdown;

  const normalize = (value: string): string => value.replace(/^#+\s*/, '').replace(/\s*#*$/, '').trim().toLowerCase();
  const imageMarkdown = (img: { alt?: string | null; url: string }): string =>
    `![${img.alt ?? ''}](${img.url})`;

  let remaining = [...images];
  const out: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    out.push(line);
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (!heading) continue;
    const headingText = normalize(heading[1] ?? '');
    if (!headingText) continue;

    const matched = remaining.filter((img) => {
      const placement = img.placement ? normalize(img.placement) : '';
      return (
        placement.length > 0 &&
        (headingText === placement ||
          headingText.includes(placement) ||
          placement.includes(headingText))
      );
    });
    for (const img of matched) {
      out.push('', imageMarkdown(img));
    }
    remaining = remaining.filter((img) => !matched.includes(img));
  }

  for (const img of remaining) {
    out.push('', imageMarkdown(img));
  }

  return out.join('\n');
}

export function buildStrapiCreateUrl(baseUrl: string, credentials: StrapiCredentials): string {
  const url = new URL(
    joinUrl(credentials.apiBaseUrl ?? baseUrl, `/api/${credentials.collectionApiId}`),
  );
  url.searchParams.set(
    'status',
    credentials.publicationStatus === 'PUBLISHED' ? 'published' : 'draft',
  );
  return url.toString();
}

export function buildStrapiUpdateUrl(
  baseUrl: string,
  credentials: StrapiCredentials,
  documentId: string,
): string {
  const url = new URL(
    joinUrl(credentials.apiBaseUrl ?? baseUrl, `/api/${credentials.collectionApiId}/${documentId}`),
  );
  url.searchParams.set(
    'status',
    credentials.publicationStatus === 'PUBLISHED' ? 'published' : 'draft',
  );
  return url.toString();
}

export function buildStrapiUploadUrl(baseUrl: string, credentials: StrapiCredentials): string {
  return joinUrl(credentials.apiBaseUrl ?? baseUrl, '/api/upload');
}

async function uploadImageToStrapi({
  baseUrl,
  credentials,
  image,
  fetchFn,
}: {
  baseUrl: string;
  credentials: StrapiCredentials;
  image: { mimeType: string; dataBase64: string; filename?: string };
  fetchFn: FetchLike;
}): Promise<{ id: string | number; url: string | null }> {
  const formData = new FormData();
  const buffer = Buffer.from(image.dataBase64, 'base64');
  const filename = image.filename ?? `article-image.${image.mimeType.split('/')[1] ?? 'png'}`;
  formData.append('files', new Blob([buffer], { type: image.mimeType }), filename);

  const response = await fetchFn(buildStrapiUploadUrl(baseUrl, credentials), {
    method: 'POST',
    headers: {
      Authorization: `bearer ${credentials.apiToken}`,
      Accept: 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new StrapiPublishError(
      `Strapi image upload failed (${response.status} ${response.statusText}): ${body.slice(
        0,
        240,
      )}`,
    );
  }

  const parsed = StrapiUploadResponseSchema.parse(await response.json());
  const uploaded = parsed[0];
  if (!uploaded) {
    throw new StrapiPublishError('Strapi upload response did not include a media id.');
  }
  return { id: uploaded.id, url: uploaded.url ?? null };
}

export async function publishToStrapi({
  baseUrl,
  credentials,
  article,
  existingDocumentId,
  fetchFn = fetch,
}: {
  baseUrl: string;
  credentials: StrapiCredentials;
  article: StrapiArticleInput;
  /** When set, updates that existing Strapi entry in place instead of creating a new one. */
  existingDocumentId?: string | null;
  fetchFn?: FetchLike;
}): Promise<StrapiPublishResult> {
  const uploadedImageId =
    article.image && credentials.fieldMap.image
      ? (await uploadImageToStrapi({ baseUrl, credentials, image: article.image, fetchFn })).id
      : null;

  // Upload each in-body image to media, then embed it into the Markdown content
  // at its placement so it renders inline in the published article.
  let contentMarkdown = article.contentMarkdown ?? null;
  const inlineImages = article.inlineImages ?? [];
  if (inlineImages.length > 0) {
    const embedded: Array<{ placement?: string | null; alt?: string | null; url: string }> = [];
    for (const image of inlineImages) {
      const uploaded = await uploadImageToStrapi({
        baseUrl,
        credentials,
        image: { mimeType: image.mimeType, dataBase64: image.dataBase64, filename: image.filename },
        fetchFn,
      });
      if (uploaded.url) {
        embedded.push({ placement: image.placement, alt: image.alt, url: uploaded.url });
      }
    }
    if (embedded.length > 0) {
      contentMarkdown = embedInlineImagesIntoMarkdown(contentMarkdown ?? '', embedded);
    }
  }

  // Update the existing entry in place when this article was published before;
  // otherwise create a new one. This keeps the enhance → republish loop clean
  // (no duplicate CMS entries).
  const isUpdate = Boolean(existingDocumentId);
  const targetUrl = isUpdate
    ? buildStrapiUpdateUrl(baseUrl, credentials, existingDocumentId as string)
    : buildStrapiCreateUrl(baseUrl, credentials);

  const response = await fetchFn(targetUrl, {
    method: isUpdate ? 'PUT' : 'POST',
    headers: {
      Authorization: `bearer ${credentials.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(
      buildStrapiArticlePayload(credentials, { ...article, contentMarkdown }, uploadedImageId),
    ),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new StrapiPublishError(
      `Strapi ${isUpdate ? 'update' : 'publish'} failed (${response.status} ${response.statusText}): ${body.slice(0, 240)}`,
    );
  }

  const raw = await response.json();
  const parsed = StrapiCreateResponseSchema.parse(raw);
  const id = parsed.data.documentId ?? parsed.data.id ?? existingDocumentId;
  if (id === undefined || id === null) {
    throw new StrapiPublishError('Strapi response did not include an id or documentId.');
  }

  const slug = parsed.data.slug ?? article.slug;
  return {
    cmsPostId: String(id),
    documentId: parsed.data.documentId ?? existingDocumentId ?? null,
    url: slug ? joinUrl(baseUrl, slug) : null,
    raw,
  };
}
