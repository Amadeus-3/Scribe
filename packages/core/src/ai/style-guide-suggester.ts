import { z } from 'zod';
import { mapOpenRouterUsage, type LlmUsage } from '../cost/usage';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

export const SuggestedStyleGuideSchema = z.object({
  systemPrompt: z.string().min(1),
  businessContext: z.string().min(1),
  audienceNotes: z.string().min(1),
  seoGuidance: z.string().min(1),
  imagePromptInstructions: z.string().min(1),
  toneNotes: z.string().min(1),
  formattingRules: z.string().min(1),
  readingLevel: z.string().min(1),
  bannedPhrases: z.array(z.string().min(1)).default([]),
});

export type SuggestedStyleGuide = z.infer<typeof SuggestedStyleGuideSchema>;

const OpenRouterChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nullable().optional(),
      completion_tokens: z.number().nullable().optional(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().nullable().optional() })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

export class StyleGuideSuggestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StyleGuideSuggestionError';
  }
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim().startsWith('{')) {
    return JSON.parse(fenced[1]);
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new StyleGuideSuggestionError('The model did not return a JSON object.');
}

export function buildStyleGuideSuggestionMessages({
  siteName,
  siteUrl,
  siteText,
  notes,
}: {
  siteName: string;
  siteUrl: string;
  siteText: string;
  notes?: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        'You are a senior content strategist for SEO blogs. Return only valid JSON matching the requested keys. Do not include markdown.',
    },
    {
      role: 'user',
      content: [
        `Site name: ${siteName}`,
        `Site URL: ${siteUrl}`,
        notes ? `Owner notes:\n${notes}` : null,
        siteText
          ? `Public site text collected from the website:\n${siteText}`
          : 'No public site text could be collected. Infer cautiously from the site name, URL, and owner notes.',
        '',
        'Create a reusable style guide for article generation. The guide must help an LLM understand the core business, target readers, topic strategy, writing voice, formatting expectations, and image generation direction.',
        '',
        'Return JSON with exactly these keys:',
        '- systemPrompt: complete drafting system prompt for future articles',
        '- businessContext: concise site/business summary, offer, credibility signals, and what the brand should be known for',
        '- audienceNotes: target audience, problems, objections, knowledge level, and desired actions',
        '- seoGuidance: article topics, search intent focus, internal-linking angles, and what to avoid',
        '- imagePromptInstructions: reusable manual image prompt rules including visual style, subject matter, composition, lighting, aspect ratio, brand safety, and things to avoid',
        '- toneNotes: practical voice and tone guidance',
        '- formattingRules: structure rules for article outlines, headings, examples, CTAs, and tables/lists',
        '- readingLevel: short reading-level label',
        '- bannedPhrases: array of phrases to avoid',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export async function suggestStyleGuideWithOpenRouter({
  apiKey,
  model,
  siteName,
  siteUrl,
  siteText,
  notes,
  fetchFn = fetch,
}: {
  apiKey?: string;
  model: string;
  siteName: string;
  siteUrl: string;
  siteText: string;
  notes?: string;
  fetchFn?: FetchLike;
}): Promise<{ suggestion: SuggestedStyleGuide; usage: LlmUsage }> {
  if (!apiKey) {
    throw new StyleGuideSuggestionError(
      'Save an OpenRouter API key in Settings before using AI suggestions.',
    );
  }

  const response = await fetchFn(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: buildStyleGuideSuggestionMessages({ siteName, siteUrl, siteText, notes }),
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new StyleGuideSuggestionError(
      `OpenRouter style guide suggestion failed (${response.status} ${response.statusText}): ${body.slice(0, 240)}`,
    );
  }

  const parsed = OpenRouterChatResponseSchema.parse(await response.json());
  const content = parsed.choices[0]?.message.content;
  if (!content) {
    throw new StyleGuideSuggestionError('OpenRouter returned an empty style guide suggestion.');
  }

  return {
    suggestion: SuggestedStyleGuideSchema.parse(extractJsonObject(content)),
    usage: mapOpenRouterUsage(parsed.usage),
  };
}
