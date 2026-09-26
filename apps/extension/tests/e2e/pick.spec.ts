import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * Drives the real built `pick.js` — injected the same way
 * `chrome.scripting.executeScript({ files: ['pick.js'] })` would, since
 * Playwright has no API to click the browser's own toolbar icon (the
 * popup→injection wiring itself is covered by `popup.spec.ts` and manual
 * verification, not simulated end-to-end here).
 */
test.describe('pick.js', () => {
  test('picks an element, skips the anchors step, and opens the results panel', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <form data-testid="signup-form"><button id="target" data-testid="join-btn">Join now</button></form>
    </body></html>`);

    await page.addScriptTag({ path: path.join(DIST, 'pick.js') });
    await expect(page.getByText('click any element to generate locators')).toBeVisible();

    await page.hover('#target');
    await page.click('#target');

    // The role has an anchor-worthy ancestor (the form's data-testid), so the
    // anchors step opens — skip it to reach the results panel.
    await expect(page.getByText('Scope to stable parents')).toBeVisible();
    await page.getByRole('button', { name: 'Skip (Esc)' }).click();

    // The results panel lives in a closed shadow root (deliberate — see
    // results-panel.ts) so its contents aren't reachable through Playwright's
    // locator engine; the host existing confirms the flow reached the end.
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-picker-results-host'))).toBe(true);
    // …and the picking overlay must be gone by then. It used to survive to the
    // end of the flow still reading "Analyzing element…", which looked exactly
    // like a pick that had hung.
    await expect(page.locator('#__piwi_picker_banner')).toHaveCount(0);
  });

  test('the hover preview shows the ranked locator, not the overlay approximation', async ({ context }) => {
    const page = await context.newPage();
    // An id and an accessible name: the overlay's own descriptor would settle
    // for `locator('#target')`, the ranking engine prefers the role+name.
    await page.setContent(`<!doctype html><html><body style="margin-top:120px">
      <button id="target">Join now</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'pick.js') });
    await expect(page.getByText('click any element to generate locators')).toBeVisible();

    await page.hover('#target');
    await expect(page.locator('#__piwi_picker_locator')).toContainText("getByRole('button', { name: 'Join now' })");
    await expect(page.locator('#__piwi_picker_label')).toContainText("getByRole('button', { name: 'Join now' })");
  });

  test('a form control named only by its label is located by that label', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body style="margin-top:120px">
      <label for="country">Country</label>
      <select id="country"><option>United Kingdom</option><option>Ireland</option><option>France</option></select>
      <label><input type="checkbox" id="news"> Keep me posted on new roasts</label>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'pick.js') });
    await expect(page.getByText('click any element to generate locators')).toBeVisible();

    const preview = page.locator('#__piwi_picker_locator');
    await page.hover('#country');
    await expect(preview).toContainText("getByRole('combobox', { name: 'Country' })");
    // The suggestion resolves in real Playwright too.
    await expect(page.getByRole('combobox', { name: 'Country' })).toHaveId('country');

    await page.hover('#news');
    await expect(preview).toContainText("getByRole('checkbox', { name: 'Keep me posted on new roasts' })");
    await page.evaluate(() => document.getElementById('news')!.removeAttribute('id'));
    await page.mouse.move(0, 0);
    await page.hover('input[type=checkbox]');
    await expect(preview).toContainText("getByRole('checkbox', { name: 'Keep me posted on new roasts' })");
  });

  test('Escape at the element step ends the flow with no results panel', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button id="x">X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'pick.js') });
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (globalThis as any).__piwiPicking)).toBe(false);
    expect(await page.evaluate(() => !!document.getElementById('piwi-picker-results-host'))).toBe(false);
  });

  test('re-injecting while a pick is already in progress does not double-install the overlay', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button id="x">X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'pick.js') });
    await expect(page.getByText('click any element to generate locators')).toBeVisible();
    await page.addScriptTag({ path: path.join(DIST, 'pick.js') });
    // Still exactly one banner/highlight pair — the guard in pick.ts returned
    // early on the second injection instead of installing a second overlay.
    await expect(page.locator('#__piwi_picker_banner')).toHaveCount(1);
  });
});
