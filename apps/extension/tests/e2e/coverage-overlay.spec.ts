import { test, expect, type Page } from '@playwright/test';
import {
  CARD_TEST,
  DEFAULT_CONNECTION,
  INSTANCE_URL,
  SHOP_TESTS,
  injectCoverage,
  openShop,
  readCoverage,
  shopIndex,
  stubCoverageChrome,
} from './coverage-fixtures.js';
import { servePages } from './engine-bundle.js';

/**
 * The "Tested elements" overlay (`coverage-overlay.js`) driven as a bundle on
 * a realistic page (`pages/shop.html`), with `chrome.*` stubbed: the locator
 * index of a fake project is in the extension cache, the worker answers
 * refreshes. The overlay renders into an open shadow root in tests, so its
 * boxes, badges, cards and panel can be inspected directly.
 */

const HOST = '#piwi-coverage-host';

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box;
}

test.describe('coverage overlay on a page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  test('lists what the tests reach, how, and the untested interactive elements', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const coverage = await readCoverage(page);

    const byDescription = new Map(coverage.covered.map((c) => [c.description, c]));
    expect(byDescription.get('searchbox "Search products"')).toMatchObject({ kind: 'operated', ambiguous: false });
    expect(byDescription.get('button "Cart, 2 items"')).toMatchObject({
      kind: 'checked',
      tests: ['adds a mug to the cart'],
    });
    expect(byDescription.get('checkbox "In stock"')).toMatchObject({
      kind: 'operated',
      tests: ['filters in-stock products'],
    });
    expect(byDescription.get('button "4 stars"')).toMatchObject({ kind: 'operated', tests: ['rates a product'] });
    expect(byDescription.get('textbox "Message"')).toMatchObject({
      kind: 'operated',
      tests: ['opens the support chat'],
    });
    expect(byDescription.get('heading "Your cart"')).toMatchObject({ kind: 'checked' });

    // The Blue mug's button is operated by one test and counted by another; the other three are only counted.
    const addToCart = coverage.covered.filter((c) => c.description === 'button "Add to cart"');
    expect(addToCart).toHaveLength(4);
    expect(addToCart[0]).toMatchObject({
      kind: 'operated',
      ambiguous: false,
      tests: ['adds a mug to the cart', 'filters in-stock products'],
    });
    for (const other of addToCart.slice(1)) expect(other).toMatchObject({ kind: 'checked', ambiguous: true });

    const uncovered = coverage.uncovered.map((u) => u.description);
    expect(uncovered).toEqual(
      expect.arrayContaining([
        'link "Shop now"',
        'checkbox "Free shipping"',
        'button "Add Blue mug to wishlist"',
        'textbox "Coupon code"',
        'button "Apply"',
        'button "Subscribe"',
        'link "Legal notice"',
        'button "1 star"',
      ]),
    );
    // Covered through their label or a child, never listed as untested; the overlay's own controls never count.
    expect(uncovered).not.toContain('checkbox "In stock"');
    expect(uncovered.some((d) => /panel|Collapse|Close/.test(d))).toBe(false);

    expect(coverage.tests[0]).toEqual({ title: 'shows prices', elements: 7 });
    expect(coverage.tests.map((t) => t.title)).not.toContain('uses a layout locator');
    // "Log in", "Password", and the cookie dialog's button while the dialog is closed.
    expect(coverage.unmatched).toBe(3);
    expect(coverage.errors).toEqual([
      { locator: 'locator(\'button:left-of(:text("Apply"))\')', message: ':left-of() is not supported' },
    ]);
  });

  test('draws a box per element and a badge with its number of tests', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);

    const search = await boxOf(page, 'input[type=search]');
    const boxes = await page.locator(`${HOST} .box`).evaluateAll((els) =>
      els.map((e) => ({
        kind: (e as HTMLElement).dataset.kind,
        rect: e.getBoundingClientRect().toJSON() as DOMRect,
      })),
    );
    const onSearch = boxes.find(
      (b) =>
        Math.abs(b.rect.left - search.x) < 1 &&
        Math.abs(b.rect.top - search.y) < 1 &&
        Math.abs(b.rect.width - search.width) < 1,
    );
    expect(onSearch?.kind).toBe('operated');
    expect(boxes.filter((b) => b.kind === 'uncovered').length).toBeGreaterThanOrEqual(15);

    // The badge of the Blue mug's button reads 2 tests and carries a flaky dot.
    const button = await boxOf(page, 'article:has-text("Blue mug") button.primary');
    const badges = await page.locator(`${HOST} .badge`).evaluateAll((els) =>
      els.map((e) => ({
        text: e.textContent,
        flaky: !!e.querySelector('.dot.flaky'),
        rect: e.getBoundingClientRect().toJSON() as DOMRect,
      })),
    );
    const onButton = badges.find(
      (b) =>
        b.rect.left >= button.x &&
        b.rect.left <= button.x + button.width + 8 &&
        Math.abs(b.rect.top - (button.y - 9)) < 3,
    );
    expect(onButton).toMatchObject({ text: '2', flaky: true });
  });

  test('hovering an element previews the tests that reach it', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const target = await boxOf(page, 'nav a[href="/deals"]');
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    const preview = page.locator(`${HOST} .card.preview`);
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('link "Deals"');
    await expect(preview).toContainText('Operated by 1 test');
    await expect(preview).toContainText('navigation › visits the deals');
    await page.mouse.move(700, 880);
    await expect(preview).toBeHidden();
  });

  test('a badge opens a card with each locator, its tests and links into Piwi', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const button = await boxOf(page, 'article:has-text("Blue mug") button.primary');
    const badge = page.locator(`${HOST} .badge`).filter({ hasText: /^2/ });
    await badge.click();
    const card = page.locator(`${HOST} .card.pinned`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('button "Add to cart"');
    await expect(card).toContainText(
      "getByTestId('product-card').filter({ hasText: 'Blue mug' }).getByRole('button', { name: 'Add to cart' })",
    );
    await expect(card).toContainText("getByRole('button', { name: 'Add to cart' })");
    await expect(card).toContainText('Matches 4 elements on this page');
    await expect(card.getByRole('link', { name: 'catalog › adds a mug to the cart' })).toHaveAttribute(
      'href',
      `${INSTANCE_URL}/test-cases/101`,
    );
    await expect(card).toContainText('Click · tests/catalog.spec.ts:9:5 · chromium');
    const find = card.getByRole('link', { name: /Find these locators in Piwi/ });
    const href = await find.getAttribute('href');
    expect(href).toContain(`${INSTANCE_URL}/projects/1/locators?q=`);
    expect(decodeURIComponent(href!.split('?q=')[1]!).split('\n')).toHaveLength(2);
    // The card sits next to the element.
    const cardBox = await card.boundingBox();
    expect(Math.abs(cardBox!.y - (button.y + button.height + 10))).toBeLessThan(2);

    // Escape closes the card first, then the overlay itself.
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page.locator(HOST)).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(page.locator(HOST)).not.toBeAttached();
  });

  test('the Tests list spotlights the elements one test reaches', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const panel = page.locator(`${HOST} .panel`);
    await panel.getByRole('button', { name: /^Tests \d+$/ }).click();
    const row = panel.locator('li.row', { hasText: 'shows prices' });
    await expect(row).toContainText('7 elements');
    await row.click();
    await expect(row).toContainText('showing only its elements');
    await expect(page.locator(`${HOST} .box.strong`)).toHaveCount(7);
    expect(await page.locator(`${HOST} .box.dim`).count()).toBeGreaterThan(20);
    await row.click();
    await expect(row).not.toContainText('showing only its elements');
    // The list re-renders under the pointer, and hovering a row spotlights it too.
    await page.mouse.move(5, 5);
    await expect(page.locator(`${HOST} .box.strong`)).toHaveCount(0);
  });

  test('toggles hide the untested boxes and shade boxes by number of tests', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const panel = page.locator(`${HOST} .panel`);
    expect(await page.locator(`${HOST} .box.uncovered`).count()).toBeGreaterThan(10);
    await panel.getByLabel('Not tested').uncheck();
    await expect(page.locator(`${HOST} .box.uncovered`)).toHaveCount(0);
    await panel.getByLabel('Checked').uncheck();
    await expect(page.locator(`${HOST} .box.checked`)).toHaveCount(0);
    await expect(page.locator(`${HOST} .box.operated`).first()).toBeAttached();
    await panel.getByLabel('Heatmap').check();
    const heats = await page
      .locator(`${HOST} .box.operated`)
      .evaluateAll((els) => els.map((e) => Number((e as HTMLElement).style.getPropertyValue('--heat'))));
    expect(Math.max(...heats)).toBe(1);
    expect(Math.min(...heats)).toBeGreaterThan(0);
  });

  test('the Not tested list suggests a locator to write a test with', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const panel = page.locator(`${HOST} .panel`);
    await panel.getByRole('button', { name: /^Not tested \d+$/ }).click();
    const row = panel.locator('li.row', { hasText: 'button "Subscribe"' });
    await expect(row.locator('code')).toHaveText("getByRole('button', { name: 'Subscribe' })");
    await expect(row.getByRole('button', { name: 'Copy locator' })).toBeVisible();
    // A checkbox named only by the label wrapping it is suggested by that name.
    await expect(panel.locator('li.row', { hasText: 'checkbox "Free shipping"' }).locator('code')).toHaveText(
      "getByRole('checkbox', { name: 'Free shipping' })",
    );
    await panel.getByLabel('Filter the list').fill('coupon');
    await expect(panel.locator('li.row')).toHaveCount(1);
  });

  test('follows the page: added and removed elements rescan', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const before = await readCoverage(page);
    expect(before.unmatched).toBe(3);

    await page.evaluate(() => {
      const login = document.createElement('button');
      login.textContent = 'Log in';
      document.querySelector('header')!.appendChild(login);
      document.querySelector('.newsletter')!.remove();
    });
    await page.waitForFunction(
      (scans) => (globalThis as unknown as { __piwiCoverage: { scans: number } }).__piwiCoverage.scans > scans,
      before.scans,
    );
    const after = await readCoverage(page);
    expect(after.covered.find((c) => c.description === 'button "Log in"')).toMatchObject({
      kind: 'operated',
      tests: ['pays by card'],
    });
    expect(after.unmatched).toBe(2);
    expect(after.uncovered.map((u) => u.description)).not.toContain('button "Subscribe"');
  });

  test('boxes follow the page when it scrolls', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div style="height: 1600px"></div>'));
    await injectCoverage(page);
    const hasBoxAt = async (y: number) =>
      (await page.locator(`${HOST} .box`).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))).some(
        (top) => Math.abs(top - y) < 1,
      );
    const input = await boxOf(page, 'input[type=search]');
    expect(await hasBoxAt(input.y)).toBe(true);
    await page.mouse.wheel(0, 200);
    await expect
      .poll(async () => {
        const now = await boxOf(page, 'input[type=search]');
        return now.y < input.y - 100 && (await hasBoxAt(now.y));
      })
      .toBe(true);
  });

  test('a newer index from the instance replaces the cached one', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    expect((await readCoverage(page)).uncovered.map((u) => u.description)).toContain('button "Subscribe"');

    const withNewsletter = shopIndex([
      ...SHOP_TESTS,
      {
        title: 'subscribes to the newsletter',
        suite: ['newsletter'],
        file: 'tests/newsletter.spec.ts',
        status: 'passed',
        uses: [
          ["getByRole('form', { name: 'Newsletter' }).getByRole('textbox')", ['fill'], 4],
          ["getByRole('button', { name: 'Subscribe' })", ['click'], 5],
        ],
      },
    ]);
    await page.evaluate((index) => {
      (globalThis as Record<string, unknown>).__piwiTestRefreshAnswer = { ok: true, refreshed: true, index };
    }, withNewsletter);
    const scans = (await readCoverage(page)).scans;
    await page.locator(`${HOST} .panel`).getByRole('button', { name: 'Refresh' }).click();
    await page.waitForFunction(
      (n) => (globalThis as unknown as { __piwiCoverage: { scans: number } }).__piwiCoverage.scans > n,
      scans,
    );
    const coverage = await readCoverage(page);
    expect(coverage.covered.find((c) => c.description === 'button "Subscribe"')?.tests).toEqual([
      'subscribes to the newsletter',
    ]);
    expect(coverage.covered.find((c) => c.description === 'textbox "Email for the newsletter"')?.kind).toBe('operated');
    const sent = await page.evaluate(
      () => (globalThis as unknown as { __piwiTestSent: Array<{ type: string; force?: boolean }> }).__piwiTestSent,
    );
    expect(sent.filter((m) => m.type === 'piwi-refresh-locator-index').map((m) => m.force)).toEqual([false, true]);
  });

  test('draws above a modal dialog the page opened, and says the panel is blocked meanwhile', async ({
    page,
    context,
  }) => {
    await stubCoverageChrome(context);
    await openShop(page);
    await injectCoverage(page);
    // In the top layer, after the dialog: drawn above it.
    expect(await page.locator(HOST).evaluate((host) => host.matches(':popover-open'))).toBe(true);
    const coverage = await readCoverage(page);
    expect(coverage.covered.find((c) => c.description === 'button "Accept all"')).toMatchObject({
      kind: 'operated',
      visible: true,
    });
    expect(coverage.uncovered.map((u) => u.description)).toContain('button "Settings"');
    const accept = await boxOf(page, 'dialog button.primary');
    const tops = await page
      .locator(`${HOST} .box.operated`)
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    expect(tops.some((r) => Math.abs(r.x - accept.x) < 1 && Math.abs(r.y - accept.y) < 1)).toBe(true);
    // Boxes of what sits behind the dialog are dimmed; the dialog's own stay bright.
    const dimmed = await page.locator(`${HOST} .box.dim`).count();
    expect(dimmed).toBeGreaterThan(20);
    expect(await page.locator(`${HOST} .box.operated:not(.dim)`).count()).toBe(1);
    // A modal dialog makes the rest of the page inert, the overlay included.
    await expect(page.locator(`${HOST} .panel`)).toContainText('The page shows a modal dialog');
  });

  test('collapses to a pill that keeps the summary, and expands back', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const panel = page.locator(`${HOST} .panel`);
    await panel.getByRole('button', { name: 'Collapse to a summary pill' }).click();
    const pill = page.locator(`${HOST} .pill`);
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/Piwi · 14\/34 tested · 8 tests/);
    await expect(panel).toBeHidden();
    await pill.click();
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Move the panel to the other side' }).click();
    const box = await panel.boundingBox();
    expect(box!.x).toBeLessThan(20);
  });

  test('injecting it again turns it off', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    await injectCoverage(page, 'closed');
    await expect(page.locator(HOST)).not.toBeAttached();
  });
});

