import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { stubChromeI18n } from './i18n-stub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

const SHOP = `<!doctype html><html><body style="min-height:3000px;padding-top:200px">
  <nav><a href="/cart">Cart (2)</a></nav>
  <main>
    <label>Coupon <input name="coupon"></label>
    <button class="btn" data-testid="apply-coupon">Apply coupon</button>
    <button>Show popup</button>
    <button>Show popup</button>
    <button class="icon"><svg width="10" height="10"></svg></button>
    <div class="fake-button" onclick="void 0">Checkout</div>
    <div class="card" style="cursor:pointer"><span>Blue mug</span></div>
    <p>Plain text is not labelled.</p>
    <button hidden>Hidden</button>
  </main>
</body></html>`;

interface ViewSummary {
  tag: string;
  role: string | null;
  name: string;
  testId: string | null;
  mark: 'unreachable' | 'ambiguous' | null;
  count: number;
}

async function openView(page: Page): Promise<ViewSummary[]> {
  await page.addScriptTag({ path: path.join(DIST, 'playwright-view.js') });
  await expect
    .poll(() => page.evaluate(() => (globalThis as { __piwiPlaywrightView?: unknown }).__piwiPlaywrightView))
    .toBeTruthy();
  return page.evaluate(() => (globalThis as unknown as { __piwiPlaywrightView: ViewSummary[] }).__piwiPlaywrightView);
}

test.describe('Playwright view', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      (globalThis as { __piwiTestOpenShadow?: boolean }).__piwiTestOpenShadow = true;
    });
    await stubChromeI18n(context);
  });

  test('labels what getByRole sees, and marks the unreachable and the ambiguous', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(SHOP);
    const labels = await openView(page);
    const find = (role: string | null, name: string) => labels.find((l) => l.role === role && l.name === name);

    expect(find('link', 'Cart (2)')).toMatchObject({ mark: null });
    expect(find('textbox', 'Coupon')).toMatchObject({ mark: null });
    expect(find('button', 'Apply coupon')).toMatchObject({ testId: 'apply-coupon', mark: null });
    expect(labels.filter((l) => l.role === 'button' && l.name === 'Show popup')).toEqual([
      expect.objectContaining({ mark: 'ambiguous', count: 2 }),
      expect.objectContaining({ mark: 'ambiguous', count: 2 }),
    ]);
    // A button with no name, a clickable div, a card with a pointer cursor: no stable locator reaches them.
    expect(find('button', '')).toMatchObject({ mark: 'unreachable' });
    expect(labels.filter((l) => l.role === null && l.mark === 'unreachable').map((l) => l.tag)).toEqual(['div', 'div']);
    // Its text inherits the pointer and is not marked again; hidden elements and plain text get no label.
    expect(labels.some((l) => l.tag === 'span' || l.tag === 'p' || l.name === 'Hidden')).toBe(false);

    // The same answers as real Playwright.
    await expect(page.getByRole('button', { name: 'Show popup' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Apply coupon' })).toHaveCount(1);

    const host = page.locator('#piwi-playwright-view-host');
    await expect(host.getByText('button · Apply coupon')).toBeVisible();
    await expect(host.getByText('apply-coupon', { exact: true })).toBeVisible();
    await expect(host.getByText('div · (no role)')).toHaveCount(2);
    await expect(host.getByText('3 no stable locator reaches (red)')).toBeVisible();
    await expect(host.getByText('2 whose role and name find others too (amber)')).toBeVisible();
  });

  test('filters by role, follows scrolling, scans again after a change, and toggles off', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(SHOP);
    await openView(page);
    const host = page.locator('#piwi-playwright-view-host');

    await host.getByRole('combobox', { name: 'Role' }).selectOption('link');
    await expect(host.locator('.tag')).toHaveCount(1);
    await expect(host.locator('.tag')).toHaveText('link · Cart (2)');
    const before = await host.locator('.tag').boundingBox();
    await page.mouse.wheel(0, 40);
    await expect.poll(async () => (await host.locator('.tag').boundingBox())?.y).toBeLessThan(before!.y);

    await host.getByRole('combobox', { name: 'Role' }).selectOption('');
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.textContent = 'Added later';
      document.querySelector('main')!.appendChild(button);
    });
    await expect(host.getByText('button · Added later')).toBeVisible();

    await page.addScriptTag({ path: path.join(DIST, 'playwright-view.js') });
    await expect(host).toHaveCount(0);
  });
});
