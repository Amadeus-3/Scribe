# Scribe

Scribe is a self-hosted SEO article pipeline with one mandatory human approval
gate. It turns a keyword list into briefs and drafts, runs automated QA, queues
the result for a human to review, and publishes approved articles to your CMS
as drafts. Nothing reaches your site without a person clicking approve.

- **Autopilot.** A scheduled tick picks the next keyword, drafts the article
  with OpenRouter models you choose, adds hero and inline images with Gemini,
  scores it for SEO, and parks it in review. Pacing, budgets and run windows
  are dashboard settings.
- **Review gate.** Editors see the draft, the QA report and the SEO flags, edit
  in place, request changes, or approve. Approving is the only path to publish,
  and the publisher re-checks that a human did it.
- **Publishing.** Strapi v5 today (Markdown body, inline images uploaded to
  media, categories and tags connected by slug). WordPress is planned but not
  built.
- **Cost control.** Every model call is metered against a monthly budget and a
  per-article ceiling.
- **Self-hosted.** One Docker Compose file, Postgres, a self-hosted Inngest
  server, and a GitHub Actions workflow that redeploys on every green push.

## Quickstart (local)

Requirements: Docker, Node 20 or newer, pnpm.

```bash
cp .env.example .env
docker compose up -d --build
```

That starts Postgres, Inngest, Mailpit, the web app on http://localhost:4000
and the worker. Request a sign-in link and read it at http://localhost:8026.
The first account becomes ADMIN; invite everyone else from the Team page. Then in Settings add an OpenRouter key and a
Gemini key, create a site with its Strapi token and style guide, seed some
keywords, and turn autopilot on.

Faster inner loop for development: `docker compose up -d postgres inngest mailpit`
then `pnpm install && pnpm db:migrate && pnpm dev`.

## Deploy to a server

One Ubuntu VPS, Docker Compose, TLS through your existing nginx (or a bundled
Caddy), automatic redeploy from GitHub Actions on every green push to `main`.
Step by step in [docs/deploy.md](docs/deploy.md).

## Security model

The product is the approval gate, so the codebase treats these as acceptance
criteria for every change, not as goals:

1. Nothing publishes autonomously. Publishing requires an `article.approved`
   event from an authenticated human Admin or Editor, verified again at the
   publish step.
2. Fetched web content is data, never instructions, and the drafting and QA
   models have no state-changing tools.
3. Secrets are encrypted at rest (AES-256-GCM), redacted from logs, and never
   sent to the browser.
4. Every mutation is authorized server-side through one helper. Hidden buttons
   are not authorization.
5. External input is validated with Zod at every boundary.
6. Every state change is audited in the same transaction.

Details and how to report a vulnerability: [SECURITY.md](SECURITY.md).

## Configuration

Provider keys (OpenRouter, Gemini, Google Search Console), CMS credentials,
model choices, budgets and autopilot pacing are all set in the dashboard and
stored encrypted. The environment file holds only infrastructure: database
URL, Inngest keys, and the auth and encryption secrets. SMTP can live there
too, or be set from Settings → Email. See [.env.example](.env.example).

## Status

Working end to end for Strapi sites. Known gaps, tracked in
[PROGRESS.md](PROGRESS.md):

- WordPress publisher not implemented.
- Playwright end-to-end coverage of the review gate is pending.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md), the full
project guide. Run `pnpm lint && pnpm typecheck && pnpm test` before a pull
request.

## License

Apache License 2.0. See [LICENSE](LICENSE).
