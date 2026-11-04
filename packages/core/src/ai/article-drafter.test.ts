import { describe, expect, it, vi } from 'vitest';
import {
  ArticleDraftError,
  buildArticleDraftMessages,
  buildInlineImageSuggestionMessages,
  classifyArticleTaxonomyWithOpenRouter,
  draftArticleWithOpenRouter,
  suggestInlineImagesWithOpenRouter,
} from './article-drafter';

const styleGuide = {
  systemPrompt: 'Write practical finance articles.',
  businessContext: 'A personal finance blog.',
  audienceNotes: 'Beginners and practical investors.',
  seoGuidance: 'Prioritize informational search intent.',
  imagePromptInstructions: 'Use clean editorial imagery.',
  toneNotes: 'Clear and specific.',
  formattingRules: 'Use H2 headings and examples.',
  readingLevel: 'Grade 8',
  bannedPhrases: ['delve'],
};

describe('buildArticleDraftMessages', () => {
  it('includes the keyword, style guide, and image prompt instructions', () => {
    const messages = buildArticleDraftMessages({
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      keyword: 'how to build wealth',
      instructions: 'Mention budgeting.',
      styleGuide,
    });

    const user = messages.find((message) => message.role === 'user')?.content;
    expect(user).toContain('how to build wealth');
    expect(user).toContain('Use clean editorial imagery');
    expect(user).toContain('imagePrompt');
    expect(user).toContain('inlineImages');
    expect(user).toContain('IN-BODY');
    expect(user).toContain('exact figures from the article');
  });

  it('offers the existing taxonomy to choose from when provided', () => {
    const user = buildArticleDraftMessages({
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      keyword: 'how to build wealth',
      styleGuide,
      taxonomy: {
        categories: [{ name: 'How to guides', slug: 'how-to-guides' }],
        tags: [
          { name: 'Investing', slug: 'investing' },
          { name: 'ETFS', slug: 'etfs' },
        ],
      },
    }).find((message) => message.role === 'user')?.content;
    expect(user).toContain('how-to-guides');
    expect(user).toContain('Available tags');
    expect(user).toContain('- categorySlug:');
    expect(user).toContain('- tagSlugs:');
  });

  it('omits taxonomy instructions when none is provided', () => {
    const user = buildArticleDraftMessages({
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      keyword: 'how to build wealth',
      styleGuide,
    }).find((message) => message.role === 'user')?.content;
    expect(user).not.toContain('- categorySlug:');
  });

  it('builds a revision prompt with the current draft, comments, and SEO issues', () => {
    const user = buildArticleDraftMessages({
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      keyword: 'how to build wealth',
      styleGuide,
      revision: {
        currentTitle: 'Old Title',
        currentContentMarkdown: '# Old\n\nThin content.',
        comments: 'Add a concrete example.',
        seoIssues: ['Title is 12 characters; rewrite to ~50–60.', 'Add a meta description.'],
      },
    }).find((message) => message.role === 'user')?.content;
    expect(user).toContain('Improve the EXISTING draft');
    expect(user).toContain('Current content (Markdown):');
    expect(user).toContain('Add a concrete example.');
    expect(user).toContain('Title is 12 characters');
  });
});

