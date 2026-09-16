import { describe, test, expect } from 'vitest';
import { computeNextStep, type NextStepInput } from '#shared/next-step';

function step(overrides: Partial<NextStepInput> = {}) {
  return computeNextStep({ clusterId: 10, executionId: 100, ...overrides });
}

describe('computeNextStep — one row per rule', () => {
  test('1: a did-not-run cascade opens the blocking failure', () => {
    const s = step({ status: 'didnotrun', blockedByCase: { id: 7, title: 'login' } });
    expect(s.kind).toBe('open-blocker');
    expect(s.primary.payload).toEqual({ executionId: 7 });
  });

  test('2: a verified fix that held, still open → mark resolved', () => {
    const s = step({ fixVerification: 'diagnosis-verified', clusterStatus: 'open', fixLandedRunId: 62 });
    expect(s.kind).toBe('mark-resolved');
    expect(s.title).toContain('run #62');
  });

  test('3: a locator-resolution failure with a healing recommendation', () => {
    const s = step({ hasHealingRecommendation: true });
    expect(s.kind).toBe('replace-locator');
  });

  test('4: a completed diagnosis whose patch applies cleanly', () => {
    const s = step({
      diagnosisCompleted: true,
      patchAppliesCleanly: true,
      patchFile: 'src/server/users.ts',
      diagnosisSummary: 'PAGE_SIZE 50 → 25',
    });
    expect(s.kind).toBe('apply-patch');
    expect(s.title).toContain('src/server/users.ts');
    // The summary is the "Most likely" line's job; the step names only the work.
    expect(s.title).not.toContain('PAGE_SIZE 50 → 25');
  });

  test('5: a completed diagnosis whose patch is stale or absent', () => {
    const s = step({ diagnosisCompleted: true, patchAppliesCleanly: false, diagnosisSummary: 'race on render' });
    expect(s.kind).toBe('follow-diagnosis');
  });

  test('6: a regressed fix → see what changed', () => {
    const s = step({ fixVerification: 'regressed', fixCommit: 'demo001' });
    expect(s.kind).toBe('see-what-changed');
    expect(s.title).toContain('demo001');
  });

  test('7: passed-on-retry → compare attempts', () => {
    expect(step({ why: 'passed-on-retry' }).kind).toBe('compare-attempts');
    expect(step({ why: 'new-flaky' }).kind).toBe('compare-attempts');
  });

  test('8: a crash with a CI re-run configured', () => {
    expect(step({ errorKind: 'crash', ciRerunAvailable: true }).kind).toBe('rerun-in-ci');
    expect(step({ errorKind: 'navigation', ciRerunAvailable: true }).kind).toBe('rerun-in-ci');
  });

  test('9: AI configured and no diagnosis → diagnose', () => {
    expect(step({ aiConfigured: true }).kind).toBe('diagnose');
  });

  test('10: otherwise reproduce locally', () => {
    expect(step({}).kind).toBe('reproduce');
  });
});

describe('computeNextStep — precedence between rows', () => {
  test('a clean patch beats mark-resolved (a truly-landed fix leaves a stale patch)', () => {
    // The #10 case: verified + open, yet the diagnosis patch still applies cleanly.
    const s = step({
      fixVerification: 'diagnosis-verified',
      clusterStatus: 'open',
      diagnosisCompleted: true,
      patchAppliesCleanly: true,
    });
    expect(s.kind).toBe('apply-patch');
  });

  test('the blocker row wins over everything', () => {
    const s = step({
      status: 'didnotrun',
      blockedByCase: { id: 7 },
      hasHealingRecommendation: true,
      diagnosisCompleted: true,
      patchAppliesCleanly: true,
    });
    expect(s.kind).toBe('open-blocker');
  });

  test('replace-locator wins over apply-patch when both are present', () => {
    const s = step({ hasHealingRecommendation: true, diagnosisCompleted: true, patchAppliesCleanly: true });
    expect(s.kind).toBe('replace-locator');
  });

  test('apply-patch wins over see-what-changed on a regressed cluster with a clean patch', () => {
    const s = step({ fixVerification: 'regressed', diagnosisCompleted: true, patchAppliesCleanly: true });
    expect(s.kind).toBe('apply-patch');
  });

  test('crash without a CI re-run falls through to diagnose or reproduce, not rerun-in-ci', () => {
    expect(step({ errorKind: 'crash', ciRerunAvailable: false }).kind).not.toBe('rerun-in-ci');
  });

  test('every row returns exactly one primary action', () => {
    for (const input of [
      { status: 'didnotrun', blockedByCase: { id: 1 } },
      { fixVerification: 'diagnosis-verified', clusterStatus: 'open' },
      { hasHealingRecommendation: true },
      { diagnosisCompleted: true, patchAppliesCleanly: true },
      { diagnosisCompleted: true },
      { fixVerification: 'regressed' },
      { why: 'new-flaky' as const },
      { errorKind: 'crash' as const, ciRerunAvailable: true },
      { aiConfigured: true },
      {},
    ]) {
      const s = computeNextStep(input);
      expect(s.primary).toBeTruthy();
      expect(typeof s.primary.action).toBe('string');
    }
  });
});
