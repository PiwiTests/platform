import { describe, expect, test } from 'vitest';
import { callEndLine } from '../src/analysis';

describe('callEndLine', () => {
  const lines = (text: string) => text.split('\n');

  test('ends on the line of the parenthesis that closes the call', () => {
    const spec = lines(
      ["test('pays', async ({ page }) => {", "  await page.goto('/cart');", '});', 'after();'].join('\n'),
    );
    expect(callEndLine(spec, 0, 4)).toBe(2);
    expect(callEndLine(lines("test('one line', () => {});"), 0, 4)).toBe(0);
  });

  test('skips brackets inside strings, template literals and comments', () => {
    const spec = lines(
      [
        "test('a ) in the title', async () => {",
        '  const s = "(" + \')\';',
        '  const t = `${[1, 2].map((n) => `(${n}`)} }`;',
        '  // an unbalanced ( in a comment',
        '  /* and ) in',
        '     a block comment ( */',
        '});',
      ].join('\n'),
    );
    expect(callEndLine(spec, 0, 4)).toBe(6);
  });

  test('gives up on a call that never closes', () => {
    expect(callEndLine(lines("test('open', () => {\n  foo();"), 0, 4)).toBeNull();
  });
});
