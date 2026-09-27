import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { stubChromeI18n } from './i18n-stub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * test-function-panel.ts reads chrome.storage.local (connection settings,
 * the catalog cache) directly — real access needs a genuine content-script
 * injection. Driving the bundle via page.addScriptTag (the same shortcut
 * session-panel.spec.ts/record.spec.ts use) runs in the page's own main
 * world instead, so this stubs a minimal chrome.storage.local. No
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
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (values: Record<string, unknown>) => Object.assign(store, values),
          remove: async (key: string) => {
            delete store[key];
          },
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
});
