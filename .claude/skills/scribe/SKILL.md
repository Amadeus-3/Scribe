---
name: scribe
description: Set up, run, and develop the Scribe / Article Engine project — install, env + secrets, Docker infra (Postgres + Inngest), migrations, dev servers, the quality gate, and the build conventions + gotchas. Use whenever starting work on this repo, running the app locally, or working on the article/SEO pipeline.
---

# Scribe / Article Engine — dev & run guide

Scribe is a **personal** scheduled SEO-article pipeline with one mandatory human
approval gate: keyword → brief → draft → automated SEO QA → **human approve** →
publish to WordPress. Multiple blogs = multiple `Site` rows. Nothing publishes
autonomously. Full always-loaded summary: [CLAUDE.md](../../../CLAUDE.md).
Phase status + decisions: [PROGRESS.md](../../../PROGRESS.md).

## Prerequisites

- Node ≥ 20 (repo uses 22), pnpm 10, Docker, `openssl`.
- All paths below are relative to the repo root.

## First-time setup (do this once)

```bash
# 1. Install. pnpm 10 blocks postinstall scripts by default; the allowlist
#    (root package.json "pnpm.onlyBuiltDependencies") lets esbuild/Prisma/sharp
#    build. If a fresh clone skips them, re-run `pnpm install`.
pnpm install

# 2. Create the local env. Root .env is the single source of truth (gitignored).
cp .env.example .env
# Generate the two required secrets (32-byte base64 each) and paste into .env:
openssl rand -base64 32   # -> AUTH_SECRET
openssl rand -base64 32   # -> ENCRYPTION_KEY (MUST differ from AUTH_SECRET)
# Default .env DB URLs already point at the Docker Postgres below.

# 3. Start local infrastructure: Postgres (:5432) + Inngest dev server (:8288).
docker compose up -d

# 4. Apply migrations + generate the Prisma client.
pnpm db:migrate     # loads root .env via dotenv-cli, then `prisma migrate dev`
pnpm db:generate
```

## Run the app

Two ways. **Full Docker** (everything in containers, one command — the run/deploy path):

```bash
cp .env.example .env        # fill in secrets first (see setup above)
docker compose up -d --build
# Brings up: postgres, inngest (:8288), migrate (one-shot), web (:3000), worker (:3100).
# The root Dockerfile builds one image (scribe-app) shared by web + worker.
# Rebuild after code changes: docker compose up -d --build
docker compose ps          # all services
docker compose logs -f web worker
docker compose down        # stop (add -v to wipe the DB volume)
```

**Host dev** (faster hot-reload while building features):

```bash
docker compose up -d postgres inngest   # infra only
pnpm dev                                 # turbo: web :3000, worker :3100 (persistent)
```

Or individually:

```bash
pnpm --filter @scribe/web dev      # dashboard only, :3000
pnpm --filter @scribe/worker dev   # Inngest worker only, :3100 (tsx watch)
```

