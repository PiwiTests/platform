import { describe, expect, test } from 'vitest';
import { applyPatchFile, parsePatch } from '../src/analysis';

const TEXT = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');

describe('parsePatch', () => {
  test('reads each file and its hunks, leaving out created and deleted files', () => {
    const files = parsePatch(
      [
        '--- a/src/x.ts',
        '+++ b/src/x.ts',
        '@@ -2,2 +2,2 @@',
        ' b',
        '-c',
        '+C',
        '--- /dev/null',
        '+++ b/src/new.ts',
        '@@ -0,0 +1 @@',
        '+new',
      ].join('\n'),
    );
    expect(files).toEqual([{ path: 'src/x.ts', hunks: [{ oldStart: 2, lines: [' b', '-c', '+C'] }] }]);
  });
});

describe('applyPatchFile', () => {
  test('applies hunks at their line, or at the nearest offset', () => {
    const file = {
      path: 'x',
      hunks: [
        { oldStart: 2, lines: [' b', '-c', '+C'] },
        { oldStart: 5, lines: ['-e', '+E', '+E2'] },
      ],
    };
    expect(applyPatchFile(TEXT, file)).toBe(['a', 'b', 'C', 'd', 'E', 'E2', 'f'].join('\n'));
    expect(applyPatchFile(`z\n${TEXT}`, file)).toBe(['z', 'a', 'b', 'C', 'd', 'E', 'E2', 'f'].join('\n'));
  });

  test('refuses a hunk whose lines are gone', () => {
    expect(applyPatchFile(TEXT, { path: 'x', hunks: [{ oldStart: 2, lines: ['-q', '+Q'] }] })).toBeNull();
  });
});
