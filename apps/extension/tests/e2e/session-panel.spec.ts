import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { stubChromeI18n } from './i18n-stub.js';
import { clippedInShadows, openShadowRoots } from './shadow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

interface FakeSessionPick {
  name: string;
  locator: string;
  pageUrl: string;
}

/**
 * session-panel.ts reads/writes chrome.storage.session directly — real
 * access requires background/index.ts's setAccessLevel call, which only
 * takes effect for a genuine content-script injection. Driving the bundle
 * via page.addScriptTag (the same shortcut lint-scan.spec.ts and
 * assertion-suggest.spec.ts use to exercise real bundle logic without a
 * full popup-driven injection) runs it in the page's own main world
 * instead, which has no chrome.* APIs at all — so this stubs a minimal
 * chrome.storage.session backed by an in-page object, mirroring
 * session-storage.test.ts's own fakeChromeStorage() for the same API.
 *
 * Registered on the *context*, not the page: page.addInitScript's script
 * never actually ran ahead of a subsequent page.setContent() call in this
 * harness (confirmed by a marker-flag experiment — setContent doesn't
 * trigger it the way a real navigation does), whereas context.addInitScript
 * does.
 */
async function stubSessionStorage(
  context: BrowserContext,
  initialPicks: FakeSessionPick[] = [],
  language = 'en',
): Promise<void> {
  await context.addInitScript((seed) => {
    const store: Record<string, unknown> = { piwiPickSession: seed };
    (globalThis as any).chrome = {
      storage: {
        session: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (values: Record<string, unknown>) => {
            Object.assign(store, values);
          },
          remove: async (key: string) => {
            delete store[key];
          },
        },
      },
    };
  }, initialPicks);
  await stubChromeI18n(context, language);
}

async function readStoredPicks(page: Page): Promise<FakeSessionPick[]> {
  return page.evaluate(async () => {
    const result = await (globalThis as any).chrome.storage.session.get('piwiPickSession');
    return result.piwiPickSession ?? [];
  });
}

async function pressTabTimes(page: Page, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await page.keyboard.press('Tab');
}

