import { z } from 'zod';

/**
 * Environment configuration schema (Spec §12).
 *
 * Boot must fail fast when a required variable is missing or malformed. Parsing
 * is exposed as a pure `loadEnv(raw)` for testability and as a lazy `getEnv()`
 * singleton for runtime use, so importing this module never throws at build
 * time (e.g. during `next build`).
 */

/** A base64-encoded value that decodes to exactly `len` bytes. */
const base64Bytes = (len: number) =>
  z.string().refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === len;
      } catch {
        return false;
      }
    },
    { message: `must decode to ${len} bytes from base64` },
  );

/** A URL string, or an explicitly empty string for optional endpoints. */
const urlOrEmpty = z.union([z.string().url(), z.literal('')]);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.string().url(),

  // Database (Postgres). Pooled for runtime, direct for migrations.
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),

  // AI providers. Provider-specific callers enforce the required key at use time.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Inngest — optional in dev (the local dev server supplies defaults).
  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),

  // Auth.js (NextAuth v5) — email + password, JWT sessions.
  AUTH_SECRET: z.string().min(16, 'must be at least 16 characters'),
  // Optional: when set, /setup demands it before creating the first admin.
  // For operators who expose the server publicly before finishing setup.
  SETUP_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(8, 'must be at least 8 characters').optional(),
  ),
  // Optional SMTP fallback for invitations, resets and the review digest; the
  // dashboard (Settings > Email) takes precedence.
  EMAIL_SERVER: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),

  // AES-256-GCM key for per-site CMS credentials (Spec §10.3). 32 bytes.
  ENCRYPTION_KEY: base64Bytes(32),

  // Observability (optional)
  SENTRY_DSN: urlOrEmpty.optional(),
  ALERT_WEBHOOK_URL: urlOrEmpty.optional(),

  // Keyword sourcing / trending-topic discovery. Optional env fallbacks; the
  // preferred path is the encrypted ProviderCredential rows (Settings UI).
  KEYWORD_API_KEY: z.string().optional(),
  // Google Search Console service-account JSON (read-only). Secret — never log.
  GSC_SERVICE_ACCOUNT_JSON: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse and validate an environment record. Throws a readable error on failure. */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

/** Lazily-validated environment singleton. Safe to call from any server module. */
export function getEnv(): Env {
  if (cached === undefined) {
    cached = loadEnv();
  }
  return cached;
}

/** Test-only: reset the cached env so a fresh `getEnv()` re-parses. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}
