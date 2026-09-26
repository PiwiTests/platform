import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures.js';

/**
 * The real background worker fetching a project's locator index from a
 * stand-in Piwi instance: the answer carries the index, the cache keeps it,
 * and an unforced request inside the TTL does not re-hit the instance.
 */

let server: Server;
let baseUrl: string;
let requests: Array<{ url: string; apiKey: string | undefined }> = [];
let locators = ["getByRole('button', { name: 'Pay' })"];

function locatorIndex() {
  return {
    projectId: 1,
    projectName: 'shop',
    builtAt: null,
    generatedAt: new Date().toISOString(),
    testIdAttributes: ['data-qa'],
    tests: [{ id: 11, title: 'pays', file: 'tests/pay.spec.ts', suite: [], status: 'passed' }],
    locators: locators.map((locator) => ({
      locator,
      lastSeenAt: new Date().toISOString(),
      uses: [{ test: 0, actions: ['click'], callSites: ['tests/pay.spec.ts:4:3'], projects: ['chromium'] }],
    })),
    truncated: false,
  };
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.url?.split('?')[0] === '/api/projects/1/locator-index') {
      requests.push({ url: req.url, apiKey: req.headers['x-api-key'] as string | undefined });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(locatorIndex()));
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

test('the worker fetches, caches and revalidates a project’s locator index', async ({ context, extensionId }) => {
  requests = [];
  locators = ["getByRole('button', { name: 'Pay' })"];
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(
    (url) =>
      chrome.storage.local.set({
        piwiConnection: {
          instanceUrl: url,
          apiKey: 'pd_test',
          projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Shop' }],
        },
      }),
    baseUrl,
  );
  const ask = (force: boolean, projectId: unknown = 1) =>
    page.evaluate(
      ([f, id]) =>
        chrome.runtime.sendMessage({ type: 'piwi-refresh-locator-index', projectId: id, force: f }) as Promise<{
          ok: boolean;
          refreshed?: boolean;
          index?: { locators: Array<{ locator: string }>; testIdAttributes: string[] } | null;
          error?: string;
        }>,
      [force, projectId] as const,
    );
  const cachedLocators = () =>
    page.evaluate(async () => {
      const stored = await chrome.storage.local.get('piwiLocatorIndexCache');
      const store = stored.piwiLocatorIndexCache as Record<string, { index: { locators: Array<{ locator: string }> } }>;
      return (store?.['1']?.index.locators ?? []).map((l) => l.locator);
    });

  const first = await ask(false);
  expect(first).toMatchObject({ ok: true, refreshed: true });
  expect(first.index?.locators.map((l) => l.locator)).toEqual(["getByRole('button', { name: 'Pay' })"]);
  expect(first.index?.testIdAttributes).toEqual(['data-qa']);
  expect(await cachedLocators()).toEqual(["getByRole('button', { name: 'Pay' })"]);
  expect(requests).toEqual([{ url: '/api/projects/1/locator-index', apiKey: 'pd_test' }]);

  // Inside the TTL an unforced request answers from the cache.
  expect(await ask(false)).toEqual({ ok: true, refreshed: false, index: null });
  expect(requests).toHaveLength(1);

  // A test starts using a new locator; an explicit refresh picks it up.
  locators = [...locators, "getByTestId('coupon')"];
  const forced = await ask(true);
  expect(forced.index?.locators.map((l) => l.locator)).toEqual([
    "getByRole('button', { name: 'Pay' })",
    "getByTestId('coupon')",
  ]);
  expect(await cachedLocators()).toHaveLength(2);

  expect(await ask(false, 'x')).toMatchObject({ ok: false });
});

test('the worker asks for a branch and caches it apart from the default branch', async ({ context, extensionId }) => {
  requests = [];
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(
    (url) =>
      chrome.storage.local.set({
        piwiConnection: {
          instanceUrl: url,
          apiKey: 'pd_test',
          projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Shop', branch: 'feature/x' }],
        },
        piwiLocatorIndexCache: {},
      }),
    baseUrl,
  );
  const answer = await page.evaluate(
    () =>
      chrome.runtime.sendMessage({
        type: 'piwi-refresh-locator-index',
        projectId: 1,
        force: false,
        branch: 'feature/x',
      }) as Promise<{ ok: boolean; refreshed?: boolean }>,
  );
  expect(answer).toMatchObject({ ok: true, refreshed: true });
  expect(requests.map((r) => r.url)).toEqual(['/api/projects/1/locator-index?branch=feature%2Fx']);
  const keys = await page.evaluate(async () =>
    Object.keys(((await chrome.storage.local.get('piwiLocatorIndexCache')).piwiLocatorIndexCache ?? {}) as object),
  );
  expect(keys).toEqual(['1@feature/x']);
});
