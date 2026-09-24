import { describe, expect, test } from 'vitest';
import {
  extractStepLocatorUse,
  extractStepLocatorUses,
  findLocationRoot,
  stepLocations,
  stripLocationRoot,
} from '../src/step-locators';

describe('extractStepLocatorUse — Playwright 1.63 steps', () => {
  // Shapes as the reporter stores them: title, Piwi's category, params, subtitle, location.
  test('reads the chain from params.locator and the action from the title', () => {
    const use = extractStepLocatorUse({
      title: 'Select option',
      category: 'input',
      subtitle: "getByRole('form', { name: 'Shipping' }).getByLabel('Country')",
      params: {
        locator: "getByRole('form', { name: 'Shipping' }).getByLabel('Country')",
        options: '[{"valueOrLabel":"FR"}]',
      },
      location: '/work/shop/pages/shipping.page.ts:41:7',
    });
    expect(use).toMatchObject({
      action: 'selectOption',
      locator: "getByRole('form', { name: 'Shipping' }).getByLabel('Country')",
      location: '/work/shop/pages/shipping.page.ts:41:7',
    });
  });

  test('keeps the fill value out of the result', () => {
    const use = extractStepLocatorUse({
      title: 'Fill "Jane Secret"',
      params: { locator: "getByLabel('Name')", value: 'Jane Secret' },
    });
    expect(use?.action).toBe('fill');
    expect(JSON.stringify(use)).not.toContain('Jane Secret');
  });

  test('names assertions by matcher, including negation', () => {
    expect(
      extractStepLocatorUse({
        title: 'Expect "toContainText"',
        params: { locator: "getByTestId('address-form')", expected: 'France' },
      })?.action,
    ).toBe('expect.toContainText');
    expect(
      extractStepLocatorUse({ title: 'Expect "soft not toBeVisible"', params: { locator: "getByText('Error')" } })
        ?.action,
    ).toBe('expect.not.toBeVisible');
  });

  test('a custom expect message still yields the locator', () => {
    const use = extractStepLocatorUse({
      title: 'the total is shown',
      category: 'assertion',
      params: { locator: "getByTestId('total')" },
    });
    expect(use).toMatchObject({ action: 'expect', locator: "getByTestId('total')" });
  });

  test('skips a chain the runner truncated', () => {
    expect(
      extractStepLocatorUse({ title: 'Click', params: { locator: "getByRole('button', { name: 'Very lo…" } }),
    ).toBeNull();
  });

  test('ignores steps without a locator', () => {
    expect(
      extractStepLocatorUse({
        title: 'Navigate',
        params: { url: 'https://shop.test/cart' },
        subtitle: 'https://shop.test/cart',
      }),
    ).toBeNull();
    expect(extractStepLocatorUse({ title: 'Create page' })).toBeNull();
  });
});

describe('extractStepLocatorUse — Playwright 1.61 titles', () => {
  // Titles printed by Playwright 1.61.1 for the same test.
  test.each([
    [
      "Select option getByRole('form', { name: 'Shipping' }).getByLabel('Country')",
      'selectOption',
      "getByRole('form', { name: 'Shipping' }).getByLabel('Country')",
    ],
    ['Fill "Jane Secret" getByLabel(\'Name\')', 'fill', "getByLabel('Name')"],
    [
      "Click locator('.field').filter({ hasText: 'Country' }).locator('select')",
      'click',
      "locator('.field').filter({ hasText: 'Country' }).locator('select')",
    ],
    ['Expect "toContainText" getByTestId(\'address-form\')', 'expect.toContainText', "getByTestId('address-form')"],
    ['Expect "not toHaveValue" getByLabel(\'Country\')', 'expect.not.toHaveValue', "getByLabel('Country')"],
    ["Double click getByRole('row', { name: 'Order 7' })", 'dblclick', "getByRole('row', { name: 'Order 7' })"],
  ])('%s', (title, action, locator) => {
    expect(extractStepLocatorUse({ title })).toMatchObject({ action, locator });
  });

  test('a typed value that looks like a locator does not win', () => {
    const use = extractStepLocatorUse({ title: "Fill \"use getByText('x') here\" getByLabel('Notes')" });
    expect(use).toMatchObject({ action: 'fill', locator: "getByLabel('Notes')" });
  });
});

describe('extractStepLocatorUses', () => {
  test('keeps step order and indexes', () => {
    const uses = extractStepLocatorUses([
      { title: 'Navigate', params: { url: '/' } },
      { title: 'Click', params: { locator: "getByRole('link', { name: 'Checkout' })" } },
      null,
      { title: "Click getByRole('button', { name: 'Pay' })" },
    ]);
    expect(uses.map((u) => [u.stepIndex, u.locator])).toEqual([
      [1, "getByRole('link', { name: 'Checkout' })"],
      [3, "getByRole('button', { name: 'Pay' })"],
    ]);
  });

  test('tolerates a non-array', () => {
    expect(extractStepLocatorUses(null)).toEqual([]);
  });
});

describe('findLocationRoot and stripLocationRoot', () => {
  test('finds the root through a location in the test file', () => {
    const root = findLocationRoot(
      ['/work/shop/pages/shipping.page.ts:41:7', '/work/shop/tests/checkout.spec.ts:12:5'],
      'tests/checkout.spec.ts',
    );
    expect(root).toBe('/work/shop/');
    expect(stripLocationRoot('/work/shop/pages/shipping.page.ts:41:7', root)).toBe('pages/shipping.page.ts:41:7');
  });

  test('normalizes Windows separators', () => {
    const root = findLocationRoot(['C:\\work\\shop\\tests\\a.spec.ts:3:1'], 'tests/a.spec.ts');
    expect(stripLocationRoot('C:\\work\\shop\\pages\\p.ts:1:1', root)).toBe('pages/p.ts:1:1');
  });

  test('no root when no step sits in the test file', () => {
    expect(findLocationRoot(['/work/shop/pages/p.ts:1:1'], 'tests/a.spec.ts')).toBeNull();
    expect(stripLocationRoot('/work/shop/pages/p.ts:1:1', null)).toBe('/work/shop/pages/p.ts:1:1');
  });

  test('stepLocations reads every step, locator or not', () => {
    expect(stepLocations([{ title: 'Navigate', location: '/a/t.spec.ts:1:1' }, { title: 'x' }, null])).toEqual([
      '/a/t.spec.ts:1:1',
    ]);
  });
});
