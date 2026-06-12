import { describe, it, expect } from 'vitest';
import { ACTIONS, can, authorize, AuthorizationError, type Action, type Actor } from './authorize';

const admin: Actor = { id: 'u-admin', role: 'ADMIN' };
const editor: Actor = { id: 'u-editor', role: 'EDITOR' };
const viewer: Actor = { id: 'u-viewer', role: 'VIEWER' };

const READS: Action[] = [
  'site.read',
  'styleGuide.read',
  'keyword.read',
  'article.read',
  'settings.read',
  'auditLog.read',
];

describe('RBAC matrix (Spec §1.4)', () => {
  it('ADMIN can perform every action', () => {
    for (const action of ACTIONS) {
      expect(can('ADMIN', action)).toBe(true);
    }
  });

  it('VIEWER can only read', () => {
    for (const action of ACTIONS) {
      expect(can('VIEWER', action)).toBe(READS.includes(action));
    }
  });

  it('EDITOR can review/edit articles + briefs and read, but not manage creds/users/settings/sites', () => {
    // allowed
    for (const action of [
      ...READS,
      'article.edit',
      'article.approve',
      'article.requestChanges',
      'article.reject',
      'article.archive',
      'brief.approve',
      'brief.reject',
    ] as Action[]) {
      expect(can('EDITOR', action)).toBe(true);
    }
    // denied
    for (const action of [
      'site.create',
      'site.update',
      'site.delete',
      'site.credentials.manage',
      'styleGuide.update',
      'keyword.create',
      'keyword.delete',
      'article.create',
      'article.publish',
      'settings.update',
      'user.manage',
    ] as Action[]) {
      expect(can('EDITOR', action)).toBe(false);
    }
  });
});

describe('authorize()', () => {
  it('does not throw for a permitted action', () => {
    expect(() => authorize(admin, 'user.manage')).not.toThrow();
    expect(() => authorize(editor, 'article.approve')).not.toThrow();
    expect(() => authorize(viewer, 'article.read')).not.toThrow();
  });

  it('throws AuthorizationError for a denied action', () => {
    expect(() => authorize(viewer, 'article.approve')).toThrow(AuthorizationError);
    expect(() => authorize(editor, 'site.credentials.manage')).toThrow(AuthorizationError);
  });

  it('the error names the denied action', () => {
    try {
      authorize(viewer, 'site.create');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as AuthorizationError).action).toBe('site.create');
    }
  });
});
