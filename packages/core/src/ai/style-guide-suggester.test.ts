import { describe, expect, it, vi } from 'vitest';
import {
  buildStyleGuideSuggestionMessages,
  suggestStyleGuideWithOpenRouter,
  StyleGuideSuggestionError,
} from './style-guide-suggester';

describe('buildStyleGuideSuggestionMessages', () => {
  it('includes site context and image prompt requirements', () => {
    const messages = buildStyleGuideSuggestionMessages({
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      siteText: 'Personal finance education.',
      notes: 'Focus on beginners.',
    });

    const user = messages.find((message) => message.role === 'user')?.content;
    expect(user).toContain('Wisely Rich');
    expect(user).toContain('Personal finance education');
    expect(user).toContain('imagePromptInstructions');
  });
});

describe('suggestStyleGuideWithOpenRouter', () => {
  it('posts a JSON-object request and parses the suggested guide', async () => {
    const content = JSON.stringify({
      systemPrompt: 'Write useful finance articles.',
      businessContext: 'A personal finance education blog.',
      audienceNotes: 'Readers learning to build wealth.',
      seoGuidance: 'Answer informational queries with practical steps.',
      imagePromptInstructions: 'Create clean editorial finance visuals.',
      toneNotes: 'Clear, calm, specific.',
      formattingRules: 'Use H2 headings and examples.',
      readingLevel: 'Grade 8',
      bannedPhrases: ['delve'],
    });
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 500, completion_tokens: 300 },
      }),
      text: async () => '',
    }));

    const { suggestion, usage } = await suggestStyleGuideWithOpenRouter({
      apiKey: 'openrouter-key',
      model: 'openai/gpt-4o-mini',
      siteName: 'Wisely Rich',
      siteUrl: 'https://example.com',
      siteText: 'Finance education.',
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer openrouter-key' }),
      }),
    );
    expect(suggestion.imagePromptInstructions).toBe('Create clean editorial finance visuals.');
    expect(usage).toEqual({ inputTokens: 500, outputTokens: 300, cachedTokens: 0 });
  });

  it('requires an API key', async () => {
    await expect(
      suggestStyleGuideWithOpenRouter({
        model: 'openai/gpt-4o-mini',
        siteName: 'Wisely Rich',
        siteUrl: 'https://example.com',
        siteText: '',
      }),
    ).rejects.toThrow(StyleGuideSuggestionError);
  });
});
