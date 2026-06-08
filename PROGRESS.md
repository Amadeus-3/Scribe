# PROGRESS.md — Scribe / Article Engine

Living checklist mirroring Spec §16. Tick items as completed with a one-line note
and commit hash. Each phase ends with lint + typecheck + test green, a Conventional
Commit, and this file updated.

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

---

## Phase 0 — Foundation  ·  status: complete

- [x] Monorepo (pnpm workspaces + Turborepo), root config, `tsconfig.base`, ESLint (flat) + Prettier
- [x] `packages/core` scaffold: Zod env loader (fail-fast), pino logger w/ redaction, Prisma client singleton, index exports
- [x] Full Prisma schema (Spec §5) — all entities/enums/relations
- [x] `apps/web` scaffold: Next.js App Router, minimal page, Sentry (client/server/edge), tsconfig
- [x] `apps/worker` scaffold: Inngest client + `inngest/node` serve host, Sentry (node)
- [x] Vitest configured (core unit tests for env + logger redaction); Playwright configured (web smoke e2e)
- [x] GitHub Actions CI: install → prisma generate → migrate deploy → lint → typecheck → test → build (+ Postgres service, audit job)
- [x] `docker-compose.yml`: Postgres + Inngest dev server
- [x] `.env.example` + Zod env validation; `CLAUDE.md` + `PROGRESS.md` created
- [x] **Acceptance:** `pnpm install && pnpm build` succeeds; migration `20260605163354_init` applies to a fresh DB; env validation fails fast on missing required var (test-covered); lint/typecheck/test green
- [x] Commit Phase 0 — see Decisions Log for commit hash

## Phase 1 — Auth, RBAC, core CRUD  ·  status: pending
- [ ] Auth.js email magic link + allowlist; `authorize()` helper; RBAC ADMIN/EDITOR/VIEWER
- [ ] Dashboard shell + nav; Sites CRUD w/ AES-256-GCM credential storage (write-only UI)
- [ ] StyleGuide editor; Keywords seed-list add; Settings page (Admin)
- [ ] AuditLog on every mutation
- [ ] Acceptance: per-role access matrix (integration tests); creds round-trip + never returned to client; every mutation audited

## Phase 2 — Drafting core (manual trigger)  ·  status: pending
- [ ] `callClaude` wrapper: structured outputs, prompt caching, retries, UsageRecord, budget guard
- [ ] Manual "generate draft" from keyword + brief → stored draft + v1 AI revision + sanitized HTML
- [ ] `transitionArticle` with full transition validation + audit
- [ ] Acceptance: schema-valid article + revision + UsageRecord + correct state; illegal transitions throw; budget guard blocks over-budget (SDK mocked)

## Phase 3 — Review queue + human gate  ·  status: pending
- [ ] Queue list + detail (sanitized render, brief side-by-side, QA placeholder, SEO meta)
- [ ] Edit → HUMAN revision; approve/request-changes/reject + Review rows + audit
- [ ] `article.approved` emitted on approve
- [ ] Acceptance: Playwright e2e gate (sign in → edit → approve → event + APPROVED); Viewer cannot approve; XSS fixture neutralized

## Phase 4 — Publishing  ·  status: pending
- [ ] `CmsPublisher` interface + WordPress impl (Application Passwords, HTTPS, least-priv)
- [ ] `publish.run` reacts to `article.approved`; human-actor guard; idempotency key; PublishRecord
- [ ] Internal-link index updated on publish
- [ ] Acceptance: publishes to mocked WP + success PublishRecord; double-publish → one post; non-human event rejected; failure → PUBLISH_FAILED + retryable

## Phase 5 — Automated QA gate  ·  status: pending
- [ ] Programmatic checks + cheap LLM-assisted checks → `qaReport`; auto `QA_PASSED → PENDING_REVIEW`
- [ ] Bounded regeneration on hard-fail; QA report surfaced in review detail
- [ ] Acceptance: each check has pass/fail fixtures; banned phrase/broken link/stuffed keyword fails → regen to limit → flag; passing drafts auto-reach review

