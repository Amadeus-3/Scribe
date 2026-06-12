import { z } from 'zod';

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

export const DraftArticleSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  metaDescription: z.string().min(1).max(180),
  contentMarkdown: z.string().min(800),
  imagePrompt: z.string().min(1),
});

export type DraftArticle = z.infer<typeof DraftArticleSchema>;

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
});

export class ArticleDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArticleDraftError';
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

  throw new ArticleDraftError('The model did not return a JSON article draft.');
}

export function buildArticleDraftMessages({
  siteName,
  siteUrl,
  keyword,
  instructions,
  styleGuide,
}: {
  siteName: string;
  siteUrl: string;
  keyword: string;
  instructions?: string;
  styleGuide: {
    systemPrompt: string;
    businessContext?: string | null;
    audienceNotes?: string | null;
    seoGuidance?: string | null;
    imagePromptInstructions?: string | null;
    toneNotes?: string | null;
    formattingRules?: string | null;
    readingLevel?: string | null;
    bannedPhrases?: unknown;
  };
}): Array<{ role: 'system' | 'user'; content: string }> {
  const bannedPhrases = Array.isArray(styleGuide.bannedPhrases)
    ? styleGuide.bannedPhrases.filter((phrase): phrase is string => typeof phrase === 'string')
    : [];

  return [
    {
      role: 'system',
      content: [
        styleGuide.systemPrompt,
        '',
        'Return only valid JSON. Do not wrap it in markdown.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Site name: ${siteName}`,
        `Site URL: ${siteUrl}`,
        `Primary keyword: ${keyword}`,
        instructions ? `Extra article instructions:\n${instructions}` : null,
        styleGuide.businessContext ? `Business context:\n${styleGuide.businessContext}` : null,
        styleGuide.audienceNotes ? `Audience notes:\n${styleGuide.audienceNotes}` : null,
        styleGuide.seoGuidance ? `SEO guidance:\n${styleGuide.seoGuidance}` : null,
        styleGuide.toneNotes ? `Tone notes:\n${styleGuide.toneNotes}` : null,
        styleGuide.formattingRules ? `Formatting rules:\n${styleGuide.formattingRules}` : null,
        styleGuide.readingLevel ? `Reading level:\n${styleGuide.readingLevel}` : null,
        styleGuide.imagePromptInstructions
          ? `Image prompt instructions:\n${styleGuide.imagePromptInstructions}`
          : null,
        bannedPhrases.length > 0 ? `Avoid these phrases:\n${bannedPhrases.join(', ')}` : null,
        '',
        'Draft one complete original SEO article for this site.',
        'Return JSON with exactly these keys:',
        '- title: article title',
        '- slug: URL-safe slug',
        '- metaDescription: <= 160 characters where possible',
        '- contentMarkdown: complete article in Markdown, with H2/H3 sections, useful examples, and a natural conclusion',
        '- imagePrompt: detailed prompt(s) for manually generating article images in an external image tool. Start with the hero image prompt. If the article genuinely needs supporting images, add numbered supporting-image prompts in the same string. Each prompt must include subject, setting, composition, style, lighting, mood, brand safety constraints, aspect ratio, and what to avoid. Follow the image prompt instructions.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export async function draftArticleWithOpenRouter({
  apiKey,
  model,
  siteName,
  siteUrl,
  keyword,
  instructions,
  styleGuide,
  fetchFn = fetch,
}: {
  apiKey?: string;
  model: string;
  siteName: string;
  siteUrl: string;
  keyword: string;
  instructions?: string;
  styleGuide: Parameters<typeof buildArticleDraftMessages>[0]['styleGuide'];
  fetchFn?: FetchLike;
}): Promise<DraftArticle> {
  if (!apiKey) {
    throw new ArticleDraftError(
      'Save an OpenRouter API key in Settings before generating articles.',
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
      messages: buildArticleDraftMessages({
        siteName,
        siteUrl,
        keyword,
        instructions,
        styleGuide,
      }),
      temperature: 0.35,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ArticleDraftError(
      `OpenRouter article draft failed (${response.status} ${response.statusText}): ${body.slice(0, 240)}`,
    );
  }

  const parsed = OpenRouterChatResponseSchema.parse(await response.json());
  const content = parsed.choices[0]?.message.content;
  if (!content) {
    throw new ArticleDraftError('OpenRouter returned an empty article draft.');
  }

  return DraftArticleSchema.parse(extractJsonObject(content));
}
