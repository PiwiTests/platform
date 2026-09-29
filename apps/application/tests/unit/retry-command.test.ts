import { execFileSync } from 'node:child_process';
import { describe, test, expect } from 'vitest';
import { buildRetryCommand, buildTitleGrepFlag } from '#shared/retry-command';

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

describe('buildTitleGrepFlag', () => {
  test('no titles, no flag', () => {
    expect(buildTitleGrepFlag([])).toBe('');
  });

  test('joins plain titles with an alternation', () => {
    expect(buildTitleGrepFlag(['should login', 'should logout'])).toBe(' -g "should login|should logout"');
  });

  test('escapes regex metacharacters in each title', () => {
    expect(buildTitleGrepFlag(['click .button (plus?)', 'list [a] + *b'])).toBe(
      ' -g "click \\\\.button \\\\(plus\\\\?\\\\)|list \\\\[a\\\\] \\\\+ \\\\*b"',
    );
  });

  test('escapes the characters a double-quoted shell argument treats specially', () => {
    expect(buildTitleGrepFlag(['say "hi"', 'cost `5`'])).toBe(' -g "say \\"hi\\"|cost \\`5\\`"');
  });

  describe.skipIf(process.platform === 'win32')('through a POSIX shell', () => {
    const titles = [
      'Users (admin) [beta] v1.2',
      'adds 1 + 1 = 2? *yes*',
      'price is $5 or ${x}',
      'say "hi" and \'bye\'',
      'back\\slash `tick` | pipe ^caret',
    ];

    function shellArguments(flag: string): string[] {
      const out = execFileSync('sh', ['-c', `printf '%s\\n'${flag}`], { encoding: 'utf8' });
      return out.split('\n').slice(0, -1);
    }

    test.each(titles)('the shell hands Playwright a regex that matches only %s', (title) => {
      const [flag, pattern] = shellArguments(buildTitleGrepFlag([title]));
      expect(flag).toBe('-g');
      const regex = new RegExp(pattern!);
      expect(regex.test(title)).toBe(true);
      expect(regex.test(title.replace(/[^A-Za-z0-9 ]/, 'Z'))).toBe(false);
    });

    test('a dot, a star and a bracket in a title match only themselves', () => {
      const [, pattern] = shellArguments(buildTitleGrepFlag(['v1.2 [a]*']));
      const regex = new RegExp(pattern!);
      expect(regex.test('v1.2 [a]*')).toBe(true);
      expect(regex.test('v1X2 [a]*')).toBe(false);
      expect(regex.test('v1.2 a')).toBe(false);
    });

    test('several titles become one alternation that matches each of them', () => {
      const [, pattern] = shellArguments(buildTitleGrepFlag(titles));
      const regex = new RegExp(pattern!);
      for (const title of titles) expect(regex.test(title)).toBe(true);
      expect(regex.test('an unrelated title')).toBe(false);
    });
  });
});
