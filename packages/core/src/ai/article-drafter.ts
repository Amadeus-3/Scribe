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

/**
 * One in-body (supporting) image the article needs to explain its content —
 * e.g. a process flowchart, a comparison visual, or a stat graphic. The hero
 * image is kept separate (`imagePrompt`). Each in-body image carries its own
 * placement, alt text, aspect ratio, and a standalone generation prompt so a
 * human can generate and place it.
 */
export const DraftInlineImageSchema = z.object({
  placement: z.string().min(1),
  alt: z.string().min(1),
  aspectRatio: z.string().min(1),
  prompt: z.string().min(1),
});
export type DraftInlineImage = z.infer<typeof DraftInlineImageSchema>;

export const DraftArticleSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  metaDescription: z.string().min(1).max(180),
  contentMarkdown: z.string().min(800),
  imagePrompt: z.string().min(1),
  // Empty for short/simple articles; populated only where a visual genuinely helps.
  inlineImages: z.array(DraftInlineImageSchema).default([]),
  // Chosen from the site's existing taxonomy (by slug); validated by the caller.
  categorySlug: z.string().nullable().default(null),
  tagSlugs: z.array(z.string()).default([]),
});

/** The site's existing CMS taxonomy offered to the model to choose from. */
export interface DraftTaxonomy {
  categories: Array<{ name: string; slug: string }>;
  tags: Array<{ name: string; slug: string }>;
}

/**
 * People-first, on-page SEO rules baked into every draft so articles are
 * search-friendly from the first generation (not just scored after the fact).
 * Condensed from the SEO article skill (docs/ai-project: seo-article-rules
 * Step 4–5, quality-review-checklist) and aligned with the deterministic
 * scorer in ../seo/seo-score.ts so generation and grading reinforce each other.
 */
export const SEO_DRAFTING_RULES = [
  'SEO rules (people-first — write for a real reader, then make it easy for search engines; if a tactic would help ranking but hurt the reader, drop it):',
  '- Satisfy one dominant search intent better than the current top results; match the content type the query rewards.',
  '- Title: lead with the primary keyword near the front, specific and honest, ~50–60 characters, no clickbait, no stuffing, and it must match the body.',
  '- Slug: short, lowercase, hyphenated, include the core keyword, drop stop words; never encode dates.',
  '- Meta description: 140–160 characters, one clear value proposition, include the primary keyword naturally.',
  '- Open with a direct, self-contained answer to the main question in 1–3 sentences (wins featured snippets and AI overviews); never use a generic opener.',
  '- Use a logical H2/H3 hierarchy that mirrors how the reader thinks; question/task-style headings where they match real searches. Do not add another H1 — the title is the only H1.',
  '- Place the primary keyword in the title, the first ~100 words, at least one H2, and the conclusion — only where it reads naturally. Cover related terms and entities for topical completeness; never keyword-stuff.',
  '- Use tables for comparisons, ordered lists for processes, bullet lists for sets — structured content is easier to scan and to lift into snippets.',
  '- Suggest specific internal links (the pillar and adjacent cluster topics) as Markdown links with descriptive anchor text, even when the exact URL is unknown (use a relative path like /topic).',
  '- Link out to authoritative primary sources for any factual, statistical, or current claim; never link to direct competitors.',
  '- E-E-A-T: be specific (steps, examples, numbers, decision rules, tradeoffs), add an original angle, include honest caveats, and never fabricate facts, statistics, prices, quotes, or studies.',
  '- End with a conclusion that restates the takeaway and gives a clear next step.',
  "- Avoid generic openers (\"In today's fast-paced world\", \"In the digital age\") and hype/filler (\"delve\", \"unlock\", \"game-changer\", \"comprehensive guide\" in the title) unless genuinely natural. Do not pad word count.",
].join('\n');

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

