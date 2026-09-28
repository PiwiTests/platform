import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { extensionWorker, launchWithExtension } from './fixtures.js';
import { fireDevtoolsEvent, openDevtoolsPage } from './devtools-stub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/** The shop: two buttons load the cart, by fetch and by XHR, and say how it went and how long it took. */
const SHOP = `<!doctype html><html><body>
<button id="fetch">Load with fetch</button><button id="xhr">Load with XHR</button>
<button id="image">Load the image</button>
<output id="result"></output><output id="elapsed"></output>
<script>
  const show = (text, started) => {
    document.getElementById('result').textContent = text;
    document.getElementById('elapsed').textContent = String(Math.round(performance.now() - started));
  };
  document.getElementById('fetch').onclick = () => {
    const started = performance.now();
    fetch('/api/cart?_=' + Date.now())
      .then((r) => (r.ok ? r.json().then((c) => show('total ' + c.total, started)) : show('error ' + r.status, started)))
      .catch(() => show('network error', started));
  };
  document.getElementById('image').onclick = () => {
    const started = performance.now();
    const img = new Image();
    img.onload = () => show('image loaded', started);
    img.onerror = () => show('image failed', started);
    img.src = '/pic.png?_=' + Date.now();
  };
  document.getElementById('xhr').onclick = () => {
    const started = performance.now();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/cart?_=' + Date.now());
    xhr.onload = () => show(xhr.status === 200 ? 'total ' + JSON.parse(xhr.responseText).total : 'error ' + xhr.status, started);
    xhr.onerror = () => show('network error', started);
    xhr.send();
  };
</script></body></html>`;

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

interface Fixtures {
  site: string;
  context: BrowserContext;
  extensionId: string;
}

/** The real extension, granted the local site as a person grants it from the panel's click. */
const test = base.extend<Fixtures>({
  site: async ({}, use) => {
    const server = http.createServer((request, response) => {
      if (request.url?.startsWith('/api/cart')) {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ total: 40 }));
        return;
      }
      if (request.url?.startsWith('/pic.png')) {
        response.setHeader('content-type', 'image/png');
        response.end(PIXEL);
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end(SHOP);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    server.close();
  },
  context: async ({}, use) => {
    const extension = mkdtempSync(path.join(tmpdir(), 'piwi-conditions-ext-'));
    cpSync(DIST, extension, { recursive: true });
    const manifest = JSON.parse(readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
    writeFileSync(
      path.join(extension, 'manifest.json'),
      JSON.stringify({ ...manifest, host_permissions: ['http://127.0.0.1/*'] }),
    );
    const context = await launchWithExtension(extension);
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    await use((await extensionWorker(context)).url().split('/')[2]!);
  },
});

async function tabIdOf(context: BrowserContext, extensionId: string, url: string): Promise<number> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const id = await page.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]!.id!, url);
  await page.close();
  return id;
}

async function load(shop: Page, via: 'fetch' | 'xhr' | 'image'): Promise<{ result: string; elapsed: number }> {
  await shop.evaluate(() => {
    document.getElementById('result')!.textContent = '';
  });
  await shop.locator(`#${via}`).click();
  await expect(shop.locator('#result')).not.toBeEmpty({ timeout: 10_000 });
  return {
    result: (await shop.locator('#result').textContent())!,
    elapsed: Number(await shop.locator('#elapsed').textContent()),
  };
}