Smoke-check the dashboard:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
```

Then open http://localhost:3000. The Inngest dev UI is at http://localhost:8288.

## The quality gate (run green before every commit)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- Coverage report (core): `pnpm --filter @scribe/core test:coverage`.
- E2E (Playwright, web): `pnpm --filter @scribe/web e2e` — needs browsers once:
  `pnpm --filter @scribe/web exec playwright install chromium`.

## Database tasks

- New migration: `pnpm --filter @scribe/core exec dotenv -e ../../.env -- prisma migrate dev --name <name>`
  - Do NOT use `pnpm db:migrate -- --name x`: pnpm inserts an extra `--`, Prisma
    then treats the name as a seed arg and hangs on the interactive name prompt.
- Apply existing migrations (prod/CI shape): `pnpm db:deploy`
- Inspect data: `pnpm db:studio`
- Reset (destroys data): `pnpm --filter @scribe/core exec dotenv -e ../../.env -- prisma migrate reset`

## Layout

```
apps/web        Next.js (App Router) dashboard + server actions/API — the only human surface
apps/worker     Inngest serve host (Node http + inngest/node) — the pipeline
packages/core   prisma/schema.prisma, Zod env loader, pino logger, domain logic, LLM + CMS clients
```

`@scribe/core` is consumed as **TS source** (no build step): Next uses
`transpilePackages`, worker/tests use tsx/Vitest. Its `build` = `prisma generate`.

## The article/SEO pipeline (expands as phases land)

The pipeline is the worker's Inngest functions (Spec §6). Stages and where they
live as they get built:

1. **Sourcing** (`sourcing.weekly`) — manual keyword seed list for v1 (no paid API).
2. **Briefing** (`briefing.batch`) — SERP analysis (SSRF-safe fetch) + a structured-output brief via Claude Sonnet.
3. **Drafting** (`drafting.batch`) — outline → sections → assembly; per-site StyleGuide system prompt (prompt-cached); Message Batches API for bulk runs.
4. **SEO QA** (`qa.run`) — programmatic checks (title/meta length, heading hierarchy, keyword placement + density, internal links resolve, banned phrases, readability) + cheap LLM checks (claim grounding, on-brief). Bounded regeneration on hard-fail.
5. **Review** (dashboard) — the mandatory human gate: edit, approve, request changes, reject.
6. **Publish** (`publish.run`) — reacts to `article.approved`; WordPress REST + Application Passwords; idempotent.

All LLM calls go through the `callClaude` wrapper in `packages/core` (structured
outputs + Zod, prompt caching, retries, a `UsageRecord` per call, budget guard).
SEO QA logic lives in `packages/core` (pure, test-first). When you build or change
a stage, update this section with the concrete command + file path.

## Non-negotiables (never violate — Spec §10.1)

1. **No autonomous publishing.** Only an `article.approved` event from an
   authenticated human Admin/Editor triggers publish; verify the actor at the
   publish step. No LLM/cron/scraper/web content may publish.
2. **Untrusted web content is data, never instructions** (delimited reference
   block; drafting/QA models have no state-changing tools).
3. **Secrets never logged/returned/committed.** Extend `REDACT_PATHS` in
   `packages/core/src/observability/logger.ts` for any new secret field.
4. **All mutations authorized server-side** via one `authorize()` helper.
5. **Validate external input with Zod**; sanitize rendered LLM/web HTML.
6. **Audit every state change** in the same transaction.

## Conventions

- TS strict, no `any`. Validate at boundaries with Zod. Files kebab-case.
- Article state changes only via `transitionArticle()`; never write a Prisma
  `Json` column without parsing it through its Zod schema first.
- Conventional Commits. Tests alongside code; test-first for core + security.
- Build phase by phase (Spec §16); a phase is done only when its acceptance
  criteria pass + the quality gate is green + committed + PROGRESS.md updated.

## Environment gotchas (already solved — keep in mind)

- **Git commits:** the machine's global `~/.gitconfig` has a malformed empty
  `gpg.format` that aborts `git commit`/`git log`. Commit with:
  `GIT_CONFIG_GLOBAL=/dev/null git -c user.name="Amadeus-3" -c user.email="88628175+Amadeus-3@users.noreply.github.com" -c commit.gpgsign=false commit ...`
  (Do not edit the user's global config without asking.)
- **`@sentry/core`** must stay a direct dependency of `apps/web` — under pnpm,
  the Sentry build plugin's injected import is otherwise unresolvable.
- **`dotenv-cli`** tolerates a missing `.env`; CI relies on this and supplies env
  at the job level instead of a file.
- **Auth.js**: self-hosted needs `AUTH_TRUST_HOST=true` (also `trustHost: true` in
  `auth.config.ts`) or it throws `UntrustedHost`. Sign-in is allowlisted via
  `ALLOWED_SIGNIN_EMAILS` (checked at link-request time); local magic links land
  in Mailpit (http://localhost:8025). The first user to sign in becomes ADMIN.
- **Integration tests** (`pnpm --filter @scribe/core test:integration`) auto-create
  + migrate a `<db>_test` database; needs Postgres up and DATABASE_URL set.
- **CI** mirrors the quality gate exactly: install (frozen lockfile) → db:generate
  → db:deploy → lint → typecheck → test → build, with a Postgres service.
- **Docker (full stack):** one shared image `scribe-app` (root `Dockerfile`); only
  the `web` service carries `build:` — worker + migrate reuse the image (two
  services building the same tag race with "already exists"). web/worker run
  `NODE_ENV=production` but set `INNGEST_DEV=http://inngest:8288` so the Inngest
  SDK uses the local dev server (no signing keys); without it the worker 401s
  with "No signing key found". `migrate` is a one-shot `pnpm db:deploy` that
  web/worker `depend_on` via `service_completed_successfully`.