test.describe('coverage overlay states', () => {
  test('not connected: explains how to connect and opens the settings', async ({ page, context }) => {
    await stubCoverageChrome(context, { connection: null, cached: null });
    await openShop(page, '?nodialog');
    await injectCoverage(page, 'not-connected');
    const panel = page.locator(`${HOST} .panel`);
    await expect(panel).toContainText('Connect Piwi Picker to your Piwi instance');
    await panel.getByRole('button', { name: 'Open Piwi Picker settings' }).click();
    const sent = await page.evaluate(
      () => (globalThis as unknown as { __piwiTestSent: Array<{ type: string }> }).__piwiTestSent,
    );
    expect(sent.map((m) => m.type)).toContain('piwi-open-options');
    await expect(page.locator(`${HOST} .box`)).toHaveCount(0);
  });

  test('no project mapped to the page', async ({ page, context }) => {
    await stubCoverageChrome(context, {
      connection: {
        instanceUrl: INSTANCE_URL,
        apiKey: '',
        projectMappings: [{ urlPattern: 'https://elsewhere.test/**', projectId: 1, projectLabel: 'Acme Mugs' }],
      },
    });
    await openShop(page, '?nodialog');
    await injectCoverage(page, 'no-project');
    await expect(page.locator(`${HOST} .panel`)).toContainText('No project is mapped to this page');
  });

  test('no cached index and the instance unreachable: says why and offers a retry', async ({ page, context }) => {
    await stubCoverageChrome(context, {
      cached: null,
      refresh: { ok: false, error: 'Failed to fetch the locator index (502)' },
    });
    await openShop(page, '?nodialog');
    await injectCoverage(page, 'error');
    const panel = page.locator(`${HOST} .panel`);
    await expect(panel).toContainText(
      "Couldn't load the locator index of Acme Mugs: Failed to fetch the locator index (502)",
    );
    await page.evaluate((index) => {
      (globalThis as Record<string, unknown>).__piwiTestRefreshAnswer = { ok: true, refreshed: true, index };
    }, shopIndex());
    await panel.getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(
      () => (globalThis as unknown as { __piwiCoverage: { status: string } }).__piwiCoverage.status === 'ready',
    );
    expect((await readCoverage(page)).covered.length).toBeGreaterThan(10);
  });

  test('no cached index: loads it from the instance', async ({ page, context }) => {
    await stubCoverageChrome(context, { cached: null, refresh: { ok: true, refreshed: true, index: shopIndex() } });
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    expect((await readCoverage(page)).coveredInteractive).toBe(14);
  });

  test('reads the project’s test id attribute', async ({ page, context }) => {
    const index = shopIndex(
      [
        {
          title: 'opens the cart',
          suite: [],
          file: 'tests/cart.spec.ts',
          status: 'passed',
          uses: [["getByTestId('open-cart')", ['click'], 3]],
        },
      ],
      { testIdAttributes: ['data-qa'] },
    );
    await stubCoverageChrome(context, { cached: index });
    await openShop(page, '?nodialog');
    await page.evaluate(() =>
      document.querySelector('[data-testid="cart-button"]')!.setAttribute('data-qa', 'open-cart'),
    );
    await injectCoverage(page);
    const coverage = await readCoverage(page);
    expect(coverage.covered.map((c) => c.description)).toEqual(['button "Cart, 2 items"']);
    await expect(page.locator(`${HOST} .panel`)).toContainText('getByTestId reads data-qa');
  });
});

