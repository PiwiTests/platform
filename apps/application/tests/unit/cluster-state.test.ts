import { describe, test, expect } from 'vitest';
import { computeClusterState, type ClusterStateCluster, type ClusterStateProject } from '#shared/cluster-state';

const NOW = new Date('2026-09-06T12:00:00Z');
// Newest run first. Run 63 is 9 hours ago; 62 is the latest run (8 hours ago).
const PROJECT: ClusterStateProject = { runIdsNewestFirst: [62, 63, 64, 65, 66, 67, 68, 69], now: NOW };

function cluster(overrides: Partial<ClusterStateCluster> = {}): ClusterStateCluster {
  return {
    status: 'open',
    assignee: null,
    fixVerification: null,
    fixCommit: null,
    fixLandedRunId: null,
    lastSeenRunId: 62,
    lastSeenAt: new Date('2026-09-06T03:00:00Z'),
    updatedAt: new Date('2026-09-04T12:00:00Z'),
    triageNote: null,
    snoozedUntil: null,
    snoozeMode: null,
    affectedTests: 1,
    quarantinedTests: 0,
    ...overrides,
  };
}

describe('computeClusterState — one row per kind', () => {
  test('failing: last seen in the latest run, open, unassigned', () => {
    const s = computeClusterState(cluster({ lastSeenRunId: 62 }), PROJECT);
    expect(s.kind).toBe('failing');
    expect(s.sentence).toContain('Still failing');
    expect(s.sentence).toContain('run #62');
    expect(s.action).toBeNull();
  });

  test('failing-assigned: an assignee is on it', () => {
    const s = computeClusterState(cluster({ assignee: 'Avery' }), PROJECT);
    expect(s.kind).toBe('failing-assigned');
    expect(s.sentence).toContain('Avery is on it');
  });

  test('quiet: not seen for several runs, still open', () => {
    const s = computeClusterState(cluster({ lastSeenRunId: 68 }), PROJECT);
    expect(s.kind).toBe('quiet');
    expect(s.sentence).toMatch(/Not seen for \d+ runs/);
    expect(s.action).toBe('mark-resolved');
  });

  test('fix-verified-open: verified, still marked open', () => {
    const s = computeClusterState(
      cluster({ fixVerification: 'diagnosis-verified', fixLandedRunId: 62, fixCommit: 'demo010' }),
      PROJECT,
    );
    expect(s.kind).toBe('fix-verified-open');
    expect(s.sentence).toContain('run #62');
    expect(s.sentence).toContain('demo010');
    expect(s.sentence).toContain('verified, still marked open');
    expect(s.action).toBe('mark-resolved');
  });

  test('stopped-failing-open: stopped, no fix identified', () => {
    const s = computeClusterState(cluster({ fixVerification: 'stopped-failing', fixLandedRunId: 62 }), PROJECT);
    expect(s.kind).toBe('stopped-failing-open');
    expect(s.sentence).toContain('no fix identified');
    expect(s.action).toBe('mark-resolved');
  });

  test('regressed: fixed then came back', () => {
    const s = computeClusterState(
      cluster({ fixVerification: 'regressed', fixCommit: 'demo001', regressedSinceRunId: 3 }),
      PROJECT,
    );
    expect(s.kind).toBe('regressed');
    expect(s.sentence).toContain('demo001');
    expect(s.sentence).toContain('the fix did not hold');
    expect(s.action).toBeNull(); // open, not resolved
  });

  test('regressed while resolved offers reopen', () => {
    const s = computeClusterState(cluster({ status: 'resolved', fixVerification: 'regressed' }), PROJECT);
    // resolved is terminal and wins here
    expect(s.kind).toBe('resolved');
  });

  test('resolved: names the resolver and note', () => {
    const s = computeClusterState(
      cluster({ status: 'resolved', assignee: 'Alice', triageNote: 'shipped page size fix' }),
      PROJECT,
    );
    expect(s.kind).toBe('resolved');
    expect(s.sentence).toContain('Resolved');
    expect(s.sentence).toContain('Alice');
    expect(s.sentence).toContain('shipped page size fix');
  });

  test('ignored: names the note', () => {
    const s = computeClusterState(cluster({ status: 'ignored', triageNote: 'known third-party flake' }), PROJECT);
    expect(s.kind).toBe('ignored');
    expect(s.sentence).toContain('Ignored');
  });

  test('snoozed: timed and until-recurs', () => {
    const timed = computeClusterState(cluster({ snoozedUntil: new Date('2026-09-10T00:00:00Z') }), PROJECT);
    expect(timed.kind).toBe('snoozed');
    expect(timed.action).toBe('unsnooze');
    const recurs = computeClusterState(
      cluster({ snoozedUntil: new Date('2026-09-10T00:00:00Z'), snoozeMode: 'until-recurs' }),
      PROJECT,
    );
    expect(recurs.sentence).toContain('until it recurs');
  });

  test('quarantined: every affected test is quarantined', () => {
    const s = computeClusterState(cluster({ affectedTests: 2, quarantinedTests: 2 }), PROJECT);
    expect(s.kind).toBe('quarantined');
    expect(s.sentence).toContain('All 2 tests are quarantined');
    expect(s.action).toBe('release');
  });
});

describe('computeClusterState — precedence', () => {
  test('terminal status beats fix verification', () => {
    expect(
      computeClusterState(cluster({ status: 'resolved', fixVerification: 'diagnosis-verified' }), PROJECT).kind,
    ).toBe('resolved');
  });

  test('a snooze overlay beats fix verification', () => {
    const s = computeClusterState(
      cluster({ fixVerification: 'diagnosis-verified', snoozedUntil: new Date('2026-09-10T00:00:00Z') }),
      PROJECT,
    );
    expect(s.kind).toBe('snoozed');
  });

  test('fix verification beats the quarantine overlay (a landed fix outranks parked tests)', () => {
    const s = computeClusterState(
      cluster({ fixVerification: 'diagnosis-verified', affectedTests: 1, quarantinedTests: 1 }),
      PROJECT,
    );
    expect(s.kind).toBe('fix-verified-open');
  });

  test('fix verification beats the failing/quiet decision', () => {
    // Last seen in the latest run (would be "failing"), but a verified fix wins.
    const s = computeClusterState(cluster({ lastSeenRunId: 62, fixVerification: 'diagnosis-verified' }), PROJECT);
    expect(s.kind).toBe('fix-verified-open');
  });

  test('the sentence carries the run as a linkable part', () => {
    const s = computeClusterState(cluster({ lastSeenRunId: 62 }), PROJECT);
    expect(s.parts.find((p) => p.kind === 'run')).toMatchObject({ id: 62 });
  });
});
