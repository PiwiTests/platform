import { test, expect } from 'vitest';
import { buildRetryCommand } from '../../app/utils/retry-command';

const sampleCases = [
  { filePath: 'tests/login.spec.ts', title: 'should login', line: 10, projectName: 'chromium' },
  { filePath: 'tests/login.spec.ts', title: 'should logout', line: 42, projectName: 'chromium' },
  { filePath: 'tests/checkout.spec.ts', title: 'should checkout', line: 88, projectName: 'firefox' },
];

test('file-line mode — default', () => {
  const cmd = buildRetryCommand(sampleCases);
  expect(cmd).toContain('npx playwright test');
  expect(cmd).toContain('tests/login.spec.ts:10');
  expect(cmd).toContain('tests/login.spec.ts:42');
  expect(cmd).toContain('tests/checkout.spec.ts:88');
  expect(cmd).toContain('--project="chromium"');
  expect(cmd).toContain('--project="firefox"');
  expect(cmd).toContain(' && ');
});

test('file mode — broad', () => {
  const cmd = buildRetryCommand(sampleCases, { mode: 'file' });
  expect(cmd).not.toContain(':10');
  expect(cmd).not.toContain(':42');
  expect(cmd).not.toContain(':88');
  expect(cmd).toContain('tests/login.spec.ts');
  expect(cmd).toContain('tests/checkout.spec.ts');
});

test('grep mode — by title', () => {
  const cmd = buildRetryCommand(sampleCases, { mode: 'grep' });
  expect(cmd).toContain('--grep');
  // Titles are escaped and OR'd
  expect(cmd).toContain('should login');
  expect(cmd).toContain('should logout');
});

test('grep mode — escapes regex meta characters', () => {
  const special = [{ filePath: 'tests/foo.spec.ts', title: 'click .button (plus?)', line: null, projectName: null }];
  const cmd = buildRetryCommand(special, { mode: 'grep' });
  expect(cmd).toContain('click \\.button \\(plus\\?\\)');
});

test('empty cases', () => {
  expect(buildRetryCommand([])).toBe('');
});

test('single case', () => {
  const cmd = buildRetryCommand([sampleCases[0]]);
  expect(cmd).toBe('npx playwright test "tests/login.spec.ts:10" --project="chromium"');
});

test('custom pkgRunner', () => {
  const cmd = buildRetryCommand([sampleCases[0]], { pkgRunner: 'yarn' });
  expect(cmd).toContain('yarn playwright test');
});

test('dedupe same file:line', () => {
  const dupes = [
    { filePath: 'tests/foo.spec.ts', title: 'dup1', line: 10, projectName: 'chromium' },
    { filePath: 'tests/foo.spec.ts', title: 'dup2', line: 10, projectName: 'chromium' },
  ];
  const cmd = buildRetryCommand(dupes);
  // Only one "tests/foo.spec.ts:10" arg despite 2 cases
  expect(cmd.match(/tests\/foo\.spec\.ts:10/g)?.length).toBe(1);
});

test('normalizes Windows backslash paths to forward slashes', () => {
  // Runs captured on Windows store backslash-separated paths; Playwright's CLI
  // file filter only matches forward-slash paths, so the command must convert them.
  const winCases = [
    { filePath: 'tests\\case-files-live.spec.ts', title: 'win test', line: 393, projectName: 'chromium' },
  ];
  expect(buildRetryCommand(winCases)).toBe(
    'npx playwright test "tests/case-files-live.spec.ts:393" --project="chromium"',
  );
  expect(buildRetryCommand(winCases, { mode: 'file' })).toContain('"tests/case-files-live.spec.ts"');
  expect(buildRetryCommand(winCases)).not.toContain('\\');
});

test('quotes paths containing spaces', () => {
  const spaced = [{ filePath: 'tests/my dir/foo.spec.ts', title: 'spaced', line: 12, projectName: 'chromium' }];
  expect(buildRetryCommand(spaced)).toContain('"tests/my dir/foo.spec.ts:12"');
  expect(buildRetryCommand(spaced, { mode: 'file' })).toContain('"tests/my dir/foo.spec.ts"');
});

test('no project name', () => {
  const noProject = [{ filePath: 'tests/bar.spec.ts', title: 'bar test', line: 5, projectName: null }];
  const cmd = buildRetryCommand(noProject);
  expect(cmd).not.toContain('--project=');
});
