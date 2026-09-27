import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';
import { playwrightLocator } from './playwright-locator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * The console's input, verdict text, and highlight boxes all live in a
 * closed shadow root by design (same reasoning as `results-panel.ts`), so —
 * like `hover-inspect.spec.ts` and `pick.spec.ts` — these tests assert only
 * externally-observable effects (host presence, toggling, and that the page
 * underneath stays interactive) rather than shadow-root-internal content,
 * and the count the console bridges out to `globalThis.__piwiConsoleCount`.
 * The engine behind it is compared with Playwright in `locator-engine.spec.ts`.
 */
test.describe('locator-console.js', () => {
  test('mounts on trigger and a second trigger toggles it back off', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-locator-console-host'))).toBe(true);

    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });
    expect(await page.evaluate(() => !!document.getElementById('piwi-locator-console-host'))).toBe(false);
  });

  test('Escape closes it', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => !!document.getElementById('piwi-locator-console-host'))).toBe(false);
  });

  test('what is typed in it never reaches the page’s own shortcuts', async ({ context }) => {
    const page = await context.newPage();
    // A page that acts on single keys and on paste, as the dashboard's inbox does.
    await page.setContent(`<!doctype html><html><body><button data-testid="x">X</button><script>
      window.__seen = [];
      for (const type of ['keydown', 'keyup', 'keypress', 'input', 'paste'])
        document.addEventListener(type, (e) => window.__seen.push(type + ':' + (e.key ?? '')));
    </script></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });
    await page.keyboard.type(`getByRole('button')`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+A');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([]);
  });

  test('typing a valid locator expression does not throw an unhandled page error', async ({ context }) => {
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));
    await page.setContent(`<!doctype html><html><body><button data-testid="x">X</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });

    // The input auto-focuses on mount, so typed keys land there even though
    // it's inside a closed shadow root — keyboard events route to whatever
    // currently has focus regardless of shadow-root mode.
    await page.keyboard.type(`getByTestId('x')`);
    await page.waitForTimeout(100);
    expect(pageErrors).toHaveLength(0);
  });

  test('counts what Playwright finds: a role name is a case-insensitive substring unless exact', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div role="tablist"><button role="tab">Regressions<span style="display:inline-flex">5</span></button></div>
      <button>Failed</button><button>3 failed</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });
    const countOf = async (expression: string) => {
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type(expression);
      return page.evaluate(() => (globalThis as { __piwiConsoleCount?: number }).__piwiConsoleCount);
    };
    for (const expression of [
      `getByRole('button', { name: 'Failed' })`,
      `getByRole('button', { name: 'Failed', exact: true })`,
      `getByRole('tab', { name: 'Regressions 5' })`,
      `getByRole('tab', { name: 'Regressions5' })`,
      `getByRole('button').filter({ hasText: 'failed' }).last()`,
    ]) {
      expect(await countOf(expression), expression).toBe(await playwrightLocator(page, expression).count());
    }
    expect(await countOf(`getByRole('button', { name: 'Failed' })`)).toBe(2);
    expect(await countOf(`getByRole('tab', { name: 'Regressions 5' })`)).toBe(1);
  });

  test('an unsupported expression is caught as a verdict, not thrown to the page', async ({ context }) => {
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));
    await page.setContent(`<!doctype html><html><body></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });

    await page.keyboard.type(`evaluate('x')`);
    await page.waitForTimeout(100);
    expect(pageErrors).toHaveLength(0);
  });

  test('the page underneath stays clickable and scrollable while the console is open', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body style="height:2000px">
      <button id="target" style="position:absolute;top:10px;left:10px;">Click me</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'locator-console.js') });

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
});
