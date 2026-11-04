import { describe, it, expect } from 'vitest';
import {
  RESERVED_ACTOR_IDS,
  HUMAN_PUBLISH_ROLES,
  HumanActorRequiredError,
  isPublishGrant,
} from './human-actor';
import { SYSTEM_ACTOR } from './system-actor';

describe('RESERVED_ACTOR_IDS', () => {
  it('contains the system sentinel', () => {
    // The single highest-value assertion here: rename SYSTEM_ACTOR.id without
    // updating the reserved set and this fails, rather than the cron quietly
    // becoming able to publish.
    expect(RESERVED_ACTOR_IDS.has(SYSTEM_ACTOR.id)).toBe(true);
  });

  it('covers the other non-human id shapes and the empty string', () => {
    for (const id of ['cron', 'worker', 'scheduler', 'anonymous', 'inngest', '']) {
      expect(RESERVED_ACTOR_IDS.has(id), `${id} should be reserved`).toBe(true);
    }
  });
});

describe('HUMAN_PUBLISH_ROLES', () => {
  it('matches the shipped authorize() matrix (ADMIN only)', () => {
    // If this widens, packages/core/src/auth/authorize.ts and its test must
    // change in the same commit — never this list alone.
    expect([...HUMAN_PUBLISH_ROLES]).toEqual(['ADMIN']);
  });
});

describe('isPublishGrant', () => {
  it('rejects hand-rolled objects', () => {
    // The brand is a module-private symbol, so a grant cannot be forged from
    // outside this module however closely it mimics the shape.
    expect(isPublishGrant({})).toBe(false);
    expect(isPublishGrant(null)).toBe(false);
    expect(isPublishGrant(undefined)).toBe(false);
    expect(
      isPublishGrant({
        actor: { id: 'usr_1', role: 'ADMIN' },
        articleId: 'art_1',
        reviewId: 'rev_1',
        origin: 'approval_event',
        verifiedAt: new Date(),
      }),
    ).toBe(false);
  });
});

describe('HumanActorRequiredError', () => {
  it('carries the denial reason without leaking identity into the message', () => {
    const error = new HumanActorRequiredError('reserved_actor_id', 'art_1', 'approval_event');
    expect(error.reason).toBe('reserved_actor_id');
    expect(error.articleId).toBe('art_1');
    expect(error.origin).toBe('approval_event');
    expect(error.name).toBe('HumanActorRequiredError');
    // Messages reach logs; they must not carry emails, names, or roles.
    expect(error.message).not.toMatch(/@/);
    expect(error.message).toContain('reserved_actor_id');
  });
});
