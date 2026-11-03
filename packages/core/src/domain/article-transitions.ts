import type { Article, ArticleStatus, Prisma } from '@prisma/client';
import type { Actor } from '../auth/authorize';
import { isSystemActor } from '../auth/system-actor';
import { isPublishGrant, type PublishGrant } from '../auth/human-actor';
import { auditActorFields } from '../auth/system-actor';
import { recordAudit } from '../audit/audit-log';
import type { Db } from '../db/types';

/**
 * The article state machine (Spec §2.2, CLAUDE.md domain rules).
 *
 * Every status change goes through `transitionArticle`, which validates the
 * edge and writes an AuditLog row in the SAME transaction as the update.
 *
 * The table encodes two orthogonal constraints, deny-by-default:
 *   - is this edge legal at all?
 *   - which class of actor may take it?
 *
 * The second one is why this matters now: the autopilot drives the pipeline
 * machine-to-machine, so "a human did this" has to be expressible in the state
 * machine itself rather than assumed. The invariant that falls out, and is
 * asserted as a property test, is that NO system-class edge terminates in
 * APPROVED, PUBLISHING, or PUBLISHED. The cron cannot type a path to a
 * published article.
 */

export type ActorClass = 'human' | 'system';

export interface TransitionRule {
  to: ArticleStatus;
  allow: ActorClass | 'any';
  /** Requires a PublishGrant, which only assertHumanPublishActor can mint. */
  requiresPublishGrant?: boolean;
}

const HUMAN_TERMINALS: TransitionRule[] = [
  { to: 'REJECTED', allow: 'human' },
  { to: 'ARCHIVED', allow: 'human' },
];

export const TRANSITIONS: Record<ArticleStatus, readonly TransitionRule[]> = {
  QUEUED: [
    { to: 'BRIEFED', allow: 'system' },
    { to: 'DRAFTING', allow: 'system' },
    { to: 'PENDING_REVIEW', allow: 'system' },
    ...HUMAN_TERMINALS,
  ],
  BRIEFED: [
    { to: 'BRIEF_APPROVED', allow: 'any' },
    { to: 'DRAFTING', allow: 'system' },
    ...HUMAN_TERMINALS,
  ],
  BRIEF_APPROVED: [{ to: 'DRAFTING', allow: 'system' }, ...HUMAN_TERMINALS],
  DRAFTING: [
    { to: 'DRAFTED', allow: 'system' },
    { to: 'QA_FAILED', allow: 'system' },
    { to: 'ARCHIVED', allow: 'human' },
  ],
  DRAFTED: [
    { to: 'QA_PASSED', allow: 'system' },
    { to: 'QA_FAILED', allow: 'system' },
    { to: 'PENDING_REVIEW', allow: 'system' },
    { to: 'ARCHIVED', allow: 'human' },
  ],
  QA_PASSED: [{ to: 'PENDING_REVIEW', allow: 'system' }, { to: 'ARCHIVED', allow: 'human' }],
  QA_FAILED: [
    { to: 'DRAFTING', allow: 'system' },
    { to: 'PENDING_REVIEW', allow: 'system' },
    ...HUMAN_TERMINALS,
  ],
  PENDING_REVIEW: [
    // The gate. Human-only, by definition of the product.
    { to: 'APPROVED', allow: 'human' },
    { to: 'CHANGES_REQUESTED', allow: 'human' },
    // Self-edge: an edit or regeneration re-opens review.
    { to: 'PENDING_REVIEW', allow: 'any' },
    ...HUMAN_TERMINALS,
  ],
  CHANGES_REQUESTED: [
    { to: 'PENDING_REVIEW', allow: 'any' },
    { to: 'APPROVED', allow: 'human' },
    ...HUMAN_TERMINALS,
  ],
  APPROVED: [
    { to: 'PUBLISHING', allow: 'human', requiresPublishGrant: true },
    // An edit to an approved article pulls it back for re-review.
    { to: 'PENDING_REVIEW', allow: 'any' },
    ...HUMAN_TERMINALS,
  ],
  PUBLISHING: [
    { to: 'PUBLISHED', allow: 'human', requiresPublishGrant: true },
    // Deliberately 'any' with no grant: the catch block must ALWAYS be able to
    // record a failure. If a guard error could fire inside the error path, an
    // article would be stranded in PUBLISHING forever.
    { to: 'PUBLISH_FAILED', allow: 'any' },
  ],
  PUBLISHED: [
    // Editing a published article re-opens review; re-approval republishes.
    { to: 'PENDING_REVIEW', allow: 'any' },
    { to: 'ARCHIVED', allow: 'human' },
  ],
  PUBLISH_FAILED: [
    { to: 'PUBLISHING', allow: 'human', requiresPublishGrant: true },
    { to: 'PENDING_REVIEW', allow: 'any' },
    ...HUMAN_TERMINALS,
  ],
  REJECTED: [
    { to: 'ARCHIVED', allow: 'human' },
    { to: 'PENDING_REVIEW', allow: 'human' },
  ],
  ARCHIVED: [],
};

