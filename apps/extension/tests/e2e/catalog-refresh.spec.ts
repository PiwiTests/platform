import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures.js';

/**
 * The regression this guards: the catalog used to be fetched in exactly one
 * place — the options page's save handler — so a function added in the
 * dashboard afterwards never reached the extension. Here a real HTTP server
 * stands in for a Piwi instance and *changes its catalog between requests*,
 * which is precisely the case that used to be invisible.
 *
 * The mock sends `Access-Control-Allow-Origin` so the fetch succeeds without
 * a granted host permission (Playwright can't accept the permission prompt).
 * Against a real instance that grant is what makes this work, which is why
 * the options page now requests it inside the save/test click.
 */
function entry(id: number, name: string) {
  return {
    id,
    name,
    kind: 'helper',
    module: './helpers/x',
    receiver: null,
    importName: null,
    params: [],
    urlPattern: null,
    steps: [{ action: 'click', target: { testId: `t-${id}` } }],
    paramSources: [],
  };
}

let server: Server;
let baseUrl: string;
/** Mutated mid-test to model someone adding a function in the dashboard. */
let catalog = [entry(1, 'login')];
let requestCount = 0;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // The client sends `X-API-Key`, which makes this a non-simple request, so
    // the browser preflights it. A real Piwi instance doesn't answer this —
    // which is exactly why the options page has to obtain a host permission
    // (that bypasses CORS for the extension); the mock answers it so this
    // test can exercise the refresh path without a permission prompt.
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.url?.includes('/test-functions')) {
      requestCount++;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ items: catalog.map((e) => ({ id: e.id, name: e.name, entry: e })) }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.describe.serial('catalog refresh', () => {
  test('a function added after connecting reaches the extension without re-saving options', async ({
    context,
    extensionId,
  }) => {
    catalog = [entry(1, 'login')];
    requestCount = 0;

    // An extension page can message the background worker, exactly as the
    // content-script panels do via `requestCatalogRefresh`.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.evaluate(
      (url) =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              piwiConnection: {
                instanceUrl: url,
                apiKey: 'pd_test',
                projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Demo' }],
              },
              // Start from a cache that predates the change, as a real user would.
              piwiCatalogCache: {},
            },
            resolve,
          );
        }),
      baseUrl,
    );

    const refresh = (force: boolean) =>
      page.evaluate(
        (f) =>
          chrome.runtime.sendMessage({ type: 'piwi-refresh-catalog', projectId: 1, force: f }) as Promise<{
            ok: boolean;
            refreshed?: boolean;
            count?: number | null;
            error?: string;
          }>,
        force,
      );
    const cachedNames = () =>
      page.evaluate(async () => {
        const stored = await chrome.storage.local.get('piwiCatalogCache');
        const store = stored.piwiCatalogCache as Record<string, { entries: Array<{ name: string }> }>;
        return (store?.['1']?.entries ?? []).map((e) => e.name);
      });

    // A never-cached project counts as stale, so even an unforced call fills it.
    expect(await refresh(false)).toMatchObject({ ok: true, refreshed: true, count: 1 });
    expect(await cachedNames()).toEqual(['login']);

    // Someone adds a function in the dashboard.
    catalog = [entry(1, 'login'), entry(2, 'addToCart')];

    // This is the case that used to be impossible: no options save, no
    // reconnect — just the refresh the panels now issue on open.
    expect(await refresh(true)).toMatchObject({ ok: true, refreshed: true, count: 2 });
    expect(await cachedNames()).toEqual(['login', 'addToCart']);
  });

  test('an unforced refresh inside the TTL is skipped instead of re-hitting the instance', async ({
    context,
    extensionId,
  }) => {
    catalog = [entry(1, 'login')];
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.evaluate(
      (url) =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set(
            {
              piwiConnection: {
                instanceUrl: url,
                apiKey: 'pd_test',
                projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Demo' }],
              },
              piwiCatalogCache: {},
            },
            resolve,
          );
        }),
      baseUrl,
    );

    const refresh = (force: boolean) =>
      page.evaluate((f) => chrome.runtime.sendMessage({ type: 'piwi-refresh-catalog', projectId: 1, force: f }), force);

    await refresh(false);
    const afterFirst = requestCount;
    expect(await refresh(false)).toMatchObject({ ok: true, refreshed: false });
    expect(requestCount, 'a fresh cache must not produce a second request').toBe(afterFirst);

    // Forcing bypasses the TTL — what the panel's Refresh button does.
    expect(await refresh(true)).toMatchObject({ ok: true, refreshed: true });
    expect(requestCount).toBe(afterFirst + 1);
  });

  test('a refresh with no connection configured fails cleanly rather than throwing', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          chrome.storage.local.set({ piwiConnection: { instanceUrl: '', apiKey: '', projectMappings: [] } }, resolve);
        }),
    );
    const result = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'piwi-refresh-catalog', projectId: 1, force: true }),
    );
    expect(result).toMatchObject({ ok: false });
  });
});
