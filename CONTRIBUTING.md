# Contributing to Scribe

Thanks for helping. This page is the short version; `CLAUDE.md` is the full
project guide that every contributor (human or agent) should read first.

## Set up

Requirements: Node 20 or newer, pnpm (version pinned in `package.json`), Docker.

```bash
pnpm install
cp .env.example .env            # the defaults work for local development
docker compose up -d postgres inngest mailpit
pnpm db:migrate
pnpm dev                        # web on :4000, worker on :4100
```

Mailpit at http://localhost:8025 shows the magic-link email so you can sign in
without a real mail server. Set `ALLOWED_SIGNIN_EMAILS` in `.env` to the
address you use. The first user to sign in becomes ADMIN.

## Before you open a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test
```

All three must pass. CI runs the same commands. Run `pnpm exec prettier --write`
on the files you touched (the repo is not yet fully Prettier-clean, so a
whole-tree `format:check` is not required). Integration tests that need
Postgres run with `pnpm --filter @scribe/core test:integration` against the
compose database.

## Rules that are not negotiable

The six guarantees in `SECURITY.md` are acceptance criteria for every change.
In practice:

- All article state changes go through `transitionArticle`.
- Every mutating server action calls `authorize()`.
- Never write a Prisma `Json` column without parsing it through its Zod schema.
- Never call a real AI provider or CMS in tests. Mock them.
- New secret fields go into `REDACT_PATHS` in the logger.

## Style

- TypeScript strict. No `any`; use `unknown` and narrow. No non-null `!` to
  dodge a type.
- Files kebab-case, types PascalCase, functions camelCase.
- Tests live next to the code. Core pipeline logic and security boundaries are
  written test-first.
- Comments explain why, not what.

## Commits and pull requests

Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
Keep pull requests small and focused on one thing. Describe what changed, why,
and how you verified it. Update `PROGRESS.md` when a change completes or
changes a phase.

## Reporting security issues

Privately, per `SECURITY.md`. Never in a public issue.

## License

By contributing you agree that your contributions are licensed under the
Apache License 2.0, the same as the project.
