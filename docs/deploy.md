Optional repository **variable** (not secret) `VPS_DIR`: the directory the stack
lives in on the VPS, default `/opt/scribe`. Set it when the box is shared and you
want the files under your own home, e.g. `/home/you/scribe`. The directory must
be writable by the deploy user (owner you, group `deploy`, mode `2770`) and the
deploy user needs traverse rights on the parent: `setfacl -m u:deploy:x /home/you`.
Every `/opt/scribe` below then means that directory.

# Deploying Scribe to an Ubuntu VPS

One box, Docker Compose, automatic HTTPS, redeploy on every green push to
`main`. Files involved:

| File                            | Purpose                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `docker-compose.prod.yml`       | the production stack (copied to the VPS as `docker-compose.yml`) |
| `deploy/Caddyfile`              | TLS + reverse proxy                                              |
| `deploy/env.production.example` | template for `/opt/scribe/.env`                                  |
| `.github/workflows/deploy.yml`  | builds the image, pushes to GHCR, SSHes in and restarts          |

The VPS never builds anything. CI builds the image on GitHub, the VPS pulls it.

## Requirements

- Ubuntu 22.04 or 24.04, **2 GB RAM minimum** (4 GB comfortable), 20 GB disk.
- A domain (or subdomain) you control, e.g. `scribe.example.com`.
- An SMTP provider for sign-in emails, invitations and the review digest. It
  can be configured later from the dashboard; see step 7.
  (Resend, Postmark, Mailgun, SES, your mail host). Port 587 with STARTTLS.
- OpenRouter and Gemini API keys.

## 1. DNS

Create an **A record** for your domain pointing at the VPS public IP. Do this
first: Caddy requests a Let's Encrypt certificate on first start and fails if
the name does not resolve to the box yet.

## 2. Prepare the server (once, as root)

```bash
apt-get update && apt-get upgrade -y
apt-get install -y ca-certificates curl ufw
```

Install Docker Engine + Compose plugin (official repo):

```bash
curl -fsSL https://get.docker.com | sh
```

Firewall: SSH, HTTP, HTTPS only. (Skip if the box already serves other sites;
these are open.)

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

