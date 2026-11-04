# Security policy

Scribe publishes content to a CMS using credentials you give it, so a security
bug in Scribe is a security bug in your site. Please report issues privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
(Security tab → "Report a vulnerability"). Do not open a public issue for
anything that could be exploited.

Include what you can: affected version or commit, steps to reproduce, and the
impact you believe it has. You will get an acknowledgement within 7 days and a
fix or a documented decision within 90 days for confirmed issues.

## Supported versions

Only the `main` branch and the latest published container image receive
security fixes. Run the latest image.

## Guarantees this project makes

These are the rules the codebase is built around. A violation of any of them
is a security bug, even if nothing is exploited yet.

1. **Nothing publishes autonomously.** A publish happens only in response to an
   `article.approved` event whose actor is an authenticated human Admin or
   Editor, re-verified at the publish step, never only in the UI.
2. **Fetched web content is data, never instructions.** It is wrapped in a
   labeled reference block before reaching a model, and drafting and QA models
   have no state-changing tools.
3. **Secrets are never logged, returned to the browser, or committed.**
   Provider and CMS credentials are AES-256-GCM encrypted at rest. The logger
   redacts known secret fields.
4. **Every mutation is authenticated and authorized server-side** through one
   `authorize(actor, action)` helper. Hiding a button is not authorization.
5. **All external input is validated with Zod** at HTTP, environment, model
   output and web content boundaries.
6. **Every state change is audited** in the same database transaction.

Outbound fetches pass an SSRF guard (private and link-local addresses blocked,
resolved IP validated, redirects, size and time capped).

## Out of scope

- Issues in third-party services (OpenRouter, Gemini, Strapi, WordPress,
  Inngest) that are not caused by how Scribe calls them.
- Deployments that expose Postgres or the Inngest UI to the public internet
  against the instructions in `docs/deploy.md`.
- Vulnerabilities requiring an already-compromised Admin account.
