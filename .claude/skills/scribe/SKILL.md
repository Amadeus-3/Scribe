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

# 3. Start local infrastructure: Postgres (host :5434) + Inngest dev server (:8289).
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
# Brings up: postgres, inngest (:8289), migrate (one-shot), web (:4000), worker (:4100).
# The root Dockerfile builds one image (scribe-app) shared by web + worker.
# Rebuild after code changes: docker compose up -d --build
docker compose ps          # all services
docker compose logs -f web worker
docker compose down        # stop (add -v to wipe the DB volume)
```

**Host dev** (faster hot-reload while building features):

```bash
docker compose up -d postgres inngest mailpit   # infra only
pnpm dev                                        # turbo: web :4000, worker :4100
```

Or individually:

```bash
pnpm --filter @scribe/web dev      # dashboard only, :4000
pnpm --filter @scribe/worker dev   # Inngest worker only, :4100 (tsx watch)
```

Smoke-check the dashboard:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000/
```

Then open http://localhost:4000. The Inngest dev UI is at http://localhost:8289.

**Check the crons are actually live.** Open the Inngest UI → Apps and confirm
`scribe` is *connected* and lists `pipeline-tick`, `article-autodraft`,
`discovery-run`, `discovery-weekly`, `publish-run`, `review-digest`. Crons only
fire for registered functions, and registration failing is SILENT — an empty
Apps list is the only symptom.

Two things make that work, both easy to break:

- The dev server discovers the worker at
  `${INNGEST_DISCOVERY_URL:-http://host.docker.internal:4100/api/inngest}`
  (`docker-compose.yml`). Host 4100 reaches the worker in BOTH modes (`pnpm dev`
  serves it directly; the container publishes `4100:3100`). A compose-internal
  hostname would only work in full-Docker mode.
- The worker must run with the root `.env` loaded, which is why
  `@scribe/worker`'s `dev` script goes through `dotenv-cli`. Without it the SDK
  sees `INNGEST_SIGNING_KEY` unset/mismatched, tries to register against Inngest
  **Cloud**, and fails with "Your signing key is invalid". `INNGEST_DEV` must
  point at `http://localhost:8289` — the SDK's dev default is 8288, but compose
  publishes 8289.

Auto-discovery stops after the first successful sync, so if you start the worker
*after* the dev server, either `docker restart scribe-inngest` or force a sync
with `curl -X PUT http://localhost:4100/api/inngest`.

A 15-minute cron is too slow to iterate on: send `scribe/keyword.claimed` by hand
from the dev UI to exercise the whole draft-and-enrich path, or use the
dashboard's **Run now** button to exercise pacing. Editing a cron string needs a
worker restart to re-register.

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

The pipeline is the worker's Inngest functions (`apps/worker/src/functions/`).
**Autopilot runs stages 1-4 unattended; stage 5 is the human gate and never moves
on its own.**

1. **Sourcing** — `discovery-weekly` (cron `0 9 * * 1`, emits) → `discovery-run`
   (`keyword-discovery.ts`, rate-limited 1/24h per site). Enqueues QUEUED
   keywords only. The tick also requests it on demand when a site's buffer runs
   below `autopilot_keyword_buffer_low_water`.
2. **Pacing** — `pipeline-tick` (`pipeline-tick.ts`, cron `*/15`, plus a manual
   `scribe/pipeline.tick.requested`). The cron is FIXED; all cadence comes from
   Settings at runtime via the pure `decidePacing`
   (`packages/core/src/pipeline/pacing.ts`). Claims at most ONE keyword per site
   per tick with `claimNextKeyword` (`FOR UPDATE SKIP LOCKED`), then emits
   `scribe/keyword.claimed`.
3. **Drafting + enrichment** — `article-autodraft` (`article-autodraft.ts`;
   concurrency 1/site, `idempotency: event.data.keywordId`). Draft is fatal;
   taxonomy, hero image and in-body images are best-effort, so the article always
   reaches PENDING_REVIEW. Failures release the keyword to SKIPPED (never QUEUED)
   via `onFailure`; the site page offers Requeue.
4. **SEO QA** — the deterministic report runs inline at draft time
   (`packages/core/src/seo`), advisory only. No `qa.run` function yet; bounded
   regeneration on hard-fail is still pending (`max_regen` remains unused).
