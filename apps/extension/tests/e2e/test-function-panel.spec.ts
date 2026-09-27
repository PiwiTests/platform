import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { stubChromeI18n } from './i18n-stub.js';
import { clippedInShadows, openShadowRoots } from './shadow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * test-function-panel.ts reads chrome.storage.local (connection settings,
 * the catalog cache) directly — real access needs a genuine content-script
 * injection. Driving the bundle via page.addScriptTag (the same shortcut
 * session-panel.spec.ts/record.spec.ts use) runs in the page's own main
 * world instead, so this stubs a minimal chrome.storage (local and session)
 * and a chrome.runtime with no worker behind it. No
 * cross-navigation persistence is needed here (unlike record.spec.ts's
 * window.name trick) since this panel is a single-page, single-injection
 * feature.
 */
async function stubStorage(
  context: BrowserContext,
  seed: { piwiConnection?: unknown; piwiCatalogCache?: unknown } = {},
): Promise<void> {
  await context.addInitScript((initialSeed) => {
    const store: Record<string, unknown> = { ...initialSeed };
    const session: Record<string, unknown> = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (values: Record<string, unknown>) => Object.assign(store, values),
          remove: async (key: string) => {
            delete store[key];
          },
        },
        session: {
          get: async (key: string) => ({ [key]: session[key] }),
          set: async (values: Record<string, unknown>) => Object.assign(session, values),
          remove: async (key: string) => {
            delete session[key];
          },
        },
      },
      // No worker: the panel's catalog refresh fails quietly and it shows the cached catalog.
      runtime: {
        sendMessage: async () => {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        },
      },
    };
  }, seed);
  await stubChromeI18n(context);
}

const CATALOG_ENTRY = {
  id: 1,
  name: 'addToCart',
  kind: 'helper',
  module: './helpers/cart',
  receiver: null,
  importName: null,
  params: [],
  urlPattern: null,
  steps: [{ action: 'click', target: { role: 'button', name: 'Add to cart' } }],
  paramSources: [],
};

test.describe('test-function-panel.js', () => {
  test('opens with no crash when not connected to a Piwi instance', async ({ context }) => {
    await stubStorage(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Add to cart</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-test-function-host'))).toBe(true);
  });

  test('opens and scans the page when a catalog is cached', async ({ context }) => {
    await stubStorage(context, {
      piwiConnection: {
        instanceUrl: 'https://piwi.test',
        apiKey: '',
        projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Test project' }],
      },
      piwiCatalogCache: { '1': { entries: [CATALOG_ENTRY], fetchedAt: Date.now() } },
    });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Add to cart</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-test-function-host'))).toBe(true);
  });

  test('re-injecting re-runs the scan instead of stacking a second host', async ({ context }) => {
    await stubStorage(context, {
      piwiConnection: {
        instanceUrl: 'https://piwi.test',
        apiKey: '',
        projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Test project' }],
      },
      piwiCatalogCache: { '1': { entries: [CATALOG_ENTRY], fetchedAt: Date.now() } },
    });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Add to cart</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-test-function-host'))).toBe(true);
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });
    expect(await page.evaluate(() => document.querySelectorAll('#piwi-test-function-host').length)).toBe(1);
  });

  /** Opens the panel in `language` over a page with one ready and one ambiguous function. */
  async function openInLanguage(context: BrowserContext, language: string) {
    await stubStorage(context, {
      piwiConnection: {
        instanceUrl: 'https://piwi.test',
        apiKey: '',
        projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Test project' }],
      },
      piwiCatalogCache: {
        '1': {
          entries: [
            CATALOG_ENTRY,
            { ...CATALOG_ENTRY, id: 2, name: 'openMenu', steps: [{ action: 'click', target: { role: 'button' } }] },
          ],
          fetchedAt: Date.now(),
        },
      },
    });
    await stubChromeI18n(context, language);
    await openShadowRoots(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Add to cart</button><button>Menu</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });
    const panel = page.locator('#piwi-test-function-host .panel');
    return { page, panel };
  }

  test('speaks French in a French browser, and leaves function names and actions as they are', async ({ context }) => {
    const { page, panel } = await openInLanguage(context, 'fr');
    await expect(panel).toHaveAttribute('lang', 'fr');
    await expect(panel.locator('.title')).toHaveText('Fonctions de test sur cette page');
    await expect(
      panel.getByRole('link', { name: 'Gérer les fonctions du projet Test project dans Piwi ↗' }),
    ).toBeVisible();
    await expect(panel.locator('.row.ready')).toContainText('addToCart');
    await expect(panel.locator('.row.ready .badge')).toHaveText('Prête à l’emploi ici');
    await expect(panel.locator('.row.ready .step')).toHaveText('click() → un élément');
    await expect(panel.locator('.row.partial .step')).toHaveText('click() → 2 éléments, impossible de savoir lequel');
    expect(await clippedInShadows(page)).toEqual([]);
  });

  test('lays out in German without clipping', async ({ context }) => {
    const { page, panel } = await openInLanguage(context, 'de');
    await expect(panel).toHaveAttribute('lang', 'de');
    await expect(panel.locator('.row.partial .step')).toBeVisible();
    expect(await clippedInShadows(page)).toEqual([]);
  });
});
