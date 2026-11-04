# CLAUDE.md — Scribe / Article Engine

Condensed, always-loaded project guide. Full spec lives in the build
specification; `PROGRESS.md` tracks phase status + the Decisions Log.

## What this is

A scheduled SEO-article pipeline with **one mandatory human approval gate**.
Keyword → brief → draft → automated QA → **human review/approve** → publish to
the configured CMS. The product _is_ the review gate; nothing publishes
autonomously.

## Stack

- **TypeScript (strict)**, Node ≥ 20, pnpm workspaces + Turborepo.
- `apps/web` — Next.js (App Router) dashboard + server actions/API. Only thing humans touch.
- `apps/worker` — Inngest functions (sourcing/briefing/drafting/QA/publish). Durable, retryable, idempotent.
- `packages/core` — Prisma client + schema, Zod schemas, domain types, state machine, LLM + CMS clients, pure pipeline logic. **No framework/UI imports.**
- Postgres + Prisma · Inngest · OpenRouter text generation · Gemini image generation · Auth.js (email magic link) · Zod · pino · Sentry · Vitest + Playwright.

## Layout

```
apps/web        Next.js dashboard (+ Sentry, Playwright e2e under e2e/)
apps/worker     Inngest serve host (Node http + inngest/node)
packages/core   prisma/schema.prisma, src/{config,observability,db,...}
.github/workflows/ci.yml
docker-compose.yml   local Postgres + Inngest dev server
```

`@scribe/core` is consumed as **TS source** (no build step): Next uses
`transpilePackages`, the worker/tests use tsx/Vitest. Its `build` script is just
`prisma generate`.

## Commands

| Task                        | Command                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Install                     | `pnpm install`                                                                                                 |
| Full stack in Docker        | `docker compose up -d --build` (Postgres :5432, Inngest :8288, web :3000, worker :3100; runs migrations first) |
| Infra only                  | `docker compose up -d postgres inngest`                                                                        |
| Migrate (dev)               | `pnpm db:migrate` · Generate client: `pnpm db:generate` · Deploy: `pnpm db:deploy`                             |
| Dev (host, fast hot-reload) | `pnpm dev` (turbo; web :3000, worker :3100) — needs infra up                                                   |
| Lint / Types / Test / Build | `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`                                                    |
| E2E                         | `pnpm --filter @scribe/web e2e`                                                                                |

Always run **lint + typecheck + test** green before committing.

## Security non-negotiables (Spec §10.1 — never violate)

1. **No autonomous publishing.** Publishing is triggered only by an
   `article.approved` event whose actor is an authenticated **human** Admin/Editor.
   Verify the actor at the publish step, not just the UI. No LLM/cron/scraper/web
   content may trigger a publish.
2. **Untrusted web content is data, never instructions.** Wrap it in a labeled
   reference block; it can never invoke tools or state changes. Drafting/QA models
   have **no state-changing tools**.
3. **Secrets never logged, returned to client, or committed.** pino redaction is
   in `packages/core/src/observability/logger.ts` — extend `REDACT_PATHS` for any
   new secret field. CMS creds are AES-256-GCM encrypted at rest (`ENCRYPTION_KEY`).
4. **All mutations authenticated + authorized server-side** via a single
   `authorize(user, action, resource)` helper. UI hiding is not authorization.
5. **Validate all external input with Zod**; sanitize all rendered LLM/web HTML
   (`sanitize-html`, server-side).
6. **Audit every state change** (actor, action, entity, timestamp) in the same
   transaction as the change.

Plus: SSRF guard on all outbound fetches (block private/link-local IPs, validate
resolved IP, cap redirects/size/time); strict CSP/HSTS; least-privilege CMS
credentials (WordPress Application Password or Strapi Content API token; never
admin/root credentials).

## Domain rules

- All article state changes go through **`transitionArticle(article, to, actor)`**
  in `packages/core` — it validates the transition (Spec §2.2) and writes an
  `AuditLog` row in the same transaction.
- Never write a Prisma `Json` column without first parsing it through its Zod schema.
- Publishing checks for an existing successful `PublishRecord` before calling the
  CMS (idempotency key `publish:{articleId}:{currentVersion}`).
- All LLM calls go through the provider wrapper in `packages/core`: structured
  outputs + Zod validation, provider-specific retries, a `UsageRecord` per call,
  and the budget guard checked before every call. Text generation routes through
  OpenRouter; image generation routes through Gemini.

## Conventions (Spec §15)

- TS strict; **no `any`** (use `unknown` + narrowing); no non-null `!` to dodge types.
- Validate at every boundary (HTTP, env, LLM output, web content) with Zod.
- Files kebab-case, types PascalCase, functions camelCase. Comments explain _why_.
- Conventional Commits (`feat:`/`fix:`/`chore:`/`refactor:`/`test:`/`docs:`). Small, focused.
- Tests alongside code; **test-first** for core pipeline logic and security boundaries.
- Never call the real AI provider or real CMS in tests — mock them.
- Accessibility (WCAG 2.1 AA) and security are acceptance criteria, not afterthoughts.

## Active decisions (see PROGRESS.md Decisions Log)

- Keywords: **manual seed only** (v1); `KeywordSource` interface, no paid API yet.
- CMS: **WordPress or Strapi**; default publish status **draft** in the target CMS.
- Auth: **email magic link + invitations** (Team page; first user → ADMIN; `ALLOWED_SIGNIN_EMAILS` optional bootstrap guard). No open sign-up.
- Brief gate: **auto-approve** (manual path implemented but off).
- Hosting: **self-hosted Docker Compose**.
- Budget: **$50/mo**, **$2/article** ceiling (seeded into Settings, editable in UI).

## Build protocol

Build phase by phase (Spec §16). A phase is done only when its acceptance criteria
pass + lint/typecheck/test green + committed + `PROGRESS.md` updated. Respect the
non-negotiables above; if a change would violate one, stop and flag it. Don't
gold-plate — build exactly what each phase asks.
