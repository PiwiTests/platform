import { describe, test, expect } from 'vitest';
import {
  buildNotificationDedupeKey,
  passesSubscriptionFilters,
  computePerfBaseline,
  notificationTargetPath,
  PERF_BASELINE_MIN_RUNS,
  type RunFinishedPayload,
  type ClusterNewPayload,
  type DiagnosisCompletedPayload,
} from '#shared/notification-events';

const runPayload: RunFinishedPayload = {
  runId: 7,
  projectId: 2,
  projectName: 'my-project',
  status: 'failed',
  totalTests: 10,
  failedTests: 2,
  passedTests: 8,
  flakyTests: 1,
  flakinessRate: 0.1,
};

const clusterPayload = (clusterId: number): ClusterNewPayload => ({
  clusterId,
  projectId: 2,
  projectName: 'my-project',
  signature: 'TimeoutError',
  runId: 7,
});

describe('buildNotificationDedupeKey', () => {
  test('run events dedupe on the run', () => {
    const a = buildNotificationDedupeKey('run.failed', runPayload, 1);
    const b = buildNotificationDedupeKey('run.failed', runPayload, 1);
    expect(a).toBe(b);
    expect(a).toContain('r7');
  });

  test('two new clusters from the same run get distinct keys per channel', () => {
    const a = buildNotificationDedupeKey('cluster.new', clusterPayload(11), 1);
    const b = buildNotificationDedupeKey('cluster.new', clusterPayload(12), 1);
    expect(a).not.toBe(b);
  });

  test('the same cluster stays deduped across channels but not across clusters', () => {
    const sameCluster = buildNotificationDedupeKey('cluster.new', clusterPayload(11), 1);
    expect(buildNotificationDedupeKey('cluster.new', clusterPayload(11), 1)).toBe(sameCluster);
    expect(buildNotificationDedupeKey('cluster.new', clusterPayload(11), 2)).not.toBe(sameCluster);
  });

  test('re-diagnoses of one cluster get distinct keys via completedAt', () => {
    const diag = (completedAt: number): DiagnosisCompletedPayload => ({ clusterId: 5, projectId: 2, completedAt });
    const first = buildNotificationDedupeKey('diagnosis.completed', diag(1000), 1);
    const second = buildNotificationDedupeKey('diagnosis.completed', diag(2000), 1);
    expect(first).not.toBe(second);
    expect(buildNotificationDedupeKey('diagnosis.completed', diag(1000), 1)).toBe(first);
  });

  test('run events on different channels get distinct keys', () => {
    expect(buildNotificationDedupeKey('run.finished', runPayload, 1)).not.toBe(
      buildNotificationDedupeKey('run.finished', runPayload, 2),
    );
  });
});

describe('passesSubscriptionFilters', () => {
  test('no filters passes everything', () => {
    expect(passesSubscriptionFilters(null, 'run.failed', runPayload)).toBe(true);
    expect(passesSubscriptionFilters(undefined, 'run.failed', runPayload)).toBe(true);
  });

  test('branch filter applies to run events only', () => {
    const payload = { ...runPayload, branch: 'feature-x' };
    expect(passesSubscriptionFilters({ branches: ['main'] }, 'run.failed', payload)).toBe(false);
    expect(passesSubscriptionFilters({ branches: ['feature-x'] }, 'run.failed', payload)).toBe(true);
  });

  test('defaultBranchOnly drops non-default-branch runs', () => {
    expect(passesSubscriptionFilters({ defaultBranchOnly: true }, 'run.failed', runPayload)).toBe(false);
    expect(
      passesSubscriptionFilters({ defaultBranchOnly: true }, 'run.failed', { ...runPayload, isDefaultBranch: true }),
    ).toBe(true);
  });

  test('owner filter requires an owned failing test', () => {
    expect(passesSubscriptionFilters({ owners: ['team-a'] }, 'run.failed', runPayload)).toBe(false);
    expect(
      passesSubscriptionFilters({ owners: ['team-a'] }, 'run.failed', { ...runPayload, owners: ['team-a', 'team-b'] }),
    ).toBe(true);
  });

  test('flakinessThreshold gates flakiness.spike on the rate', () => {
    expect(passesSubscriptionFilters({ flakinessThreshold: 0.2 }, 'flakiness.spike', runPayload)).toBe(false);
    expect(passesSubscriptionFilters({ flakinessThreshold: 0.05 }, 'flakiness.spike', runPayload)).toBe(true);
  });

  test('perfRegressionPct gates perf.regression on the slowdown', () => {
    const regressed = { ...runPayload, regressionPct: 30 };
    expect(passesSubscriptionFilters({ perfRegressionPct: 50 }, 'perf.regression', regressed)).toBe(false);
    expect(passesSubscriptionFilters({ perfRegressionPct: 25 }, 'perf.regression', regressed)).toBe(true);
  });
});

describe('computePerfBaseline', () => {
  test('returns null below the minimum prior-run count', () => {
    const tooFew = Array.from({ length: PERF_BASELINE_MIN_RUNS - 1 }, () => 1000);
    expect(computePerfBaseline(tooFew, 2000)).toBeNull();
  });

  test('returns null for a non-positive current duration', () => {
    expect(computePerfBaseline([1000, 1000, 1000], 0)).toBeNull();
  });

  test('ignores non-positive prior durations', () => {
    expect(computePerfBaseline([0, -5, 1000], 2000)).toBeNull();
  });

  test('uses the median of prior durations', () => {
    const result = computePerfBaseline([1000, 4000, 1200], 1800);
    expect(result).not.toBeNull();
    expect(result!.baselineDurationMs).toBe(1200);
    expect(result!.regressionPct).toBeCloseTo(50);
  });

  test('averages the two middle values for an even count', () => {
    const result = computePerfBaseline([1000, 2000], 3000);
    expect(result!.baselineDurationMs).toBe(1500);
    expect(result!.regressionPct).toBeCloseTo(100);
  });

  test('reports a negative percentage for a faster run', () => {
    const result = computePerfBaseline([1000, 1000, 1000], 800);
    expect(result!.regressionPct).toBeCloseTo(-20);
  });
});

describe('notificationTargetPath', () => {
  test('run events link to the run', () => {
    expect(notificationTargetPath('run.failed', runPayload)).toBe('/test-runs/7');
  });

  test('cluster and diagnosis events link to the cluster', () => {
    expect(notificationTargetPath('cluster.new', clusterPayload(11))).toBe('/failure-clusters/11');
    expect(notificationTargetPath('diagnosis.completed', { clusterId: 5, projectId: 2 })).toBe('/failure-clusters/5');
  });
});
