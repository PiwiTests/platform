import { describe, it, expect } from 'vitest';
import { clusterStillFailing, isDiagnosisStale, stalenessReason } from '#shared/diagnosis-staleness';

describe('clusterStillFailing', () => {
  it('is false when the fix is verified, stopped failing, or triaged resolved', () => {
    expect(clusterStillFailing({ fixVerification: 'diagnosis-verified', status: 'open' })).toBe(false);
    expect(clusterStillFailing({ fixVerification: 'stopped-failing', status: 'open' })).toBe(false);
    expect(clusterStillFailing({ fixVerification: null, status: 'resolved' })).toBe(false);
  });

  it('is true when the cluster is still failing (including a regression)', () => {
    expect(clusterStillFailing({ fixVerification: null, status: 'open' })).toBe(true);
    expect(clusterStillFailing({ fixVerification: 'regressed', status: 'open' })).toBe(true);
  });
});

describe('isDiagnosisStale', () => {
  const base = { fixVerification: null, status: 'open' };

  it('is stale when the context hash changed and the cluster is still failing', () => {
    expect(isDiagnosisStale({ ...base, storedContextSha: 'a', currentContextSha: 'b' })).toBe(true);
  });

  it('is not stale when the hash is unchanged', () => {
    expect(isDiagnosisStale({ ...base, storedContextSha: 'a', currentContextSha: 'a' })).toBe(false);
  });

  it('is never stale on a fix-verified cluster, even with a changed hash', () => {
    expect(
      isDiagnosisStale({
        storedContextSha: 'a',
        currentContextSha: 'b',
        fixVerification: 'diagnosis-verified',
        status: 'open',
      }),
    ).toBe(false);
  });

  it('is not stale when either hash is missing (no false positives)', () => {
    expect(isDiagnosisStale({ ...base, storedContextSha: null, currentContextSha: 'b' })).toBe(false);
    expect(isDiagnosisStale({ ...base, storedContextSha: 'a', currentContextSha: undefined })).toBe(false);
  });
});

describe('stalenessReason', () => {
  const stale = { storedContextSha: 'a', currentContextSha: 'b', fixVerification: null, status: 'open' };

  it('is null when not stale', () => {
    expect(stalenessReason({ ...stale, currentContextSha: 'a', diagnosedAt: 1, lastSeenAt: 2 })).toBeNull();
  });

  it('reports new occurrences when the cluster was last seen after the diagnosis', () => {
    expect(stalenessReason({ ...stale, diagnosedAt: 1000, lastSeenAt: 2000 })).toBe('occurrences');
  });

  it('reports a changed evidence otherwise', () => {
    expect(stalenessReason({ ...stale, diagnosedAt: 2000, lastSeenAt: 1000 })).toBe('evidence');
    expect(stalenessReason({ ...stale, diagnosedAt: null, lastSeenAt: null })).toBe('evidence');
  });
});
