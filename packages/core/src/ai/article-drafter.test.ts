import { describe, expect, it, vi } from 'vitest';
import {
  ArticleDraftError,
  buildArticleDraftMessages,
  draftArticleWithOpenRouter,
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
      siteUrl: 'https://wiselyrich.com',
      keyword: 'how to build wealth',
      instructions: 'Mention budgeting.',
      styleGuide,
    });

    const user = messages.find((message) => message.role === 'user')?.content;
    expect(user).toContain('how to build wealth');
    expect(user).toContain('Use clean editorial imagery');
    expect(user).toContain('imagePrompt');
    expect(user).toContain('external image tool');
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
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => '',
    }));

    const draft = await draftArticleWithOpenRouter({
      apiKey: 'openrouter-key',
      model: 'openai/gpt-4o-mini',
      siteName: 'Wisely Rich',
      siteUrl: 'https://wiselyrich.com',
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
    expect(draft.slug).toBe('how-to-build-wealth');
    expect(draft.imagePrompt).toContain('personal finance');
  });

  it('requires an API key', async () => {
    await expect(
      draftArticleWithOpenRouter({
        model: 'openai/gpt-4o-mini',
        siteName: 'Wisely Rich',
        siteUrl: 'https://wiselyrich.com',
        keyword: 'how to build wealth',
        styleGuide,
      }),
    ).rejects.toThrow(ArticleDraftError);
  });
});
