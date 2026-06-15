import { describe, it, expect } from 'vitest';
import { parseKeywordSeedList } from './keyword';
import { parseBannedPhrases, StyleGuideInputSchema } from './style-guide';
import {
  LegacyWordPressCredentialsSchema,
  SiteInputSchema,
  StrapiCredentialsSchema,
  WordPressCredentialsSchema,
} from './site';

describe('parseKeywordSeedList', () => {
  it('trims, drops blanks, and de-dupes case-insensitively (first casing kept)', () => {
    expect(parseKeywordSeedList('  Best Coffee \n\nbest coffee\nTea  \n')).toEqual([
      'Best Coffee',
      'Tea',
    ]);
  });
  it('returns empty for blank input', () => {
    expect(parseKeywordSeedList('\n   \n')).toEqual([]);
  });
});

describe('parseBannedPhrases', () => {
  it('splits on newlines and commas, trims, drops blanks', () => {
    expect(parseBannedPhrases('delve,\n tapestry \nin conclusion,')).toEqual([
      'delve',
      'tapestry',
      'in conclusion',
    ]);
  });
});

describe('StyleGuideInputSchema', () => {
  it('requires a system prompt', () => {
    expect(() => StyleGuideInputSchema.parse({ bannedPhrases: [] })).toThrow();
  });
  it('accepts a valid guide', () => {
    const guide = StyleGuideInputSchema.parse({
      systemPrompt: 'Write clearly.',
      businessContext: 'A finance education site.',
      audienceNotes: 'Beginners who want practical steps.',
      seoGuidance: 'Prioritize informational intent.',
      imagePromptInstructions: 'Clean editorial finance imagery.',
      formattingRules: 'Use H2 sections.',
      bannedPhrases: ['delve'],
    });
    expect(guide.systemPrompt).toBe('Write clearly.');
    expect(guide.businessContext).toBe('A finance education site.');
    expect(guide.imagePromptInstructions).toBe('Clean editorial finance imagery.');
    expect(guide.bannedPhrases).toEqual(['delve']);
  });
});

describe('SiteInputSchema', () => {
  it('requires a name + valid URL and defaults briefAutoApprove to true', () => {
    const site = SiteInputSchema.parse({ name: 'Blog', baseUrl: 'https://blog.example.com' });
    expect(site.briefAutoApprove).toBe(true);
    expect(site.cmsType).toBe('WORDPRESS');
  });
  it('rejects an invalid URL', () => {
    expect(() => SiteInputSchema.parse({ name: 'x', baseUrl: 'not-a-url' })).toThrow();
  });
});

describe('WordPressCredentialsSchema', () => {
  it('requires cms type, username, and application password', () => {
    expect(() =>
      WordPressCredentialsSchema.parse({ cmsType: 'WORDPRESS', username: 'a' }),
    ).toThrow();
    expect(
      WordPressCredentialsSchema.parse({
        cmsType: 'WORDPRESS',
        username: 'a',
        applicationPassword: 'b',
      }),
    ).toEqual({
      cmsType: 'WORDPRESS',
      username: 'a',
      applicationPassword: 'b',
    });
  });

  it('upgrades legacy WordPress credentials with a discriminator', () => {
    expect(
      LegacyWordPressCredentialsSchema.parse({ username: 'a', applicationPassword: 'b' }),
    ).toEqual({
      cmsType: 'WORDPRESS',
      username: 'a',
      applicationPassword: 'b',
    });
  });
});

describe('StrapiCredentialsSchema', () => {
  it('defaults collection and field mapping', () => {
    expect(
      StrapiCredentialsSchema.parse({
        cmsType: 'STRAPI',
        apiToken: 'token',
        apiBaseUrl: 'https://strapi.example.com',
      }),
    ).toMatchObject({
      cmsType: 'STRAPI',
      apiBaseUrl: 'https://strapi.example.com',
      collectionApiId: 'articles',
      fieldMap: {
        title: 'title',
        slug: 'slug',
        content: 'content',
        metaDescription: 'description',
        image: 'image',
        readTime: 'readTime',
        author: 'author',
        date: 'date',
        featured: 'featured',
      },
      contentFormat: 'HTML',
      publicationStatus: 'PUBLISHED',
    });
  });
});
