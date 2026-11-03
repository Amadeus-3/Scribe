import { describe, it, expect } from 'vitest';
import { SYSTEM_ACTOR, isSystemActor, auditActorFields } from './system-actor';
import { authorize } from './authorize';

describe('SYSTEM_ACTOR', () => {
  it('is recognised as the system sentinel', () => {
    expect(isSystemActor(SYSTEM_ACTOR)).toBe(true);
    expect(isSystemActor({ id: 'usr_1', role: 'ADMIN' })).toBe(false);
  });

  // Documents the trap the publish guard exists to close: authorize() cannot
  // distinguish the cron from a real Admin, because the sentinel is ADMIN.
  it('passes authorize() for article.publish, so authorize() is not a humanity check', () => {
    expect(() => authorize(SYSTEM_ACTOR, 'article.publish')).not.toThrow();
  });
});

describe('auditActorFields', () => {
  it('attributes system work to actorType system with a null actorId', () => {
    // A non-null actorId would violate the AuditLog -> User foreign key, losing
    // the audit row for every automated action.
    expect(auditActorFields(SYSTEM_ACTOR)).toEqual({ actorId: null, actorType: 'system' });
  });

  it('attributes human work to the user id', () => {
    expect(auditActorFields({ id: 'usr_1', role: 'EDITOR' })).toEqual({
      actorId: 'usr_1',
      actorType: 'human',
    });
  });

  it('treats any actor carrying the sentinel id as system, whatever its role', () => {
    expect(auditActorFields({ id: 'system', role: 'VIEWER' })).toEqual({
      actorId: null,
      actorType: 'system',
    });
  });
});