5. **Review** (dashboard) — the mandatory human gate: edit, approve, request
   changes, reject. Nothing above this line can advance past it.
6. **Publish** — `publish-run` (`publish.ts`) reacts to `article.approved`,
   emitted by the dashboard when a human approves. It re-verifies the human at
   the publish step via `assertHumanPublishActor`
   (`packages/core/src/auth/human-actor.ts`); the payload's `actorId` is an
   untrusted claim and `reviewId` is the real evidence. Strapi; idempotency key
   `publish:{articleId}:{currentVersion}`, claim-then-publish.
7. **Digest** — `review-digest` (hourly cron, gated on the configured hour) mails
   what is waiting via `packages/core/src/notify/`.

**Autopilot settings** (all in the Settings page, `autopilot_*` /
`review_digest_*` in `packages/core/src/domain/settings.ts`) ship OFF. A site
also needs `Site.autopilotEnabled` AND a style guide — `listAutopilotSites`
excludes sites without one, so the tick never claims a keyword it cannot draft.

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

## Writing voice — engaging, non-generic copy (feed the per-site StyleGuide)

The default failure mode of LLM article/horoscope copy is **boring**: it states facts,
hedges, and reaches for cliché. These rules make it worth reading. They apply to all
drafting prompts and the per-site `StyleGuide`; the astrology block is for sign/horoscope
sites (e.g. zodiacfield). Distilled from how the most-read astrology writers actually write
— the AstroTwins / Astrostyle (punchy + practical), Chani Nicholas (agency + meaning),
Madame Clairevoyant / Claire Comstock-Gay in The Cut (literary, image-driven, "personal but
grounded, never over-specific"), Co-Star (blunt, aphoristic) — plus the Barnum research
(specificity that *feels* personal beats vague universals).

**Core rules (any topic):**

1. **Hook in the first six words.** Open on the reader's lived experience — a sharp
   question, a command, a vivid image, a named feeling — not a definition or "the weather
   report." ("Moody much?" / "Make space for your dreams.")
2. **Always answer "so what for me?"** Every fact must cash out into a concrete stake: a
   decision, a conversation, a temptation, a relief. State the fact briefly, then translate.
3. **Specific enough to feel personal, never generic.** Avoid Barnum mush ("you value both
   security and freedom"). Use concrete scenes ("the text you've been drafting in your
   head") that still apply widely. Generic = boring; falsely over-specific ("ask for a raise
   Tuesday") = not credible. Aim between.
4. **Vivid, active verbs; earn your metaphors.** One good image beats three adjectives. Cut
   adverbs and intensifiers ("very", "really", "truly").
5. **Second person, warm, a little witty.** Talk to "you" like a smart friend. Confident,
   not hedgy. Humor and tenderness both welcome.
6. **Agency, not fate.** "You can / consider / this is the week to" — never "you will."
7. **End on a turn.** Close with a takeaway, a reframe, or a small dare the reader carries
   out. No limp closers ("let the week build", "time will tell").
8. **Rhythm.** Mix short punchy sentences with one longer flowing one. Read it aloud; if it
   drones, cut.

**Banned (never write these):** "the stars align", "the universe has a plan", "trust the
cosmos/process", "lean into", "embrace the journey", "navigate", vague "energy/vibes",
"in today's fast-paced world", "look no further", "delve", "unlock", "elevate", em-dash
pile-ups, and any sentence that would be equally true for all twelve signs.

**Astrology specifics:** name the *real* transit (which planet, sign, aspect — accuracy
first), then interpret what it asks of *this* sign in plain life terms. Tie it to the sign's
actual themes/ruler, not horoscope wallpaper.

**Before → after** (the literal bad line we shipped, then the fix):

> ✗ "Full Moon in Capricorn sets the tone this week. Sagittarius aims the arrow at the
> horizon and trusts the road to fill itself in. Lean into what's steady and let the week
> build." — generic, true of anyone, no stake, limp close.

> ✓ "Sagittarius, you've been saying yes first and figuring out the 'how' later. Monday's
> Full Moon in Capricorn calls the question: which of your big bets is actually ready to
> ship? Pick one and finish it. Let the other tabs stay open a little longer — they're not
> going anywhere."

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
  in Mailpit (http://localhost:8026). The first user to sign in becomes ADMIN.
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
