import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * Each tool claims the page on injection and tears down whichever one was
 * already running, so no two overlays and their capture-phase listeners compete
 * for the same clicks; Escape cancels the current one from anywhere.
 */
const PAGE = `<!doctype html><html><body>
  <main><h1>Checkout</h1><button id="pay" data-testid="pay">Pay now</button></main>
</body></html>`;

function inject(page: Page, file: string) {
  return page.addScriptTag({ path: path.join(DIST, file) });
}

const activeTool = (page: Page) =>
  page.evaluate(() => (globalThis as { __piwiActiveTool?: { id: string } }).__piwiActiveTool?.id ?? null);

test.describe('one tool at a time', () => {
  test('starting a tool tears down the one already running', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(PAGE);

    await inject(page, 'playwright-view.js');
    await expect.poll(() => activeTool(page)).toBe('playwright-view');
    expect(await page.locator('#piwi-playwright-view-host').count()).toBe(1);

    await inject(page, 'lint-overlay.js');
    await expect.poll(() => activeTool(page)).toBe('lint-overlay');
    // The predecessor's surface is gone, not merely covered up.
    expect(await page.locator('#piwi-playwright-view-host').count()).toBe(0);
    expect(await page.locator('#piwi-lint-overlay-host').count()).toBe(1);
  });

  test('a pick started over another tool leaves only the picking overlay', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(PAGE);

    await inject(page, 'lint-overlay.js');
    await expect.poll(() => activeTool(page)).toBe('lint-overlay');

    await inject(page, 'pick.js');
    await expect.poll(() => activeTool(page)).toBe('pick');
    expect(await page.locator('#piwi-lint-overlay-host').count()).toBe(0);
    await expect(page.locator('#__piwi_picker_banner')).toHaveCount(1);
  });

  test('Escape cancels the running tool and releases the page', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(PAGE);

    await inject(page, 'lint-overlay.js');
    await expect.poll(() => activeTool(page)).toBe('lint-overlay');

    await page.keyboard.press('Escape');
    await expect.poll(() => activeTool(page)).toBeNull();
    expect(await page.locator('#piwi-lint-overlay-host').count()).toBe(0);
  });

  test('Escape during a pick cancels it without stranding the re-entry guard', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(PAGE);

    await inject(page, 'pick.js');
    await expect.poll(() => activeTool(page)).toBe('pick');

    await page.keyboard.press('Escape');
    await expect.poll(() => activeTool(page)).toBeNull();
    // The guard has to clear, or this tool would be dead for the life of the
    // page — the pick polls for a global that a torn-down overlay never sets.
    await expect.poll(() => page.evaluate(() => (globalThis as any).__piwiPicking)).toBe(false);

    // Proof it really is reusable: a second pick claims the page again.
    await inject(page, 'pick.js');
    await expect.poll(() => activeTool(page)).toBe('pick');
  });

  test('a tool that finishes on its own releases the page', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(PAGE);

    await inject(page, 'lint-overlay.js');
    await expect.poll(() => activeTool(page)).toBe('lint-overlay');
    // Re-injecting a toggle turns it off, which must also release ownership
    // rather than leaving the popup claiming it is still running.
    await inject(page, 'lint-overlay.js');
    await expect.poll(() => activeTool(page)).toBeNull();
  });
});
