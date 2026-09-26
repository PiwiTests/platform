import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  CARD_TEST,
  DEFAULT_CONNECTION,
  DIST,
  INSTANCE_URL,
  SHOP_TESTS,
  injectCoverage,
  openShop,
  readCoverage,
  shopIndex,
  stubCoverageChrome,
} from './coverage-fixtures.js';

/**
 * The pick results panel in connected mode: "Copy all" puts every ranked
 * locator on the clipboard, and a Piwi section lists the project's tests
 * whose locators reach the picked element on this page.
 */

const RESULTS = '#piwi-picker-results-host';

/** Pick an element; `up` walks that many steps to its containers before the click commits. */
async function pick(page: Page, selector: string, up = 0): Promise<void> {
  await page.addScriptTag({ path: path.join(DIST, 'pick.js') });
  await expect(page.getByText('click any element to generate locators')).toBeVisible();
  await page.hover(selector);
  for (let i = 0; i < up; i++) await page.keyboard.press('ArrowUp');
  await page.click(selector);
  const skip = page.getByRole('button', { name: 'Skip (Esc)' });
  const results = page.locator(`${RESULTS} .panel`);
  await expect(skip.or(results)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await expect(results).toBeVisible();
}

test.describe('pick results in connected mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test('lists the tests reaching the picked element, with links into Piwi', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await pick(page, 'article:has-text("Blue mug") button.primary');

    const section = page.locator(`${RESULTS} .piwi`);
    await expect(section).toContainText('Reached by 2 tests of Acme Mugs');
    await expect(section.getByRole('link', { name: 'catalog › adds a mug to the cart' })).toHaveAttribute(
      'href',
      `${INSTANCE_URL}/test-cases/101`,
    );
    await expect(section).toContainText('catalog › filters in-stock products');
    const find = section.getByRole('link', { name: /Find these locators in Piwi/ });
    expect(await find.getAttribute('href')).toContain(`${INSTANCE_URL}/projects/1/locators?q=`);
    const report = await page.evaluate(
      () => (globalThis as unknown as { __piwiPickCoverage: { status: string; tests: string[] } }).__piwiPickCoverage,
    );
    expect(report).toMatchObject({ status: 'ready', tests: ['adds a mug to the cart', 'filters in-stock products'] });

    await section.getByRole('button', { name: 'Show every tested element' }).click();
    const sent = await page.evaluate(
      () => (globalThis as unknown as { __piwiTestSent: Array<{ type: string }> }).__piwiTestSent,
    );
    expect(sent.map((m) => m.type)).toContain('piwi-open-coverage');
  });

  test('tells the tests reaching the element from those reaching a container around it', async ({ page, context }) => {
    await stubCoverageChrome(context, { cached: shopIndex([...SHOP_TESTS, CARD_TEST]) });
    await openShop(page, '?nodialog');
    await pick(page, 'article:has-text("Blue mug") button.primary');

    const section = page.locator(`${RESULTS} .piwi`);
    await expect(section).toContainText('Reached by 2 tests of Acme Mugs');
    await expect(section.locator('.group').first()).toHaveText('This element');
    await expect(section.locator('.group').nth(1)).toContainText('Around it · article.card "Blue mug');
    await expect(section.getByRole('link', { name: 'catalog › shows the Blue mug card' })).toBeVisible();
    const report = await page.evaluate(
      () => (globalThis as unknown as { __piwiPickCoverage: Record<string, unknown> }).__piwiPickCoverage,
    );
    expect(report).toMatchObject({
      tests: ['adds a mug to the cart', 'filters in-stock products'],
      inside: [],
      around: ['shows the Blue mug card'],
    });

    // "Show tested elements inside it" hands the element over to the overlay the worker injects.
    await section.getByRole('button', { name: 'Show tested elements inside it' }).click();
    const sent = await page.evaluate(
      () => (globalThis as unknown as { __piwiTestSent: Array<{ type: string }> }).__piwiTestSent,
    );
    expect(sent.map((m) => m.type)).toContain('piwi-open-coverage');
    await injectCoverage(page);
    expect((await readCoverage(page)).scope).toBe('button "Add to cart"');
  });

  test('counts what tests reach inside a picked container', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    // From the Deals link up to the navigation landmark around it.
    await pick(page, 'nav >> text=Deals', 3);
    const section = page.locator(`${RESULTS} .piwi`);
    await expect(section).toContainText('Reached by 1 test of Acme Mugs');
    await expect(section.locator('.group').first()).toHaveText('Inside it · 1 element');
    const report = await page.evaluate(
      () => (globalThis as unknown as { __piwiPickCoverage: Record<string, unknown> }).__piwiPickCoverage,
    );
    expect(report).toMatchObject({ tests: ['visits the deals'], inside: ['visits the deals'], around: [] });
  });

  test('answers for the branch the URL mapping names', async ({ page, context }) => {
    await stubCoverageChrome(context, {
      connection: {
        ...DEFAULT_CONNECTION,
        projectMappings: [{ ...DEFAULT_CONNECTION.projectMappings[0]!, branch: 'develop' }],
      },
      cachedBranches: { develop: shopIndex(SHOP_TESTS, { branch: 'develop' }) },
    });
    await openShop(page, '?nodialog');
    await pick(page, 'article:has-text("Blue mug") button.primary');
    const section = page.locator(`${RESULTS} .piwi`);
    await expect(section).toContainText('Reached by 2 tests of Acme Mugs on develop');
    const find = section.getByRole('link', { name: /Find these locators in Piwi/ });
    expect(await find.getAttribute('href')).toContain('&branch=develop');
  });

  test('says so when no test reaches the picked element', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await pick(page, 'button[aria-label="Add Red mug to wishlist"]');
    await expect(page.locator(`${RESULTS} .piwi`)).toContainText('Not reached by any test of Acme Mugs');
  });

  test('copies every ranked locator, one per line', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://shop.test' });
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await pick(page, 'form.newsletter button');
    const copyAll = page.locator(`${RESULTS} .panel`).getByTitle(/Copy every locator, one per line/);
    await expect(copyAll).toHaveText(/^Copy all \d+$/);
    const count = Number((await copyAll.textContent())!.replace(/\D/g, ''));
    await copyAll.click();
    await expect(copyAll).toHaveText('Copied');
    const lines = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
    expect(lines).toHaveLength(count);
    expect(lines).toContain("getByRole('button', { name: 'Subscribe' })");
  });

  test('stays out of the way when the extension is not connected', async ({ page, context }) => {
    await stubCoverageChrome(context, { connection: null, cached: null });
    await openShop(page, '?nodialog');
    await pick(page, 'form.newsletter button');
    await expect(page.locator(`${RESULTS} .piwi`)).toBeHidden();
  });
});