test('slows down or fails the selected request in its tab only, and turns off', async ({
  context,
  extensionId,
  site,
}) => {
  const shop = await context.newPage();
  await shop.goto(`${site}/shop`);
  expect(await load(shop, 'fetch')).toMatchObject({ result: 'total 40' });
  const tabId = await tabIdOf(context, extensionId, `${site}/shop`);
  const panel = await openDevtoolsPage(context, extensionId, 'devtools-panel.html', shop, { tabId });
  await panel.getByRole('tab', { name: 'Network' }).click();
  await expect(panel.getByText('Select a request to mock it, slow it down or make it fail.')).toBeVisible();
  const conditions = panel.getByRole('region', { name: 'Request conditions' });
  await expect(conditions).toBeHidden();
  await fireDevtoolsEvent(panel, 'requestFinished', {
    request: { method: 'GET', url: `${site}/api/cart?_=1695820800000` },
    response: { status: 200, content: { mimeType: 'application/json' } },
    time: 3,
    _resourceType: 'fetch',
    __body: '{"total":40}',
  });
  await panel.getByRole('list', { name: 'Network' }).getByRole('button').first().click();

  await panel.getByRole('button', { name: 'Fail with 500' }).click();
  await expect(conditions.getByRole('listitem')).toHaveText([/Answer GET \*\*\/api\/cart\?_=\* with a 500 error/]);
  await expect(shop.locator('#piwi-conditions-banner')).toBeAttached();
  expect(await load(shop, 'fetch')).toMatchObject({ result: 'error 500' });
  expect(await load(shop, 'xhr')).toMatchObject({ result: 'error 500' });

  // A new condition on the same request takes the old one's place.
  await panel.getByRole('button', { name: 'Fail (network error)' }).click();
  await expect(conditions.getByRole('listitem')).toHaveText([/Fail GET .* as a network error/]);
  expect(await load(shop, 'fetch')).toMatchObject({ result: 'network error' });
  expect(await load(shop, 'xhr')).toMatchObject({ result: 'network error' });

  await panel.getByRole('spinbutton', { name: 'Delay in seconds' }).fill('1.5');
  await panel.getByRole('button', { name: 'Slow down' }).click();
  await expect(conditions.getByRole('listitem')).toHaveText([/Slow down GET .* by 1\.5 s/]);
  const slow = await load(shop, 'fetch');
  expect(slow.result).toBe('total 40');
  expect(slow.elapsed).toBeGreaterThanOrEqual(1500);
  expect((await load(shop, 'xhr')).elapsed).toBeGreaterThanOrEqual(1500);

  // The tab's next pages keep it; another tab of the site does not have it.
  await shop.reload();
  expect((await load(shop, 'fetch')).elapsed).toBeGreaterThanOrEqual(1500);
  const other = await context.newPage();
  await other.goto(`${site}/shop`);
  expect((await load(other, 'fetch')).elapsed).toBeLessThan(1000);
  await expect(other.locator('#piwi-conditions-banner')).toHaveCount(0);

  const reloaded = shop.waitForEvent('load');
  await conditions.getByRole('button', { name: 'Turn all off and reload' }).click();
  await reloaded;
  await expect(conditions).toBeHidden();
  await expect(shop.locator('#piwi-conditions-banner')).toHaveCount(0);
  expect((await load(shop, 'fetch')).elapsed).toBeLessThan(1000);
});

/** Whether the extension holds a debugging session on the tab: a command goes through only then. */
async function attached(context: BrowserContext, tabId: number): Promise<boolean> {
  const worker = await extensionWorker(context);
  return worker.evaluate(async (id) => {
    try {
      await chrome.debugger.sendCommand({ tabId: id }, 'Runtime.evaluate', { expression: '1' });
      return true;
    } catch {
      return false;
    }
  }, tabId);
}

test('through the debugging protocol: fails an image, takes the whole page offline, slows the CPU, and lets go', async ({
  context,
  extensionId,
  site,
}) => {
  const shop = await context.newPage();
  await shop.goto(`${site}/shop`);
  expect(await load(shop, 'image')).toMatchObject({ result: 'image loaded' });
  const tabId = await tabIdOf(context, extensionId, `${site}/shop`);
  const panel = await openDevtoolsPage(context, extensionId, 'devtools-panel.html', shop, { tabId });
  await panel.getByRole('tab', { name: 'Network' }).click();
  await fireDevtoolsEvent(panel, 'requestFinished', {
    request: { method: 'GET', url: `${site}/pic.png?_=1695820800000` },
    response: { status: 200, content: { mimeType: 'image/png' } },
    time: 2,
    _resourceType: 'image',
  });
  // An image is not an API call: it is listed with Every kind.
  const list = panel.getByRole('list', { name: 'Network' });
  await expect(list.getByRole('button')).toHaveCount(0);
  await panel.getByRole('checkbox', { name: 'Every kind' }).check();
  await list.getByRole('button').first().click();
  await panel.getByRole('button', { name: 'Fail with 500' }).click();
  const conditions = panel.getByRole('region', { name: 'Request conditions' });
  await expect(conditions.getByRole('listitem')).toHaveText([/Answer GET \*\*\/pic\.png\?_=\* with a 500 error/]);
  await expect(conditions).toContainText('through Chrome’s debugging protocol');
  expect(await load(shop, 'image')).toMatchObject({ result: 'image failed' });
  expect(await attached(context, tabId)).toBe(true);

  await panel.getByRole('combobox', { name: 'Network' }).selectOption({ label: 'The whole page offline' });
  await expect(conditions.getByRole('listitem')).toHaveText([/Answer GET/, 'The whole page offlineRemove']);
  expect(await load(shop, 'fetch')).toMatchObject({ result: 'network error' });
  await panel.getByRole('combobox', { name: 'CPU' }).selectOption({ label: 'The CPU 4 times slower' });
  await expect(conditions.getByRole('listitem')).toHaveCount(3);
  await expect(shop.locator('#piwi-conditions-banner')).toBeAttached();

  // Offline removed on its own: the page's requests go out again, the image still fails.
  await conditions.getByRole('listitem').filter({ hasText: 'offline' }).getByRole('button', { name: 'Remove' }).click();
  await expect(conditions.getByRole('listitem')).toHaveCount(2);
  expect(await load(shop, 'fetch')).toMatchObject({ result: 'total 40' });

  const reloaded = shop.waitForEvent('load');
  await conditions.getByRole('button', { name: 'Turn all off and reload' }).click();
  await reloaded;
  await expect(conditions).toBeHidden();
  expect(await load(shop, 'image')).toMatchObject({ result: 'image loaded' });
  await expect.poll(() => attached(context, tabId)).toBe(false);
});
