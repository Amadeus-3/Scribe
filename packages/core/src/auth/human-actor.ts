import type { PrismaClient, Role } from '@prisma/client';
import { authorize, type Actor } from './authorize';
import { SYSTEM_ACTOR } from './system-actor';
import { recordAudit } from '../audit/audit-log';
import type { Db } from '../db/types';

/**
 * The human-publish gate (Spec §10.1.1 — the product's central non-negotiable):
 *
 *   "Publishing is triggered only by an `article.approved` event whose actor is
 *    an authenticated HUMAN Admin/Editor. Verify the actor at the publish step,
 *    not just the UI. No LLM/cron/scraper/web content may trigger a publish."
 *
 * Why `authorize()` alone cannot satisfy that: SYSTEM_ACTOR carries role ADMIN
 * so it can do its legitimate pipeline work, which means
 * `authorize(SYSTEM_ACTOR, 'article.publish')` returns cleanly. Role is not
 * humanity. This module supplies the missing check and is the single door both
 * the synchronous server action and the event-driven worker pass through.
 *
 * On the event path the load-bearing evidence is `reviewId`, NOT `actorId`.
 * Anyone who can reach the Inngest event API can put any string in `actorId`
 * (the local dev server runs with no event key). Nobody can forge a `Review`
 * row: `Review.reviewerId` is a foreign key to `User.id`, and the only code
 * that writes one sits behind `authorize(actor, 'article.approve')` behind an
 * authenticated session. The guard is therefore anchored on referential
 * integrity against a table only a signed-in human can cause a write to.
 */

/** Ids that can never denote a human, checked before any DB lookup. */
export const RESERVED_ACTOR_IDS: ReadonlySet<string> = new Set([
  SYSTEM_ACTOR.id,
  'cron',
  'worker',
  'scheduler',
  'anonymous',
  'inngest',
  '',
]);

/**
 * Roles permitted to trigger a publish.
 *
 * CLAUDE.md §10.1 says "Admin/Editor", but `authorize.ts` grants
 * `article.publish` to ADMIN only and `authorize.test.ts` asserts EDITOR cannot.
 * We keep the stricter shipped behaviour: an EDITOR's approval records the
 * review and parks the article at APPROVED without publishing. Widening this
 * means editing ACTIONS/ROLE_ACTIONS and that test together — never weakening
 * the guard below.
 */
export const HUMAN_PUBLISH_ROLES: readonly Role[] = ['ADMIN'];

/** Default staleness bound on the Review row that proves an approval. */
export const DEFAULT_MAX_APPROVAL_AGE_MS = 24 * 60 * 60 * 1000;

export type PublishOrigin = 'human_session' | 'approval_event';

export type HumanActorDenialReason =
  | 'reserved_actor_id'
  | 'missing_actor_id'
  | 'actor_not_found'
  | 'role_not_permitted'
  | 'role_claim_mismatch'
  | 'missing_review_proof'
  | 'review_not_found'
  | 'review_not_approval'
  | 'review_actor_mismatch'
  | 'review_article_mismatch'
  | 'review_stale';

export class HumanActorRequiredError extends Error {
  readonly reason: HumanActorDenialReason;
  readonly articleId: string;
  readonly origin: PublishOrigin;

  constructor(reason: HumanActorDenialReason, articleId: string, origin: PublishOrigin) {
    // Deliberately carries no email, name, or role — this message reaches logs.
    super(`Publishing requires an authenticated human reviewer (${reason}).`);
    this.name = 'HumanActorRequiredError';
    this.reason = reason;
    this.articleId = articleId;
    this.origin = origin;
  }
}

/**
 * Proof that a specific human was verified for a specific article, in this
 * process, just now.
 *
 * The brand is a module-private symbol, so no code outside this file can name
 * the key and fabricate one — it is a real capability token, not a convention.
 *
 * NEVER serialize a grant into an event payload, a DB row, or a log. On the
 * wire it would degrade into a forgeable bearer token, which is precisely the
 * failure mode this design exists to avoid.
 */
const GRANT_BRAND = Symbol('scribe.publishGrant');

export interface PublishGrant {
  readonly [GRANT_BRAND]: true;
  /** Role read from the database, never from the caller's claim. */
  readonly actor: Actor;
  readonly articleId: string;
  readonly reviewId: string | null;
  readonly origin: PublishOrigin;
  readonly verifiedAt: Date;
}

export function isPublishGrant(value: unknown): value is PublishGrant {
  return typeof value === 'object' && value !== null && GRANT_BRAND in value;
}

