import { describe, it, expect } from 'vitest';
import type { ArticleStatus } from '@prisma/client';
import {
  TRANSITIONS,
  actorClassOf,
  findTransitionRule,
  type TransitionRule,
} from './article-transitions';
import { SYSTEM_ACTOR } from '../auth/system-actor';

const ALL_STATUSES: ArticleStatus[] = [
  'QUEUED',
  'BRIEFED',
  'BRIEF_APPROVED',
  'DRAFTING',
  'DRAFTED',
  'QA_PASSED',
  'QA_FAILED',
  'PENDING_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'PUBLISHING',
  'PUBLISHED',
  'PUBLISH_FAILED',
  'REJECTED',
  'ARCHIVED',
];

/** Statuses that mean "a human decided" or "this is live on the CMS". */
const HUMAN_ONLY_TARGETS: ArticleStatus[] = ['APPROVED', 'PUBLISHING', 'PUBLISHED'];

const allRules = (): Array<{ from: ArticleStatus; rule: TransitionRule }> =>
  ALL_STATUSES.flatMap((from) => TRANSITIONS[from].map((rule) => ({ from, rule })));

describe('the transition table', () => {
  it('has an entry for every ArticleStatus', () => {
    // Adding an enum value fails this until someone decides its edges, rather
    // than silently creating a status nothing can legally leave.
    for (const status of ALL_STATUSES) {
      expect(TRANSITIONS[status], `missing transitions for ${status}`).toBeDefined();
    }
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('never lets a system actor reach APPROVED, PUBLISHING, or PUBLISHED', () => {
    // THE security invariant of the autopilot. It must survive future edits to
    // the table by people who have not read the design, so it is asserted as a
    // property over the whole table rather than as a handful of examples.
    for (const { from, rule } of allRules()) {
      if (HUMAN_ONLY_TARGETS.includes(rule.to)) {
        expect(rule.allow, `${from} -> ${rule.to} must not be reachable by a system actor`).toBe(
          'human',
        );
      }
    }
  });

  it('requires a publish grant on every edge into PUBLISHING or PUBLISHED', () => {
    for (const { from, rule } of allRules()) {
      if (rule.to === 'PUBLISHING' || rule.to === 'PUBLISHED') {
        expect(
          rule.requiresPublishGrant,
          `${from} -> ${rule.to} must require a publish grant`,
        ).toBe(true);
      }
    }
  });

  it('lets the failure path record itself without a grant', () => {
    // Otherwise a guard error inside the catch block strands the article in
    // PUBLISHING forever.
    const rule = findTransitionRule('PUBLISHING', 'PUBLISH_FAILED', 'system');
    expect(rule).toBeDefined();
    expect(rule?.requiresPublishGrant).toBeUndefined();
  });

  it('treats ARCHIVED as terminal', () => {
    expect(TRANSITIONS.ARCHIVED).toHaveLength(0);
  });

  it('forbids the transitions that were silently legal before', () => {
    // approveArticle had no from-state validation, so both of these succeeded.
    // Under publish-on-approve, PUBLISHED -> APPROVED would fire a republish.
    expect(findTransitionRule('REJECTED', 'APPROVED', 'human')).toBeUndefined();
    expect(findTransitionRule('PUBLISHED', 'APPROVED', 'human')).toBeUndefined();
  });

  it('allows the real review and publish paths', () => {
    expect(findTransitionRule('PENDING_REVIEW', 'APPROVED', 'human')).toBeDefined();
    expect(findTransitionRule('CHANGES_REQUESTED', 'APPROVED', 'human')).toBeDefined();
    expect(findTransitionRule('APPROVED', 'PUBLISHING', 'human')).toBeDefined();
    expect(findTransitionRule('PUBLISH_FAILED', 'PUBLISHING', 'human')).toBeDefined();
    expect(findTransitionRule('PUBLISHING', 'PUBLISHED', 'human')).toBeDefined();
  });

  it('allows an edit to re-open review from any settled state', () => {
    for (const from of ['APPROVED', 'PUBLISHED', 'PUBLISH_FAILED'] as ArticleStatus[]) {
      expect(findTransitionRule(from, 'PENDING_REVIEW', 'human')).toBeDefined();
    }
  });

  it('denies a system actor the approve edge specifically', () => {
    expect(findTransitionRule('PENDING_REVIEW', 'APPROVED', 'system')).toBeUndefined();
    expect(findTransitionRule('APPROVED', 'PUBLISHING', 'system')).toBeUndefined();
    expect(findTransitionRule('PUBLISHING', 'PUBLISHED', 'system')).toBeUndefined();
  });
});

describe('actorClassOf', () => {
  it('classifies the system sentinel as system and a user as human', () => {
    expect(actorClassOf(SYSTEM_ACTOR)).toBe('system');
    expect(actorClassOf({ id: 'usr_1', role: 'ADMIN' })).toBe('human');
  });
});
