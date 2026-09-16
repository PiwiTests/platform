import { describe, test, expect } from 'vitest';
import { buildSituation, type SituationInput } from '#shared/situation';
import type { FailureVerdict } from '#shared/failure-verdict';

const NOW = new Date('2026-09-06T12:00:00Z');
const ONE_DAY_AGO = new Date('2026-09-05T12:00:00Z');

function since(overrides: Partial<FailureVerdict['since']> = {}): FailureVerdict['since'] {
  return {
    firstFailingRunId: 4,
    firstFailingAt: ONE_DAY_AGO,
    isFirstFailure: true,
    commit: { sha: 'a1b2c3d4e5', shortSha: 'a1b2c3d', author: 'Alice Chen', message: null, branch: 'main' },
    fixedBefore: null,
    ...overrides,
  };
}

function base(overrides: Partial<SituationInput> = {}): SituationInput {
  return {
    why: 'new-regression',
    since: since(),
    cluster: { id: 1, name: 'checkout timeout', otherTestsInRun: 1 },
    owner: { name: '@checkout-team', source: 'annotation' },
    clusterStatus: 'open',
    assignee: null,
    now: NOW,
    ...overrides,
  };
}

describe('buildSituation — clause by clause', () => {
  test('the exceptional why leads the sentence', () => {
    expect(buildSituation(base()).text).toMatch(/^New regression — /);
  });

  test('no why: the sentence starts with the since clause, capitalized', () => {
    expect(buildSituation(base({ why: null })).text).toMatch(/^First failed in this run/);
  });

  test('first failure says "first failed in this run" with a relative time', () => {
    expect(buildSituation(base()).text).toContain('first failed in this run (1 day ago)');
  });

  test('a later failure says "failing since run #N"', () => {
    const text = buildSituation(base({ since: since({ isFirstFailure: false, firstFailingRunId: 4 }) })).text;
    expect(text).toContain('failing since run #4');
  });

  test('the commit and author appear once', () => {
    const text = buildSituation(base()).text;
    expect(text).toContain('on a1b2c3d by Alice Chen');
    expect(text.match(/a1b2c3d/g)?.length).toBe(1);
  });

  test('the cluster clause names the cluster, its status and unassigned', () => {
    expect(buildSituation(base()).text).toContain('cluster #1 (open, unassigned)');
  });

  test('an assignee replaces "unassigned"', () => {
    expect(buildSituation(base({ assignee: 'Avery' })).text).toContain('cluster #1 (open, assigned to Avery)');
  });

  test('the fixed-before fact rides inside the cluster parenthesis', () => {
    const input = base({
      since: since({ fixedBefore: { commit: 'demo001', commitShort: 'demo001', runId: 3, at: null } }),
    });
    expect(buildSituation(input).text).toContain('fixed once before, the fix did not hold');
  });

  test('the owner closes the sentence', () => {
    expect(buildSituation(base()).text).toMatch(/Owner @checkout-team\.$/);
  });

  test('every clause is omitted when its fact is unknown', () => {
    const input = base({ cluster: null, owner: null, since: since({ commit: null }) });
    const text = buildSituation(input).text;
    expect(text).not.toContain('cluster');
    expect(text).not.toContain('Owner');
    expect(text).not.toContain(' on ');
  });

  test('parts carry the cluster and owner ids for linking', () => {
    const parts = buildSituation(base()).parts;
    expect(parts.find((p) => p.kind === 'cluster')).toMatchObject({ id: 1 });
    expect(parts.find((p) => p.kind === 'owner')).toMatchObject({ text: '@checkout-team' });
    expect(parts.find((p) => p.kind === 'commit')).toMatchObject({ id: 'a1b2c3d4e5', text: 'a1b2c3d' });
  });
});

describe('buildSituation — whole examples', () => {
  test('the plan example', () => {
    const input = base({
      since: since({ fixedBefore: { commit: 'demo001', commitShort: 'demo001', runId: 3, at: null } }),
    });
    expect(buildSituation(input).text).toBe(
      'New regression — first failed in this run (1 day ago) on a1b2c3d by Alice Chen. ' +
        'Same failure in 1 other test → cluster #1 (open, unassigned; fixed once before, the fix did not hold). ' +
        'Owner @checkout-team.',
    );
  });

  test('a plain, unclustered, unowned failure', () => {
    const input = base({ why: null, cluster: null, owner: null });
    expect(buildSituation(input).text).toBe('First failed in this run (1 day ago) on a1b2c3d by Alice Chen.');
  });
});
