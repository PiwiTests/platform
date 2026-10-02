import { test, expect } from '@playwright/test';
import { showAnchorPicker } from '../../src/overlay-anchors.js';
import { showPickerChoices } from '../../src/overlay-confirm.js';

test.describe('showAnchorPicker', () => {
  test('lists ancestor rows and resolves the selection with a live match count', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <form data-testid="signup-form">
        <button id="target">Join</button>
      </form>
      <button>Elsewhere</button>
    </body></html>`);
    await page.evaluate(() => {
      (globalThis as any).__piwiPickedElement = document.getElementById('target');
    });
    await page.evaluate(showAnchorPicker, {
      tagRoles: { button: 'button', form: 'form' },
      inputRoles: {},
      roleSources: 'button',
      leafRole: 'button',
      leafLevel: null,
      leafTestId: null,
    });

    const row = page.locator('label').first();
    await expect(row).toContainText('data-testid="signup-form"');
    await row.locator('input[type="checkbox"]').check();

    await expect(page.getByText('Selection matches exactly 1 element')).toBeVisible();
    await page.getByRole('button', { name: 'Use selected parents' }).click();

    const state = await page.evaluate(() => (globalThis as any).__piwiAnchorState);
    expect(state).toBe('done');
    const anchors = await page.evaluate(() => (globalThis as any).__piwiPickAnchors);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].testId).toBe('signup-form');
  });

  test('says the match count is unavailable for a role the maps cannot give the element', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <article data-testid="card"><p id="target">12 €</p></article>
    </body></html>`);
    await page.evaluate(() => {
      (globalThis as any).__piwiPickedElement = document.getElementById('target');
    });
    // The host's model gives the <p> the role paragraph; the maps passed here know no such tag.
    await page.evaluate(showAnchorPicker, {
      tagRoles: { article: 'article' },
      inputRoles: {},
      roleSources: 'article',
      leafRole: 'paragraph',
      leafLevel: null,
      leafTestId: null,
    });

    const row = page.locator('label').first();
    await expect(row).toContainText('data-testid="card"');
    await expect(row).toContainText('Match count unavailable');
    await row.locator('input[type="checkbox"]').check();
    await expect(page.getByText('Match count unavailable').last()).toBeVisible();
    await expect(page.getByText(/Selection matches \d+ elements/)).toHaveCount(0);
  });

  test('speaks the host’s texts when it gives them, English otherwise', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <form data-testid="signup-form"><button id="target">Join</button></form>
      <form data-testid="other-form"><button>Join</button></form>
    </body></html>`);
    const arg = {
      tagRoles: { button: 'button', form: 'form' },
      inputRoles: {},
      roleSources: 'button',
      leafRole: 'button',
      leafLevel: null,
      leafTestId: null,
    };
    await page.evaluate(() => {
      (globalThis as any).__piwiPickedElement = document.getElementById('target');
    });
    await page.evaluate(showAnchorPicker, arg);
    await expect(page.getByText('Scope to stable parents (optional)')).toBeVisible();
    await expect(page.getByText('No parents selected — standard alternatives only.')).toBeVisible();
    await page.getByRole('button', { name: 'Skip (Esc)' }).click();

    await page.evaluate(showAnchorPicker, {
      ...arg,
      strings: {
        title: 'Limiter à des parents stables',
        noneSelected: 'Aucun parent choisi',
        matchesOne: '✓ 1 élément',
        matchesMany: '✗ {count} éléments',
        containsOne: 'contient 1 élément',
        use: 'Utiliser',
        skip: 'Passer (Échap)',
      },
    });
    await expect(page.getByText('Limiter à des parents stables')).toBeVisible();
    await expect(page.getByText('Aucun parent choisi')).toBeVisible();
    await expect(page.getByText('contient 1 élément')).toBeVisible();
    await page.locator('label').first().locator('input[type="checkbox"]').check();
    await expect(page.getByText('✓ 1 élément')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Utiliser' })).toBeVisible();
    await page.getByRole('button', { name: 'Passer (Échap)' }).click();
    expect(await page.evaluate(() => (globalThis as any).__piwiAnchorState)).toBe('skipped');
  });

  test('fits a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.setContent(`<!doctype html><html><body>
      <form data-testid="signup-form"><button id="target">Join</button></form>
    </body></html>`);
    await page.evaluate(() => {
      (globalThis as any).__piwiPickedElement = document.getElementById('target');
    });
    await page.evaluate(showAnchorPicker, {
      tagRoles: { button: 'button', form: 'form' },
      inputRoles: {},
      roleSources: 'button',
      leafRole: 'button',
      leafLevel: null,
      leafTestId: null,
    });
    const box = await page.getByText('Scope to stable parents (optional)').locator('..').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  });

  test('Escape resolves as skipped', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <form data-testid="signup-form"><button id="target">Join</button></form>
    </body></html>`);
    await page.evaluate(() => {
      (globalThis as any).__piwiPickedElement = document.getElementById('target');
    });
    await page.evaluate(showAnchorPicker, {
      tagRoles: { button: 'button', form: 'form' },
      inputRoles: {},
      roleSources: 'button',
      leafRole: 'button',
      leafLevel: null,
      leafTestId: null,
    });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (globalThis as any).__piwiAnchorState)).toBe('skipped');
  });
});

test.describe('showPickerChoices', () => {
  test('renders ranked choices and resolves the clicked index', async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(showPickerChoices, {
      failing: `getByText('Pay now')`,
      choices: [
        { locator: `getByTestId('pay-now')`, score: 100 },
        { locator: `getByRole('button', { name: 'Pay now' })`, score: 90 },
      ],
    });
    const buttons = page.locator('button');
    // Two choices plus the trailing "skip" control.
    await expect(buttons).toHaveCount(3);
    await buttons.nth(1).click();
    expect(await page.evaluate(() => (globalThis as any).__piwiPickChoice)).toBe(1);
  });

  test('skip resolves to -1', async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(showPickerChoices, {
      failing: null,
      choices: [{ locator: `getByTestId('x')`, score: 100 }],
    });
    await page.getByText('Skip — keep the failure as-is').click();
    expect(await page.evaluate(() => (globalThis as any).__piwiPickChoice)).toBe(-1);
  });
});
