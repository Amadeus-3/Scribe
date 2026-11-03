import type { Actor } from './authorize';

/**
 * The non-human actor used by crons and event handlers (Spec §10.1.6).
 *
 * It carries role ADMIN so it passes `authorize()` for the pipeline work it
 * legitimately does (discovery, drafting). That is exactly why it must never be
 * the actor on a publish: `authorize()` alone cannot tell it apart from a real
 * Admin. Publishing is guarded separately, at the publish step.
 *
 * `__system` is a compile-time brand so a function that requires a human actor
 * can refuse this value at the call site (see `HumanClaimActor`).
 */
export interface SystemActor extends Actor {
  readonly __system: true;
}

export const SYSTEM_ACTOR: SystemActor = { id: 'system', role: 'ADMIN', __system: true };

/**
 * An Actor that is provably not the system sentinel. Parameters typed with this
 * reject `SYSTEM_ACTOR` at compile time — a deterrent, not the control. The
 * runtime guard is still required, because a plain `Actor` value carrying
 * `id: 'system'` satisfies this type.
 */
export type HumanClaimActor = Actor & { readonly __system?: never };

export function isSystemActor(actor: Actor): boolean {
  return actor.id === SYSTEM_ACTOR.id;
}

/**
 * Correct AuditLog attribution for any actor.
 *
 * `AuditLog.actorId` is a foreign key to `User.id`, and no User row exists for
 * the system sentinel — writing `actor.id` for a cron would raise a Prisma FK
 * error and lose the audit row entirely. System work is recorded as actorType
 * 'system' with a null actorId, never attributed to a human.
 */
export function auditActorFields(actor: Actor): {
  actorId: string | null;
  actorType: 'human' | 'system';
} {
  return isSystemActor(actor)
    ? { actorId: null, actorType: 'system' }
    : { actorId: actor.id, actorType: 'human' };
}