describe('draftArticleWithOpenRouter', () => {
  it('posts a JSON article request and parses the draft', async () => {
    const content = JSON.stringify({
      title: 'How to Build Wealth',
      slug: 'how-to-build-wealth',
      metaDescription: 'Learn practical steps to build wealth with better money habits.',
      contentMarkdown: `# How to Build Wealth\n\n${'Useful paragraph. '.repeat(80)}`,
      imagePrompt: 'Editorial image of organized personal finance planning.',
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [{ message: { content } }],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 800,
          prompt_tokens_details: { cached_tokens: 200 },
        },
      }),
      text: async () => '',
    }));

    const { draft, usage } = await draftArticleWithOpenRouter({
      apiKey: 'openrouter-key',
      model: 'openai/gpt-4o-mini',
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      keyword: 'how to build wealth',
      styleGuide,
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer openrouter-key' }),
      }),
    );
    expect(usage).toEqual({ inputTokens: 1000, outputTokens: 800, cachedTokens: 200 });
    expect(draft.slug).toBe('how-to-build-wealth');
    expect(draft.imagePrompt).toContain('personal finance');
    expect(draft.inlineImages).toEqual([]);
    expect(draft.categorySlug).toBeNull();
    expect(draft.tagSlugs).toEqual([]);
  });

  it('parses the model-chosen category and tags when present', async () => {
    const content = JSON.stringify({
      title: 'How to Build Wealth',
      slug: 'how-to-build-wealth',
      metaDescription: 'Learn practical steps to build wealth with better money habits.',
      contentMarkdown: `# How to Build Wealth\n\n${'Useful paragraph. '.repeat(80)}`,
      imagePrompt: 'Editorial hero image of personal finance planning.',
      categorySlug: 'how-to-guides',
      tagSlugs: ['investing', 'compound-interest'],
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    }));

    const { draft } = await draftArticleWithOpenRouter({
      apiKey: 'openrouter-key',
      model: 'openai/gpt-4o-mini',
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      keyword: 'how to build wealth',
      styleGuide,
      fetchFn,
    });

    expect(draft.categorySlug).toBe('how-to-guides');
    expect(draft.tagSlugs).toEqual(['investing', 'compound-interest']);
  });

  it('parses structured in-body image specs when present', async () => {
    const content = JSON.stringify({
      title: 'How to Build Wealth',
      slug: 'how-to-build-wealth',
      metaDescription: 'Learn practical steps to build wealth with better money habits.',
      contentMarkdown: `# How to Build Wealth\n\n${'Useful paragraph. '.repeat(80)}`,
      imagePrompt: 'Editorial hero image of personal finance planning.',
      inlineImages: [
        {
          placement: 'How to set it up in three steps',
          alt: 'Flowchart of the three-step automatic savings system',
          aspectRatio: '16:9',
          prompt:
            'Clean flat-vector flowchart with three labeled stages, brand-safe, no embedded text.',
        },
      ],
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    }));

    const { draft } = await draftArticleWithOpenRouter({
      apiKey: 'openrouter-key',
      model: 'openai/gpt-4o-mini',
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      keyword: 'how to build wealth',
      styleGuide,
      fetchFn,
    });

    expect(draft.inlineImages).toHaveLength(1);
    expect(draft.inlineImages[0]?.placement).toBe('How to set it up in three steps');
    expect(draft.inlineImages[0]?.aspectRatio).toBe('16:9');
  });

  it('requires an API key', async () => {
    await expect(
      draftArticleWithOpenRouter({
        model: 'openai/gpt-4o-mini',
        siteName: 'Wisely Rich',
        siteUrl: 'https://example.com',
        keyword: 'how to build wealth',
        styleGuide,
      }),
    ).rejects.toThrow(ArticleDraftError);
  });
});

describe('classifyArticleTaxonomyWithOpenRouter', () => {
  const taxonomy = {
    categories: [{ name: 'How to guides', slug: 'how-to-guides' }],
    tags: [{ name: 'Investing', slug: 'investing' }],
  };

  it('parses the chosen category and tags', async () => {
    const content = JSON.stringify({ categorySlug: 'how-to-guides', tagSlugs: ['investing'] });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    }));

    const { classification } = await classifyArticleTaxonomyWithOpenRouter({
      apiKey: 'openrouter-key',
      model: 'openai/gpt-4o-mini',
      title: 'How to Build Wealth',
      contentMarkdown: 'A practical guide about investing and saving.',
      keyword: 'how to build wealth',
      taxonomy,
      fetchFn,
    });

    expect(classification).toEqual({ categorySlug: 'how-to-guides', tagSlugs: ['investing'] });
  });

  it('requires an API key', async () => {
    await expect(
      classifyArticleTaxonomyWithOpenRouter({
        model: 'openai/gpt-4o-mini',
        title: 'How to Build Wealth',
        contentMarkdown: 'Body.',
        taxonomy,
      }),
    ).rejects.toThrow(ArticleDraftError);
  });
});

describe('buildInlineImageSuggestionMessages', () => {
  it('requires exact article figures for data visualizations', () => {
    const user = buildInlineImageSuggestionMessages({
      title: 'How to Build Wealth',
      contentMarkdown: '## Steps\n\nSave $1,000 in 90 days.',
      keyword: 'how to build wealth',
    }).find((message) => message.role === 'user')?.content;
    expect(user).toContain('exact figures from the article');
    expect(user).toContain('Never invent');
  });
});

describe('suggestInlineImagesWithOpenRouter', () => {
  it('parses suggested in-body images', async () => {
    const content = JSON.stringify({
      inlineImages: [
        {
          placement: 'Steps',
          alt: 'Three-step flowchart',
          aspectRatio: '16:9',
          prompt: 'Flat-vector flowchart, brand-safe, no text.',
        },
      ],
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    }));

    const { images } = await suggestInlineImagesWithOpenRouter({
      apiKey: 'openrouter-key',
      model: 'openai/gpt-4o-mini',
      title: 'How to Build Wealth',
      contentMarkdown: '## Steps\n\nDo this.',
      keyword: 'how to build wealth',
      fetchFn,
    });

    expect(images).toHaveLength(1);
    expect(images[0]?.placement).toBe('Steps');
    expect(images[0]?.aspectRatio).toBe('16:9');
  });

  it('requires an API key', async () => {
    await expect(
      suggestInlineImagesWithOpenRouter({
        model: 'openai/gpt-4o-mini',
        title: 'How to Build Wealth',
        contentMarkdown: 'Body.',
      }),
    ).rejects.toThrow(ArticleDraftError);
  });
});
