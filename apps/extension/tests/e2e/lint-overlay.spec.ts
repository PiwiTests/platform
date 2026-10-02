import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';
import { stubChromeI18n } from './i18n-stub.js';
import { clippedInShadows, openShadowRoots } from './shadow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * The lint panel (and its per-element outline boxes) lives in a closed
 * shadow root by design (same reasoning as `results-panel.ts`), so — like
 * `pick.spec.ts` — these tests assert only externally-observable effects
 * (host presence, toggling, and that the page underneath stays interactive)
 * rather than shadow-root-internal content. `scanForLintIssues`'s own
 * matching/scoring logic is covered directly in `lint-scan.spec.ts`.
 */
test.describe('lint-overlay.js', () => {
  test('mounts on trigger and a second trigger toggles it back off', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button></button><button></button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-lint-overlay-host'))).toBe(true);

    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-lint-overlay-host'))).toBe(false);
  });

  test('Escape closes it', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button></button><button></button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => !!document.getElementById('piwi-lint-overlay-host'))).toBe(false);
  });

  test('mounts even when nothing scores badly (empty-state panel)', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button data-testid="ok-btn">Save</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-lint-overlay-host'))).toBe(true);
  });

  test('the page underneath stays clickable while the overlay is open', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button id="target" style="position:absolute;top:200px;left:10px;">Click me</button>
      <button></button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });

    let clicked = false;
    await page.exposeFunction('__recordClick', () => {
      clicked = true;
    });
    await page.evaluate(() =>
      document.getElementById('target')!.addEventListener('click', () => (window as any).__recordClick()),
    );

    await page.click('#target');
    expect(clicked).toBe(true);
  });

  test('re-injecting while already open does not stack a second host', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button></button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
    // An odd number of toggles (3) ends up open — this just confirms each
    // toggle fully tears down the previous host rather than stacking hosts.
    expect(await page.locator('#piwi-lint-overlay-host').count()).toBe(1);
  });

  test('says so when the page has more buttons, links and fields than it checks', async ({ context }) => {
    await openShadowRoots(context);
    await stubChromeI18n(context);
    const page = await context.newPage();
    const buttons = Array.from({ length: 801 }, (_, i) => `<button data-testid="go-${i}">Go</button>`).join('');
    await page.setContent(`<!doctype html><html><body>${buttons}</body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });

    const panel = page.locator('#piwi-lint-overlay-host .panel');
    await expect(panel.locator('.title')).toHaveText('Looking for elements hard to target…');
    // Each element is ranked as the Pick results rank it, which reads the whole page: 800 of them take a while.
    await expect(panel.locator('.title')).toHaveText('No element hard to target', { timeout: 40_000 });
    await expect(panel.locator('.notice')).toHaveText(
      'Checked the first 800 of the 801 buttons, links and fields on this page.',
    );
  });

  test('speaks French in a French browser', async ({ context }) => {
    await openShadowRoots(context);
    await stubChromeI18n(context, 'fr');
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button></button><button></button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });

    const panel = page.locator('#piwi-lint-overlay-host .panel');
    await expect(panel).toHaveAttribute('lang', 'fr');
    await expect(panel).toHaveAttribute('aria-label', 'Contrôle\u00a0: éléments difficiles à cibler');
    await expect(panel.locator('.title')).toHaveText('2 éléments difficiles à cibler');
    await expect(panel.locator('.export')).toHaveText('Copier en liste de tâches Markdown');
    await expect(panel.locator('.row .name').first()).toHaveText('rôle button');
    await expect(panel.locator('.row code').first()).toHaveAttribute('title', 'Cliquer pour copier');
    await expect(panel.getByRole('button', { name: 'Fermer le contrôle' })).toBeVisible();
    expect(await clippedInShadows(page)).toEqual([]);
  });

  test('lays out in German without clipping', async ({ context }) => {
    await openShadowRoots(context);
    await stubChromeI18n(context, 'de');
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button></button><button></button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });

    const panel = page.locator('#piwi-lint-overlay-host .panel');
    await expect(panel).toHaveAttribute('lang', 'de');
    await expect(panel.locator('.row').first()).toBeVisible();
    expect(await clippedInShadows(page)).toEqual([]);
  });
});
