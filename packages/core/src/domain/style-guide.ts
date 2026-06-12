import { z } from 'zod';

/** bannedPhrases is stored as a Json column — validate before write (Spec §5.1). */
export const BannedPhrasesSchema = z.array(z.string().min(1)).default([]);
export type BannedPhrases = z.infer<typeof BannedPhrasesSchema>;

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
});

export type StyleGuideInput = z.infer<typeof StyleGuideInputSchema>;

/** Parse a newline- or comma-separated banned-phrase list from a textarea. */
export function parseBannedPhrases(raw: string): BannedPhrases {
  return raw
    .split(/[\n,]/)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);
}
