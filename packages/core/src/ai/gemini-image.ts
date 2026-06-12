import { z } from 'zod';

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

const GeminiInlineDataSchema = z.object({
  mimeType: z.string().min(1),
  data: z.string().min(1),
});

const GeminiPartSchema = z
  .object({
    text: z.string().optional(),
    inlineData: GeminiInlineDataSchema.optional(),
  })
  .passthrough();

const GeminiImageResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(GeminiPartSchema).default([]),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export interface GeminiGeneratedImage {
  mimeType: string;
  dataBase64: string;
}

export interface GeminiImageResult {
  images: GeminiGeneratedImage[];
  text: string[];
}

export class GeminiImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiImageError';
  }
}

function modelPath(model: string): string {
  return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

export async function generateGeminiImage({
  apiKey,
  model,
  prompt,
  fetchFn = fetch,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  fetchFn?: FetchLike;
}): Promise<GeminiImageResult> {
  if (!apiKey) {
    throw new GeminiImageError(
      'Save a Gemini API key in Settings or set GEMINI_API_KEY before generating images.',
    );
  }
  if (!prompt.trim()) throw new GeminiImageError('A non-empty image prompt is required.');

  const response = await fetchFn(
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
      modelPath(model),
    )}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new GeminiImageError(
      `Gemini image generation failed (${response.status} ${response.statusText}): ${body.slice(
        0,
        240,
      )}`,
    );
  }

  const parsed = GeminiImageResponseSchema.parse(await response.json());
  const images: GeminiGeneratedImage[] = [];
  const text: string[] = [];

  for (const candidate of parsed.candidates) {
    for (const part of candidate.content.parts) {
      if (part.text) text.push(part.text);
      if (part.inlineData) {
        images.push({
          mimeType: part.inlineData.mimeType,
          dataBase64: part.inlineData.data,
        });
      }
    }
  }

  if (images.length === 0) {
    throw new GeminiImageError('Gemini returned no image data.');
  }

  return { images, text };
}
