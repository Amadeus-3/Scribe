# PROGRESS.md — Scribe / Article Engine

Living checklist mirroring Spec §16. Tick items as completed with a one-line note
and commit hash. Each phase ends with lint + typecheck + test green, a Conventional
Commit, and this file updated.

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

---

## Phase 0 — Foundation · status: complete

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

## Phase 1 — Auth, RBAC, core CRUD · status: complete

- [x] Auth.js email magic link + allowlist; `authorize()` helper; RBAC ADMIN/EDITOR/VIEWER (first user → ADMIN)
- [x] Dashboard shell + nav (dense dark admin); Sites CRUD w/ AES-256-GCM credential storage (write-only UI)
- [x] StyleGuide editor; Keywords seed-list add; Settings page (Admin)
- [x] AuditLog on every mutation (written in the same transaction)
- [x] Acceptance: per-role access matrix (integration tests); creds round-trip + never returned to client; every mutation audited — all proven by `*.integration.test.ts` against a real Postgres
- [x] E2E verified on the Docker stack: middleware redirect; allowlist blocks non-listed email; magic-link sign-in via Mailpit completes; dashboard renders; first user is ADMIN
- Commits: `03ef8b5` (crypto+RBAC), `7752831` (domain), `f0181ca` (auth), `4cf571a` (services+integration tests), `4642cc7` (dashboard UI), + trustHost fix

## Phase 2 — Drafting core (manual trigger) · status: pending

- [ ] OpenRouter text-generation wrapper: structured outputs, retries, UsageRecord, budget guard
- [ ] Manual "generate draft" from keyword + brief → stored draft + v1 AI revision + sanitized HTML
- [ ] `transitionArticle` with full transition validation + audit
- [ ] Acceptance: schema-valid article + revision + UsageRecord + correct state; illegal transitions throw; budget guard blocks over-budget (SDK mocked)

## Phase 3 — Review queue + human gate · status: pending

- [ ] Queue list + detail (sanitized render, brief side-by-side, QA placeholder, SEO meta)
- [ ] Edit → HUMAN revision; approve/request-changes/reject + Review rows + audit
- [ ] `article.approved` emitted on approve
- [ ] Acceptance: Playwright e2e gate (sign in → edit → approve → event + APPROVED); Viewer cannot approve; XSS fixture neutralized

## Phase 4 — Publishing · status: pending

- [ ] `CmsPublisher` interface + Strapi/WordPress impls (least-priv credentials, HTTPS)
- [ ] `publish.run` reacts to `article.approved`; human-actor guard; idempotency key; PublishRecord
- [ ] Internal-link index updated on publish
- [ ] Acceptance: publishes to mocked CMS + success PublishRecord; double-publish → one post; non-human event rejected; failure → PUBLISH_FAILED + retryable

## Phase 5 — Automated QA gate · status: pending

- [ ] Programmatic checks + cheap LLM-assisted checks → `qaReport`; auto `QA_PASSED → PENDING_REVIEW`
- [ ] Bounded regeneration on hard-fail; QA report surfaced in review detail
- [ ] Acceptance: each check has pass/fail fixtures; banned phrase/broken link/stuffed keyword fails → regen to limit → flag; passing drafts auto-reach review

## Phase 6 — Sourcing, briefing, scheduling · status: pending

- [ ] `KeywordSource` interface + manual seed (+ GSC/keyword API behind interface, off in v1)
- [ ] SERP analysis w/ SSRF-safe fetch; structured-output brief generation; brief gate
- [ ] Inngest crons (`sourcing.weekly`, `briefing.batch`, `drafting.batch`) + events; Batch API for bulk drafting
- [ ] Acceptance: scheduled run keyword→brief→draft→QA→PENDING_REVIEW (mocked); injection test (no state change); SSRF blocks private IPs; batch UsageRecords correct

## Phase 7 — Observability, cost, hardening, feedback · status: pending