test('scans a large page against a large index without freezing it', async ({ page, context }) => {
  const products = 1200;
  const tests = Array.from({ length: 600 }, (_, i) => ({
    title: `product ${i}`,
    suite: ['catalog'],
    file: `tests/catalog-${i % 20}.spec.ts`,
    status: 'passed' as const,
    uses: [
      [`getByTestId('product-${i}').getByRole('button', { name: 'Add to cart' })`, ['click'], 10],
      [`getByRole('heading', { name: 'Product ${i}', exact: true })`, ['expect.toBeVisible'], 11],
      [`getByRole('link', { name: 'Missing page ${i}' })`, ['click'], 12],
      [`getByLabel('Quantity for product ${i}', { exact: true })`, ['fill'], 13],
      [`locator('#product-${i} .price')`, ['expect.toHaveText'], 14],
    ] as Array<[string, string[], number]>,
  }));
  const cards = Array.from(
    { length: products },
    (_, i) => `<article data-testid="product-${i}" id="product-${i}"><h3>Product ${i}</h3><p class="price">${i} €</p>
      <label>Quantity for product ${i} <input type="number" value="1"></label><button>Add to cart</button></article>`,
  ).join('');
  await servePages(page, 'https://big.test', {
    'big.html': `<!doctype html><html><body><main>${cards}</main></body></html>`,
  });
  await stubCoverageChrome(context, {
    cached: shopIndex(tests),
    connection: {
      instanceUrl: INSTANCE_URL,
      apiKey: '',
      projectMappings: [{ urlPattern: 'https://big.test/**', projectId: 1, projectLabel: 'Big' }],
    },
  });
  await page.goto('https://big.test/big.html');
  // Count animation frames while the scan runs: a scan in slices leaves the page painting.
  await page.evaluate(() => {
    const g = globalThis as Record<string, unknown>;
    g.__frames = 0;
    const tick = () => {
      g.__frames = (g.__frames as number) + 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const started = Date.now();
  await injectCoverage(page);
  const elapsed = Date.now() - started;
  const coverage = await readCoverage(page);
  expect(coverage.tests).toHaveLength(600);
  expect(coverage.unmatched).toBe(600);
  expect(coverage.covered.filter((c) => c.kind === 'operated').length).toBe(1200);
  expect(coverage.coveredInteractive).toBe(1200);
  expect(coverage.uncoveredCount).toBe(1200);
  expect(coverage.uncovered.length).toBe(500);
  expect(elapsed).toBeLessThan(20_000);
  const frames = await page.evaluate(() => (globalThis as unknown as Record<string, number>).__frames);
  expect(frames).toBeGreaterThan(3);
});

test.describe('coverage overlay limited to one element', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  const BLUE_CARD = 'article:has-text("Blue mug")';

  test('limits the view to an element chosen on the page, then widens it', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const whole = await readCoverage(page);
    const panel = page.locator(`${HOST} .panel`);

    await panel.getByRole('button', { name: 'Limit to an element' }).click();
    await expect(panel.locator('.scope-bar')).toContainText('Click a part of the page');
    expect((await readCoverage(page)).drawn).toBe(0);

    // Point at the Blue mug's Add to cart button, then widen to its card with ↑.
    await page.hover(`${BLUE_CARD} button.primary`);
    await expect.poll(async () => (await readCoverage(page)).choosing).toBe('button "Add to cart"');
    await expect(page.locator(`${HOST} .frame.choosing`)).toBeVisible();
    for (let i = 0; i < 4 && !(await readCoverage(page)).choosing?.startsWith('article'); i++) {
      await page.keyboard.press('ArrowUp');
    }
    expect((await readCoverage(page)).choosing).toMatch(/^article\.card "Blue mug/);
    await page.keyboard.press('ArrowDown');
    expect((await readCoverage(page)).choosing).not.toMatch(/^article/);
    await page.keyboard.press('ArrowUp');

    // The click that chooses never reaches the page.
    await page.evaluate(() => {
      (globalThis as { __clicks?: number }).__clicks = 0;
      document.addEventListener('click', () => (globalThis as { __clicks?: number }).__clicks!++);
    });
    await page.mouse.click(...(await centerOf(page, `${BLUE_CARD} button.primary`)));
    expect(await page.evaluate(() => (globalThis as { __clicks?: number }).__clicks)).toBe(0);

    const scoped = await readCoverage(page);
    expect(scoped.scope).toMatch(/^article\.card "Blue mug/);
    expect(scoped.choosing).toBeNull();
    expect(scoped.covered.map((c) => c.description).sort()).toEqual(
      ['button "4 stars"', 'button "Add to cart"', 'paragraph.price "12 €"'].sort(),
    );
    expect(scoped.uncovered.map((u) => u.description)).toContain('button "Add Blue mug to wishlist"');
    expect(scoped.uncovered.map((u) => u.description)).not.toContain('button "Add Red mug to wishlist"');
    expect(scoped.tests.map((t) => t.title).sort()).toEqual(
      ['adds a mug to the cart', 'filters in-stock products', 'rates a product', 'shows prices'].sort(),
    );
    expect(scoped.coveredInteractive + scoped.uncoveredCount).toBeLessThan(
      whole.coveredInteractive + whole.uncoveredCount,
    );
    await expect(panel.locator('.scope-bar')).toContainText('Inside article.card "Blue mug');
    await expect(page.locator(`${HOST} .frame.scope`)).toBeVisible();
    await expect(page.locator(`${HOST} .frame-tag`)).toContainText('Inside article.card');
    await expect(panel.getByRole('button', { name: /^Tests \d+$/ })).toHaveText('Tests 4');

    // Container ↑ widens to the product grid, Whole page drops the limit.
    await panel.getByRole('button', { name: 'Container ↑' }).click();
    const grid = await readCoverage(page);
    expect(grid.scope).toMatch(/^div\.grid/);
    expect(grid.covered.filter((c) => c.description === 'button "Add to cart"')).toHaveLength(4);
    // Esc goes back to the whole page before it closes the overlay.
    await page.keyboard.press('Escape');
    await expect(page.locator(HOST)).toBeAttached();
    const again = await readCoverage(page);
    expect(again.scope).toBeNull();
    expect(again.covered).toHaveLength(whole.covered.length);
    await expect(page.locator(`${HOST} .frame`)).toHaveCount(0);
  });

  test('Esc cancels choosing, and a link clicked to choose it does not navigate', async ({ page, context }) => {
    await stubCoverageChrome(context);
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const panel = page.locator(`${HOST} .panel`);

    await panel.getByRole('button', { name: 'Limit to an element' }).click();
    await page.keyboard.press('Escape');
    expect((await readCoverage(page)).choosing).toBeNull();
    await expect(page.locator(HOST)).toBeAttached();
    await expect(panel.locator('.scope-bar')).toContainText('Whole page');

    await panel.getByRole('button', { name: 'Limit to an element' }).click();
    const url = page.url();
    await page.locator('nav').getByRole('link', { name: 'Deals' }).click();
    expect(page.url()).toBe(url);
    const scoped = await readCoverage(page);
    expect(scoped.scope).toBe('link "Deals"');
    expect(scoped.tests.map((t) => t.title)).toEqual(['visits the deals']);
  });

  test('opens limited to the element the pick results hand over, with the containers tests reach', async ({
    page,
    context,
  }) => {
    await stubCoverageChrome(context, { cached: shopIndex([...SHOP_TESTS, CARD_TEST]) });
    await openShop(page, '?nodialog');
    await page.evaluate((selector) => {
      (globalThis as { __piwiCoverageScopeRequest?: Element }).__piwiCoverageScopeRequest =
        document.querySelector(selector)!;
    }, '.grid article:first-child button.primary');
    await injectCoverage(page);
    const coverage = await readCoverage(page);
    expect(coverage.scope).toBe('button "Add to cart"');
    expect(coverage.containers).toEqual([
      { description: expect.stringMatching(/^article\.card "Blue mug/), tests: ['shows the Blue mug card'] },
    ]);
    const around = page.locator(`${HOST} .panel .around`);
    await expect(around).toContainText('Around it');
    await around.locator('li.row').first().hover();
    await expect(page.locator(`${HOST} .frame.around`)).toBeVisible();
    await around.locator('li.row').first().click();
    const card = await readCoverage(page);
    expect(card.scope).toMatch(/^article\.card "Blue mug/);
    expect(card.tests.map((t) => t.title)).toContain('shows the Blue mug card');
    await page.locator(`${HOST} .panel`).getByRole('button', { name: 'Whole page' }).click();
    expect((await readCoverage(page)).scope).toBeNull();
  });
});

async function centerOf(page: Page, selector: string): Promise<[number, number]> {
  const box = await boxOf(page, selector);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

test.describe('coverage overlay on a branch', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  /** On feature/voucher, only the search test ran; it now uses the search button alone. */
  const featureIndex = () =>
    shopIndex(
      [
        {
          ...SHOP_TESTS[0]!,
          uses: [["getByRole('button', { name: 'Search' })", ['click'], 6]],
        },
      ],
      {
        branch: 'feature/voucher',
        branches: [{ name: 'feature/voucher', lastSeenAt: '2026-09-25T10:00:00.000Z', tests: 1 }],
      },
    );

  test('reads the branch the URL mapping names, and the panel switches branches', async ({ page, context }) => {
    await stubCoverageChrome(context, {
      connection: {
        ...DEFAULT_CONNECTION,
        projectMappings: [{ ...DEFAULT_CONNECTION.projectMappings[0]!, branch: 'feature/voucher' }],
      },
      cachedBranches: { 'feature/voucher': featureIndex() },
    });
    await openShop(page, '?nodialog');
    await injectCoverage(page);
    const onFeature = await readCoverage(page);
    expect(onFeature.branch).toBe('feature/voucher');
    expect(onFeature.tests.map((t) => t.title)).toEqual(['finds a product by name']);
    const select = page.locator(`${HOST} .panel select.branch-select`);
    await expect(select).toHaveValue('feature/voucher');
    const sent = () =>
      page.evaluate(
        () =>
          (globalThis as unknown as { __piwiTestSent: Array<{ type: string; branch?: string | null }> }).__piwiTestSent,
      );
    expect((await sent()).filter((m) => m.type === 'piwi-refresh-locator-index').map((m) => m.branch)).toEqual([
      'feature/voucher',
    ]);

    // Back to the default branch: its cached index, remembered for the session.
    await select.selectOption('');
    await page.waitForFunction(
      () =>
        (globalThis as { __piwiCoverage?: { branch?: string | null; status?: string } }).__piwiCoverage?.branch ===
        null,
    );
    await expect.poll(async () => (await readCoverage(page)).status).toBe('ready');
    expect((await readCoverage(page)).tests.length).toBeGreaterThan(1);
    expect((await sent()).filter((m) => m.type === 'piwi-refresh-locator-index').map((m) => m.branch)).toEqual([
      'feature/voucher',
      null,
    ]);
    const remembered = await page.evaluate(async () =>
      (globalThis as any).chrome.storage.session.get('piwiLocatorBranchOverride'),
    );
    expect(remembered).toEqual({ piwiLocatorBranchOverride: { '1': '' } });
  });
});
