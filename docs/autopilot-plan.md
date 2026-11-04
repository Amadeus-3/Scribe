Autopilot: automated article production up to the review gate
Context
Scribe's pipeline is a dead end today. discovery-weekly (the only Inngest function) enqueues QUEUED keywords every Monday and stops. Nothing consumes those keywords. Every stage after that is a human clicking a button that runs a ~20s LLM call synchronously inside a Next.js server action: pick a keyword → Generate → Auto-assign taxonomy → Suggest images → Generate hero → Generate each inline image → Approve → Publish. That is 7+ clicks per article, and the user must remember to come back and do them.

There are zero inngest.send() calls in the repo. No event graph exists.

The goal: the user never triggers topic discovery or article generation. A scheduler discovers topics, drafts the article, and produces every extra (hero image, in-body images, category, tags, SEO report) so a complete, publish-ready draft is waiting. The user reviews it and clicks Approve once, which publishes it. Pace and volume are editable from the dashboard, and an email tells them when something is waiting.

The human review gate stays absolute (CLAUDE.md §10.1 #1). This plan strengthens it: it closes a latent hole where SYSTEM_ACTOR (role ADMIN) already passes authorize(actor, 'article.publish').

What the pipeline becomes
cron \*/15 pipeline-tick (thin: reads Settings, decides, claims)
│ reclaim stale claims (IN_PROGRESS older than N min -> QUEUED)
│ budget reserve gate (stop before spending the human's headroom)
│ for each ACTIVE + autopilotEnabled site WITH a style guide:
│ decidePacing(settings, throughput) pure fn, fully unit-tested
│ ├─ articles this rolling 7d >= target? -> skip
│ ├─ unreviewed backlog >= cap? -> skip ◄ self-limiting
│ ├─ spacing since last article not elapsed? -> skip
│ ├─ outside run window? -> skip
│ └─ ok -> claim ONE keyword atomically, emit event
│ QUEUED keywords below low-water? -> emit scribe/discovery.requested
v
scribe/keyword.claimed ──> article-autodraft (concurrency 1/site, idempotent on keywordId)
├─ draft FATAL generateArticleDraft
├─ taxonomy best-effort autoAssignArticleTaxonomy
├─ hero image best-effort generateArticleImage
├─ suggest inline images best-effort suggestArticleInlineImages
├─ inline-image-{id} xN best-effort generateArticleInlineImage
└─ emit scribe/article.drafted
│
Article @ PENDING_REVIEW, complete
v
cron hourly review-digest ──> email: "3 articles ready to review" + links
v
╔═══════════════════════════════════╗
║ HUMAN clicks Approve (the gate) ║
╚═══════════════════════════════════╝
v
article.approved { articleId, reviewId, actorId, version }
v
publish-run: re-verifies a HUMAN did this,
against the DB, not the payload
v
CMS (draft status)
Two structural safety properties: the tick claims at most one keyword per site per tick, so a bug in the pacing math can never fan out twenty paid drafts; and production stops on its own when the unreviewed pile hits its cap, so an unread backlog cannot drain the budget.

Phase 0: three blockers (verified, must land first)
B1. The first automated draft will crash on a foreign key
All 10 recordAudit calls in article-service.ts hardcode actorId: actor.id, actorType: 'human' (lines 423, 586, 812, 886, 974, 1132, 1174, 1244, 1397, 1432). SYSTEM_ACTOR.id is the string 'system' (keyword-discovery-service.ts:31), and AuditLog.actorId is a real FK to User.id (schema.prisma:338-339). Prisma raises P2003, the createDraftRecords transaction rolls back, and no article is ever created. It would also label cron work as human, violating §10.1 #6.

The discovery service already has the correct pattern (keyword-discovery-service.ts:33-35, 85-86). The article service never got it.

Fix, in a new packages/core/src/auth/system-actor.ts:

export interface SystemActor extends Actor { readonly **system: true }
export const SYSTEM_ACTOR: SystemActor = { id: 'system', role: 'ADMIN', **system: true };
/** An Actor that is provably not the system sentinel (compile-time deterrent). \*/
export type HumanClaimActor = Actor & { readonly \_\_system?: never };
export function isSystemActor(actor: Actor): boolean;
/** Correct AuditLog attribution for any actor (null actorId for system). _/
export function auditActorFields(actor: Actor): { actorId: string | null; actorType: 'human' | 'system' };
Replace all 10 call sites with ...auditActorFields(actor). Move SYSTEM_ACTOR out of keyword-discovery-service.ts (it is an auth primitive) and import it there. Do not re-export from both files: index.ts uses export _ and a duplicate export is a build error.

Do not create a User row named system to satisfy the FK. That hands the cron a human identity and dissolves both the audit guarantee and the publish guard at once.

B2. authorize() already lets the system actor publish
SYSTEM_ACTOR.role is ADMIN, and ADMIN gets the full ACTIONS set (authorize.ts:68). So authorize(SYSTEM_ACTOR, 'article.publish') returns cleanly, and article-service.ts:1265 is the only check publishArticleToCms performs on the actor. This is latent today because nothing non-human calls it. Phase 2 puts cron code one careless line away. Fixed properly in Phase 4.

B3. A keyword containing a comma silently orphans itself
generateArticleDraft does parseKeywordSeedList(input.keyword)[0] (article-service.ts:654), and commit 0350694 made that helper split on commas as well as newlines. A discovered keyword with a comma (plausible from the RSS and LLM sources) drafts only the fragment before it, then createDraftRecords upserts a different Keyword row keyed (siteId, fragment). The claimed keyword stays IN_PROGRESS forever while the pacing counter still increments.

Fix by making the automated path id-based, leaving the human free-text path untouched:

export interface GenerateArticleDraftInput {
siteId: string;
keyword: string; // free-text path (dashboard). Ignored when keywordId is set.
keywordId?: string; // automated path: draft this exact row, term used verbatim
instructions?: string;
}
When keywordId is set: load the row, assert siteId matches, use row.term with no seed-list parsing, and in createDraftRecords replace the keyword.upsert (:363-367) with tx.keyword.update({ where: { id }, data: { status: 'DONE' } }).

Phase 1: infra fix (unblocks all local verification)
The cron cannot fire in the documented fast-dev path today, and it fails silently.

docker-compose.yml:118 launches the dev server with -u http://worker:3100/api/inngest. Registration is inbound: the dev server fetches that URL to introspect functions, and crons only fire for registered functions. In host-dev (docker compose up -d postgres inngest + pnpm dev) the worker container is not running, so the hostname never resolves, zero functions register, and the dev UI just shows no apps.

A second failure runs the opposite way: compose publishes the dev server on host 8289, but the SDK's dev-mode default target is 127.0.0.1:8288, so inngest.send() from a host-run worker posts into the void. .env.example never mentions INNGEST_DEV.

inngest:
command: - inngest - dev - -u - ${INNGEST_DISCOVERY_URL:-http://host.docker.internal:4100/api/inngest}
extra_hosts: ['host.docker.internal:host-gateway'] # Linux parity
ports: ['8289:8288'] # drop depends_on: [worker], discovery no longer uses compose DNS
Port 4100 is the published worker port in both modes: tsx serves it directly on the host (server.ts:9), and the container publishes 4100:3100 (docker-compose.yml:95). One URL, both modes, no compose profiles.

Also: add INNGEST_DEV=http://localhost:8289 to .env.example and .env; add EMAIL_SERVER: smtp://mailpit:1025 plus EMAIL_FROM to the compose worker service (it has neither today, so the digest cannot send from the container) and mailpit to its depends_on; sync the stale ports in AGENTS.md (still says worker :3100 and Postgres :5432).

Phase 2: pacing engine and event backbone
Pure pacing logic in packages/core/src/pipeline/pacing.ts
Inngest cron strings are static and only re-register on worker restart, so cadence cannot live in the cron. The line to hold: Inngest flow control expresses safety (concurrency, idempotency, retries); Settings express policy (cadence, targets, windows). Never encode cadence in throttle/rateLimit or the dashboard becomes a lie.

Everything here is deterministic with an injected now, so no DB and no Inngest, fully unit-testable:

export function rollingWindowStart(now: Date, days?: number): Date; // default 7
export function derivedSpacingMinutes(articlesPerWeek: number): number; // 10080 / N
export function effectiveSpacingMinutes(config: PacingConfig): number; // override > 0 else derived
export function isWithinRunWindow(now: Date, window: RunWindow): boolean;
export function decidePacing(config: PacingConfig, inputs: PacingInputs): PacingDecision;

type PacingSkipReason = 'paused' | 'outside_run_window' | 'weekly_target_met'
| 'unreviewed_backlog_full' | 'spacing_not_elapsed' | 'no_queued_keywords';

interface PacingDecision {
slots: 0 | 1; // structurally capped at 1: the key safety property
reason: PacingSkipReason | 'ok';
detail: { windowStart: Date; spacingMinutes: number; nextEligibleAt: Date | null;
remainingThisWeek: number; backlogHeadroom: number };
}
slots capped at 1 per site per tick bounds worst-case budget overshoot to a single article. Throughput is not the constraint: at 5/week the spacing is 33.6h, and a 15-minute tick only becomes the bottleneck above 672 articles/week.

Two decisions worth stating:

Count Article.createdAt in a rolling 7 days, and human-generated articles count too. The weekly number is a cadence-and-cost budget for the site; excluding hand-made drafts would let total output reach 2N and silently double spend against a $50/month budget. Same for spacing: measure from the newest article of any origin, so an auto draft never stacks on top of a human burst.
The backlog cap counts PENDING_REVIEW plus CHANGES_REQUESTED. Both are unreviewed human work; capping only the former lets an ignored changes-requested pile grow without ever throttling.
DB helpers in packages/core/src/services/pipeline-service.ts
/** ACTIVE + autopilotEnabled + HAS a style guide. \*/
export async function listAutopilotSites(db: PrismaClient): Promise<AutopilotSite[]>;
/** Batched: 3 groupBy queries total, never N+1 per site. \*/
export async function loadSiteThroughput(db, siteIds: string[], windowStart: Date): Promise<Map<string, SiteThroughput>>;
export async function claimNextKeyword(db, siteId: string): Promise<ClaimedKeyword | null>;
export async function releaseKeyword(db, keywordId: string, to: 'QUEUED' | 'SKIPPED'): Promise<boolean>;
export async function reclaimStaleKeywords(db, staleAfterMinutes: number, now?: Date): Promise<number>;
The style-guide requirement lives in listAutopilotSites, not in the draft function. generateArticleDraft hard-throws without one (article-service.ts:668); handling that inside the draft would release the keyword and let the next tick re-claim and re-fail forever, 96 times a day. Never claim a keyword you cannot draft. The dashboard surfaces "Autopilot blocked: add a style guide" so the silence is explained.

The atomic claim is the only thing that truly prevents double-drafting:

UPDATE "Keyword" k SET status = 'IN_PROGRESS'::"KeywordStatus", "claimedAt" = NOW()
WHERE k.id = (
SELECT c.id FROM "Keyword" c
WHERE c."siteId" = $1 AND c.status = 'QUEUED'::"KeywordStatus"
AND NOT EXISTS (SELECT 1 FROM "Article" a WHERE a."keywordId" = c.id)
ORDER BY c.priority DESC, c."discoveryScore" DESC NULLS LAST, c."sourcedAt" ASC
LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING k.id, k.term, k."siteId", k.source
FOR UPDATE SKIP LOCKED makes concurrent ticks pick different rows instead of racing. This is the one place raw SQL is justified: updateMany cannot express RETURNING over a locked subselect, and DB-level atomicity is the behaviour. releaseKeyword must carry a where: { status: 'IN_PROGRESS' } CAS predicate so a late failure can never flip a DONE keyword back to QUEUED and cause a second draft.

Events in packages/core/src/pipeline/events.ts (Zod only, no inngest import)
'scribe/keyword.claimed' { siteId, keywordId, term, source, claimedAt, tickId }
'scribe/article.drafted' { siteId, articleId, keywordId, title, wordCount, seoScore, enrichment }
'scribe/discovery.requested' { siteId, reason: 'buffer_low' | 'weekly_cron' | 'manual' }
'scribe/pipeline.tick.requested' { siteId?, actorId }
'article.approved' { articleId, siteId, actorId, reviewId, version, approvedAt }
Wire them via new EventSchemas().fromZod({...}) on the client (apps/worker/src/inngest/client.ts:8). inngest@3.54.2 is installed and exports EventSchemas, NonRetriableError, and RetryAfterError.

EventSchemas is compile-time only. It does not validate event.data at runtime. Per §10.1 #5, every handler's first line must be Schema.parse(event.data).

Fan out per article, keep enrichment inline
The tick emits one event per article rather than looping inline, because: the tick is cheap and runs every 15 minutes while a draft is minutes of paid calls, so sharing a run entangles their retry semantics; they need opposite retry policies (retries: 0 for the tick, since the next tick is the retry, versus retries: 2 for the draft); concurrency: { key: 'event.data.siteId', limit: 1 } is inexpressible in a loop; idempotency: 'event.data.keywordId' needs a per-item event; and one inspectable, individually retryable Inngest run per article is the whole answer to "how do I watch this."

Enrichment stays as step.run calls inside the draft function. The extras are short, share the article context, and run after createDraftRecords commits, so "the article reached PENDING_REVIEW" becomes a structural guarantee rather than a convention.

Function Trigger Flow control
pipeline-tick cron: _/15 _ \* \* _ plus scribe/pipeline.tick.requested retries: 0, concurrency: 1
article-autodraft scribe/keyword.claimed retries: 2, idempotency: 'event.data.keywordId', concurrency: [{key: siteId, limit: 1}, {limit: N}], onFailure
discovery-run scribe/discovery.requested retries: 1, rateLimit: {limit: 1, period: '24h', key: siteId}
review-digest cron: 0 _ \* \* \* retries: 1, concurrency: 1
publish-run article.approved retries: 3, concurrency: {key: articleId, limit: 1}
Refactor weeklyKeywordDiscovery to emit scribe/discovery.requested instead of calling runSiteDiscovery inline, so there is one discovery path and one place for flow control. The rateLimit keyed on siteId stops the weekly cron and a buffer-low tick paying for discovery twice in a day.

Phase 3: drafting and enrichment worker
apps/worker/src/functions/article-autodraft.ts. Every step calls an existing exported service function, unchanged apart from B1/B3. No drafting, scoring, or enrichment logic is rewritten.

Step Reuses Fatal?
draft generateArticleDraft(prisma, SYSTEM_ACTOR, { siteId, keywordId, keyword: term }, { apiKey }) Fatal
list-inline-images articleImage.findMany Fatal (cheap read)
suggest-inline-images suggestArticleInlineImages (only when count is 0) best-effort
taxonomy autoAssignArticleTaxonomy best-effort
hero-image generateArticleImage best-effort
inline-image-{id} xN generateArticleInlineImage best-effort each
emit-drafted step.sendEvent best-effort
Only the draft is fatal, because without it there is nothing to review. Every extra already has a one-click dashboard button (generateArticleImageAction, autoAssignTaxonomyAction, suggestInlineImagesAction) for the human to fill any gap, each independently calls assertWithinBudget(db, { articleId }) so they self-limit against the $2/article ceiling, and the failure mode is a visible missing image.

Two step mechanics that bite if ignored:

Never return an ArticleDTO from step.run. It carries imageDataBase64 (article-service.ts:161), which would persist multi-megabyte blobs into Inngest's memoized step state on every attempt. Return { articleId, title, wordCount, seoScore }.
Freeze the inline-image list in its own step, then loop the captured array. Re-reading the DB per attempt shifts the inline-image-{id} step ids between attempts and diverges memoization.
onFailure releases the claim to SKIPPED, not QUEUED. SKIPPED is an unused enum value and this is exactly its meaning: attempted, failed, needs a human. Releasing to QUEUED loops forever on a structurally undraftable keyword. Pair it with an audit row and a "Requeue" button on SKIPPED rows.

Budget safety. Gate the tick before it claims, not the draft after it pays:

const stopAt = settings.monthly_budget_usd \* (1 - settings.autopilot_budget_reserve_pct / 100);
if (settings.monthly_budget_usd > 0 && await monthToDateSpendUsd(prisma) >= stopAt)
return { skipped: 'budget_reserve_reached' };
The reserve matters because assertWithinBudget is documented as a soft pre-check (cost/usage.ts:11-14). Without it autopilot eats the last dollar and the human has no headroom left to regenerate a bad draft.

Map BudgetExceededError to NonRetriableError in the worker. Inngest defaults to 4 attempts and the budget will not change inside the backoff, so retrying burns four runs for one deterministic outcome. packages/core never imports NonRetriableError: core throws typed errors, the worker maps them.

With autopilot_max_concurrent_drafts: 1 (default) plus slots ≤ 1 plus sequential enrichment steps, worst-case monthly overshoot is one in-flight call: one draft, or one $0.039 image. A real bound.

Phase 4: approve equals publish, with the gate intact
This is the security-critical phase and it lands before Phase 2/3 ship enabled, because cron code that creates articles is what makes B2 exploitable.

The event
approveArticle gains an injected emitter, matching the repo's existing DI style (options.fetchFn, DiscoveryUsageSink):

export async function approveArticle(db, actor, id,
options: { emit?: ArticleApprovedEmitter } = {}): Promise<ApproveArticleResult>;

type PublishQueueOutcome = 'queued' | 'not_configured' | 'blocked_preconditions' | 'emit_failed';
emit omitted means no publish, so every existing core integration test that calls approveArticle(db, admin, id) stays green, including the republish test at services.integration.test.ts:868. That is the decisive argument for the event path over calling publishArticleToCms inline.

Commit the approval, then emit. The dual-write failure mode becomes "approved but not published", which fails closed and is recoverable via the retained Publish button.
An emit throw never rolls back the approval. Catch, log, return emit_failed, and show "Approved. Automatic publishing could not be queued, use Publish to retry."
Pre-flight preconditions synchronously before emitting (site ACTIVE, title, content, credentials). Otherwise approving on a paused site silently produces a PUBLISH_FAILED article via four burned retries and the reviewer learns nothing at decision time.
recordReviewDecision (article-service.ts:1149) needs one refactor: it creates the Review via a nested reviews: { create } which does not return the id. Use an explicit tx.review.create in the same transaction so reviewId is available.

Emit from apps/web (add inngest to its package.json; 3.54.2 is already in the lockfile) via a new apps/web/src/server/publish-events.ts with import 'server-only'. Do not add an /api/inngest route to apps/web: the middleware matcher would auth-gate it, and excluding it would create a second unauthenticated entry point into publish logic. The worker serves; web only sends. Compose already sets INNGEST_DEV on the web service for exactly this shape.

The guard in packages/core/src/auth/human-actor.ts
The load-bearing field is reviewId, not actorId. Anyone reaching the Inngest event API can forge actorId (the dev server runs with no event key). Nobody can forge a Review row: Review.reviewerId is a FK to User.id, and its only writer sits behind authorize(actor, 'article.approve') behind requireActor(). The guard is anchored on referential integrity against a table only an authenticated human session can write.

export async function assertHumanPublishActor(db, input: {
claimed: { id?: string | null; role?: Role }; // untrusted, including the role
articleId: string;
origin: 'human_session' | 'approval_event';
reviewId?: string; // REQUIRED when origin is approval_event
maxApprovalAgeMs?: number; // default 24h
}): Promise<PublishGrant>;
Verification order, each line load-bearing:

claimed.id missing, empty, or in RESERVED_ACTOR_IDS (system, cron, worker, …) gives reserved_actor_id. This is the line that stops today's SYSTEM_ACTOR.
db.user.findUnique returning null gives actor_not_found. The real backstop: rename the sentinel out of the reserved set and there is still no User row for it.
Role in HUMAN_PUBLISH_ROLES, else role_not_permitted.
Call authorize(...). Do not reimplement a role matrix, or §10.1 #4 gains a second source of truth. Steps 1 to 3 exist precisely because this line alone passes for SYSTEM_ACTOR.
claimed.role !== user.role gives role_claim_mismatch. Not paranoia: auth.ts uses session: { strategy: 'jwt' } and the jwt callback reads the DB role only on sign-in, so a demoted user's session keeps claiming its old role until re-login. Re-reading the row closes a stale-JWT escalation window that exists today.
On approval_event: load the Review and require that it exists, articleId matches, decision === 'APPROVED', reviewerId === user.id, and createdAt is within 24h. This is the layer a cron cannot satisfy even holding a real ADMIN's id.
PublishGrant is branded with a module-private Symbol, so only this module can construct one: a real capability token, not a convention. It must never be serialized into an event payload or a DB row; on the wire it degrades into a forgeable bearer token.

Every denial writes an audit row before throwing, with actorId: null and the claimed id in metadata. This is not cosmetic: AuditLog.actorId is a FK, so writing a forged id there raises a Prisma error instead of writing the row, destroying the security signal exactly when you need it.

Then replace the lone authorize at article-service.ts:1265 with assertHumanPublishActor, so both the sync and event paths traverse one door, and type publishArticleToCms(db, actor: HumanClaimActor, ...) so passing SYSTEM_ACTOR is a compile error at the call site.

Idempotency: a real duplicate-post risk under automatic retries
The dangerous window: the CMS POST succeeds but the response never arrives (timeout, ECONNRESET, restart). No success record is written, so existingDocumentId stays null on the next attempt, and the retry POSTs again, creating a second CMS entry. Today a human chooses to click Publish again; under Inngest, retries are automatic and invisible.

Separately, the key at article-service.ts:1348 is `article:${id}:${randomUUID()}`, fresh per attempt, so the @unique constraint on PublishRecord.idempotencyKey can never fire. It is a decorative index.

Fix, which is what CLAUDE.md's domain rules already prescribe:

Deterministic key publish:{articleId}:{currentVersion}.
Pre-check fast path: a success row for that key means already published, so return with no CMS call.
Claim then publish: insert the row as status: 'pending' before the CMS call, in the same transaction that sets PUBLISHING. A retry hits P2002 and knows an attempt is in flight. The claim, not the completion, is what makes retries safe.
Recovering a pending row: the outcome is unknown, so do not blind-POST. Look the entry up by slug and PUT if found. fetchStrapiCollection and resolveDocumentIdsBySlug in strapi-taxonomy.ts already do this.
upsert on retry, permitted only when the existing row is failed. Without this, keying on version breaks the PUBLISH_FAILED retry path with a unique-constraint crash.
Keep the prior-successful-record lookup at :1337-1341 exactly as it is. It is version-agnostic and catches legacy article:{id}:{uuid} rows, so a pre-change article PUTs rather than POSTs. The new pre-check is purely additive.
Event-level dedupe as the second layer: event id keyed on reviewId, not version, because a legitimate re-approval after a failed publish is the same version and must not be swallowed.
Note PublishRecord.status is free-text String so 'pending' needs no migration, but articles/[id]/page.tsx:279 paints anything non-success red, so it needs a third badge tone.

transitionArticle, scoped
CLAUDE.md mandates it and schema.prisma's header asserts it exists. It does not: all 8 status writes are raw prisma.article.update. With a machine about to drive the pipeline this stops being tidiness. approveArticle today has no from-state validation, so REJECTED → APPROVED and PUBLISHED → APPROVED both succeed, and under publish-on-approve an accidental Approve on a published article would immediately fire a republish.

New packages/core/src/domain/article-transitions.ts. The table encodes two orthogonal constraints, deny-by-default:

interface TransitionRule { to: ArticleStatus; allow: 'human' | 'system' | 'any'; requiresPublishGrant?: boolean }
Invariants to encode and test as properties:

No system or any rule targets APPROVED, PUBLISHING, or PUBLISHED. The cron cannot type a path to a published article.
Every edge into PUBLISHING/PUBLISHED sets requiresPublishGrant. Since only assertHumanPublishActor can mint a grant, there is no way to write PUBLISHED without having passed the human check in the same process.
PUBLISHING → PUBLISH_FAILED is deliberately any with no grant, so the catch block can always record a failure. Otherwise a guard error inside the error path strands the article in PUBLISHING.
The update uses where: { id, status: fromStatus } as an optimistic-concurrency guard, so a racing transition fails with P2025 instead of silently clobbering. That is what makes a double-clicked Approve safe at the DB level. recordAudit runs in the same transaction, and options.action preserves the existing audit action strings (article.approved is the spec's own name and the audit page reads them).

Honest scope. Migrate the 4 safety-critical writes: :1192 APPROVED (needs from-state validation), :1345 PUBLISHING (also a standing §10.1 #6 violation today, being a bare update with no transaction and no audit row), :1394 PUBLISHED, :1429 PUBLISH_FAILED. Also migrate :956 (updateArticleDraft silently reverting APPROVED/PUBLISHED to PENDING_REVIEW with no audit of the status move; once approve means publish, that silent revert is the whole difference between published and not) plus :1207 and :1220, which are free once the shared helper routes through it. Defer :385 (a create, not a transition) and :1108 (regenerate).

Keep the Publish button
A PUBLISH_FAILED retry has no new Review row, so no event. Keep the button as the recovery path: it is the only human escape when Inngest is down or emit failed. Change the condition at articles/[id]/page.tsx:54 to show when PUBLISH_FAILED, or when APPROVED with no successful or pending record for the current version. It becomes "Retry publish", not the happy path. Relabel the primary button "Approve & publish" so the single action's consequence is legible before the click.

Publish stays ADMIN-only. CLAUDE.md §10.1 says "Admin/Editor" but authorize.ts grants article.publish to ADMIN only and authorize.test.ts:50 asserts EDITOR cannot. The user is the sole allowlisted account, so this costs nothing: an EDITOR's approve parks at APPROVED without emitting. Resolving it the other way means editing ACTIONS/ROLE_ACTIONS and that test in the same commit, never by weakening the guard.

Phase 5: email digest
packages/core/src/notify/mailer.ts (impure send, lazy transport) plus review-digest.ts (pure builder). Add nodemailer and @types/nodemailer to packages/core: the digest sends from the worker, and core already hosts the CMS and LLM clients, so this imports no framework code. EMAIL_SERVER is already in REDACT_PATHS (logger.ts:38) and both env vars already exist for magic-link auth.

Hourly cron gated on review_digest_enabled and review_digest_hour_utc. Query PENDING_REVIEW with reviewNotifiedAt: null, send, then mark. Marking after sending gives at-least-once delivery: a successful send with a failed mark yields a duplicate email, which is the right failure direction for a notification, whereas marking first risks silent non-notification. Comment that reasoning in the code. Recipients come from review_digest_recipients, falling back to all ADMIN/EDITOR users. HTML-escape titles.

Phase 6: dashboard controls
Migration (one)
Keyword.claimedAt DateTime? · Article.autoGenerated Boolean @default(false) · Article.reviewNotifiedAt DateTime? · Site.autopilotEnabled Boolean @default(false) · Site.autopilotArticlesPerWeek Int? (null inherits the global) · indexes Article @@index([siteId, createdAt]) (the rolling-window count, currently unindexed) and Article @@index([status, reviewNotifiedAt]) (the digest query).

autoGenerated is for reporting and digest scoping only, never for pacing. That keeps the pacing math to two integers and a date.

New settings in settings.ts
All default off or conservative, matching how discovery_cron_enabled ships false. Nothing changes behaviour until the user opts in.

Key Default Meaning
autopilot_enabled false master switch
autopilot_articles_per_week 3 the dial the user asked for, per site
autopilot_min_spacing_minutes 0 0 derives evenly from the weekly target
autopilot_max_unreviewed 5 backlog cap; 0 is unlimited
autopilot_max_concurrent_drafts 1 capped at 5
autopilot_max_inline_images 4 cost ceiling per article
autopilot_budget_reserve_pct 10 headroom held back for human work
autopilot_generate_hero_image true
autopilot_generate_inline_images true
autopilot_assign_taxonomy true
autopilot_stale_claim_minutes 60 reaper threshold
autopilot_keyword_buffer_low_water 5 below this, auto-run discovery
autopilot_run_window all day, every day { daysOfWeek, startHour, endHour, timezoneOffsetMinutes }
review_digest_enabled false
review_digest_hour_utc 8
review_digest_recipients [] empty means all ADMIN/EDITOR
review_digest_min_articles 1
Leave briefs_per_run and max_regen alone. max_regen is reserved for the Phase 5 QA loop per the Decisions Log, and overloading briefs_per_run would be worse than a clearly named new key.

The settings write path breaks, so watch this part
updateSettingsAction (actions.ts:762) handles exactly one shape well. Three changes:

Numbers: append to NUMERIC_SETTINGS (:754), and add a numFromForm helper that skips NaN. Today garbage input yields NaN, Zod rejects it, and toState surfaces a raw ZodError at the user.
Booleans need their own list and cannot join the numeric loop. An unchecked HTML checkbox sends nothing, so absence must be written as an explicit false, and Number('') is not false. The existing discovery_cron_enabled line (:788-793) already does this right, so generalize it into BOOLEAN_SETTINGS.
Nested objects and arrays need bespoke assembly, exactly as models and imageGeneration already do at :773-787.
Also note updateSetting writes one AuditLog row per key, so a 20-field form produces 20 rows per save. Correct but noisy; acceptable, worth recording.

UI
Autopilot card in settings/page.tsx reusing the existing numberField helper and the checkbox pattern at :141-149. Show the derived consequence next to the weekly number by calling derivedSpacingMinutes server-side ("3 per week is about one every 56 hours") so the dial means something.
Autopilot status panel on the dashboard, per site: enabled, articles this week versus target, next eligible time, unreviewed backlog versus cap, and any block reason. This panel is what makes an invisible cron trustworthy.
"Run autopilot now" button emitting scribe/pipeline.tick.requested. It is both the dev loop (a 15-minute cron is too slow to iterate on) and the user's manual override. Calls requireActor() and authorize(actor, 'article.create'); grants no publish authority.
"Requeue" on SKIPPED keyword rows.
Testing
Structural principle: push every decision into a pure core function so the worker files are thin glue with nothing worth unit-testing. Test-first for the security boundaries, per CLAUDE.md.

Pure (packages/core, existing vitest setup):

pipeline/pacing.test.ts carries the bulk. Table-driven, one case per PacingSkipReason, plus boundaries: exactly at target, exactly at the spacing threshold, lastArticleAt null, maxUnreviewed: 0 meaning unlimited, endHour: 24, a window wrapping midnight, empty daysOfWeek, negative tz offset, articlesPerWeek: 0.
domain/article-transitions.test.ts: completeness (iterate every ArticleStatus and require an entry, so adding an enum value fails until someone decides its edges) and the property test that no system/any rule targets APPROVED, PUBLISHING, or PUBLISHED. That invariant survives future edits by people who never read this plan.
auth/human-actor.test.ts: expect(RESERVED_ACTOR_IDS.has(SYSTEM_ACTOR.id)).toBe(true) is the single highest-value line in the suite, since renaming the sentinel makes it fail. Plus isPublishGrant({}) is false, error messages leak no PII, and a // @ts-expect-error asserting SYSTEM_ACTOR is not assignable to HumanClaimActor (which only bites under pnpm typecheck, exactly where you want it).
pipeline/events.test.ts, notify/review-digest.test.ts.
Integration (real Postgres, alongside services.integration.test.ts):

claimNextKeyword is the one thing unit tests cannot cover, because atomicity is the behaviour: seed 5 QUEUED keywords, fire 5 concurrent claims via Promise.all, assert 5 distinct ids and zero duplicates; a 6th returns null; a keyword that already has an Article is never returned; releaseKeyword no-ops on DONE; reclaimStaleKeywords ignores a fresh claimedAt.
The non-negotiable #1 test: publishArticleToCms(db, SYSTEM_ACTOR as never, id, { fetchFn }) rejects with HumanActorRequiredError and fetchFn is called zero times. Asserting the call count is what proves nothing reached the CMS.
The full denial matrix: unknown user, VIEWER, stale-JWT role_claim_mismatch, missing reviewId, wrong-article Review, REJECTED decision, wrong reviewer, 25h-stale Review.
Idempotency: double publish gives one POST and one success row; an interrupted retry gives zero second POSTs; the key equals publish:{id}:{version}; a PUBLISH_FAILED retry at the same version does not crash on the unique constraint; a paused site makes no CMS call and leaves status APPROVED, not PUBLISH_FAILED.
approveArticle with a spy emit: one call, payload matches the schema, reviewId matches the created Review, and approveArticle itself makes no CMS call. emit throwing still commits the approval and returns publish === 'emit_failed'. REJECTED → APPROVED now throws (a behaviour change, so lock it).
apps/worker (zero tests today): add vitest.config.ts (test files must live under src/, since tsconfig.json sets rootDir: "src"), then assert wiring, not logic: every event name a function triggers on is a registered EventSchemas key (this catches the classic "typo in the event name, so nothing ever fires and nothing errors" bug), no duplicate function ids, and flow-control config via exported as const config objects rather than reaching into private fn['opts']. Plus: a HumanActorRequiredError is rethrown as NonRetriableError while a StrapiPublishError is not.

Do not unit-test Inngest step orchestration; that is genuinely exercised by the local dev run below. Never call the real OpenRouter, Gemini, or CMS: every service already accepts fetchFn injection.

Verification
docker compose up -d postgres inngest mailpit
pnpm db:migrate # then pnpm dev
The one diagnostic that matters: open http://localhost:8289, go to Apps, and confirm scribe lists pipeline-tick, article-autodraft, discovery-run, review-digest, and publish-run. An empty Apps list means the -u URL is wrong and nothing else will work.
curl -s http://localhost:4100/api/inngest | head -c 400 returns introspection JSON with those ids.
Dev loop (a 15-minute cron is too slow to iterate on): send scribe/keyword.claimed by hand from the dev UI with a real keywordId to exercise the whole draft-plus-enrich path in isolation, or hit "Run autopilot now" to exercise pacing. Editing a cron string needs a worker restart.
Watch it: dev UI, then Runs, where the article-autodraft run lists each step (draft, taxonomy, hero-image, inline-image-\*) with timing, output, and per-step retry history.
Cross-check in pnpm db:studio: Keyword.status moving QUEUED → IN_PROGRESS → DONE with claimedAt cleared; a new Article at PENDING_REVIEW with autoGenerated = true; ArticleImage rows with dataBase64 populated; one UsageRecord per paid call; and AuditLog rows with actorType = 'system' and actorId = null, that last one being the proof B1 is fixed.
Pacing: set autopilot_articles_per_week to 1 and confirm the second tick skips with weekly_target_met. Set autopilot_max_unreviewed to 1, leave an article unreviewed, and confirm unreviewed_backlog_full. Both are visible in the tick run's return value.
Digest: read the mail at http://localhost:8026.
The gate: approve an article as ADMIN and confirm the publish-run run publishes it as a CMS draft. Then prove the negative via the integration test asserting SYSTEM_ACTOR cannot publish and fetchFn was never called.
pnpm lint && pnpm typecheck && pnpm test && pnpm build green at every phase boundary.
Note: pnpm is not on PATH in this shell (reachable only via corepack pnpm), and turbo needs a pnpm binary on PATH to run its tasks.

Ordered execution

# Phase Gate

1 Infra fix (compose -u, INNGEST_DEV, worker SMTP, AGENTS.md ports) dev UI lists discovery-weekly
2 B1 and B3 fixes with tests (system-actor.ts, 10 audit sites, keywordId path) audit rows with null actorId
3 Migration (claimedAt, autoGenerated, reviewNotifiedAt, Site.autopilot\*, 2 indexes) pnpm db:migrate
4 Core pure logic and tests (pacing.ts, events.ts, transition table) unit tests green
5 pipeline-service.ts plus concurrent-claim integration test 5 concurrent claims, 0 duplicates
6 Settings schema and write path (BOOLEAN_SETTINGS, nested assembly) save round-trips in the UI
7 Worker: EventSchemas, pipeline-tick, article-autodraft, discovery-run one full auto draft
8 Phase 4 security work (human-actor.ts, transitionArticle, idempotency, publish-run) the SYSTEM_ACTOR negative test
9 Digest (mailer plus cron) mail lands in Mailpit
10 Dashboard (autopilot card, status panel, Run now, Requeue) pacing dial visibly changes behaviour
11 PROGRESS.md Decisions Log plus skill pipeline section
Steps 7 and 8 can be built in either order, but do not enable autopilot_enabled in a real environment until step 8 has landed, since that is the phase which makes B2 unexploitable.

Decisions and flagged deviations for PROGRESS.md
Weekly target is per site (global setting as default, per-site column overrides), and human-generated articles count toward it, because it is a cost budget rather than a quota.
Failed drafts terminate at KeywordStatus.SKIPPED, not back at QUEUED.
No brief stage exists. CLAUDE.md describes keyword → brief → draft, but no code writes a Brief, and Site.briefAutoApprove plus briefs_per_run are dead. Autopilot goes keyword → draft, matching shipped code. A conscious decision, not an oversight.
transitionArticle was a pre-existing violation of CLAUDE.md's domain rules (8 raw status writes). This plan implements it partially and records the deferred writes as remaining debt.
The randomUUID() idempotency key was a pre-existing violation of the documented publish:{articleId}:{currentVersion} rule, rendering a @unique index inert.
PUBLISHING was being written with no transaction and no audit row, a standing §10.1 #6 violation, fixed here.
Stale JWT roles affect every action, not just publish. Out of scope, worth a follow-up.
Optional hardening deliberately not included: requiring User.emailVerified at the publish step. It is the only DB-side evidence a magic-link sign-in completed, but if the admin's existing row has a null value it locks them out. Verify against the real DB before adding.
