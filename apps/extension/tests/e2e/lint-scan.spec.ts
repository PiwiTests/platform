import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

interface ExposedFinding {
  tag: string;
  role: string;
  accessibleName: string | null;
  suggestedTestId: string;
  bestScore: number;
}

/**
 * `scanForLintIssues` calls @piwitests/core's `generateAlternatives`, which
 * has its own web of private module-level helpers (`attr`, `esc`, etc.) —
 * unlike `derivePattern`, stringifying it alone via
 * `Function.prototype.toString()` can't carry those along, and they aren't
 * exported to install individually either. Driving the real built
 * `lint-overlay.js` and reading the findings it bridges out to
 * `globalThis.__piwiLintFindings` (see that file) exercises the real,
 * fully-bundled function instead.
 */
async function scan(page: Page): Promise<ExposedFinding[]> {
  await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
  const findings = (await (
    await page.waitForFunction(() => (globalThis as any).__piwiLintFindings as ExposedFinding[] | undefined)
  ).jsonValue()) as ExposedFinding[];
  // Tear the overlay back down so each test starts clean and to mirror how
  // a real user would dismiss it — a second trigger of the same script toggles it off.
  await page.addScriptTag({ path: path.join(DIST, 'lint-overlay.js') });
  return findings;
}

test.describe('scanForLintIssues (via the real built lint-overlay.js)', () => {
  test('does not flag a button with a test id', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="submit-btn">Submit</button>
    </body></html>`);
    expect(await scan(page)).toEqual([]);
  });

  test('does not flag a button with an accessible name (text content)', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button>Submit</button>
    </body></html>`);
    expect(await scan(page)).toEqual([]);
  });

  test('flags duplicate anonymous buttons with no test id, name, or unique structural anchor', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button></button>
      <button></button>
    </body></html>`);
    const findings = await scan(page);
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.tag).toBe('button');
      expect(f.role).toBe('button');
      expect(f.accessibleName).toBeNull();
      expect(f.bestScore).toBeLessThan(50);
    }
    expect(findings.map((f) => f.suggestedTestId)).toEqual(['button-1', 'button-2']);
  });

  test('flags buttons sharing a name no locator tells apart but by position', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button aria-label="Show popup"></button>
      <button aria-label="Show popup"></button>
    </body></html>`);
    const findings = await scan(page);
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.accessibleName).toBe('Show popup');
      expect(f.bestScore).toBeLessThan(50);
    }
  });

  test('does not flag buttons sharing a name but showing different text', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button aria-label="Show popup">Details</button>
      <button aria-label="Show popup">History</button>
    </body></html>`);
    expect(await scan(page)).toEqual([]);
  });

  test('numbers suggested test ids per role, not with one counter shared across roles', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button></button>
      <input type="checkbox" />
      <button></button>
      <input type="checkbox" />
    </body></html>`);
    const findings = await scan(page);
    expect(findings.map((f) => f.suggestedTestId)).toEqual(['button-1', 'checkbox-1', 'button-2', 'checkbox-2']);
  });

  test('checks every button of a long table, its rows and cells aside', async ({ context }) => {
    const page = await context.newPage();
    const rows = Array.from({ length: 300 }, () => '<tr><td>Item</td><td>12 €</td><td><button></button></td></tr>');
    await page.setContent(`<!doctype html><html><body><table><tbody>${rows.join('')}</tbody></table></body></html>`);
    const findings = await scan(page);
    expect(findings).toHaveLength(300);
    expect(findings[findings.length - 1]).toMatchObject({ role: 'button', suggestedTestId: 'button-300' });
  });

  test('checks the elements inside a web component', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><toolbar-buttons></toolbar-buttons><script>
      customElements.define('toolbar-buttons', class extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: 'open' }).innerHTML = '<button></button><button></button>';
        }
      });
    </script></body></html>`);
    const findings = await scan(page);
    expect(findings.map((f) => f.suggestedTestId)).toEqual(['button-1', 'button-2']);
  });

  test('leaves the page responsive while it checks a long table', async ({ context }) => {
    const page = await context.newPage();
    const rows = Array.from({ length: 300 }, () => '<tr><td>Item</td><td><button></button></td></tr>');
    await page.setContent(`<!doctype html><html><body><table><tbody>${rows.join('')}</tbody></table></body></html>`);
    await page.evaluate(() => {
      const g = globalThis as unknown as { __longTasks: number[] };
      g.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) g.__longTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: true });
    });
    expect(await scan(page)).toHaveLength(300);
    const longest = await page.evaluate(() =>
      Math.max(0, ...(globalThis as unknown as { __longTasks: number[] }).__longTasks),
    );
    expect(longest).toBeLessThan(500);
  });

  test('leaves out the elements hidden from the accessibility tree, as getByRole does', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div style="display:none"><button></button><button></button></div>
      <div aria-hidden="true"><button></button></div>
      <button data-testid="submit-btn">Submit</button>
    </body></html>`);
    expect(await scan(page)).toEqual([]);
  });

  test('ignores non-interactive roles (headings, regions) even when anonymous', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <h2></h2>
      <nav></nav>
    </body></html>`);
    expect(await scan(page)).toEqual([]);
  });
});
