import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { openShadowRoots } from './shadow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

interface DevtoolsScript {
  query(expression: string): { count: number };
  highlight(index: number | null): boolean;
}

/** The outline's top and the element's, in viewport pixels; null once the outline is gone. */
function outline(page: Page): Promise<{ box: number; element: number } | null> {
  return page.evaluate(() => {
    const box = document.getElementById('piwi-devtools-highlight')?.shadowRoot?.querySelector('div');
    if (!box) return null;
    return {
      box: Math.round(parseFloat(box.style.top)),
      element: Math.round(document.getElementById('far')!.getBoundingClientRect().top),
    };
  });
}

/**
 * The outline the Locators tab draws around a match while its row is hovered
 * (`devtools-rank.js`'s `highlight`), driven through the bundle's own global
 * with the page's clock faked.
 */
test.describe('the DevTools outline of a match', () => {
  test('follows the element as the page scrolls, and goes on its own', async ({ context }) => {
    await openShadowRoots(context);
    const page = await context.newPage();
    await page.clock.install();
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div style="height:1500px"></div><button id="far">Far</button><div style="height:1500px"></div>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'devtools-rank.js') });
    const found = await page.evaluate(() => {
      const devtools = (globalThis as unknown as { __piwiDevtools: DevtoolsScript }).__piwiDevtools;
      return { count: devtools.query("getByRole('button', { name: 'Far' })").count, outlined: devtools.highlight(0) };
    });
    expect(found).toEqual({ count: 1, outlined: true });
    let shown = await outline(page);
    expect(shown?.box).toBe(shown?.element);

    await page.evaluate(() => window.scrollBy(0, 300));
    // The scroll event comes with the next frame the browser draws; the outline moves on the animation frame after it.
    await page.waitForTimeout(200);
    await page.clock.runFor(100);
    shown = await outline(page);
    expect(shown).not.toBeNull();
    expect(shown!.box).toBe(shown!.element);

    await page.clock.runFor(5000);
    expect(await outline(page)).toBeNull();
  });
});
