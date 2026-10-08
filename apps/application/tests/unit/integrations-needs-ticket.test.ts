import { describe, test, expect } from 'vitest';
import { needsTicket, clusterInQueue, INBOX_QUEUES, type InboxClusterLike } from '../../shared/inbox-queues';
import { computeClusterState, failureGoesOn, ticketReconcileKey } from '../../shared/cluster-state';

const now = new Date('2026-09-13T12:00:00Z');
const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
const run = (id: number, startTime: Date | string | number) => ({ id, startTime });

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
  // The failure stopped: it was last seen before the latest finished run.
  const project = { runIdsNewestFirst: [30, 20, 10], failureGoesOn: false, now };

  test('offers to mark resolved when the ticket is Done', () => {
    const state = computeClusterState({ ...base, knownIssue: { key: 'PROJ-123', statusCategory: 'done' } }, project);
    expect(state.kind).toBe('ticket-done');
    expect(state.action).toBe('mark-resolved');
    expect(state.sentence).toContain('PROJ-123 is Done');
  });

  test('a regression under a Done ticket keeps the regression, with no reconcile', () => {
    const state = computeClusterState(
      {
        ...base,
        fixVerification: 'regressed',
        fixCommit: 'abc1234def',
        regressedSinceRunId: 10,
        knownIssue: { key: 'PROJ-123', statusCategory: 'done' },
      },
      project,
    );
    expect(state.kind).toBe('regressed');
    expect(state.action).toBeNull();
    expect(state.sentence).toContain('the fix did not hold');
  });

  test('a cluster that failed in the latest run keeps failing under a Done ticket', () => {
    const state = computeClusterState(
      { ...base, lastSeenRunId: 30, lastSeenAt: days(0), knownIssue: { key: 'PROJ-123', statusCategory: 'done' } },
      { ...project, failureGoesOn: true },
    );
    expect(state.kind).toBe('failing');
    expect(state.action).toBeNull();
    expect(state.sentence).toMatch(/^Still failing/);
  });

  test('a run still in progress never counts as one the failure skipped', () => {
    // Run 40 is running; the cluster failed in run 30, the newest finished one.
    const done = { key: 'PROJ-123', statusCategory: 'done' };
    const state = computeClusterState(
      { ...base, lastSeenRunId: 30, lastSeenAt: days(0), knownIssue: done },
      { runIdsNewestFirst: [40, 30, 20, 10], failureGoesOn: failureGoesOn(run(30, days(1)), run(30, days(1))), now },
    );
    expect(state.kind).not.toBe('ticket-done');
    expect(state.action).not.toBe('mark-resolved');

    // Once run 40 finished without the failure, the reconcile is offered.
    const after = computeClusterState(
      { ...base, lastSeenRunId: 30, lastSeenAt: days(1), knownIssue: done },
      { runIdsNewestFirst: [40, 30, 20, 10], failureGoesOn: failureGoesOn(run(30, days(1)), run(40, days(0))), now },
    );
    expect(after.kind).toBe('ticket-done');
  });

  test('with no word on the failure, a Done ticket is not reconciled', () => {
    const state = computeClusterState(
      { ...base, knownIssue: { key: 'PROJ-123', statusCategory: 'done' } },
      { runIdsNewestFirst: [30, 20, 10], now },
    );
    expect(state.kind).not.toBe('ticket-done');
  });

  test('a non-done ticket does not trigger the reconcile', () => {
    const state = computeClusterState(
      { ...base, knownIssue: { key: 'PROJ-123', statusCategory: 'indeterminate' } },
      project,
    );
    expect(state.kind).not.toBe('ticket-done');
  });
});

describe('failureGoesOn', () => {
  test('the failure goes on when it was seen in the latest finished run or a later one', () => {
    expect(failureGoesOn(run(30, days(1)), run(30, days(1)))).toBe(true);
    expect(failureGoesOn(run(40, days(0)), run(30, days(1)))).toBe(true);
  });

  test('the failure stopped when the latest finished run started after it was last seen', () => {
    expect(failureGoesOn(run(20, days(2)), run(30, days(1)))).toBe(false);
  });

  test('two runs that started in the same second are ordered by id', () => {
    const second = days(1);
    expect(failureGoesOn(run(30, second), run(31, second))).toBe(false);
    expect(failureGoesOn(run(31, second), run(30, second))).toBe(true);
  });

  test('with no finished run yet, the failure goes on', () => {
    expect(failureGoesOn(run(20, days(2)), null)).toBe(true);
  });

  test('a cluster whose last-seen run is gone has stopped once a run finished', () => {
    expect(failureGoesOn(null, run(30, days(1)))).toBe(false);
  });

  test('reads start times as dates, ISO strings or epoch milliseconds', () => {
    expect(failureGoesOn(run(40, days(0).toISOString()), run(30, days(1).getTime()))).toBe(true);
    expect(failureGoesOn(run(20, days(2).getTime()), run(30, days(1).toISOString()))).toBe(false);
  });
});

describe('ticketReconcileKey', () => {
  const done = { key: 'PROJ-123', statusCategory: 'done' };
  const open = { status: 'open', knownIssue: done };

  test('a Done ticket on a failure that stopped is reconciled', () => {
    expect(ticketReconcileKey(open, { failureGoesOn: false, now })).toBe('PROJ-123');
  });

  test('a Done ticket on a failure that goes on is not', () => {
    expect(ticketReconcileKey(open, { failureGoesOn: true, now })).toBeNull();
  });

  test('a snoozed cluster with a Done ticket is not, while the snooze lasts', () => {
    const snoozed = { ...open, snoozedUntil: new Date(now.getTime() + 86_400_000), snoozeMode: 'until' };
    expect(ticketReconcileKey(snoozed, { failureGoesOn: false, now })).toBeNull();
    const expired = { ...open, snoozedUntil: days(1), snoozeMode: 'until' };
    expect(ticketReconcileKey(expired, { failureGoesOn: false, now })).toBe('PROJ-123');
  });

  test('a regressed fix under a Done ticket is not', () => {
    expect(ticketReconcileKey({ ...open, fixVerification: 'regressed' }, { failureGoesOn: false, now })).toBeNull();
  });

  test('a resolved cluster or a ticket that is not Done is not', () => {
    expect(ticketReconcileKey({ ...open, status: 'resolved' }, { failureGoesOn: false, now })).toBeNull();
    const inProgress = { status: 'open', knownIssue: { key: 'PROJ-123', statusCategory: 'indeterminate' } };
    expect(ticketReconcileKey(inProgress, { failureGoesOn: false, now })).toBeNull();
    expect(ticketReconcileKey({ status: 'open', knownIssue: null }, { failureGoesOn: false, now })).toBeNull();
  });

  test('the cluster state offers the reconcile exactly when the key is set', () => {
    const cluster = { ...open, lastSeenRunId: 10, affectedTests: 1, quarantinedTests: 0, lastSeenAt: days(20) };
    for (const goesOn of [true, false]) {
      const state = computeClusterState(cluster, { runIdsNewestFirst: [30, 20, 10], failureGoesOn: goesOn, now });
      const key = ticketReconcileKey(cluster, { failureGoesOn: goesOn, now });
      expect(state.kind === 'ticket-done').toBe(key != null);
    }
  });
});
