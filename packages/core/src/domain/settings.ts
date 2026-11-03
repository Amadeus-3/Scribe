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

  // Trending-topic discovery: opt-in weekly cron (per-site flag also required).
  discovery_cron_enabled: z.boolean().default(false),

  // ── Autopilot ──────────────────────────────────────────────────────────────
  // The tick cron is fixed (Inngest cron strings are static and only take effect
  // on re-registration); ALL cadence is read from these keys at runtime so it
  // stays editable from the dashboard. See pipeline/pacing.ts.
  // Everything here ships off or conservative, like discovery_cron_enabled.
  autopilot_enabled: z.boolean().default(false),
  /** Target articles per site per rolling 7 days. 0 pauses that site. */
  autopilot_articles_per_week: z.number().int().nonnegative().max(100).default(3),
  /** 0 derives an even spacing from autopilot_articles_per_week. */
  autopilot_min_spacing_minutes: z.number().int().nonnegative().default(0),
  /** Cap on PENDING_REVIEW + CHANGES_REQUESTED. 0 = unlimited. */
  autopilot_max_unreviewed: z.number().int().nonnegative().default(5),
  autopilot_max_concurrent_drafts: z.number().int().positive().max(5).default(1),
  autopilot_max_inline_images: z.number().int().nonnegative().max(10).default(4),
  /** Percent of the monthly budget held back for human-triggered work. */
  autopilot_budget_reserve_pct: z.number().min(0).max(90).default(10),
  autopilot_generate_hero_image: z.boolean().default(true),
  autopilot_generate_inline_images: z.boolean().default(true),
  autopilot_assign_taxonomy: z.boolean().default(true),
  /** Claims older than this are treated as orphaned by a crashed worker. */
  autopilot_stale_claim_minutes: z.number().int().positive().default(60),
  /** Below this many claimable keywords, the tick requests discovery. */
  autopilot_keyword_buffer_low_water: z.number().int().nonnegative().default(5),
  autopilot_run_window: z
    .object({
      /** 0=Sun..6=Sat. Empty means every day. */
      daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
      startHour: z.number().int().min(0).max(23).default(0),
      endHour: z.number().int().min(1).max(24).default(24),
      /** Fixed offset in minutes, so no tz database is needed. */
      timezoneOffsetMinutes: z.number().int().min(-840).max(840).default(0),
    })
    .default({ daysOfWeek: [], startHour: 0, endHour: 24, timezoneOffsetMinutes: 0 }),

  // ── Review digest ──────────────────────────────────────────────────────────
  review_digest_enabled: z.boolean().default(false),
  review_digest_hour_utc: z.number().int().min(0).max(23).default(8),
  /** Empty falls back to every ADMIN/EDITOR user. */
  review_digest_recipients: z.array(z.string().email()).default([]),
  review_digest_min_articles: z.number().int().positive().default(1),

  // Model selection (Spec §7.2)
  models: z
    .object({
      brief: z.string().min(1),
      draft: z.string().min(1),
      qa: z.string().min(1),
    })
    .default({
      brief: '~anthropic/claude-sonnet-latest',
      draft: '~anthropic/claude-sonnet-latest',
      qa: '~anthropic/claude-sonnet-latest',
    }),

  textGeneration: z
    .object({
      provider: z.literal('openrouter'),
    })
    .default({ provider: 'openrouter' }),

  imageGeneration: z
    .object({
      provider: z.literal('gemini'),
      model: z.string().min(1),
    })
    .default({
      provider: 'gemini',
      model: 'gemini-3.1-flash-image',
    }),

  openrouter: z
    .object({
      modelCatalogSyncedAt: z.string().datetime().nullable().default(null),
      modelCatalog: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            description: z.string().nullable(),
            contextLength: z.number().int().positive().nullable(),
            inputModalities: z.array(z.string()),
            outputModalities: z.array(z.string()),
            promptPriceUsdPerToken: z.number().nonnegative().nullable(),
            completionPriceUsdPerToken: z.number().nonnegative().nullable(),
            cacheReadPriceUsdPerToken: z.number().nonnegative().nullable(),
            cacheWritePriceUsdPerToken: z.number().nonnegative().nullable(),
            supportsStructuredOutputs: z.boolean(),
            supportsTools: z.boolean(),
            createdAtUnix: z.number().int().nonnegative().nullable(),
          }),
        )
        .default([]),
    })
    .default({
      modelCatalogSyncedAt: null,
      modelCatalog: [],
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
      '~anthropic/claude-sonnet-latest': { inputPerMTok: 3, outputPerMTok: 15 },
    }),

  // Flat per-image price in USD (image providers bill per image, not per token).
  image_pricing: z
    .record(z.string(), z.object({ perImageUsd: z.number().nonnegative() }))
    .default({
      'gemini-3.1-flash-image': { perImageUsd: 0.039 },
    }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;
export type OpenRouterTextModel = Settings['openrouter']['modelCatalog'][number];

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
