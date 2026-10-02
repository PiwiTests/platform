import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { stubChromeI18n } from './i18n-stub.js';
import { clippedInShadows, openShadowRoots } from './shadow.js';
import { servePages } from './engine-bundle.js';

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
  /** Which storage area's reads throw, as they do before the worker opens session storage to content scripts; `catalog` for the cached catalog's read alone. */
  failing: 'local' | 'session' | 'catalog' | null = null,
): Promise<void> {
  await context.addInitScript(
    ({ initialSeed, failingArea }) => {
      const store: Record<string, unknown> = { ...initialSeed };
      const session: Record<string, unknown> = {};
      const fail = (area: string) => {
        if (area === failingArea) throw new Error(`Access to storage is not allowed from this context.`);
      };
      (globalThis as any).chrome = {
        storage: {
          local: {
            get: async (key: string) => {
              fail('local');
              if (key === 'piwiCatalogCache') fail('catalog');
              return { [key]: store[key] };
            },
            set: async (values: Record<string, unknown>) => Object.assign(store, values),
            remove: async (key: string) => {
              delete store[key];
            },
          },
          session: {
            get: async (key: string) => {
              fail('session');
              return { [key]: session[key] };
            },
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
    },
    { initialSeed: seed, failingArea: failing },
  );
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
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('#piwi-test-function-host').length)).toBe(1);
  });

  const CONNECTED = {
    instanceUrl: 'https://piwi.test',
    apiKey: '',
    projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Test project' }],
  };

  test('counts what Playwright finds: not a hidden copy, and inside web components', async ({ context }) => {
    await stubStorage(context, {
      piwiConnection: CONNECTED,
      piwiCatalogCache: {
        '1': {
          entries: [
            {
              ...CATALOG_ENTRY,
              name: 'openPricing',
              steps: [{ action: 'click', target: { role: 'link', name: 'Pricing' } }],
            },
            {
              ...CATALOG_ENTRY,
              id: 2,
              name: 'checkOut',
              steps: [{ action: 'click', target: { role: 'button', name: 'Check out' } }],
            },
          ],
          fetchedAt: Date.now(),
        },
      },
    });
    await openShadowRoots(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <nav class="desktop"><a href="/pricing">Pricing</a></nav>
      <nav class="mobile" style="display:none"><a href="/pricing">Pricing</a></nav>
      <cart-widget></cart-widget>
      <script>
        customElements.define('cart-widget', class extends HTMLElement {
          constructor() {
            super();
            this.attachShadow({ mode: 'open' }).innerHTML = '<button>Check out</button>';
          }
        });
      </script>
    </body></html>`);
    await expect(page.getByRole('link', { name: 'Pricing' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Check out' })).toHaveCount(1);
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });

    const panel = page.locator('#piwi-test-function-host .panel');
    await expect(panel.locator('.row.ready')).toHaveCount(2);
    await expect(panel.locator('.row.ready .step')).toHaveText(['click() → one element', 'click() → one element']);
  });

  test('opens when the session storage cannot be read, from the URL mapping alone', async ({ context }) => {
    await stubStorage(
      context,
      { piwiConnection: CONNECTED, piwiCatalogCache: { '1': { entries: [CATALOG_ENTRY], fetchedAt: Date.now() } } },
      'session',
    );
    await openShadowRoots(context);
    const page = await context.newPage();
    // A page with an origin: the project chosen in the popup is kept per origin, in session storage.
    await servePages(page, 'https://shop.test', {
      'shop.html': `<!doctype html><html><body><button>Add to cart</button></body></html>`,
    });
    await page.goto('https://shop.test/shop.html');
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });
    const panel = page.locator('#piwi-test-function-host .panel');
    await expect(panel.locator('.row.ready')).toContainText('addToCart');
    await page.keyboard.press('Escape');
    await expect(page.locator('#piwi-test-function-host')).toHaveCount(0);
  });

  test('leaves nothing over the page when the settings cannot be read', async ({ context }) => {
    await stubStorage(context, {}, 'local');
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html><body><button onclick="this.textContent = 'Clicked'">Add to cart</button></body></html>`,
    );
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });
    await expect
      .poll(() => page.evaluate(() => (globalThis as { __piwiActiveTool?: unknown }).__piwiActiveTool ?? null))
      .toBeNull();
    await expect(page.locator('#piwi-test-function-host')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add to cart' }).click({ timeout: 2000 });
    await expect(page.getByRole('button')).toHaveText('Clicked');
  });

  test('says so when the cached catalog cannot be read, and holds the focus', async ({ context }) => {
    await stubStorage(context, { piwiConnection: CONNECTED }, 'catalog');
    await openShadowRoots(context);
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Add to cart</button></body></html>`);
    await page.addScriptTag({ path: path.join(DIST, 'test-function-panel.js') });
    const panel = page.locator('#piwi-test-function-host .panel');
    await expect(panel.locator('.empty')).toHaveText(
      'The test functions kept in this browser could not be read. Refresh to download them again.',
    );
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    await expect(panel.getByRole('link', { name: /Test project/ })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(panel.getByRole('button', { name: 'Close' })).toBeFocused();
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