## Phase 6 — Sourcing, briefing, scheduling  ·  status: pending
- [ ] `KeywordSource` interface + manual seed (+ GSC/keyword API behind interface, off in v1)
- [ ] SERP analysis w/ SSRF-safe fetch; structured-output brief generation; brief gate
- [ ] Inngest crons (`sourcing.weekly`, `briefing.batch`, `drafting.batch`) + events; Batch API for bulk drafting
- [ ] Acceptance: scheduled run keyword→brief→draft→QA→PENDING_REVIEW (mocked); injection test (no state change); SSRF blocks private IPs; batch UsageRecords correct

## Phase 7 — Observability, cost, hardening, feedback  ·  status: pending
- [ ] Metrics + dashboard home (throughput, spend vs budget, stuck items); alerting
- [ ] CSP/HSTS/security headers; rate limiting (auth + mutations); audit enforced (blocking) in CI; SHA-pin actions
- [ ] Feedback summary (Spec §6.9); coverage ≥ 80% on `packages/core`
- [ ] Acceptance: live counts + MTD spend; over-budget pauses work + alerts; headers verified; coverage met

## Phase 8 — Docs, polish, deploy  ·  status: pending
- [ ] README (setup/run/deploy/rotate/rollback); finalized CLAUDE.md; a11y pass (WCAG 2.1 AA)
- [ ] Production self-host deploy (Docker) w/ migrations; runbook for common failures
- [ ] Acceptance: new dev sets up from README; full keyword→published cycle vs real test WordPress with real approval; a11y audit passes

---

## Decisions Log

Open decisions (Spec §18) and small choices the spec left open. Record every
deviation here with a reason.

- **Repo codename:** `Scribe`; package scope `@scribe/*`. Product/working name stays "Article Engine".
- **§18.1 Keyword sourcing:** manual seed list only for v1. `KeywordSource` interface built so a provider drops in later; no `KEYWORD_API_KEY` wired.
- **§18.2 CMS:** WordPress (default).
- **§18.3 Default publish status:** `draft` (human does a final glance in WP).
- **§18.4 Auth:** email magic link + email allowlist (Auth.js Email provider; no Google OAuth).
- **§18.5 Brief gate:** auto-approve briefs (manual gate implemented but off by default).
- **§18.6 Hosting:** self-hosted Docker Compose (Postgres + self-hosted Inngest). Vercel path not used.
- **§18.7 Budget:** `monthly_budget_usd = 50`, `per_article_cost_ceiling_usd = 2`, seeded into Settings, editable in the Settings UI.
- **`@scribe/core` consumed as TS source** (no dist build): Next `transpilePackages`, worker/tests via tsx/Vitest. Keeps the package framework-free and avoids a build step. Its `build` = `prisma generate`.
- **Phase 0 dependency audit is report-only** (`|| true`); flipped to blocking in Phase 7 (Spec §10.7), alongside SHA-pinning GitHub Actions.
- **GitHub Actions pinned to major tags** in Phase 0; SHA-pinning deferred to Phase 7 hardening.
- **Prisma client default output** (`node_modules/.prisma/client`) so imports use the standard `@prisma/client` path.
- **Phase 0 commit:** `071379d` (`chore: scaffold Phase 0 foundation`). Initial commit on `main` (greenfield baseline); later phases use branches/PRs per the CI model.
- **Local dev env:** root `.env` is the canonical source of truth (gitignored); Prisma scripts load it via `dotenv-cli` (`dotenv -e ../../.env`), which tolerates a missing file so CI works off job-level env instead.
- **Git note:** the user's global `~/.gitconfig` has a malformed empty `gpg.format` that aborts `git commit`/`git log`. Worked around with `GIT_CONFIG_GLOBAL=/dev/null` + explicit identity; their global config was left untouched.
- **Full-Docker run path (per owner request):** web + worker are now containerized alongside Postgres + Inngest. `docker compose up -d --build` runs the whole stack (root `Dockerfile`, one shared `scribe-app` image; `web` owns the build, worker/migrate reuse it; a one-shot `migrate` service applies migrations first). Host `pnpm dev` remains the fast dev path. This pulls Spec §8 (self-host containerization) forward from Phase 8; Phase 8 will refine for production (smaller image / standalone, secrets, healthchecks). Gotchas captured: single build owner avoids the shared-tag race; `INNGEST_DEV=http://inngest:8288` keeps the worker on the local dev server (no signing key) under `NODE_ENV=production`.
