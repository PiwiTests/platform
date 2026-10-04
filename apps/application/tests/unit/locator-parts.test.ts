import { describe, test, expect } from 'vitest';
import { splitLocatorParts } from '~/utils/locator-parts';

describe('splitLocatorParts', () => {
  test('finds the locator in a cluster name', () => {
    expect(splitLocatorParts("Timeout on getByLabel('Email address') in checkout.spec.ts")).toEqual([
      { kind: 'text', text: 'Timeout on ' },
      { kind: 'locator', text: "getByLabel('Email address')" },
      { kind: 'text', text: ' in checkout.spec.ts' },
    ]);
  });

  test('keeps a parenthesis inside a quoted name in the locator', () => {
    const parts = splitLocatorParts(
      "Strict-mode violation on getByRole('button', { name: 'Pay (card)' }) in pay.spec.ts",
    );
    expect(parts[1]).toEqual({ kind: 'locator', text: "getByRole('button', { name: 'Pay (card)' })" });
  });

  test('takes the calls chained onto a locator', () => {
    expect(splitLocatorParts("page.locator('.row').nth(2) never became visible")[0]).toEqual({
      kind: 'locator',
      text: "page.locator('.row').nth(2)",
    });
  });

  test('reads an elided argument list as a locator', () => {
    expect(splitLocatorParts('Timeout on getByRole(…)')[1]).toEqual({ kind: 'locator', text: 'getByRole(…)' });
  });

  test('a name with no locator is one run of prose', () => {
    expect(splitLocatorParts('Checkout total is off by one cent')).toEqual([
      { kind: 'text', text: 'Checkout total is off by one cent' },
    ]);
    expect(splitLocatorParts('getByRoleless prose (no call)')).toEqual([
      { kind: 'text', text: 'getByRoleless prose (no call)' },
    ]);
  });
});
