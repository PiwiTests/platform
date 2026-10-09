import { describe, test, expect } from 'vitest';
import type { DiagnosisContextCoverage } from '~~/types/api';
import { describeScmStatus } from '~/utils/scm-status';

type Scm = NonNullable<DiagnosisContextCoverage['scm']>;

const scm = (over: Partial<Scm> = {}): Scm => ({
  hasLastGreen: true,
  hasCommitRange: true,
  baseCommitUsed: null,
  provider: 'github',
  commitsCount: 0,
  filesCount: 0,
  patchedFilesCount: 0,
  patchesOmitted: false,
  patchesTruncated: false,
  baselineKind: 'run-green',
  error: null,
  repositoryUrl: 'https://github.com/acme/shop',
  range: { from: 'a1b2c3d', to: 'e4f5a6b' },
  compareUrl: 'https://github.com/acme/shop/compare/a1b2c3d...e4f5a6b',
  gitCommand: 'git log --oneline a1b2c3d..e4f5a6b',
  hasToken: true,
  ...over,
});

describe('describeScmStatus', () => {
  test('without coverage there is nothing to act on', () => {
    expect(describeScmStatus(null)).toMatchObject({ kind: 'unavailable', compare: null, gitCommand: null });
  });

  test('the same commit on both sides points away from the code', () => {
    const status = describeScmStatus(
      scm({ range: { from: 'a1b2c3d', to: 'a1b2c3d' }, compareUrl: null, gitCommand: null }),
    );
    expect(status.kind).toBe('same-commit');
    expect(status.text).toBe('Same commit as the last passing run (a1b2c3d)');
    expect(status.detail).toContain('not in the code');
  });

  test('the per-test baseline names the test’s own last pass', () => {
    const status = describeScmStatus(
      scm({ hasLastGreen: false, baselineKind: 'test-green', range: { from: 'a1b2c3d', to: 'a1b2c3d' } }),
    );
    expect(status.text).toBe('Same commit as the last run this test passed in (a1b2c3d)');
  });

  test('no passing run and no range: pick a baseline', () => {
    const status = describeScmStatus(
      scm({ hasLastGreen: false, baselineKind: undefined, range: null, compareUrl: null, gitCommand: null }),
    );
    expect(status.kind).toBe('no-baseline');
    expect(status.detail).toContain('pick the last commit');
  });

  test('a passing run without commits says where the commit comes from', () => {
    const status = describeScmStatus(scm({ hasCommitRange: false, range: null, compareUrl: null, gitCommand: null }));
    expect(status.kind).toBe('no-commit');
    expect(status.detail).toContain('Git checkout');
  });

  test('a range without a repository still offers the local git log', () => {
    const status = describeScmStatus(scm({ provider: null, repositoryUrl: null, compareUrl: null }));
    expect(status.kind).toBe('no-repository');
    expect(status.text).toBe('a1b2c3d..e4f5a6b since the last passing run');
    expect(status.detail).toContain('origin remote');
    expect(status.gitCommand).toBe('git log --oneline a1b2c3d..e4f5a6b');
    expect(status.compare).toBeNull();
  });

  test('an unknown host is named, with the hosts Piwi reads', () => {
    const status = describeScmStatus(
      scm({ provider: null, repositoryUrl: 'https://git.acme.internal/shop', compareUrl: null }),
    );
    expect(status.kind).toBe('unsupported-host');
    expect(status.detail).toBe('git.acme.internal is not a host Piwi reads (GitHub, GitLab and Bitbucket are)');
  });

  test('a failed fetch without a token asks for one and keeps the compare link', () => {
    const status = describeScmStatus(scm({ hasToken: false, error: 'GitHub API 404: Not Found' }));
    expect(status).toMatchObject({
      kind: 'fetch-failed',
      needsToken: true,
      error: 'GitHub API 404: Not Found',
      compare: { url: 'https://github.com/acme/shop/compare/a1b2c3d...e4f5a6b', label: 'Compare on GitHub' },
    });
    expect(status.detail).toBe('GitHub did not return the changes: a private repository needs an access token');
  });

  test('a range the desktop app’s linked clone lacks asks to fetch it there first', () => {
    const status = describeScmStatus(scm({ hasToken: false, localGit: true }));
    expect(status).toMatchObject({ kind: 'fetch-failed', needsToken: true });
    expect(status.detail).toBe(
      'the folder linked to this project does not have these commits: fetch them there, or add an access token',
    );
  });

  test('a failed fetch with a token does not ask for another', () => {
    const status = describeScmStatus(scm({ error: 'GitHub API 502' }));
    expect(status.needsToken).toBe(false);
    expect(status.detail).toBe('GitHub did not return the changes');
    expect(status.help).toBe('cluster.scm-host-error');
  });

  test("the host's error is a clause the line shows", () => {
    expect(describeScmStatus(scm({ error: 'Bad credentials' })).errorText).toBe('GitHub error: Bad credentials');
    expect(describeScmStatus(scm({ hasToken: false, error: 'Not Found' })).errorText).toBe('GitHub error: Not Found');
    expect(describeScmStatus(scm({ hasToken: false })).errorText).toBeNull();
  });

  test('a readable range with no file changed says so', () => {
    const status = describeScmStatus(scm());
    expect(status.kind).toBe('no-changes');
    expect(status.text).toBe('No file changed since the last passing run (a1b2c3d..e4f5a6b)');
  });

  test('a per-test baseline without a repository names the test’s last pass', () => {
    const status = describeScmStatus(
      scm({ hasLastGreen: false, baselineKind: 'test-green', provider: null, repositoryUrl: null, compareUrl: null }),
    );
    expect(status.kind).toBe('no-repository');
    expect(status.text).toBe('a1b2c3d..e4f5a6b since this test last passed');
  });

  test('a picked baseline is named as such', () => {
    const status = describeScmStatus(scm({ baseCommitUsed: 'a1b2c3d', baselineKind: 'manual', provider: null }));
    expect(status.text).toBe('a1b2c3d..e4f5a6b from the baseline you picked');
  });
});