- [ ] Metrics + dashboard home (throughput, spend vs budget, stuck items); alerting
- [ ] CSP/HSTS/security headers; rate limiting (auth + mutations); audit enforced (blocking) in CI; SHA-pin actions
- [ ] Feedback summary (Spec §6.9); coverage ≥ 80% on `packages/core`
- [ ] Acceptance: live counts + MTD spend; over-budget pauses work + alerts; headers verified; coverage met

## Phase 8 — Docs, polish, deploy · status: pending

- [ ] README (setup/run/deploy/rotate/rollback); finalized CLAUDE.md; a11y pass (WCAG 2.1 AA)
- [ ] Production self-host deploy (Docker) w/ migrations; runbook for common failures
- [ ] Acceptance: new dev sets up from README; full keyword→published cycle vs real test CMS with real approval; a11y audit passes

---

## Decisions Log

Open decisions (Spec §18) and small choices the spec left open. Record every
deviation here with a reason.

- **Repo codename:** `Scribe`; package scope `@scribe/*`. Product/working name stays "Article Engine".
- **§18.1 Keyword sourcing:** manual seed list only for v1. `KeywordSource` interface built so a provider drops in later; no `KEYWORD_API_KEY` wired.
- **§18.2 CMS:** WordPress remains supported; Strapi is now a first-class CMS target for the user's current blog.
- **§18.3 Default publish status:** `draft` in the target CMS unless explicitly configured to create published entries.
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
- **Auth runtime (self-hosted):** set `AUTH_TRUST_HOST=true` (and `trustHost: true` in auth.config) or Auth.js throws `UntrustedHost` behind localhost/proxy. The allowlist (`ALLOWED_SIGNIN_EMAILS`) is checked at link-request time, so non-allowlisted emails never receive a magic link. JWT session strategy so middleware authorizes at the edge without a DB hit. First user to sign in is promoted to ADMIN.
- **Git note:** the user's global `~/.gitconfig` has a malformed empty `gpg.format` that aborts `git commit`/`git log`. Worked around with `GIT_CONFIG_GLOBAL=/dev/null` + explicit identity; their global config was left untouched.
- **Full-Docker run path (per owner request):** web + worker are now containerized alongside Postgres + Inngest. `docker compose up -d --build` runs the whole stack (root `Dockerfile`, one shared `scribe-app` image; `web` owns the build, worker/migrate reuse it; a one-shot `migrate` service applies migrations first). Host `pnpm dev` remains the fast dev path. This pulls Spec §8 (self-host containerization) forward from Phase 8; Phase 8 will refine for production (smaller image / standalone, secrets, healthchecks). Gotchas captured: single build owner avoids the shared-tag race; `INNGEST_DEV=http://inngest:8288` keeps the worker on the local dev server (no signing key) under `NODE_ENV=production`.
- **Provider routing:** text generation now defaults to OpenRouter (`OPENROUTER_API_KEY` in env) with an on-demand catalog sync into Settings; image generation is configured for Gemini (`GEMINI_API_KEY`) with `gemini-3.1-flash-image` as the default image model. Provider secrets stay in `.env`, not the Setting table.
- **Strapi integration:** `CmsType.STRAPI` is available with encrypted Content API token storage, configurable collection API ID, field mapping, content format (`HTML`, `MARKDOWN`, or basic Strapi blocks), and draft/published create mode. The Strapi publisher helper posts to `/api/:pluralApiId` with a Content API bearer token; the full human approval → publish workflow is still Phase 4.
- **Edit a published article → republish updates in place:** editing (or regenerating) a PUBLISHED article now sends it back through the review gate (`updateArticleDraft`/`regenerateArticleDraft` set `PENDING_REVIEW`), and on the next publish, `publishArticleToCms` looks up the latest successful `PublishRecord` and passes its `cmsPostId` (the Strapi v5 `documentId`) to `publishToStrapi`, which **PUTs `/api/:plural/:documentId`** instead of POSTing a new entry — so the enhance → review → republish loop updates the live post rather than creating duplicates. The publish button reads "Republish (update live post)" once a successful publish exists; the audit records `updated: true`. Human gate preserved (re-approval required before republish). Known limitation: images are re-uploaded to Strapi media on each republish (old media is orphaned, not pruned).
- **Editable primary keyword (refinement):** the keyword (SEO target) was fixed at draft time and often ended up being a headline, skewing every keyword check. `updateArticleKeyword` lets the reviewer set a concise target from the review UI ("Primary keyword" card); it updates `Keyword.term`, re-scores against the new keyword, and audits (`article.keywordUpdated`). Unique per site — a term already used by another keyword is rejected. The keyword term is now exposed on `ArticleDTO` (read paths + draft creation include it). This is the "refine" lever on top of the automated pipeline (draft → auto category/tags → in-body image suggestions → SEO score): set a sharper keyword → re-score → regenerate.
- **SEO scorer hardened for long-tail / headline keywords:** when an article's stored "keyword" is actually a headline (the real case: `keyword.term` = the full title), the keyword checks were impossible to satisfy — a 90-char phrase can't fit a 50–60 char title and never repeats, so `keyword-in-title` (critical) failed, density read 0.0%, and a solid article scored `fail`. The regenerator faithfully forwarded these unsatisfiable "issues," so it looked like it ignored SEO. Fixed in `seo-score.ts`: `isLongKeyword` (>4 significant words or >50 chars) switches keyword matching to term-overlap (≥60% of significant words for title/slug/intro; ≥2 topic words for a heading) and skips exact-density (not a meaningful signal for long-form). Short keywords are unchanged (still require every significant word). The existing article re-scored 86/fail → 100/pass. Deeper cause is data: the keyword should be a concise phrase, not a headline — keyword editing is a sensible follow-up.
- **Iterative regeneration (comments + SEO feedback):** `regenerateArticleDraft` rewrites an existing article with the LLM, feeding back the current draft, the reviewer's free-text comments, and the concrete SEO findings (the failing/weak checks from the stored report, or a freshly computed one) so each pass is stronger. Implemented by extending the drafting prompt with an `ArticleRevisionContext` ("improve the existing draft" framing + current content + comments + SEO issues to fix) rather than a separate code path. It preserves the reviewer's taxonomy and any in-body images, re-scores, increments `regenAttempts`, writes a new AI `ArticleRevision`, returns the article to `PENDING_REVIEW`, and audits `article.regenerated`. Human-triggered (a "Regenerate (AI)" card on the article page) and **never auto-publishes** (Spec §10.1); blocked for PUBLISHED/PUBLISHING. Not capped by `max_regen` (that bound is for the future autonomous Phase 5 QA loop, not deliberate human regeneration).
- **LLM auto-assigns category + tags:** at draft time `generateArticleDraft` fetches the site's existing Strapi taxonomy (`listSiteTaxonomy`, best-effort — never blocks drafting) and passes the available categories/tags to the drafter prompt; the model returns `categorySlug` (single best fit) + `tagSlugs` (2–5) in its structured output. The service validates the choices against the fetched slug sets and stores only existing ones — hallucinated/unknown slugs are dropped (no auto-create), matching the existing-only policy. The reviewer's picker stays and is pre-filled with the model's choices for override. Non-Strapi sites or unreachable CMS → no options offered, no selection (reviewer can still pick later). **Existing/pre-feature articles** (drafted before auto-assignment) can be classified on demand without rewriting content via `autoAssignArticleTaxonomy` (a focused LLM classification over the article title/content + available taxonomy), surfaced as an "Auto-assign category & tags" button on the article page; choices are validated to existing slugs and audited (`article.taxonomyAssigned`).
- **Inline-image publishing + category/tag relations (Strapi v5):** publishing now embeds in-body images into the article body and connects taxonomy. On publish, each `ArticleImage` that has an asset is uploaded to Strapi media and embedded into the Markdown `content` as `![alt](url)` under its placement heading (`embedInlineImagesIntoMarkdown`), so images render inline (works when the site's content format is **Markdown** — matches Strapi richtext). The reviewer picks a **category** (single) + **tags** (multi) in the review editor, populated live from Strapi via `listSiteTaxonomy` (`fetchStrapiCollection`); selections are stored as slugs on the article (`Article.categorySlug`, `Article.tagSlugs[]`, migration `20260615110940_add_article_taxonomy`) and resolved to Strapi v5 **documentId**s at publish (`resolveDocumentIdsBySlug`), then connected via `{ connect: [{ documentId }] }` (category oneToOne) / array (tags manyToMany). **Existing taxonomy only**, matched by slug — unknown slugs are skipped, never auto-created. `StrapiCredentials` gained `categoryApiId`/`tagApiId` (default `categories`/`tags`) and `fieldMap.category`/`fieldMap.tags` (default `category`/`tags`), all matching the owner's schema so no reconfiguration is needed. Per owner's Strapi: v5.36.1, body field `content` (richtext-as-Markdown), cover `image`, relations `category` (oneToOne) + `tags` (manyToMany). Deferred: auto-creating missing taxonomy (off until explicitly enabled); HeroSlide publishing.
- **In-body (supporting) images:** the drafter previously produced a single hero `imagePrompt` blob, and the pipeline supported exactly one image (one upload slot, one published image), so longer articles got no in-body visuals or per-image prompts. Now the drafter returns a structured plan: the hero `imagePrompt` plus `inlineImages[]`, where each in-body image carries `placement` (the heading it belongs under), `alt`, `aspectRatio`, and its own standalone prompt — added only where a visual genuinely aids comprehension (empty for short/simple posts; no decorative filler; no placeholders inside `contentMarkdown`). New `ArticleImage` model (migration `20260612172001_add_article_images`) stores each in-body image with an optional uploaded/generated asset; service adds `listArticleImages`, `uploadArticleInlineImage`, `generateArticleInlineImage` (Gemini, same model as the hero), and the SEO scorer gains an `inline-images` check that warns when a long article (≥1200 words) plans none. The article review page lists each in-body image with its placement, alt, aspect ratio, copyable prompt, and per-image generate/upload. The hero image flow is unchanged. Deferred (the "Full inline publish" option, Phase 4+): embedding the in-body images into the article body and pushing them to the CMS on publish — depends on per-site Strapi media field/relation config. Per owner decision: plan + per-image upload (no auto inline-publish yet).
- **SEO scoring + flagging (advisory):** added a deterministic, people-first SEO scorer in `packages/core/src/seo` (`seo-score.ts` + Zod `seo-report.ts`) that encodes the *mechanical* rules from the SEO skill (`docs/ai-project`: seo-article-rules Step 4–5, quality-review-checklist) — title/slug/meta shape, heading structure, keyword placement + density, snippet-friendly formatting, internal/external links, anti-patterns (generic openers, hype/filler, site-banned phrases), and image-prompt quality. It returns `{ version, score 0–100, verdict pass|warn|fail, checks[], flags[], wordCount, generatedAt }`, stored in the **existing** `Article.qaReport` Json column (no migration) and surfaced read-only on the article review page (`SeoScoreCard`). Scoring runs automatically on draft generation and on every human edit, and is **advisory only** — it never changes article status or the human approval gate (Spec §10.1). Drafting is now SEO-aware: `SEO_DRAFTING_RULES` (aligned with the scorer) is injected into the drafting system prompt and the output spec asks for direct-answer intros, keyworded H2s, lists/tables, internal-link suggestions, and sourced claims. **Existing articles** (drafted before this) start with no in-body images; `suggestArticleInlineImages` runs the LLM over the existing content to propose them on demand (surfaced as a "Suggest in-body images (AI)" button on the article's empty in-body-images card), creating one row per suggestion and refreshing the SEO in-body-image check. It only runs when the article has none yet (guard), and is audited (`article.inlineImagesSuggested`). Deliberately out of scope (deferred to Phase 5): the LLM-assisted editorial rubric (business fit, originality, E-E-A-T depth, risk), `QA_FAILED` auto-transitions, and bounded regeneration. Per owner decision: deterministic-only engine, flag-for-reviewer (no gate change).