Create the deploy user GitHub Actions will SSH in as. It needs the `docker`
group and nothing else; no sudo.

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/scribe && chown deploy:deploy /opt/scribe
```

## 3. SSH key for GitHub Actions

On **your laptop** (not the server), generate a dedicated key pair:

```bash
ssh-keygen -t ed25519 -C "scribe-deploy" -f ~/.ssh/scribe_deploy -N ""
```

Install the public half for the deploy user on the VPS:

```bash
ssh root@YOUR_VPS_IP "install -d -m 700 -o deploy -g deploy /home/deploy/.ssh && cat >> /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys" < ~/.ssh/scribe_deploy.pub
```

Check it works:

```bash
ssh -i ~/.ssh/scribe_deploy deploy@YOUR_VPS_IP docker ps
```

## 4. Production `.env` on the server

As `deploy`:

```bash
ssh -i ~/.ssh/scribe_deploy deploy@YOUR_VPS_IP
```

```bash
cd /opt/scribe && nano .env
```

Paste `deploy/env.production.example` and fill every `change-me`. Generate
secrets on the server with:

```bash
openssl rand -base64 32   # AUTH_SECRET, and separately ENCRYPTION_KEY
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -hex 32      # INNGEST_EVENT_KEY, and separately INNGEST_SIGNING_KEY
```

`INNGEST_SIGNING_KEY` **must be hex**. `ENCRYPTION_KEY` must differ from
`AUTH_SECRET`. Then:

```bash
chmod 600 /opt/scribe/.env
```

Back up `ENCRYPTION_KEY` somewhere safe. Without it every stored CMS
credential is unreadable.

## 5. GitHub repository secrets

Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret        | Value                                                                |
| ------------- | -------------------------------------------------------------------- |
| `VPS_HOST`    | the VPS IP or hostname                                               |
| `VPS_USER`    | `deploy`                                                             |
| `VPS_SSH_KEY` | contents of `~/.ssh/scribe_deploy` (the **private** key, whole file) |
| `VPS_PORT`    | only if SSH is not on 22                                             |

Optionally create an environment named `production` (Settings → Environments)
and add required reviewers. The deploy job targets it, so you can require a
manual approval before each release.

No registry secret is needed. The workflow pushes to GitHub Container Registry
with the built-in `GITHUB_TOKEN` and hands the VPS that same short-lived token
to pull.

**Running from a fork.** The deploy job is guarded by
`if: github.repository == 'Amadeus-3/Scribe'` so a fork never tries to reach
this project's server. In your fork, change that owner/name in
`.github/workflows/deploy.yml`. The image name follows your repository
automatically (`ghcr.io/<your-owner>/scribe`), so set
`IMAGE=ghcr.io/<your-owner>/scribe` in `/opt/scribe/.env`, or leave `IMAGE`
unset only if you use the upstream image. Make the package public once
(GitHub → Packages → scribe → Package settings → Change visibility) or
`docker compose pull` on the server will need a token.

## 6. Reverse proxy

Pick one.

### A. The host already runs nginx (default)

This is the case when the VPS serves other sites: nginx owns ports 80/443, so
Scribe's web container binds to `127.0.0.1:4010` and nginx forwards to it.

Copy the server block from `deploy/nginx-scribe.conf`, substituting your
hostname for `YOUR_DOMAIN` (the file is in the repo you cloned; from the server
you can also fetch it from your fork's raw URL):

```bash
sed "s/YOUR_DOMAIN/scribe.example.com/" deploy/nginx-scribe.conf | sudo tee /etc/nginx/sites-available/scribe >/dev/null
```

If you changed `WEB_BIND_PORT` in `/opt/scribe/.env`, edit the `proxy_pass`
port to match. Then enable it:

```bash
sudo ln -sf /etc/nginx/sites-available/scribe /etc/nginx/sites-enabled/scribe && sudo nginx -t && sudo systemctl reload nginx
```

Issue the certificate (certbot rewrites the file to add the 443 listener):

```bash
sudo certbot --nginx -d scribe.example.com --redirect
```

If `certbot` is missing: `sudo apt-get install -y certbot python3-certbot-nginx`.
The upstream returns 502 until the first deploy starts the container; that is
fine, certbot only needs port 80 on the hostname.

### B. Nothing else on 80/443: bundled Caddy

Add `COMPOSE_PROFILES=caddy` to `/opt/scribe/.env`. Caddy publishes 80/443,
gets a Let's Encrypt certificate for `DOMAIN` automatically, and proxies to
web. Nothing to install on the host.

## 7. First deploy

Merge or push to `main`. CI runs; when it passes, **Deploy** runs:

1. builds the image and pushes `ghcr.io/<owner>/scribe:sha-<commit>` and `:latest`;
2. copies `docker-compose.prod.yml` and `deploy/Caddyfile` to `/opt/scribe`
   (the Caddyfile is inert unless the `caddy` profile is on);
3. pins the image tag in `.env`, pulls, runs migrations, restarts the stack.

Or trigger it by hand: Actions → Deploy → Run workflow.

Then open `https://your-domain`, enter your email, click the link. The first
account becomes ADMIN (if you set `ALLOWED_SIGNIN_EMAILS`, it must be one of
those). Invite the rest of the team from the Team page; nobody else can get in.

**No SMTP yet?** On an instance with zero users the sign-in link is written to
the web log instead of being emailed:

```bash
docker compose logs web | grep signInUrl
```

Open that link, then set SMTP under Settings → Email and press "Send test email
to me". This log path closes as soon as the first account exists.

## 8. Verify the pipeline is alive

Inngest's UI is bound to the server's loopback only (it has no auth). Tunnel in:

```bash
ssh -i ~/.ssh/scribe_deploy -L 8288:127.0.0.1:8288 deploy@YOUR_VPS_IP
```

