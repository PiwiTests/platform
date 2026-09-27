import { describe, expect, test } from 'vitest';
import { editText } from '../../src/content/coverage-risk';

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
