import { test, expect } from './fixtures.js';
import { evaluateLocatorChain } from '../../src/content/locator-eval.js';
import { parseLocatorExpression } from '../../src/shared/locator-expr.js';
import { domRoleOf, domHeadingLevel } from '@piwitests/picker-dom';
import { approximateAccessibleName, TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';
import type { Page } from '@playwright/test';

const MAPS = { tagRoles: TAG_TO_ROLE, inputRoles: INPUT_TYPE_TO_ROLE };

/**
 * `evaluateLocatorChain` nests every matching helper inside its own body
 * specifically so this reconstruction trick works (see the doc comment on
 * the function itself) — only its three genuine cross-module imports need
 * installing as globals first, same as `live-count.spec.ts`'s `evalLiveCount`.
 */
async function evalChain(page: Page, expr: string): Promise<{ count: number; exact: boolean }> {
  await page.evaluate(
    ([roleSrc, levelSrc, nameSrc]) => {
      (globalThis as any).domRoleOf = new Function(`return (${roleSrc})`)();
      (globalThis as any).domHeadingLevel = new Function(`return (${levelSrc})`)();
      (globalThis as any).approximateAccessibleName = new Function(`return (${nameSrc})`)();
    },
    [domRoleOf.toString(), domHeadingLevel.toString(), approximateAccessibleName.toString()],
  );
  const chain = parseLocatorExpression(expr);
  const { elements, exact } = await page.evaluate(
    ([fnSrc, chainArg, maps]) => {
      const evaluate = new Function(`return (${fnSrc})`)() as (c: unknown, m: unknown) => { elements: unknown[] };
      const { elements, exact } = evaluate(chainArg, maps) as { elements: unknown[]; exact: boolean };
      return { elements: elements.length, exact };
    },
    [evaluateLocatorChain.toString(), chain, MAPS] as const,
  );
  return { count: elements, exact };
}

test.describe('evaluateLocatorChain', () => {
  test('matches getByTestId exactly', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="join-btn">Join</button>
      <button data-testid="other">Other</button>
    </body></html>`);
    expect(await evalChain(page, `getByTestId('join-btn')`)).toEqual({ count: 1, exact: true });
  });

  test('matches locator(css) exactly', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><li>A</li><li>B</li><li>C</li></body></html>`);
    expect(await evalChain(page, `locator('li')`)).toEqual({ count: 3, exact: true });
  });

  test('an invalid CSS selector in locator() throws instead of silently matching nothing', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body></body></html>`);
    await expect(evalChain(page, `locator(':::not-css')`)).rejects.toThrow(/isn't a valid CSS selector/);
  });

  test('matches a bare getByRole exactly (no name involved)', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><h2>One</h2><h2>Two</h2><h3>Three</h3></body></html>`);
    expect(await evalChain(page, `getByRole('heading', { level: 2 })`)).toEqual({ count: 2, exact: true });
  });

  test('matches getByRole with a name approximately (name involves accessible-name approximation)', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button>Pay now</button>
      <button>Cancel</button>
    </body></html>`);
    expect(await evalChain(page, `getByRole('button', { name: 'Pay now' })`)).toEqual({ count: 1, exact: false });
  });

  test('getByRole names a form field by its label, not by its options or value', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <label for="country">Country</label>
      <select id="country"><option>United Kingdom</option><option>Ireland</option></select>
      <label><input type="checkbox"> Keep me posted</label>
      <span id="l">Notes</span><textarea aria-labelledby="l">Draft</textarea>
    </body></html>`);
    expect((await evalChain(page, `getByRole('combobox', { name: 'Country' })`)).count).toBe(1);
    expect((await evalChain(page, `getByRole('combobox', { name: 'Ireland' })`)).count).toBe(0);
    expect((await evalChain(page, `getByRole('checkbox', { name: 'Keep me posted' })`)).count).toBe(1);
    expect((await evalChain(page, `getByRole('textbox', { name: 'Notes' })`)).count).toBe(1);
    expect((await evalChain(page, `getByRole('textbox', { name: 'Draft' })`)).count).toBe(0);
  });

  test('getByRole name matching is substring + case-insensitive unless exact', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Pay Now Please</button></body></html>`);
    expect((await evalChain(page, `getByRole('button', { name: 'pay now' })`)).count).toBe(1);
    expect((await evalChain(page, `getByRole('button', { name: 'pay now', exact: true })`)).count).toBe(0);
  });

  test('matches getByText/getByLabel/getByPlaceholder/getByAltText/getByTitle approximately', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <span>Hello world</span>
      <label for="e">Email</label><input id="e" />
      <input placeholder="Search…" />
      <img alt="Piwi logo" src="x.png" />
      <button title="Close dialog">X</button>
    </body></html>`);
    expect(await evalChain(page, `getByText('Hello world')`)).toEqual({ count: 1, exact: false });
    expect(await evalChain(page, `getByLabel('Email')`)).toEqual({ count: 1, exact: false });
    expect(await evalChain(page, `getByPlaceholder('Search')`)).toEqual({ count: 1, exact: false });
    expect(await evalChain(page, `getByAltText('Piwi logo')`)).toEqual({ count: 1, exact: false });
    expect(await evalChain(page, `getByTitle('Close dialog')`)).toEqual({ count: 1, exact: false });
  });

  test('narrows with filter({ hasText }), first(), last(), and nth()', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <li>Alice — admin</li>
      <li>Bob — member</li>
      <li>Alice — member</li>
    </body></html>`);
    expect(await evalChain(page, `locator('li').filter({ hasText: 'Alice' })`)).toEqual({ count: 2, exact: false });
    expect(await evalChain(page, `locator('li').filter({ hasText: 'Alice' }).first()`)).toEqual({
      count: 1,
      exact: false,
    });
    expect(await evalChain(page, `locator('li').last()`)).toEqual({ count: 1, exact: true });
    expect(await evalChain(page, `locator('li').nth(1)`)).toEqual({ count: 1, exact: true });
  });

  test('filter({ hasNotText }) excludes matches', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <li>active item</li>
      <li>archived item</li>
    </body></html>`);
    expect(await evalChain(page, `locator('li').filter({ hasNotText: 'archived' })`)).toEqual({
      count: 1,
      exact: false,
    });
  });

  test('an empty chain matches nothing', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body></body></html>`);
    const chain = { calls: [] };
    const { count } = await page.evaluate(
      ([fnSrc, chainArg, maps]) => {
        const evaluate = new Function(`return (${fnSrc})`)() as (c: unknown, m: unknown) => { elements: unknown[] };
        return { count: evaluate(chainArg, maps).elements.length };
      },
      [evaluateLocatorChain.toString(), chain, MAPS] as const,
    );
    expect(count).toBe(0);
  });
});
