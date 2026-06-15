import { describe, it, expect, vi } from 'vitest';
import { fetchStrapiCollection, resolveDocumentIdsBySlug } from './strapi-taxonomy';
import type { StrapiCredentials } from '../domain/site';

const credentials: StrapiCredentials = {
  cmsType: 'STRAPI',
  apiToken: 'strapi-token',
  apiBaseUrl: 'https://strapi.example.com',
  collectionApiId: 'articles',
  categoryApiId: 'categories',
  tagApiId: 'tags',
  fieldMap: {
    title: 'title',
    slug: 'slug',
    content: 'content',
    category: 'category',
    tags: 'tags',
  },
  contentFormat: 'MARKDOWN',
  publicationStatus: 'PUBLISHED',
};

describe('resolveDocumentIdsBySlug', () => {
  const entries = [
    { documentId: 'd1', name: 'Investing', slug: 'investing' },
    { documentId: 'd2', name: 'ETFS', slug: 'etfs' },
  ];

  it('maps slugs to documentIds in order, dropping unknown slugs', () => {
    expect(resolveDocumentIdsBySlug(entries, ['etfs', 'missing', 'investing'])).toEqual(['d2', 'd1']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(resolveDocumentIdsBySlug(entries, ['nope'])).toEqual([]);
  });
});

describe('fetchStrapiCollection', () => {
  it('requests name+slug and parses v5 flattened entries', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => ({
        data: [
          { id: 1, documentId: 'd1', name: 'Investing', slug: 'investing' },
          { id: 2, documentId: 'd2', name: 'ETFS', slug: 'etfs' },
          { id: 3, documentId: 'd3', name: null, slug: null },
        ],
      }),
    }));

    const result = await fetchStrapiCollection({
      baseUrl: 'https://public.example.com',
      credentials,
      pluralApiId: 'categories',
      fetchFn,
    });

    expect(result).toEqual([
      { documentId: 'd1', name: 'Investing', slug: 'investing' },
      { documentId: 'd2', name: 'ETFS', slug: 'etfs' },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('https://strapi.example.com/api/categories'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'bearer strapi-token' }),
      }),
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'denied',
      json: async () => ({}),
    }));
    await expect(
      fetchStrapiCollection({ baseUrl: 'https://x.example.com', credentials, pluralApiId: 'tags', fetchFn }),
    ).rejects.toThrow();
  });
});
