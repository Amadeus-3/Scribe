# Open-source readiness plan

Goal: anyone can clone Scribe, run `docker compose up`, sign in as the first
admin, and configure every provider key, CMS connection and teammate from the
dashboard. Nothing personal to the original author stays in the repo, and no
secret is ever required in source.

This plan was written against the code as of 2026-11-04 (main at the merge of
PR #2). Each phase lists what exists, what changes, and the acceptance check.

## Audit: where configuration lives today

| Item                                 | Today                                                                      | Open-source target                      |
| ------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------- |
| OpenRouter / Gemini API keys         | Dashboard (Settings), AES-256-GCM in `ProviderCredential`; env is fallback | Keep. Already right.                    |
| Google Search Console service acct   | Dashboard, encrypted; env fallback                                         | Keep.                                   |
| CMS credentials (Strapi token)       | Per site in dashboard, encrypted in `Site.cmsCredentialsEnc`               | Keep.                                   |
| Model ids, budgets, autopilot pacing | `Setting` table, edited in dashboard                                       | Keep.                                   |
| Who may sign in                      | `ALLOWED_SIGNIN_EMAILS` env var, read in `apps/web/src/auth.ts`            | **Move to DB: Team page + invitations** |
| SMTP for magic links + digest        | `EMAIL_SERVER` / `EMAIL_FROM` env                                          | **Dashboard, with env fallback**        |
| `ENCRYPTION_KEY`, `AUTH_SECRET`      | env                                                                        | Stay env (infrastructure secrets)       |
| `DATABASE_URL`, Inngest keys         | env                                                                        | Stay env (infrastructure secrets)       |
| Domain in nginx template             | `scribe.wiselyrich.com` hard-coded in `deploy/nginx-scribe.conf`           | **Placeholder + sed step in runbook**   |
| Image name in prod compose           | `ghcr.io/amadeus-3/scribe` default                                         | Keep as default, document `IMAGE`       |
| `.env.example` allowlist             | `88628175+Amadeus-3@users.noreply.github.com`                                                          | **Placeholder**                         |
| Author identity in skill files       | `.claude/skills/scribe/SKILL.md`, `.agents/skills/scribe/SKILL.md`         | **Remove the commit-identity line**     |
| Test fixtures                        | `wiselyrich.com` URLs in several `*.test.ts`                               | Optional: `example.com`                 |
| Secrets in git history               | None. Only dummy `sk-or-test` style values; `.env` never committed         | Nothing to scrub                        |
| License                              | None; `package.json` has no `license` field; repo is private               | **Add LICENSE + fields, flip public**   |

The provider-key half of the request is therefore already done. The real work
is accounts, email, and repo hygiene.

## Design decisions

- **Single-tenant per deployment.** One Scribe instance belongs to one team.
  Credentials are instance-wide and managed by ADMIN; they are not per user.
  Multi-tenancy (per-user keys, orgs) is out of scope and would complicate the
  security model for no self-hosting benefit.
- **Infrastructure secrets stay in env.** `DATABASE_URL`, `AUTH_SECRET`,
  `ENCRYPTION_KEY`, Inngest keys. They must exist before the app can boot or
  decrypt anything, so a dashboard cannot hold them. Compose generates them.
- **Application secrets move to the dashboard, encrypted.** Everything the app
  uses to talk to third parties: LLM keys, CMS tokens, SMTP. Env stays as a
  fallback so existing deployments and CI keep working.
- **Env allowlist becomes a bootstrap seed only.** `ALLOWED_SIGNIN_EMAILS`
  stays supported but is read only while the instance has zero users.
- **No open sign-up, ever.** This is a CLAUDE.md non-negotiable. Access is
  bootstrap (first user) or invitation by an ADMIN.
- **License: Apache-2.0.** Permissive like MIT but with an explicit patent
  grant, which matters for a tool that wraps LLM providers. Choose AGPL-3.0
  instead only if you want to stop others from offering Scribe as a closed
  hosted service.

## Phase A: User accounts and team management

What exists: `User` with `Role` (ADMIN/EDITOR/VIEWER), Auth.js Prisma adapter,
`authorize()` with an unused `user.manage` action, and a `createUser` event
that promotes the first user to ADMIN. Missing: any UI, invitations, disabling.

Schema (one migration):

```prisma
enum UserStatus { INVITED ACTIVE DISABLED }

model User {
  // existing fields...
  status      UserStatus @default(ACTIVE)
  invitedById String?
  invitedAt   DateTime?
  lastLoginAt DateTime?
}
```

An invitation is a pre-created `User` row with `status: INVITED` and the chosen
role. The Auth.js adapter finds it by email on first sign-in and links it, so no
separate token table is needed. The magic link itself is the invitation.

Sign-in rule (replaces the allowlist check in `apps/web/src/auth.ts`):

1. If the instance has zero users: allow, and the `createUser` event makes this
   user ADMIN. If `ALLOWED_SIGNIN_EMAILS` is set, require membership for this
   first sign-in too, so an exposed instance cannot be claimed by a stranger.
2. Otherwise allow only if a `User` row exists for the email with status
   INVITED or ACTIVE. INVITED flips to ACTIVE and `emailVerified` is set.
3. DISABLED users are refused and their JWT is invalidated by checking status in
   the `jwt` callback (re-read role and status from DB at most every 5 minutes
   so role changes and disables take effect without re-login).

Core service `packages/core/src/services/user-service.ts`, every mutation
through `authorize()` and `recordAudit()` in the same transaction:

- `listUsers(db, actor)` requires `user.manage`.
- `inviteUser(db, actor, email, role)` creates the INVITED row and sends the
  magic link by calling Auth.js `signIn('nodemailer')` server-side. Audit
  `user.invited`.
- `updateUserRole(db, actor, userId, role)`; refuses to demote the last ADMIN.
  Audit `user.roleChanged`.
- `setUserStatus(db, actor, userId, status)`; refuses to disable yourself or
  the last ADMIN. Audit `user.disabled` / `user.enabled`.
- `deleteInvitation(db, actor, userId)` only while status is INVITED.

Web: `apps/web/src/app/(dashboard)/settings/team/page.tsx` with a table
(email, role, status, last login, invited by) and server actions in
`apps/web/src/server/actions.ts`. Role select and disable button are hidden for
non-admins but the server action is the gate.

Login page: when zero users exist, show "Create the first admin account" copy
instead of the generic sign-in prompt, so a fresh install explains itself.

Tests (test-first, per CLAUDE.md): unit tests for the sign-in decision as a
pure function `decideSignIn({ userCount, existing, allowlist, email })`;
integration tests for last-admin protection and audit rows; one Playwright
flow: fresh DB, first sign-in becomes ADMIN, invites an EDITOR, EDITOR cannot
open Team.

Acceptance: `ALLOWED_SIGNIN_EMAILS` removed from `deploy/env.production.example`
and `.env.example` (documented as optional bootstrap guard); a brand-new
deployment can be claimed and staffed entirely from the browser.

## Phase B: Email delivery configured in the dashboard

What exists: `EMAIL_SERVER` / `EMAIL_FROM` read by `apps/web/src/auth.ts`
(magic links) and `packages/core/src/notify/mailer.ts` (digest). Without SMTP
nobody can sign in, which is the chicken-and-egg problem for a fresh install.

Changes:

- New encrypted `ProviderCredential` row `smtp` holding `{ serverUrl, from }`,
  managed in Settings → Email with a "Send test email" button. Env remains the
  fallback, same pattern as `provider-credential-service.ts`.
- Auth.js provider: replace the static `server:` option with a custom
  `sendVerificationRequest` that resolves SMTP at request time (DB first, env
  second). This is the supported hook and avoids reinitialising NextAuth.
- **Bootstrap without SMTP:** when no SMTP is configured anywhere and the
  instance has zero users, `sendVerificationRequest` writes the magic link to
  the server log at `warn` level with a clear banner, and the login page says
  "Email is not configured yet; the sign-in link was printed to the server
  logs (`docker compose logs web`)". This path closes itself as soon as the
  first user exists, so it can never be used to enter a staffed instance.
- `REDACT_PATHS` in `packages/core/src/observability/logger.ts` already covers
  `EMAIL_SERVER`; add `serverUrl` for the new credential shape.
- Mailer reads the same resolver so the digest uses dashboard SMTP too.

Acceptance: fresh compose stack, no SMTP anywhere, first admin signs in from a
logged link, configures SMTP in the UI, invites a second user who receives a
real email.

## Phase C: Remove author-specific values

- `deploy/nginx-scribe.conf`: `server_name YOUR_DOMAIN;` and a one-line
  `sed "s/YOUR_DOMAIN/$DOMAIN/"` step in `docs/deploy.md`.
- `.env.example`: `ALLOWED_SIGNIN_EMAILS=` empty with a comment.
- `.claude/skills/scribe/SKILL.md` and `.agents/skills/scribe/SKILL.md`:
  drop the hard-coded git identity line. Decide whether `.agents/` and
  `AGENTS.md` are committed at all (they are untracked today; the author's
  tooling mirror does not belong in a public repo unless kept generic).
- `docs/ai-project/*`: review for personal site details (Strapi field names
  for one specific site, brand names). Keep what is generic; move the rest to
  a private notes repo.
- `PROGRESS.md`: fine to keep as project history, but strip "owner's Strapi"
  specifics or reword as "the reference deployment".
- Optional: replace `wiselyrich.com` in test fixtures with `example.com`.

## Phase D: Repository hygiene for a public repo

- `LICENSE` (Apache-2.0), `"license": "Apache-2.0"` in every `package.json`,
  SPDX header not required.
- `SECURITY.md`: how to report a vulnerability privately (GitHub private
  vulnerability reporting), supported versions, the publish-gate guarantees.
- `CONTRIBUTING.md`: dev setup (link to README), test-first rule, Conventional
  Commits, the six non-negotiables, "no real provider calls in tests".
- `CODE_OF_CONDUCT.md` (Contributor Covenant).
- `.github/ISSUE_TEMPLATE/{bug,feature}.yml`, `PULL_REQUEST_TEMPLATE.md`.
- `.github/dependabot.yml` for npm + GitHub Actions, weekly.
- Deploy workflow guard: add
  `if: github.repository == 'Amadeus-3/Scribe'` to the `deploy` job so forks
  that enable Actions never try to ship to your VPS, and document how a fork
  points `IMAGE` at its own registry.
- CI for forks: `ci.yml` already uses only dummy secrets; confirm it passes
  with no repository secrets at all.
- Make the GHCR package public (Packages → scribe → Danger zone → Change
  visibility) so `docker compose pull` works without a token.
- README: screenshots of the review gate and autopilot panel, a 60-second
  quickstart, a "Security model" section linking to the non-negotiables, and
  a status line stating the known gaps (WordPress publisher missing, Phase 7
  hardening partial).
- Branch protection on `main`: require CI, require PR.
- Flip visibility to public last, after Phases A to D are merged and
  `git log -p | grep -i` for emails, domains and tokens comes back clean.

## Phase E: Nice-to-have after launch

- First-run setup wizard (site, CMS, keys, SMTP) instead of scattered Settings.
- Encryption-key rotation command (`pnpm scribe:rotate-key`) that re-encrypts
  every `ProviderCredential` and `Site.cmsCredentialsEnc`.
- WordPress publisher, which the README currently over-promises.
- Published `docker-compose.yml` that pulls the image instead of building, for
  people who never want to clone.

## Order and effort

| Phase | Effort   | Blocks public launch? |
| ----- | -------- | --------------------- |
| C     | 1 hour   | Yes                   |
| D     | 2 hours  | Yes                   |
| A     | 1 day    | Yes                   |
| B     | half day | Yes                   |
| E     | later    | No                    |

Do C and D first: they are mechanical and make every later PR safe to review in
public. A and B are the product work. Finish your own production deploy before
starting A, so the account changes are tested against a real instance.
