import { describe, it, expect, vi } from 'vitest';
import {
  buildStrapiArticlePayload,
  buildStrapiCreateUrl,
  embedInlineImagesIntoMarkdown,
  publishToStrapi,
  type StrapiArticleInput,
} from './strapi-publisher';
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
    content: 'body',
    metaDescription: 'seoDescription',
    image: 'image',
    readTime: 'readTime',
    author: 'author',
    date: 'date',
    featured: 'featured',
    category: 'category',
    tags: 'tags',
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
  image: {
    mimeType: 'image/png',
    dataBase64: 'aW1hZ2U=',
    filename: 'how-to-budget.png',
  },
  readTime: '4 min read',
  author: 'Jane Doe',
  date: '2026-06-12',
  featured: false,
};

describe('buildStrapiArticlePayload', () => {
  it('maps Scribe article fields into configured Strapi field names', () => {
    expect(buildStrapiArticlePayload(credentials, article, 42)).toEqual({
      data: {
        title: 'How to Budget',
        slug: 'how-to-budget',
        body: '<h1>How to Budget</h1>',
        seoDescription: 'A practical budgeting guide.',
        image: 42,
        readTime: '4 min read',
        author: 'Jane Doe',
        date: '2026-06-12',
        featured: false,
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
        readTime: '4 min read',
        author: 'Jane Doe',
        date: '2026-06-12',
        featured: false,
      },
    });
  });

  it('connects category and tags by documentId (Strapi v5)', () => {
    const payload = buildStrapiArticlePayload(
      credentials,
      { ...article, categoryDocumentId: 'cat_1', tagDocumentIds: ['tag_a', 'tag_b'] },
      42,
    );
    expect(payload.data).toMatchObject({
      category: { connect: [{ documentId: 'cat_1' }] },
      tags: { connect: [{ documentId: 'tag_a' }, { documentId: 'tag_b' }] },
    });
  });

  it('omits relations when none are resolved', () => {
    const payload = buildStrapiArticlePayload(credentials, article, 42);
    expect(payload.data).not.toHaveProperty('category');
    expect(payload.data).not.toHaveProperty('tags');
  });
});

describe('embedInlineImagesIntoMarkdown', () => {
  const md = '# Title\n\nIntro.\n\n## Steps\n\nDo this.\n\n## Costs\n\nDetails.';

  it('inserts each image under its placement heading', () => {
    const out = embedInlineImagesIntoMarkdown(md, [
      { placement: 'Steps', alt: 'Flowchart', url: 'https://cdn/flow.png' },
    ]);
    expect(out).toContain('## Steps\n\n![Flowchart](https://cdn/flow.png)');
    expect(out).not.toContain('## Costs\n\n![Flowchart]');
  });

  it('appends images whose placement matches no heading', () => {
    const out = embedInlineImagesIntoMarkdown(md, [
      { placement: 'Nonexistent', alt: 'Chart', url: 'https://cdn/c.png' },
    ]);
    expect(out.trimEnd().endsWith('![Chart](https://cdn/c.png)')).toBe(true);
  });

  it('returns the markdown unchanged when there are no images', () => {
    expect(embedInlineImagesIntoMarkdown(md, [])).toBe(md);
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
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
        json: async () => [{ id: 42 }],
      })
      .mockResolvedValueOnce({
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

    expect(fetchFn).toHaveBeenNthCalledWith(1, 'https://strapi.example.com/api/upload', {
      method: 'POST',
      headers: {
        Authorization: 'bearer strapi-token',
        Accept: 'application/json',
      },
      body: expect.any(FormData),
    });
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      'https://strapi.example.com/api/articles?status=draft',
      {
        method: 'POST',
        headers: {
          Authorization: 'bearer strapi-token',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(buildStrapiArticlePayload(credentials, article, 42)),
      },
    );
    expect(result).toMatchObject({
      cmsPostId: 'doc_123',
      documentId: 'doc_123',
      url: 'https://public.example.com/how-to-budget',
    });
  });

  it('updates the existing entry in place when given a documentId', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
        json: async () => [{ id: 42 }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
        json: async () => ({ data: { id: 7, documentId: 'doc_123', slug: 'how-to-budget' } }),
      });

    const result = await publishToStrapi({
      baseUrl: 'https://public.example.com',
      credentials,
      article,
      existingDocumentId: 'doc_123',
      fetchFn,
    });

    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      'https://strapi.example.com/api/articles/doc_123?status=draft',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(result.cmsPostId).toBe('doc_123');
  });

  it('sends media fileInfo (clean name + alt text) for cover and in-body images', async () => {
    const articleWithImages: StrapiArticleInput = {
      ...article,
      image: {
        mimeType: 'image/png',
        dataBase64: 'aW1hZ2U=',
        filename: 'how-to-budget.png',
        alt: 'How to Budget hero',
      },
      contentMarkdown: '# How to Budget\n\n## Saving',
      inlineImages: [
        {
          mimeType: 'image/png',
          dataBase64: 'aW5saW5l',
          filename: 'how-to-budget-inline-0.png',
          alt: 'A jar of coins labelled savings',
          placement: 'Saving',
        },
      ],
    };

    const ok = (json: unknown) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => json,
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(ok([{ id: 10, url: '/uploads/cover.png' }])) // cover upload
      .mockResolvedValueOnce(ok([{ id: 11, url: '/uploads/inline.png' }])) // in-body upload
      .mockResolvedValueOnce(ok({ data: { id: 7, documentId: 'doc_123', slug: 'how-to-budget' } }));

    await publishToStrapi({
      baseUrl: 'https://public.example.com',
      credentials,
      article: articleWithImages,
      fetchFn,
    });

    const coverForm = fetchFn.mock.calls[0]?.[1]?.body as FormData;
    const inlineForm = fetchFn.mock.calls[1]?.[1]?.body as FormData;
    expect(JSON.parse(coverForm.get('fileInfo') as string)).toEqual({
      name: 'how-to-budget',
      alternativeText: 'How to Budget hero',
    });
    expect(JSON.parse(inlineForm.get('fileInfo') as string)).toEqual({
      name: 'how-to-budget-inline-0',
      alternativeText: 'A jar of coins labelled savings',
    });
  });
});
