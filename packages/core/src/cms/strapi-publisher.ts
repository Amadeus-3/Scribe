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
    body?: string;
  },
) => Promise<HttpResponseLike>;

export interface StrapiArticleInput {
  title: string;
  slug?: string | null;
  metaDescription?: string | null;
  contentMarkdown?: string | null;
  contentHtml?: string | null;
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

  if (credentials.locale) {
    data.locale = credentials.locale;
  }

  return { data };
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

export async function publishToStrapi({
  baseUrl,
  credentials,
  article,
  fetchFn = fetch,
}: {
  baseUrl: string;
  credentials: StrapiCredentials;
  article: StrapiArticleInput;
  fetchFn?: FetchLike;
}): Promise<StrapiPublishResult> {
  const response = await fetchFn(buildStrapiCreateUrl(baseUrl, credentials), {
    method: 'POST',
    headers: {
      Authorization: `bearer ${credentials.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(buildStrapiArticlePayload(credentials, article)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new StrapiPublishError(
      `Strapi publish failed (${response.status} ${response.statusText}): ${body.slice(0, 240)}`,
    );
  }

  const raw = await response.json();
  const parsed = StrapiCreateResponseSchema.parse(raw);
  const id = parsed.data.documentId ?? parsed.data.id;
  if (id === undefined) {
    throw new StrapiPublishError('Strapi response did not include an id or documentId.');
  }

  const slug = parsed.data.slug ?? article.slug;
  return {
    cmsPostId: String(id),
    documentId: parsed.data.documentId ?? null,
    url: slug ? joinUrl(baseUrl, slug) : null,
    raw,
  };
}