Open http://localhost:8288 → **Apps**. `scribe` must list `pipeline-tick`,
`article-autodraft`, `discovery-run`, `discovery-weekly`, `review-digest`,
`publish-run`. An empty list means the server could not sync the worker: check

```bash
docker compose -f /opt/scribe/docker-compose.yml logs inngest worker | tail -n 50
```

Then in the dashboard: Settings → fill the OpenRouter/Gemini keys if not in
`.env`, create a site with its CMS credentials and a style guide, add a few
keywords, and turn on **Autopilot** globally and on the site. The dashboard's
autopilot panel shows the next tick's decision and why it is or isn't drafting.

## Day-to-day

All commands as `deploy` in `/opt/scribe`.

```bash
docker compose ps
```

```bash
docker compose logs -f --tail=100 web worker inngest
```

Restart without redeploying (keeps the pinned image):

```bash
docker compose up -d
```

Roll back to an earlier release: edit `IMAGE_TAG=sha-...` in `.env` to a
previous tag (visible under the repo's Packages), then `docker compose up -d`.
Migrations are forward-only; rolling back code past a migration that dropped
columns is not supported.

### Backups

Nightly database dump, kept 14 days. As `deploy`:

```bash
mkdir -p /opt/scribe/backups && (crontab -l 2>/dev/null; echo '15 3 * * * docker exec scribe-postgres pg_dump -U scribe scribe | gzip > /opt/scribe/backups/scribe-$(date +\%F).sql.gz && find /opt/scribe/backups -name "*.sql.gz" -mtime +14 -delete') | crontab -
```

Restore:

```bash
gunzip -c /opt/scribe/backups/scribe-YYYY-MM-DD.sql.gz | docker exec -i scribe-postgres psql -U scribe scribe
```

Also back up `/opt/scribe/.env` (it holds `ENCRYPTION_KEY`) off the box.

### Updating the host

```bash
sudo apt-get update && sudo apt-get upgrade -y && docker compose pull && docker compose up -d
```

## Troubleshooting

- **502 from nginx.** The web container is not up or `WEB_BIND_PORT` in `.env`
  does not match `proxy_pass` in the nginx server block. `docker compose ps`,
  then `curl -I http://127.0.0.1:4010`.
- **Sign-in link points at http:// or loops.** nginx must send
  `X-Forwarded-Proto` (it does in `deploy/nginx-scribe.conf`) and `DOMAIN` in
  `.env` must match the host you browse to.
- **Caddy (profile B): certificate errors / site unreachable.** DNS must resolve
  to the VPS and ports 80 + 443 must be free and open. `docker compose logs caddy`.
- **Sign-in email never arrives.** `docker compose logs web | grep -i email`.
  Check Settings → Email (or `EMAIL_SERVER`) and that the provider allows the From
  domain. On a staffed instance the address must have been invited from the
  Team page (or be in `ALLOWED_SIGNIN_EMAILS`).
- **Deploy job fails with `.env missing`.** Step 4 was skipped.
- **Deploy job skipped entirely.** `VPS_HOST` secret is unset; the image was
  still pushed.
- **`migrate` exited non-zero.** `docker compose logs migrate`. Fix the
  migration, push again; web/worker did not start against the old schema.
- **Autopilot does nothing.** Dashboard panel shows the skip reason (paused,
  outside run window, target met, backlog full, budget reserve, no style guide,
  no queued keywords). If the Inngest Apps list is empty, see step 7.
- **Budget.** `monthly_budget_usd` in Settings is the hard stop; the autopilot
  additionally keeps `autopilot_budget_reserve_pct` back for human edits.

## What this setup deliberately does not do

- No horizontal scaling. Everything is on one host; Postgres and Inngest state
  live in Docker volumes on its disk.
- The image is the build stage with dev dependencies, so it is large
  (roughly 1.5 GB). A slimmer standalone image is a later refinement.
- Inngest's queue is in-memory with periodic snapshots; a hard crash may lose
  in-flight steps, which Inngest retries from the last completed step. Point
  `--redis-uri` / `--postgres-uri` at external stores if that matters.