/**
 * A claimed publish actor.
 *
 * `role` is optional because the guard reads the authoritative role from the
 * database anyway — the event path only carries an id. The `__system?: never`
 * brand still makes `SYSTEM_ACTOR` a compile error at any call site that takes
 * this type.
 */
export type PublishActorClaim = { id: string; role?: Role } & { readonly __system?: never };

export interface HumanPublishActorInput {
  /** The claimed actor. Untrusted input, including its role. */
  claimed: { id?: string | null; role?: Role };
  articleId: string;
  origin: PublishOrigin;
  /** Required when origin is 'approval_event'. */
  reviewId?: string;
  maxApprovalAgeMs?: number;
  now?: Date;
}

/**
 * Record a blocked publish, then throw.
 *
 * `actorId` is null on purpose: `AuditLog.actorId` is a foreign key to
 * `User.id`, so writing a forged or sentinel id there would raise a Prisma FK
 * error INSTEAD of writing the row, destroying the security signal at exactly
 * the moment it matters. The claimed id goes in `metadata`, which has no FK.
 */
async function deny(
  db: Db,
  input: HumanPublishActorInput,
  reason: HumanActorDenialReason,
): Promise<never> {
  await recordAudit(db, {
    actorId: null,
    actorType: 'system',
    action: 'article.publishBlocked',
    entityType: 'Article',
    entityId: input.articleId,
    metadata: {
      reason,
      origin: input.origin,
      claimedActorId: input.claimed.id ?? null,
      claimedRole: input.claimed.role ?? null,
    },
  });
  throw new HumanActorRequiredError(reason, input.articleId, input.origin);
}

/**
 * Verify that a real, authenticated human is behind this publish, or throw.
 *
 * Checks run in increasing cost. Each one is load-bearing; see the comments.
 */
export async function assertHumanPublishActor(
  db: PrismaClient,
  input: HumanPublishActorInput,
): Promise<PublishGrant> {
  const claimedId = input.claimed.id;
  if (claimedId === undefined || claimedId === null) {
    return deny(db, input, 'missing_actor_id');
  }
  // The line that stops today's SYSTEM_ACTOR, before any query runs.
  if (RESERVED_ACTOR_IDS.has(claimedId)) {
    return deny(db, input, 'reserved_actor_id');
  }

  const user = await db.user.findUnique({
    where: { id: claimedId },
    select: { id: true, role: true },
  });
  // The real backstop: rename the sentinel out of RESERVED_ACTOR_IDS and there
  // is still no User row for it, so it still cannot publish.
  if (!user) {
    return deny(db, input, 'actor_not_found');
  }

  if (!HUMAN_PUBLISH_ROLES.includes(user.role)) {
    return deny(db, input, 'role_not_permitted');
  }

  // Call the single authorization helper rather than reimplementing a role
  // matrix (Spec §10.1.4). The checks above exist precisely because this line
  // alone passes for SYSTEM_ACTOR.
  authorize({ id: user.id, role: user.role }, 'article.publish');

  // Auth.js uses a JWT session strategy and only re-reads the role at sign-in,
  // so a demoted user's session keeps asserting its old role until they log in
  // again. Comparing the claim against the live row closes that window.
  if (input.claimed.role !== undefined && input.claimed.role !== user.role) {
    return deny(db, input, 'role_claim_mismatch');
  }

  let reviewId: string | null = null;
  if (input.origin === 'approval_event') {
    if (!input.reviewId) {
      return deny(db, input, 'missing_review_proof');
    }
    const review = await db.review.findUnique({
      where: { id: input.reviewId },
      select: { id: true, articleId: true, reviewerId: true, decision: true, createdAt: true },
    });
    if (!review) return deny(db, input, 'review_not_found');
    if (review.articleId !== input.articleId) return deny(db, input, 'review_article_mismatch');
    if (review.decision !== 'APPROVED') return deny(db, input, 'review_not_approval');
    if (review.reviewerId !== user.id) return deny(db, input, 'review_actor_mismatch');

    const now = input.now ?? new Date();
    const maxAge = input.maxApprovalAgeMs ?? DEFAULT_MAX_APPROVAL_AGE_MS;
    if (now.getTime() - review.createdAt.getTime() > maxAge) {
      return deny(db, input, 'review_stale');
    }
    reviewId = review.id;
  }

  return {
    [GRANT_BRAND]: true,
    actor: { id: user.id, role: user.role },
    articleId: input.articleId,
    reviewId,
    origin: input.origin,
    verifiedAt: input.now ?? new Date(),
  };
}
