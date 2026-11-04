import { z } from 'zod';
import type { StrapiCredentials } from '../domain/site';

/**
 * Read-only helpers for resolving Strapi taxonomy (categories, tags) by slug.
 * Used to (a) populate the reviewer's category/tag pickers and (b) resolve the
 * chosen slugs to Strapi v5 `documentId`s at publish time so the article's
 * relations can be connected. Existing entries only — never creates taxonomy.
 */

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

export interface StrapiTaxonomyEntry {
  documentId: string;
  name: string;
  slug: string;
}

export class StrapiTaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrapiTaxonomyError';
  }
}

// Strapi v5 flattens attributes onto each entry (no `attributes` wrapper).
const StrapiCollectionResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            documentId: z.string(),
            name: z.string().nullable().optional(),
            slug: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function buildStrapiCollectionUrl(
  baseUrl: string,
  credentials: StrapiCredentials,
  pluralApiId: string,
): string {
  const url = new URL(joinUrl(credentials.apiBaseUrl ?? baseUrl, `/api/${pluralApiId}`));
  url.searchParams.set('fields[0]', 'name');
  url.searchParams.set('fields[1]', 'slug');
  url.searchParams.set('pagination[pageSize]', '100');
  url.searchParams.set('sort', 'name:asc');
  return url.toString();
}

export async function fetchStrapiCollection({
  baseUrl,
  credentials,
  pluralApiId,
  fetchFn = fetch,
}: {
  baseUrl: string;
  credentials: StrapiCredentials;
  pluralApiId: string;
  fetchFn?: FetchLike;
}): Promise<StrapiTaxonomyEntry[]> {
  const response = await fetchFn(buildStrapiCollectionUrl(baseUrl, credentials, pluralApiId), {
    method: 'GET',
    headers: {
      Authorization: `bearer ${credentials.apiToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new StrapiTaxonomyError(
      `Strapi ${pluralApiId} fetch failed (${response.status} ${response.statusText}): ${body.slice(
        0,
        240,
      )}`,
    );
  }

  const parsed = StrapiCollectionResponseSchema.parse(await response.json());
  return parsed.data.flatMap((entry) =>
    entry.slug && entry.name
      ? [{ documentId: entry.documentId, name: entry.name, slug: entry.slug }]
      : [],
  );
}

/** Map the requested slugs to documentIds, preserving order, dropping unknowns. */
export function resolveDocumentIdsBySlug(
  entries: StrapiTaxonomyEntry[],
  slugs: string[],
): string[] {
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry.documentId]));
  return slugs.flatMap((slug) => {
    const documentId = bySlug.get(slug);
    return documentId ? [documentId] : [];
  });
}