describe('describeScmStatus: setup gaps', () => {
  test.each([
    [
      'no-commit',
      scm({ hasCommitRange: false, range: null, compareUrl: null, gitCommand: null }),
      'cluster.scm-no-commit',
    ],
    ['no-repository', scm({ provider: null, repositoryUrl: null, compareUrl: null }), 'cluster.scm-no-repository'],
    [
      'unsupported-host',
      scm({ provider: null, repositoryUrl: 'https://git.acme.internal/shop', compareUrl: null }),
      'cluster.scm-unsupported-host',
    ],
    ['fetch-failed', scm({ hasToken: false, error: 'GitHub API 404: Not Found' }), 'cluster.scm-fetch-failed'],
    ['fetch-failed', scm({ hasToken: false, localGit: true }), 'cluster.scm-fetch-failed'],
    ['fetch-failed', scm({ hasToken: false }), 'cluster.scm-fetch-failed'],
    ['fetch-failed', scm({ error: 'API rate limit exceeded' }), 'cluster.scm-host-error'],
  ] as const)('%s is a setup gap with its own help', (kind, coverage, help) => {
    expect(describeScmStatus(coverage)).toMatchObject({ kind, setupGap: true, help });
  });

  test('the range and what it is counted from are apart from the text', () => {
    const status = describeScmStatus(scm({ provider: null, repositoryUrl: null, compareUrl: null }));
    expect(status).toMatchObject({ range: 'a1b2c3d..e4f5a6b', origin: 'since the last passing run' });
    const picked = describeScmStatus(scm({ baseCommitUsed: 'a1b2c3d', baselineKind: 'manual', provider: null }));
    expect(picked.origin).toBe('from the baseline you picked');
  });

  test('a gap with no commit recorded has no range', () => {
    const status = describeScmStatus(scm({ hasCommitRange: false, range: null, compareUrl: null, gitCommand: null }));
    expect(status).toMatchObject({ range: null, origin: null });
  });

  test('a failed fetch keeps the compare page for the range', () => {
    const status = describeScmStatus(scm({ hasToken: false, error: 'GitHub API 404: Not Found' }));
    expect(status.compare?.label).toBe('Compare on GitHub');
  });

  test.each([
    ['same-commit', scm({ range: { from: 'a1b2c3d', to: 'a1b2c3d' }, compareUrl: null, gitCommand: null })],
    ['no-baseline', scm({ hasLastGreen: false, baselineKind: undefined, range: null, compareUrl: null })],
    ['no-changes', scm()],
    ['resolved', scm({ commitsCount: 2, filesCount: 3 })],
  ] as const)('%s is a finding, not a setup gap', (kind, coverage) => {
    expect(describeScmStatus(coverage)).toMatchObject({ kind, setupGap: false, help: null });
  });

  test('no coverage is not a setup gap', () => {
    expect(describeScmStatus(null)).toMatchObject({ setupGap: false, help: null, range: null });
  });
});
