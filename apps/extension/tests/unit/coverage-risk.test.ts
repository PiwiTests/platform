import { describe, expect, test } from 'vitest';
import type { LocatorIndex, LocatorIndexUse } from '@piwitests/core/locator-index';
import { editText, needsElement, pageRisks, usePlace } from '../../src/content/coverage-risk';

const use: LocatorIndexUse = {
  test: 0,
  actions: ['click'],
  callSites: ['t.spec.ts:1:1'],
  projects: ['chromium'],
  branches: ['main'],
};

describe('editText', () => {
  test('lists each call site with the old and the new locator', () => {
    expect(editText(['tests/a.spec.ts:3:5', 'pages/b.ts:9:12'], "locator('.x')", "getByTestId('x')")).toBe(
      [
        'tests/a.spec.ts:3:5',
        "- locator('.x')",
        "+ getByTestId('x')",
        '',
        'pages/b.ts:9:12',
        "- locator('.x')",
        "+ getByTestId('x')",
      ].join('\n'),
    );
  });

  test('without a call site, gives the change alone', () => {
    expect(editText([], "locator('.x')", "getByTestId('x')")).toBe("- locator('.x')\n+ getByTestId('x')");
  });

  test('stops after ten call sites and says how many more there are', () => {
    const sites = Array.from({ length: 13 }, (_, i) => `t.spec.ts:${i + 1}:1`);
    const text = editText(sites, 'a', 'b');
    expect(text.split('\n\n')).toHaveLength(11);
    expect(text.endsWith('… and 3 more call sites')).toBe(true);
  });
});

describe('usePlace', () => {
  test('here when the use was recorded on this page, elsewhere when on others only, unknown without a page', () => {
    expect(usePlace({ ...use, pages: [0, 2] }, 2)).toBe('here');
    expect(usePlace({ ...use, pages: [0] }, 2)).toBe('elsewhere');
    expect(usePlace({ ...use, pages: [0] }, -1)).toBe('elsewhere');
    expect(usePlace(use, 2)).toBe('unknown');
    expect(usePlace({ ...use, pages: [] }, 2)).toBe('unknown');
  });

  test('a use on more pages than listed counts on every page but is never here', () => {
    expect(usePlace({ ...use, pages: [0], pagesTruncated: true }, 3)).toBe('unknown');
  });
});

describe('needsElement', () => {
  test('interactions and positive assertions need the element; absence, count and reads do not', () => {
    for (const action of ['click', 'fill', 'selectOption', 'expect.toBeVisible', 'expect.toHaveText']) {
      expect(needsElement(action), action).toBe(true);
    }
    for (const action of [
      'expect.not.toBeVisible',
      'expect.toBeHidden',
      'expect.toHaveCount',
      'count',
      'waitFor',
      'expect',
      'other',
    ]) {
      expect(needsElement(action), action).toBe(false);
    }
  });
});

describe('pageRisks', () => {
  const index = (uses: Array<{ locator: string; use: Partial<LocatorIndexUse> }>): LocatorIndex => ({
    projectId: 1,
    projectName: 'p',
    branch: 'main',
    defaultBranch: 'main',
    branches: [],
    builtAt: null,
    generatedAt: '2026-09-27T00:00:00.000Z',
    testIdAttributes: null,
    pages: ['/checkout', '/cart'],
    tests: [
      { id: 1, title: 'a', file: 'a.spec.ts', suite: [], status: 'passed' },
      { id: 2, title: 'b', file: 'b.spec.ts', suite: [], status: 'failed' },
    ],
    locators: uses.map(({ locator, use: u }) => ({ locator, lastSeenAt: '', uses: [{ ...use, ...u }] })),
    truncated: false,
  });

  test('lists what tests use here and find nothing, on arrival first, and what they click here among several', () => {
    const idx = index([
      { locator: 'a', use: { actions: ['click'], pages: [0] } },
      { locator: 'b', use: { actions: ['expect.toBeVisible'], pages: [0], arrival: [0], test: 1 } },
      { locator: 'c', use: { actions: ['expect.not.toBeVisible'], pages: [0] } },
      { locator: 'd', use: { actions: ['click'], pages: [1] } },
      { locator: 'e', use: { actions: ['click'] } },
      { locator: 'f', use: { actions: ['click'], pages: [0] } },
      { locator: 'g', use: { actions: ['expect.toHaveCount'], pages: [0] } },
      { locator: 'h', use: { actions: ['click'], pages: [0] } },
    ]);
    // a, b, c, d, e find nothing; f and g find three; h finds one.
    const { missing, several } = pageRisks(idx, [0, 0, 0, 0, 0, 3, 3, 1], 0);
    expect(missing.map((r) => [idx.locators[r.entry]!.locator, r.arrival, r.actions])).toEqual([
      ['b', true, ['expect.toBeVisible']],
      ['a', false, ['click']],
    ]);
    expect(missing[0]!.tests).toEqual([1]);
    expect(several.map((r) => [idx.locators[r.entry]!.locator, r.count])).toEqual([['f', 3]]);
  });

  test('says nothing on a page no use was recorded on, or for a chain that could not be evaluated', () => {
    const idx = index([{ locator: 'a', use: { actions: ['click'], pages: [0] } }]);
    expect(pageRisks(idx, [0], -1)).toEqual({ missing: [], several: [] });
    expect(pageRisks(idx, [-1], 0)).toEqual({ missing: [], several: [] });
  });
});
