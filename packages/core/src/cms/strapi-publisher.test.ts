import { describe, it, expect, vi } from 'vitest';
import {
  buildStrapiArticlePayload,
  buildStrapiCreateUrl,
  publishToStrapi,
  type StrapiArticleInput,
} from './strapi-publisher';
import type { StrapiCredentials } from '../domain/site';

const credentials: StrapiCredentials = {
  cmsType: 'STRAPI',
  apiToken: 'strapi-token',
  apiBaseUrl: 'https://strapi.example.com',
  collectionApiId: 'articles',
  fieldMap: {
    title: 'title',
    slug: 'slug',
    content: 'body',
    metaDescription: 'seoDescription',
  },
  contentFormat: 'HTML',
  publicationStatus: 'DRAFT',
};

const article: StrapiArticleInput = {
  title: 'How to Budget',
  slug: 'how-to-budget',
  metaDescription: 'A practical budgeting guide.',
  contentMarkdown: '# How to Budget',
  contentHtml: '<h1>How to Budget</h1>',
};

describe('buildStrapiArticlePayload', () => {
  it('maps Scribe article fields into configured Strapi field names', () => {
    expect(buildStrapiArticlePayload(credentials, article)).toEqual({
      data: {
        title: 'How to Budget',
        slug: 'how-to-budget',
        body: '<h1>How to Budget</h1>',
        seoDescription: 'A practical budgeting guide.',
      },
    });
  });

  it('can emit basic Strapi rich-text blocks', () => {
    expect(
      buildStrapiArticlePayload(
        { ...credentials, contentFormat: 'STRAPI_BLOCKS' },
        { ...article, contentMarkdown: 'First paragraph.\n\nSecond paragraph.' },
      ),
    ).toEqual({
      data: {
        title: 'How to Budget',
        slug: 'how-to-budget',
        body: [
          { type: 'paragraph', children: [{ type: 'text', text: 'First paragraph.' }] },
          { type: 'paragraph', children: [{ type: 'text', text: 'Second paragraph.' }] },
        ],
        seoDescription: 'A practical budgeting guide.',
      },
    });
  });
});

describe('buildStrapiCreateUrl', () => {
  it('targets the configured collection and status', () => {
    expect(buildStrapiCreateUrl('https://strapi.example.com/', credentials)).toBe(
      'https://strapi.example.com/api/articles?status=draft',
    );
    expect(
      buildStrapiCreateUrl('https://public.example.com', {
        ...credentials,
        publicationStatus: 'PUBLISHED',
      }),
    ).toBe('https://strapi.example.com/api/articles?status=published');
  });
});

describe('publishToStrapi', () => {
  it('posts to Strapi with a bearer token and returns the created id', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => ({
        data: {
          id: 7,
          documentId: 'doc_123',
          slug: 'how-to-budget',
        },
      }),
    });

    const result = await publishToStrapi({
      baseUrl: 'https://public.example.com',
      credentials,
      article,
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith('https://strapi.example.com/api/articles?status=draft', {
      method: 'POST',
      headers: {
        Authorization: 'bearer strapi-token',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(buildStrapiArticlePayload(credentials, article)),
    });
    expect(result).toMatchObject({
      cmsPostId: 'doc_123',
      documentId: 'doc_123',
      url: 'https://public.example.com/how-to-budget',
    });
  });
});
