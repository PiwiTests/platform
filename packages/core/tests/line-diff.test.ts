import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseUnifiedDiff } from '../src/diff-anchors';
import { diffLines } from '../src/line-diff';

/** The hunks git reports between two texts. */
function gitHunks(before: string, after: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-linediff-'));
  try {
    fs.writeFileSync(path.join(dir, 'a'), before);
    fs.writeFileSync(path.join(dir, 'b'), after);
    let out = '';
    try {
      execFileSync('git', ['diff', '--no-index', '--unified=0', '--diff-algorithm=myers', 'a', 'b'], {
        cwd: dir,
        encoding: 'utf-8',
      });
    } catch (e) {
      out = (e as { stdout: string }).stdout;
    }
    return parseUnifiedDiff(out)[0]?.hunks ?? [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const cases: Array<[string, string, string]> = [
  ['a rename in the middle', 'a\nb\nc\nd\n', 'a\nB\nc\nd\n'],
  ['an insertion', 'a\nb\nc\n', 'a\nb\nx\ny\nc\n'],
  ['a removal', 'a\nb\nc\nd\n', 'a\nd\n'],
  ['changes at both ends', 'one\ntwo\nthree\nfour\n', 'ONE\ntwo\nthree\nFOUR\nfive\n'],
  ['identical texts', 'same\n', 'same\n'],
  ['from nothing', '', 'new\nfile\n'],
  [
    'a template edit',
    '<template>\n  <button class="pay">\n    Pay now\n  </button>\n</template>\n',
    '<template>\n  <button class="pay" data-testid="pay">\n    Pay\n  </button>\n</template>\n',
  ],
];

describe('diffLines', () => {
  test.each(cases)('%s gives the hunks git gives', (_name, before, after) => {
    expect(diffLines('f', before, after).hunks).toEqual(gitHunks(before, after));
  });

  test('keeps the path', () => {
    expect(diffLines('src/a.vue', 'x', 'y')).toMatchObject({ path: 'src/a.vue', status: 'modified' });
  });
});

test('a large, heavily edited file stays cheap', () => {
  const before = Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join('\n');
  const after = Array.from({ length: 20_000 }, (_, i) => (i % 7 === 0 ? `changed ${i}` : `line ${i}`)).join('\n');
  const started = Date.now();
  const hunks = diffLines('big', before, after).hunks;
  expect(hunks.length).toBeGreaterThan(0);
  expect(Date.now() - started).toBeLessThan(5000);
});
