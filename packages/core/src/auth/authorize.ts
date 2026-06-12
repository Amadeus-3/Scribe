import type { Role } from '@prisma/client';

/**
 * Single source of authorization (Spec §10.1.4, §1.4). Every mutating server
 * action calls `authorize(actor, action)`; UI hiding is never the gate.
 *
 * `Action` is derived from the canonical `ACTIONS` list, so the ADMIN "all"
 * set below can never silently fall out of sync when an action is added.
 */
export const ACTIONS = [
  'site.read',
  'site.create',
  'site.update',
  'site.delete',
  'site.credentials.manage',
  'styleGuide.read',
  'styleGuide.update',
  'keyword.read',
  'keyword.create',
  'keyword.delete',
  'article.read',
  'article.create',
  'article.edit',
  'article.approve',
  'article.requestChanges',
  'article.reject',
  'article.publish',
  'article.archive',
  'brief.approve',
  'brief.reject',
  'settings.read',
  'settings.update',
  'user.manage',
  'auditLog.read',
] as const;

export type Action = (typeof ACTIONS)[number];

export interface Actor {
  id: string;
  role: Role;
}

// Read-only surface — available to every role.
const READ_ACTIONS: readonly Action[] = [
  'site.read',
  'styleGuide.read',
  'keyword.read',
  'article.read',
  'settings.read',
  'auditLog.read',
];

// EDITOR: reviews, edits, approves/rejects articles and briefs (Spec §1.4).
// No credential, user, settings, site, style-guide, or keyword management.
const EDITOR_ACTIONS: readonly Action[] = [
  ...READ_ACTIONS,
  'article.edit',
  'article.approve',
  'article.requestChanges',
  'article.reject',
  'article.archive',
  'brief.approve',
  'brief.reject',
];

const ROLE_ACTIONS: Record<Role, ReadonlySet<Action>> = {
  ADMIN: new Set(ACTIONS), // full access
  EDITOR: new Set(EDITOR_ACTIONS),
  VIEWER: new Set(READ_ACTIONS),
};

export class AuthorizationError extends Error {
  readonly action: Action;
  readonly role: Role;
  constructor(actor: Actor, action: Action) {
    super(`Role ${actor.role} is not permitted to perform "${action}"`);
    this.name = 'AuthorizationError';
    this.action = action;
    this.role = actor.role;
  }
}

/** Pure predicate: may this role perform this action? */
export function can(role: Role, action: Action): boolean {
  return ROLE_ACTIONS[role].has(action);
}

/** Enforce authorization; throws AuthorizationError when denied. */
export function authorize(actor: Actor, action: Action): void {
  if (!can(actor.role, action)) {
    throw new AuthorizationError(actor, action);
  }
}
