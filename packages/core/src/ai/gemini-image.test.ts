import { describe, it, expect, vi } from 'vitest';
import { GeminiImageError, generateGeminiImage } from './gemini-image';

describe('generateGeminiImage', () => {
  it('calls Gemini generateContent and extracts inline image data', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { text: 'Created image.' },
                { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 0 },
      }),
    });

    const result = await generateGeminiImage({
      apiKey: 'gemini-test-key',
      model: 'gemini-3.1-flash-image',
      prompt: 'Create an article hero image',
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': 'gemini-test-key',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Create an article hero image' }] }],
        }),
      },
    );
    expect(result).toEqual({
      images: [{ mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }],
      text: ['Created image.'],
      usage: { inputTokens: 12, outputTokens: 0, cachedTokens: 0 },
    });
  });

  it('requires a key and image data', async () => {
    await expect(
      generateGeminiImage({
        apiKey: '',
        model: 'gemini-3.1-flash-image',
        prompt: 'Create an image',
      }),
    ).rejects.toThrow(GeminiImageError);

    await expect(
      generateGeminiImage({
        apiKey: 'gemini-test-key',
        model: 'gemini-3.1-flash-image',
        prompt: 'Create an image',
        fetchFn: async () => ({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => '',
          json: async () => ({ candidates: [{ content: { parts: [{ text: 'No image' }] } }] }),
        }),
      }),
    ).rejects.toThrow(/no image data/);
  });
});