test.describe('session-panel.js', () => {
  test('opens on an empty session with no crash', async ({ context }) => {
    await stubSessionStorage(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button id="target">Target</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);
  });

  test('adding a named pick end-to-end persists it to chrome.storage.session', async ({ context }) => {
    await stubSessionStorage(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button id="target" data-testid="submit-btn">Submit</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);

    // Empty session: Tab order is closeBtn, then "+ Add pick".
    await pressTabTimes(page, 2);
    await page.keyboard.press('Enter');

    await expect(page.getByText('click any element to generate locators')).toBeVisible();
    await page.hover('#target');
    await page.click('#target');

    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-name-host'))).toBe(true);
    await page.keyboard.type('submitButton');
    await page.keyboard.press('Enter');

    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);
    const picks = await readStoredPicks(page);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ name: 'submitButton', locator: `getByTestId('submit-btn')` });
  });

  test('a duplicate name is rejected and the name prompt stays open', async ({ context }) => {
    await stubSessionStorage(context, [
      { name: 'submitButton', locator: `getByTestId('x')`, pageUrl: 'https://x.test/' },
    ]);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button id="target" data-testid="submit-btn">Submit</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);

    // One existing pick: Tab order is closeBtn, its removeBtn, then "+ Add pick".
    await pressTabTimes(page, 3);
    await page.keyboard.press('Enter');
    await expect(page.getByText('click any element to generate locators')).toBeVisible();
    await page.hover('#target');
    await page.click('#target');

    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-name-host'))).toBe(true);
    await page.keyboard.type('submitButton');
    await page.keyboard.press('Enter');

    // Rejected as a duplicate — the name prompt is still open, session unchanged.
    expect(await page.evaluate(() => !!document.getElementById('piwi-session-name-host'))).toBe(true);
    expect(await readStoredPicks(page)).toHaveLength(1);
  });

  test('Escape while picking cancels just that add, leaving the session unchanged', async ({ context }) => {
    await stubSessionStorage(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button id="target">Target</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);

    await pressTabTimes(page, 2);
    await page.keyboard.press('Enter');
    await expect(page.getByText('click any element to generate locators')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);
    expect(await readStoredPicks(page)).toEqual([]);
  });

  test('Escape while naming cancels just that add, leaving the session unchanged', async ({ context }) => {
    await stubSessionStorage(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button id="target" data-testid="submit-btn">Submit</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);

    await pressTabTimes(page, 2);
    await page.keyboard.press('Enter');
    await expect(page.getByText('click any element to generate locators')).toBeVisible();
    await page.hover('#target');
    await page.click('#target');
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-name-host'))).toBe(true);

    await page.keyboard.press('Escape');

    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);
    expect(await readStoredPicks(page)).toEqual([]);
  });

  test('removes a pick by its row remove button', async ({ context }) => {
    await stubSessionStorage(context, [
      { name: 'submitButton', locator: `getByTestId('x')`, pageUrl: 'https://x.test/' },
    ]);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);

    // One existing pick: Tab order is closeBtn, then its removeBtn.
    await pressTabTimes(page, 2);
    await page.keyboard.press('Enter');

    await expect.poll(() => readStoredPicks(page)).toEqual([]);
  });

  test('clears the whole session', async ({ context }) => {
    await stubSessionStorage(context, [
      { name: 'a', locator: `getByTestId('a')`, pageUrl: 'https://x.test/' },
      { name: 'b', locator: `getByTestId('b')`, pageUrl: 'https://x.test/' },
    ]);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);

    // Two existing picks: closeBtn, removeBtn x2, addBtn, 3 export buttons, then Clear session.
    await pressTabTimes(page, 8);
    await page.keyboard.press('Enter');

    await expect.poll(() => readStoredPicks(page)).toEqual([]);
  });

  test('re-injecting while the panel is already open does not start a second flow', async ({ context }) => {
    await stubSessionStorage(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-session-panel-host'))).toBe(true);
    await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
    await expect(page.locator('#piwi-session-panel-host')).toHaveCount(1);
  });

  test.describe('in French', () => {
    const panelTexts = (page: Page) =>
      page.evaluate(() => {
        const root = document.getElementById('piwi-session-panel-host')?.shadowRoot;
        const dialog = root?.querySelector('[role="dialog"]');
        if (!root || !dialog) return null;
        return {
          lang: (dialog as HTMLElement).lang,
          label: dialog.getAttribute('aria-label'),
          title: root.querySelector('.title')?.textContent,
          sub: root.querySelector('.sub')?.textContent,
          empty: root.querySelector('.empty')?.textContent ?? null,
          remove: [...root.querySelectorAll('button.remove')].map((b) => b.getAttribute('aria-label')),
          actions: [...root.querySelectorAll('button.action')].map((b) => b.textContent),
        };
      });

    test('the empty list', async ({ context }) => {
      await openShadowRoots(context);
      await stubSessionStorage(context, [], 'fr');
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html><body></body></html>`);
      await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
      await expect.poll(() => panelTexts(page)).not.toBeNull();
      expect(await panelTexts(page)).toEqual({
        lang: 'fr',
        label: 'Session\u00a0: éléments nommés',
        title: 'Aucun élément nommé pour l’instant',
        sub: 'Échap pour fermer · La liste reste jusqu’à la fermeture du navigateur',
        empty:
          'Choisissez un élément et donnez-lui un nom. Ajoutez des éléments de plusieurs pages, puis copiez la liste en page object, en tableau Markdown ou en JSON.',
        remove: [],
        actions: ['+ Ajouter un élément'],
      });
      expect(await clippedInShadows(page)).toEqual([]);
    });

    test('a list of two, and the name prompt refusing a name', async ({ context }) => {
      await openShadowRoots(context);
      await stubSessionStorage(
        context,
        [
          { name: 'submitButton', locator: `getByTestId('x')`, pageUrl: 'https://x.test/' },
          { name: 'total', locator: `getByTestId('total')`, pageUrl: 'https://x.test/cart' },
        ],
        'fr',
      );
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html><body>
        <button id="target" data-testid="submit-btn">Submit</button>
      </body></html>`);
      await page.addScriptTag({ path: path.join(DIST, 'session-panel.js') });
      await expect.poll(() => panelTexts(page)).not.toBeNull();
      expect(await panelTexts(page)).toMatchObject({
        title: '2 éléments nommés',
        empty: null,
        remove: ['Retirer submitButton', 'Retirer total'],
        actions: [
          '+ Ajouter un élément',
          'Copier en page object (.ts)',
          'Copier en tableau Markdown',
          'Copier en JSON',
          'Vider la liste',
        ],
      });

      // Two picks: closeBtn, removeBtn x2, then "+ Ajouter un élément".
      await pressTabTimes(page, 4);
      await page.keyboard.press('Enter');
      await page.hover('#target');
      await page.click('#target');
      const prompt = () =>
        page.evaluate(() => {
          const root = document.getElementById('piwi-session-name-host')?.shadowRoot;
          const input = root?.querySelector('input');
          if (!root || !input) return null;
          return {
            lang: (root.querySelector('.bar') as HTMLElement).lang,
            label: input.getAttribute('aria-label'),
            placeholder: input.placeholder,
            save: root.querySelector('button')?.textContent,
            error: root.querySelector('.error')?.textContent,
          };
        });
      await expect.poll(prompt).not.toBeNull();
      expect(await prompt()).toEqual({
        lang: 'fr',
        label: 'Nom de cet élément',
        placeholder: 'Nom, par ex. submitButton',
        save: 'Enregistrer',
        error: '',
      });

      await page.keyboard.press('Enter');
      expect((await prompt())?.error).toBe('Saisissez un nom.');
      await page.keyboard.type('2total');
      await page.keyboard.press('Enter');
      expect((await prompt())?.error).toBe(
        'Utilisez seulement des lettres sans accent, des chiffres, _ ou $, sans commencer par un chiffre.',
      );
      await page.keyboard.press('Control+A');
      await page.keyboard.type('total');
      await page.keyboard.press('Enter');
      expect((await prompt())?.error).toBe('«\u202ftotal\u202f» est déjà dans la liste.');
      expect(await clippedInShadows(page)).toEqual([]);
    });
  });
});
