import { describe, expect, test } from 'vitest';
import { callEndLine, flakeLabLens } from '../src/analysis';
import type { FlakeLabEntry } from '../src/piwi-client';

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

describe('flakeLabLens', () => {
  const entry = (overrides: Partial<FlakeLabEntry> = {}): FlakeLabEntry => ({
    testCaseId: 12,
    state: 'untested',
    nextCommand: 'npx @piwitests/reporter flake 12',
    flaky: true,
    reproducedBy: null,
    flakeRate: 0.18,
    suspect: { id: 'slow-route:GET /api/cart', label: 'slow GET /api/cart', standing: 'untested', lab: 'untested' },
    ...overrides,
  });

  test('a flaky test with an untested suspect offers to reproduce it', () => {
    expect(flakeLabLens(12, entry())).toEqual({
      title: 'flaky 18% · top suspect: slow GET /api/cart (untested)',
      actions: [{ kind: 'reproduce', title: 'Reproduce this flake', command: 'npx @piwitests/reporter flake 12' }],
    });
  });

  test('a reproduced flake offers to verify the fix too', () => {
    const lens = flakeLabLens(
      12,
      entry({
        state: 'reproduced',
        nextCommand: 'npx @piwitests/reporter flake verify 12',
        reproducedBy: 'delay GET /api/cart 1.8 s',
        suspect: {
          id: 'slow-route:GET /api/cart',
          label: 'slow GET /api/cart',
          standing: 'reproduced',
          lab: 'reproduced 7 of 10',
        },
      }),
    );
    expect(lens?.title).toBe('flaky 18% · top suspect: slow GET /api/cart (reproduced 7 of 10)');
    expect(lens?.actions).toEqual([
      { kind: 'reproduce', title: 'Reproduce this flake', command: 'npx @piwitests/reporter flake 12' },
      { kind: 'verify', title: 'Verify the flake fix', command: 'npx @piwitests/reporter flake verify 12' },
    ]);
  });

  test('a fix that holds, or a test off the ranking with nothing to verify, shows nothing', () => {
    expect(flakeLabLens(12, entry({ state: 'verified', nextCommand: null, flaky: false }))).toBeNull();
    expect(flakeLabLens(12, entry({ flaky: false }))).toBeNull();
  });

  test('an older instance without the rate or the suspect still offers the command', () => {
    const lens = flakeLabLens(12, {
      testCaseId: 12,
      state: 'not-reproduced',
      nextCommand: 'npx @piwitests/reporter flake 12',
      flaky: true,
      reproducedBy: null,
    });
    expect(lens?.title).toBe('flaky');
    expect(lens?.actions.map((a) => a.kind)).toEqual(['reproduce']);
  });
});