export class IllegalArticleTransitionError extends Error {
  readonly from: ArticleStatus;
  readonly to: ArticleStatus;
  readonly actorClass: ActorClass;

  constructor(from: ArticleStatus, to: ArticleStatus, actorClass: ActorClass, detail?: string) {
    super(
      `Illegal article transition ${from} -> ${to} for ${actorClass} actor${
        detail ? `: ${detail}` : ''
      }.`,
    );
    this.name = 'IllegalArticleTransitionError';
    this.from = from;
    this.to = to;
    this.actorClass = actorClass;
  }
}

export function actorClassOf(actor: Actor): ActorClass {
  return isSystemActor(actor) ? 'system' : 'human';
}

/** Pure predicate over the table; used by tests and by the guard below. */
export function findTransitionRule(
  from: ArticleStatus,
  to: ArticleStatus,
  actorClass: ActorClass,
): TransitionRule | undefined {
  return TRANSITIONS[from].find(
    (rule) => rule.to === to && (rule.allow === 'any' || rule.allow === actorClass),
  );
}

export interface TransitionOptions {
  /**
   * Audit action string. Pass it to preserve the established names
   * ('article.approved' is the spec's own, and the audit page reads them).
   */
  action?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  /** Required for PUBLISHING and PUBLISHED. */
  publishGrant?: PublishGrant;
  /** Other Article fields to write in the same UPDATE. */
  data?: Omit<Prisma.ArticleUpdateInput, 'status'>;
}

/**
 * Validate and apply a status change, auditing it atomically.
 *
 * Accepts either a root client or a transaction client: handed the former it
 * opens its own transaction, handed the latter it joins the caller's. Either
 * way the status write and its audit row commit together (Spec §10.1.6).
 */
export async function transitionArticle(
  db: Db,
  article: Pick<Article, 'id' | 'status'>,
  to: ArticleStatus,
  actor: Actor,
  options: TransitionOptions = {},
): Promise<Article> {
  const actorClass = actorClassOf(actor);
  const rule = findTransitionRule(article.status, to, actorClass);
  if (!rule) {
    throw new IllegalArticleTransitionError(article.status, to, actorClass);
  }
  if (rule.requiresPublishGrant) {
    if (!isPublishGrant(options.publishGrant)) {
      throw new IllegalArticleTransitionError(
        article.status,
        to,
        actorClass,
        'a verified publish grant is required',
      );
    }
    if (options.publishGrant.articleId !== article.id) {
      throw new IllegalArticleTransitionError(
        article.status,
        to,
        actorClass,
        'publish grant was issued for a different article',
      );
    }
  }

  const apply = async (tx: Db): Promise<Article> => {
    // `status` in the WHERE clause is an optimistic-concurrency guard: a racing
    // transition fails with P2025 rather than silently clobbering. This is what
    // makes a double-clicked Approve safe at the database level.
    const updated = await tx.article.update({
      where: { id: article.id, status: article.status },
      data: { ...options.data, status: to },
    });

    await recordAudit(tx, {
      ...auditActorFields(actor),
      action: options.action ?? 'article.transitioned',
      entityType: 'Article',
      entityId: article.id,
      metadata: {
        from: article.status,
        to,
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.metadata ?? {}),
      } as Prisma.InputJsonValue,
    });

    return updated;
  };

  return '$transaction' in db ? db.$transaction((tx) => apply(tx)) : apply(db);
}
