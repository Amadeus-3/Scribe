import { z } from 'zod';

/** bannedPhrases is stored as a Json column — validate before write (Spec §5.1). */
export const BannedPhrasesSchema = z.array(z.string().min(1)).default([]);
export type BannedPhrases = z.infer<typeof BannedPhrasesSchema>;

/** Structured niche lists used by trending-topic discovery (Json columns). */
const TopicListSchema = z.array(z.string().trim().min(1).max(120)).max(50).default([]);

export const StyleGuideInputSchema = z.object({
  systemPrompt: z.string().min(1, 'A drafting system prompt is required'),
  businessContext: z.string().optional(),
  audienceNotes: z.string().optional(),
  seoGuidance: z.string().optional(),
  imagePromptInstructions: z.string().optional(),
  toneNotes: z.string().optional(),
  formattingRules: z.string().optional(),
  readingLevel: z.string().optional(),
  bannedPhrases: BannedPhrasesSchema,
  // Trending-topic discovery niche
  topicPillars: TopicListSchema,
  topicClusters: TopicListSchema,
  excludedTopics: TopicListSchema,
  geo: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : undefined)),
});

export type StyleGuideInput = z.infer<typeof StyleGuideInputSchema>;

/** Parse a newline- or comma-separated banned-phrase list from a textarea. */
export function parseBannedPhrases(raw: string): BannedPhrases {
  return raw
    .split(/[\n,]/)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);
}

/** Parse a newline- or comma-separated topic list from a textarea. */
export function parseTopicLines(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 50);
}
