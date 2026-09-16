import { describe, it, expect } from 'vitest';
import { resolveUnrunReason, linkBlockedTests, type BlockableCase } from '../src/status-classify.js';

describe('resolveUnrunReason', () => {
  it('reads a timed-out run as the global timeout', () => {
    expect(resolveUnrunReason('timedout', { maxFailures: 0, failures: 3 })).toBe('global-timeout');
    // A reached failure budget never overrides the global timeout.
    expect(resolveUnrunReason('timedout', { maxFailures: 2, failures: 5 })).toBe('global-timeout');
  });

  it('reads an interrupted run that hit its failure budget as max-failures', () => {
    expect(resolveUnrunReason('interrupted', { maxFailures: 3, failures: 3 })).toBe('max-failures');
    expect(resolveUnrunReason('interrupted', { maxFailures: 3, failures: 4 })).toBe('max-failures');
  });

  it('falls back to a generic interruption', () => {
    expect(resolveUnrunReason('interrupted', { maxFailures: 0, failures: 1 })).toBe('interrupted');
    expect(resolveUnrunReason('interrupted', { maxFailures: 5, failures: 2 })).toBe('interrupted');
    expect(resolveUnrunReason(undefined, { maxFailures: 0, failures: 0 })).toBe('interrupted');
  });
});

describe('linkBlockedTests', () => {
  it('links a cascade to the failing sibling in the same serial group', () => {
    const cases: BlockableCase[] = [
      { location: 'auth.spec.ts:3:1', suitePath: ['Login'], status: 'failed' },
      { location: 'auth.spec.ts:7:1', suitePath: ['Login'], status: 'didnotrun', didNotRunReason: 'previous-failure' },
      { location: 'auth.spec.ts:11:1', suitePath: ['Login'], status: 'didnotrun', didNotRunReason: 'previous-failure' },
    ];
    linkBlockedTests(cases);
    expect(cases[1]!.blockedBy).toBe('auth.spec.ts:3:1');
    expect(cases[2]!.blockedBy).toBe('auth.spec.ts:3:1');
  });

  it('matches a timed-out test as the blocker', () => {
    const cases: BlockableCase[] = [
      { location: 'flow.spec.ts:3:1', suitePath: ['Flow'], status: 'timedOut' },
      { location: 'flow.spec.ts:7:1', suitePath: ['Flow'], status: 'didnotrun', didNotRunReason: 'previous-failure' },
    ];
    linkBlockedTests(cases);
    expect(cases[1]!.blockedBy).toBe('flow.spec.ts:3:1');
  });

  it('links a nested serial describe to the parent-group failure via the deepest shared prefix', () => {
    const cases: BlockableCase[] = [
      { location: 'a.spec.ts:3:1', suitePath: ['Outer'], status: 'failed' },
      {
        location: 'a.spec.ts:9:1',
        suitePath: ['Outer', 'Inner'],
        status: 'didnotrun',
        didNotRunReason: 'previous-failure',
      },
    ];
    linkBlockedTests(cases);
    expect(cases[1]!.blockedBy).toBe('a.spec.ts:3:1');
  });

  it('leaves blockedBy null when no failure shares the file', () => {
    const cases: BlockableCase[] = [
      { location: 'other.spec.ts:3:1', suitePath: ['X'], status: 'failed' },
      { location: 'a.spec.ts:9:1', suitePath: ['A'], status: 'didnotrun', didNotRunReason: 'previous-failure' },
    ];
    linkBlockedTests(cases);
    expect(cases[1]!.blockedBy).toBeUndefined();
  });

  it('ignores non-cascade did-not-run cases (global timeout, max failures)', () => {
    const cases: BlockableCase[] = [
      { location: 'a.spec.ts:3:1', suitePath: ['A'], status: 'failed' },
      { location: 'a.spec.ts:9:1', suitePath: ['A'], status: 'didnotrun', didNotRunReason: 'global-timeout' },
    ];
    linkBlockedTests(cases);
    expect(cases[1]!.blockedBy).toBeUndefined();
  });
});
