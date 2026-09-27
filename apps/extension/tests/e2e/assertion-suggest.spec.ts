import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { playwrightLocator } from './playwright-locator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

interface ExposedCandidate {
  method: 'toHaveValue' | 'toHaveText' | 'toHaveAccessibleName' | 'toBeVisible';
  detail: string | null;
  expectLine: string;
}

interface ExposedSuggestion {
  locator: string | null;
  candidates: ExposedCandidate[];
}

/**
 * `suggestAssertions` calls @piwitests/core's `generateAlternatives`, which
 * has its own web of private module-level helpers (`attr`, `esc`, etc.) —
 * like `lint-scan.spec.ts`, this drives the real built `assertion-panel.js`
 * and reads what it bridges out to `globalThis.__piwiAssertionSuggestion`
 * (see that file) instead of attempting `Function.prototype.toString()`
 * reconstruction, which can't carry those helpers along.
 */
async function pickAndSuggest(page: Page, targetSelector: string): Promise<ExposedSuggestion> {
  await page.addScriptTag({ path: path.join(DIST, 'assertion-panel.js') });
  await page.hover(targetSelector);
  await page.click(targetSelector);
  await expect.poll(() => page.evaluate(() => !!(globalThis as any).__piwiAssertionSuggestion)).toBe(true);
  return page.evaluate(() => (globalThis as any).__piwiAssertionSuggestion as ExposedSuggestion);
}

test.describe('suggestAssertions (via the real built assertion-panel.js)', () => {
  test('a plain button with text gets toHaveText, toHaveAccessibleName, and toBeVisible — no toHaveValue', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="submit-btn">Submit</button>
    </body></html>`);
    const { locator, candidates } = await pickAndSuggest(page, '[data-testid="submit-btn"]');

    expect(locator).toBe(`getByTestId('submit-btn')`);
    expect(candidates.map((c) => c.method)).toEqual(['toHaveText', 'toHaveAccessibleName', 'toBeVisible']);
    expect(candidates[0]).toEqual({
      method: 'toHaveText',
      detail: 'Submit',
      expectLine: `await expect(page.getByTestId('submit-btn')).toHaveText('Submit');`,
    });
    expect(candidates[2]).toEqual({
      method: 'toBeVisible',
      detail: null,
      expectLine: `await expect(page.getByTestId('submit-btn')).toBeVisible();`,
    });
  });

  test('a tab with a count badge is named as Playwright names it, and its locator resolves in Playwright', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body style="margin-top:120px">
      <div role="tablist"><button role="tab" id="tab">Regressions<span style="display:inline-flex">5</span></button></div>
    </body></html>`);
    const { locator, candidates } = await pickAndSuggest(page, '#tab');

    expect(locator).toBe(`getByRole('tab', { name: 'Regressions 5' })`);
    expect(candidates.find((c) => c.method === 'toHaveAccessibleName')?.detail).toBe('Regressions 5');
    await expect(playwrightLocator(page, locator!)).toHaveAccessibleName('Regressions 5');
    // toHaveText compares the element's text, which has no space.
    await expect(playwrightLocator(page, locator!)).toHaveText('Regressions5');
  });

  test('whitespace in text content is normalized (collapsed and trimmed)', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="msg-btn">   Hello   \n   World   </button>
    </body></html>`);
    const { candidates } = await pickAndSuggest(page, '[data-testid="msg-btn"]');

    const textCandidate = candidates.find((c) => c.method === 'toHaveText');
    expect(textCandidate?.detail).toBe('Hello World');
    expect(textCandidate?.expectLine).toContain(`toHaveText('Hello World')`);
  });

  test('a text input with a value and placeholder gets toHaveValue and toHaveAccessibleName, not toHaveText', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <input data-testid="email-input" value="user@example.com" placeholder="Email" />
    </body></html>`);
    const { locator, candidates } = await pickAndSuggest(page, '[data-testid="email-input"]');

    expect(locator).toBe(`getByTestId('email-input')`);
    expect(candidates.map((c) => c.method)).toEqual(['toHaveValue', 'toHaveAccessibleName', 'toBeVisible']);
    expect(candidates[0]).toMatchObject({ detail: 'user@example.com' });
    expect(candidates[1]).toMatchObject({ detail: 'Email' });
  });

  test('a checkbox does not get toHaveValue (checked state, not value, is the relevant signal)', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <input type="checkbox" data-testid="agree-checkbox" checked />
    </body></html>`);
    const { candidates } = await pickAndSuggest(page, '[data-testid="agree-checkbox"]');

    expect(candidates.map((c) => c.method)).not.toContain('toHaveValue');
  });

  test('an element with no identifying attributes, text, or role yields no locator and no candidates', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div style="width:60px;height:20px;"></div>
    </body></html>`);
    const { locator, candidates } = await pickAndSuggest(page, 'div');

    expect(locator).toBeNull();
    expect(candidates).toEqual([]);
  });
});