/** Existing draft + feedback, supplied when improving (regenerating) an article. */
export interface ArticleRevisionContext {
  currentTitle?: string | null;
  currentSlug?: string | null;
  currentMetaDescription?: string | null;
  currentContentMarkdown?: string | null;
  currentImagePrompt?: string | null;
  /** Free-text reviewer feedback to address. */
  comments?: string;
  /** Concrete SEO findings (failing/weak checks) to fix. */
  seoIssues?: string[];
}

export function buildArticleDraftMessages({
  siteName,
  siteUrl,
  keyword,
  instructions,
  styleGuide,
  taxonomy,
  revision,
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
  taxonomy?: DraftTaxonomy;
  revision?: ArticleRevisionContext;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const bannedPhrases = Array.isArray(styleGuide.bannedPhrases)
    ? styleGuide.bannedPhrases.filter((phrase): phrase is string => typeof phrase === 'string')
    : [];

  const hasCategories = (taxonomy?.categories.length ?? 0) > 0;
  const hasTags = (taxonomy?.tags.length ?? 0) > 0;
  const offerTaxonomy = hasCategories || hasTags;
  const formatOptions = (entries: Array<{ name: string; slug: string }>): string =>
    entries.map((entry) => `${entry.name} (slug: ${entry.slug})`).join('; ');

  const revisionLines: Array<string | null> = revision
    ? [
        'Current draft to improve:',
        `Title: ${revision.currentTitle ?? ''}`,
        `Slug: ${revision.currentSlug ?? ''}`,
        `Meta description: ${revision.currentMetaDescription ?? ''}`,
        revision.currentImagePrompt ? `Hero image prompt: ${revision.currentImagePrompt}` : null,
        'Current content (Markdown):',
        revision.currentContentMarkdown ?? '',
        revision.comments && revision.comments.trim()
          ? `Reviewer comments to address:\n${revision.comments.trim()}`
          : null,
        revision.seoIssues && revision.seoIssues.length > 0
          ? `SEO issues to fix (from the automated SEO review):\n- ${revision.seoIssues.join('\n- ')}`
          : null,
        'Keep the existing in-body images; you may return an empty inlineImages array.',
      ]
    : [];

  return [
    {
      role: 'system',
      content: [
        styleGuide.systemPrompt,
        '',
        SEO_DRAFTING_RULES,
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
        offerTaxonomy
          ? "Choose the article taxonomy from the site's EXISTING options only — match a slug exactly and never invent new ones:"
          : null,
        hasCategories && taxonomy
          ? `Available categories (pick the single best fit): ${formatOptions(taxonomy.categories)}`
          : null,
        hasTags && taxonomy
          ? `Available tags (pick the 2–5 most relevant): ${formatOptions(taxonomy.tags)}`
          : null,
        '',
        revision
          ? 'Improve the EXISTING draft below into a stronger, complete, people-first SEO article for this site. Keep what already works, fix every listed SEO issue, and address the reviewer comments.'
          : 'Draft one complete, original, people-first SEO article for this site.',
        `The single dominant search intent for "${keyword}" must be satisfied better than the current top results, following the SEO rules above.`,
        ...revisionLines,
        'Return JSON with exactly these keys:',
        '- title: ~50–60 characters, primary keyword near the front, specific and honest, not clickbait',
        '- slug: short, lowercase, hyphenated, includes the core keyword, no stop-word filler',
        '- metaDescription: 140–160 characters, one clear value proposition, includes the primary keyword naturally',
        '- contentMarkdown: complete article in Markdown that:',
        '    • opens with a direct, self-contained answer to the main question in 1–3 sentences (no generic opener);',
        '    • uses a logical H2/H3 structure (do not add another H1 — the title is the H1), with the primary keyword in at least one H2;',
        '    • places the primary keyword in the first ~100 words and the conclusion, naturally, without stuffing;',
        '    • includes lists or a comparison table where they fit, plus concrete steps, examples, numbers, and tradeoffs;',
        '    • suggests internal links as Markdown links to relative paths (e.g. [related topic](/related-topic)) and cites authoritative external sources for any factual or statistical claim;',
        '    • ends with a conclusion that restates the takeaway and gives a clear next step',
        '- imagePrompt: the detailed HERO image prompt only (one image). Include subject, setting, composition, style, lighting, mood, brand-safety constraints, aspect ratio (16:9 unless another fits), and what to avoid. Follow the image prompt instructions.',
        '- inlineImages: an array of the IN-BODY images this specific article needs to help a reader understand it (for example a process flowchart, a comparison visual, or a stat graphic). Add an image ONLY where a visual genuinely aids comprehension — use an empty array for short or simple articles, and never add decorative filler. For each in-body image return:',
        '    • placement: the exact H2/H3 heading text the image should appear under,',
        '    • alt: concise, descriptive alt text,',
        '    • aspectRatio: e.g. "16:9", "4:3", or "1:1",',
        '    • prompt: a full standalone, brand-safe generation prompt. For a data visualization (chart, graph, stat graphic, or comparison), include the exact figures from the article — every value, label, category, unit, and axis range, taken verbatim from the article so the image is accurate and consistent with the text; never invent, round, or estimate numbers that are not in the article (if a section has no concrete data, use a conceptual illustration instead of a fake chart). For non-data images, keep the brand style and avoid embedding text.',
        'Do not put image placeholders inside contentMarkdown — describe each in-body image only via its placement field.',
        offerTaxonomy
          ? '- categorySlug: the slug of the single best-fit category from the provided list (exact slug), or null if none truly fit'
          : null,
        offerTaxonomy
          ? '- tagSlugs: an array of the 2–5 most relevant tag slugs from the provided list above (exact slugs only; empty array if none fit)'
          : null,
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
  taxonomy,
  revision,
  fetchFn = fetch,
}: {
  apiKey?: string;
  model: string;
  siteName: string;
  siteUrl: string;
  keyword: string;
  instructions?: string;
  styleGuide: Parameters<typeof buildArticleDraftMessages>[0]['styleGuide'];
  taxonomy?: DraftTaxonomy;
  revision?: ArticleRevisionContext;
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
        taxonomy,
        revision,
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

export const ArticleClassificationSchema = z.object({
  categorySlug: z.string().nullable().default(null),
  tagSlugs: z.array(z.string()).default([]),
});
export type ArticleClassification = z.infer<typeof ArticleClassificationSchema>;

export function buildArticleClassificationMessages({
  title,
  contentMarkdown,
  keyword,
  taxonomy,
}: {
  title: string;
  contentMarkdown: string;
  keyword?: string;
  taxonomy: DraftTaxonomy;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const formatOptions = (entries: Array<{ name: string; slug: string }>): string =>
    entries.map((entry) => `${entry.name} (slug: ${entry.slug})`).join('; ');

  return [
    {
      role: 'system',
      content: [
        "You classify an existing article into a site's EXISTING taxonomy.",
        'Choose only from the provided options and use their exact slugs — never invent new ones.',
        'Return only valid JSON. Do not wrap it in markdown.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Title: ${title}`,
        keyword ? `Primary keyword: ${keyword}` : null,
        taxonomy.categories.length > 0
          ? `Available categories (pick the single best fit): ${formatOptions(taxonomy.categories)}`
          : 'No categories available.',
        taxonomy.tags.length > 0
          ? `Available tags (pick the 2–5 most relevant): ${formatOptions(taxonomy.tags)}`
          : 'No tags available.',
        '',
        'Article content (may be truncated):',
        contentMarkdown.slice(0, 4000),
        '',
        'Return JSON with exactly these keys:',
        '- categorySlug: the single best-fit category slug from the list above, or null if none truly fit',
        '- tagSlugs: an array of the 2–5 most relevant tag slugs from the list above (exact slugs only; empty if none fit)',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

/** Classify an existing article into the site's taxonomy (no content rewrite). */
export async function classifyArticleTaxonomyWithOpenRouter({
  apiKey,
  model,
  title,
  contentMarkdown,
  keyword,
  taxonomy,
  fetchFn = fetch,
}: {
  apiKey?: string;
  model: string;
  title: string;
  contentMarkdown: string;
  keyword?: string;
  taxonomy: DraftTaxonomy;
  fetchFn?: FetchLike;
}): Promise<ArticleClassification> {
  if (!apiKey) {
    throw new ArticleDraftError(
      'Save an OpenRouter API key in Settings before classifying articles.',
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
      messages: buildArticleClassificationMessages({ title, contentMarkdown, keyword, taxonomy }),
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ArticleDraftError(
      `OpenRouter classification failed (${response.status} ${response.statusText}): ${body.slice(0, 240)}`,
    );
  }

  const parsed = OpenRouterChatResponseSchema.parse(await response.json());
  const content = parsed.choices[0]?.message.content;
  if (!content) {
    throw new ArticleDraftError('OpenRouter returned an empty classification.');
  }

  return ArticleClassificationSchema.parse(extractJsonObject(content));
}

const SuggestedInlineImagesSchema = z.object({
  inlineImages: z.array(DraftInlineImageSchema).default([]),
});

export function buildInlineImageSuggestionMessages({
  title,
  contentMarkdown,
  keyword,
  imagePromptInstructions,
}: {
  title: string;
  contentMarkdown: string;
  keyword?: string;
  imagePromptInstructions?: string | null;
}): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        'You suggest in-body (supporting) images for an EXISTING article to help readers understand specific sections.',
        'Return only valid JSON. Do not wrap it in markdown.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Title: ${title}`,
        keyword ? `Primary keyword: ${keyword}` : null,
        imagePromptInstructions ? `Image prompt instructions:\n${imagePromptInstructions}` : null,
        '',
        'Article content (may be truncated):',
        contentMarkdown.slice(0, 8000),
        '',
        'Propose ONLY the in-body images that genuinely help a reader understand a section (for example a process flowchart, a comparison visual, or a stat graphic). Use an empty array for short or simple articles, and never add decorative filler.',
        'For any data visualization (chart, graph, stat graphic, or comparison), the prompt must include the exact figures from the article — every value, label, category, unit, and axis range, taken verbatim from the article so the image matches the text. Never invent, round, or estimate numbers that are not in the article; if the section has no concrete data, use a conceptual illustration instead of a fake chart.',
        'Return JSON with exactly this shape:',
        '{ "inlineImages": [ { "placement": "<exact existing H2/H3 heading text the image goes under>", "alt": "<concise alt text>", "aspectRatio": "16:9", "prompt": "<full standalone, brand-safe generation prompt; for data charts include the article\'s exact values, labels, units, and axis ranges, otherwise avoid embedding text>" } ] }',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

/** Propose in-body images for an EXISTING article (no content rewrite). */
export async function suggestInlineImagesWithOpenRouter({
  apiKey,
  model,
  title,
  contentMarkdown,
  keyword,
  imagePromptInstructions,
  fetchFn = fetch,
}: {
  apiKey?: string;
  model: string;
  title: string;
  contentMarkdown: string;
  keyword?: string;
  imagePromptInstructions?: string | null;
  fetchFn?: FetchLike;
}): Promise<DraftInlineImage[]> {
  if (!apiKey) {
    throw new ArticleDraftError(
      'Save an OpenRouter API key in Settings before suggesting images.',
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
      messages: buildInlineImageSuggestionMessages({
        title,
        contentMarkdown,
        keyword,
        imagePromptInstructions,
      }),
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ArticleDraftError(
      `OpenRouter image suggestion failed (${response.status} ${response.statusText}): ${body.slice(0, 240)}`,
    );
  }

  const parsed = OpenRouterChatResponseSchema.parse(await response.json());
  const content = parsed.choices[0]?.message.content;
  if (!content) {
    throw new ArticleDraftError('OpenRouter returned an empty image suggestion.');
  }

  return SuggestedInlineImagesSchema.parse(extractJsonObject(content)).inlineImages;
}
