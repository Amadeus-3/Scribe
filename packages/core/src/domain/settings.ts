import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { Db } from '../db/types';

/**
 * Non-secret operational config lives in the Setting table so it changes without
 * a deploy (Spec §12, §7.4). Each key is one Setting row (key + Json value),
 * validated through this schema before read/write (Spec §5.1). Missing keys fall
 * back to the seeded defaults below.
 *
 * Model IDs and pricing are config, not hardcoded constants in pipeline code
 * (Spec §7.2, §7.4) — edit them in the Settings UI.
 */
export const SettingsSchema = z.object({
  // Budget guardrails (Decision §18.7)
  monthly_budget_usd: z.number().nonnegative().default(50),
  per_article_cost_ceiling_usd: z.number().nonnegative().default(2),

  // Pipeline batch sizes
  keyword_buffer_target: z.number().int().positive().default(20),
  briefs_per_run: z.number().int().positive().default(5),
  max_regen: z.number().int().nonnegative().default(2),

  // Model selection (Spec §7.2)
  models: z
    .object({
      brief: z.string().min(1),
      draft: z.string().min(1),
      qa: z.string().min(1),
    })
    .default({
      brief: 'claude-sonnet-4-6',
      draft: 'claude-sonnet-4-6',
      qa: 'claude-haiku-4-5-20251001',
    }),

  // Per-model pricing in USD per million tokens (Spec §7.4)
  pricing: z
    .record(
      z.string(),
      z.object({
        inputPerMTok: z.number().nonnegative(),
        outputPerMTok: z.number().nonnegative(),
        cacheWritePerMTok: z.number().nonnegative().optional(),
        cacheReadPerMTok: z.number().nonnegative().optional(),
      }),
    )
    .default({
      'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
      'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
      'claude-opus-4-8': { inputPerMTok: 15, outputPerMTok: 75 },
    }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

/** All settings with seeded defaults applied. */
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Read every setting, filling defaults for any unset/absent key. */
export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.setting.findMany();
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    raw[row.key] = row.value;
  }
  return SettingsSchema.parse(raw);
}

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<Settings[K]> {
  const settings = await getSettings(db);
  return settings[key];
}

/** Validate a single setting against its schema and upsert it. */
export async function setSetting<K extends SettingKey>(
  db: Db,
  key: K,
  value: unknown,
): Promise<Settings[K]> {
  const parsed = SettingsSchema.shape[key].parse(value) as Settings[K];
  const jsonValue = parsed as unknown as Prisma.InputJsonValue;
  await db.setting.upsert({
    where: { key },
    create: { key, value: jsonValue },
    update: { value: jsonValue },
  });
  return parsed;
}
