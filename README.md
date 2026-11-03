# Scribe

Scheduled SEO-article pipeline with one mandatory human approval gate.
See [CLAUDE.md](CLAUDE.md) for the project guide and [PROGRESS.md](PROGRESS.md)
for status.

## Run locally

```bash
cp .env.example .env            # fill in secrets
docker compose up -d --build    # Postgres, Inngest, Mailpit, web :4000, worker :4100
```

Faster inner loop: `docker compose up -d postgres inngest mailpit` then `pnpm dev`.

## Deploy

One Ubuntu VPS, Docker Compose, automatic HTTPS via Caddy, redeploy on every
green push to `main`. Step-by-step guide: [docs/deploy.md](docs/deploy.md).
