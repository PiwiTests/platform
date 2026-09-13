import { describe, test, expect } from 'vitest';
import { needsTicket, clusterInQueue, INBOX_QUEUES, type InboxClusterLike } from '../../shared/inbox-queues';
import { computeClusterState } from '../../shared/cluster-state';

const now = new Date('2026-09-13T12:00:00Z');
const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

function cluster(overrides: Partial<InboxClusterLike> = {}): InboxClusterLike {
  return {
    onDefaultBranch: true,
    hasKnownIssue: false,
    firstSeenAt: days(5),
    needsTicketAfterDays: 2,
    ...overrides,
  };
}

describe('needsTicket predicate', () => {
  test('lists an old, untracked, default-branch cluster', () => {
    expect(needsTicket(cluster(), now)).toBe(true);
  });

  test('excludes clusters younger than the threshold', () => {
    expect(needsTicket(cluster({ firstSeenAt: days(1) }), now)).toBe(false);
  });

  test('excludes clusters not on the default branch', () => {
    expect(needsTicket(cluster({ onDefaultBranch: false }), now)).toBe(false);
  });

  test('excludes clusters that already have a ticket', () => {
    expect(needsTicket(cluster({ hasKnownIssue: true }), now)).toBe(false);
  });

  test('honors a custom age threshold from the binding', () => {
    expect(needsTicket(cluster({ firstSeenAt: days(3), needsTicketAfterDays: 7 }), now)).toBe(false);
    expect(needsTicket(cluster({ firstSeenAt: days(8), needsTicketAfterDays: 7 }), now)).toBe(true);
  });

  test('is wired into the queue registry and predicate', () => {
    expect(INBOX_QUEUES).toContain('needs-ticket');
    expect(clusterInQueue(cluster(), 'needs-ticket', { now })).toBe(true);
    expect(clusterInQueue(cluster({ hasKnownIssue: true }), 'needs-ticket', { now })).toBe(false);
  });
});

describe('cluster-state ticket-done reconcile', () => {
  const base = {
    status: 'open',
    lastSeenRunId: 10,
    affectedTests: 1,
    quarantinedTests: 0,
    lastSeenAt: days(20),
  };
  const project = { runIdsNewestFirst: [30, 20, 10], now };

  test('offers to mark resolved when the ticket is Done', () => {
    const state = computeClusterState({ ...base, knownIssue: { key: 'PROJ-123', statusCategory: 'done' } }, project);
    expect(state.kind).toBe('ticket-done');
    expect(state.action).toBe('mark-resolved');
    expect(state.sentence).toContain('PROJ-123 is Done');
  });

  test('a non-done ticket does not trigger the reconcile', () => {
    const state = computeClusterState(
      { ...base, knownIssue: { key: 'PROJ-123', statusCategory: 'indeterminate' } },
      project,
    );
    expect(state.kind).not.toBe('ticket-done');
  });
});
