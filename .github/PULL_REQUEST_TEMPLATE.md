## What

<!-- One or two sentences. Link the issue if there is one. -->

## Why

## How it was verified

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` pass locally
- [ ] Tests added or updated for the behavior that changed
- [ ] No real provider or CMS is called from tests

## Checklist

- [ ] Every new mutation goes through `authorize()` and writes an audit row
- [ ] Article state changes go through `transitionArticle`
- [ ] New secret fields are added to `REDACT_PATHS`
- [ ] `PROGRESS.md` updated if this completes or changes a phase
