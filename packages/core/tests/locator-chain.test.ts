import { describe, expect, test } from 'vitest';
import {
  canonicalLocator,
  locatorScopes,
  locatorTarget,
  parseLocatorChain,
  renderLocatorChain,
  tryParseLocatorChain,
} from '../src/locator-chain';

describe('parseLocatorChain', () => {
  // Every expression below is printed verbatim by Playwright 1.63's formatter.
  test.each([
    "getByRole('button', { name: 'Save' })",
    "getByRole('button', { name: 'Save', exact: true })",
    "getByRole('form', { name: 'Shipping' }).getByLabel('Country')",
    "locator('.field').filter({ hasText: 'Country' }).locator('select')",
    "locator('.field').filter({ has: getByRole('combobox') }).first()",
    "getByRole('row', { name: 'Acme' }).getByRole('button', { name: 'Delete' }).first()",
    "locator('iframe#pay').contentFrame().getByRole('textbox', { name: 'Card' })",
    "getByText('France').locator('..')",
    'getByText(/total: \\d+/i)',
    "getByRole('heading', { name: 'Orders', level: 2 })",
    "getByTestId('address-form').nth(2)",
    "getByRole('button').and(getByTitle('Subscribe'))",
    "getByLabel('Country').or(getByRole('combobox'))",
    "locator('.item').filter({ visible: true })",
  ])('round-trips %s', (expr) => {
    expect(renderLocatorChain(parseLocatorChain(expr))).toBe(expr);
  });

  test('normalizes quotes, spacing and a page. prefix', () => {
    expect(canonicalLocator(`await page.getByRole("button",{name:"Save"})`)).toBe(
      "getByRole('button', { name: 'Save' })",
    );
  });

  test('keeps escaped quotes inside strings', () => {
    const chain = parseLocatorChain("getByText('It\\'s done')");
    expect(chain.calls[0]!.args[0]).toEqual({ type: 'string', value: "It's done" });
    expect(renderLocatorChain(chain)).toBe("getByText('It\\'s done')");
  });

  test.each([
    ['an unknown method', "getByRole('button').click()"],
    ['a narrowing call first', 'first()'],
    ['trailing text', "getByText('a') and more"],
    ['an unterminated string', "getByText('a"],
    ['arbitrary code', "locator(eval('1'))"],
  ])('refuses %s', (_label, expr) => {
    expect(tryParseLocatorChain(expr)).toBeNull();
  });
});

describe('locatorTarget and locatorScopes', () => {
  test('a chained field: the label is the target, the form the scope', () => {
    const chain = parseLocatorChain("getByRole('form', { name: 'Shipping' }).getByLabel('Country')");
    expect(locatorTarget(chain)).toBe("getByLabel('Country')");
    expect(locatorScopes(chain)).toEqual(["getByRole('form', { name: 'Shipping' })"]);
  });

  test('a filtered container stays whole as the scope', () => {
    const chain = parseLocatorChain("locator('.field').filter({ hasText: 'Country' }).locator('select')");
    expect(locatorTarget(chain)).toBe("locator('select')");
    expect(locatorScopes(chain)).toEqual(["locator('.field').filter({ hasText: 'Country' })"]);
  });

  test('a single call has no scope and is its own target', () => {
    const chain = parseLocatorChain("getByTestId('order-total').first()");
    expect(locatorTarget(chain)).toBe("getByTestId('order-total')");
    expect(locatorScopes(chain)).toEqual([]);
  });
});
