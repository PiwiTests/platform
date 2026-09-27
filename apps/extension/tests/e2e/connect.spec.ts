import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

/**
 * Connecting in one step, end to end against a stub instance that speaks the
 * device-authorization endpoints: Connect opens the instance's page in a tab,
 * Allow there hands the extension an API key through its next poll, the tab
 * closes, and the instance's URL patterns are read and shown.
 *
 * The stub answers CORS so the requests go through without a host permission
 * (Playwright cannot accept the permission prompt); the options page's
 * permission calls are stubbed to "granted" for the same reason.
 */
const USER_CODE = 'BCDF-GHJK';
const API_KEY = `pd_${'a'.repeat(64)}`;

let server: Server;
let baseUrl: string;
let approved = false;
let keysHandedOut = 0;
let connectBody: unknown = null;
let patterns: Array<{ pattern: string; environment: string | null }> = [];
const addedPatterns: unknown[] = [];

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

const VERIFICATION_PAGE = `<!doctype html><html><body>
<h1>Connect Piwi Picker</h1><p>Code <code id="code">${USER_CODE}</code></p>
<button id="allow">Allow</button><p id="done"></p>
<script>
document.getElementById('allow').onclick = async () => {
  await fetch('/api/extension/connect/decision', { method: 'POST', body: JSON.stringify({ userCode: '${USER_CODE}', allow: true }) });
  document.getElementById('done').textContent = 'Allowed';
};
</script></body></html>`;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    const json = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    void (async () => {
      const url = new URL(req.url ?? '/', baseUrl);
      if (req.method === 'POST' && url.pathname === '/api/extension/connect') {
        connectBody = await readJson(req);
        return json(200, {
          deviceCode: `pdc_${'0'.repeat(64)}`,
          userCode: USER_CODE,
          verificationUrl: `${baseUrl}/extension/connect?code=${USER_CODE}`,
          interval: 1,
          expiresIn: 60,
        });
      }
      if (req.method === 'GET' && url.pathname === '/extension/connect') {
        res.setHeader('Content-Type', 'text/html');
        res.end(VERIFICATION_PAGE);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/extension/connect/decision') {
        approved = true;
        return json(200, { status: 'approved' });
      }
      if (req.method === 'POST' && url.pathname === '/api/extension/connect/token') {
        if (!approved) return json(200, { status: 'pending' });
        if (keysHandedOut > 0) return json(200, { status: 'expired' });
        keysHandedOut++;
        return json(200, { status: 'approved', apiKey: API_KEY, user: { name: 'Ada Lovelace' } });
      }
      // Everything below needs the key the flow handed out.
      if (req.headers['x-api-key'] !== API_KEY) return json(401, { message: 'Invalid or expired API key' });
      if (url.pathname === '/api/extension/url-patterns') {
        return json(200, {
          user: { name: 'Ada Lovelace' },
          items: patterns.map((p) => ({
            projectId: 1,
            projectName: 'shop',
            projectLabel: 'Shop',
            pattern: p.pattern,
            environment: p.environment,
            branch: null,
          })),
          projects: [{ id: 1, label: 'Shop', canEdit: true }],
        });
      }
      if (url.pathname === '/api/projects/menu') return json(200, { items: [{ id: 1, name: 'shop', label: 'Shop' }] });
      if (url.pathname === '/api/projects/1/test-functions') return json(200, { items: [] });
      if (req.method === 'POST' && url.pathname === '/api/projects/1/url-patterns') {
        const body = (await readJson(req)) as { pattern: string; environment?: string | null };
        addedPatterns.push(body);
        patterns.push({ pattern: body.pattern, environment: body.environment ?? null });
        return json(201, { items: [] });
      }
      return json(404, {});
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Answers the options page's host-permission checks as granted: the prompt cannot be clicked from a test. */
async function grantPermissions(page: Page): Promise<void> {
  await page.evaluate(() => {
    chrome.permissions.contains = (async () => true) as typeof chrome.permissions.contains;
    chrome.permissions.request = (async () => true) as typeof chrome.permissions.request;
  });
}

async function storedConnection(page: Page) {
  return page.evaluate(async () => (await chrome.storage.local.get('piwiConnection')).piwiConnection);
}

test.describe.serial('connect in one step', () => {
  test('Connect, Allow on the instance, and the extension holds a key and the instance’s patterns', async ({
    context,
    extensionId,
  }) => {
    approved = false;
    keysHandedOut = 0;
    patterns = [{ pattern: `${baseUrl}/shop/**`, environment: 'staging' }];

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await grantPermissions(options);
    await options.getByLabel('Address of your Piwi instance').fill(baseUrl);

    const verificationTab = context.waitForEvent('page');
    await options.getByRole('button', { name: 'Connect', exact: true }).click();
    const verification = await verificationTab;
    await verification.waitForLoadState();

    // Both sides show the same code.
    await expect(options.locator('#connect-panel code')).toHaveText(USER_CODE);
    await expect(verification.locator('#code')).toHaveText(USER_CODE);
    expect(connectBody).toMatchObject({ browser: 'Chrome' });

    const closed = verification.waitForEvent('close');
    await verification.getByRole('button', { name: 'Allow' }).click();
    await closed;

    await expect(options.locator('#connected-as')).toHaveText('Connected as Ada Lovelace.');
    await expect(options.locator('#status')).toContainText('1 URL pattern from your instance.');
    const serverRow = options.locator('#server-mappings .server-row');
    await expect(serverRow).toHaveCount(1);
    await expect(serverRow).toContainText(`${baseUrl}/shop/**`);
    await expect(serverRow).toContainText('Shop · staging');
    await expect(serverRow.locator('.source')).toHaveText('Piwi');

    const stored = await storedConnection(options);
    expect(stored).toMatchObject({
      instanceUrl: baseUrl,
      apiKey: API_KEY,
      connectedAs: 'Ada Lovelace',
      serverMappings: [
        { urlPattern: `${baseUrl}/shop/**`, projectId: 1, projectLabel: 'Shop', environment: 'staging' },
      ],
      serverProjects: [{ id: 1, label: 'Shop', canEdit: true }],
    });
    // The key was handed out once; the fallback field shows it, folded away.
    expect(keysHandedOut).toBe(1);
    await expect(options.locator('#api-key-fallback')).not.toHaveAttribute('open', '');

    // Opening the settings again reads the patterns again.
    patterns.push({ pattern: `${baseUrl}/admin/**`, environment: null });
    await options.reload();
    await expect(options.locator('#server-mappings .server-row')).toHaveCount(2);
    await expect(options.locator('#connected-as')).toHaveText('Connected as Ada Lovelace.');
  });

  test('a site the popup offers is added to the instance from the settings', async ({ context, extensionId }) => {
    const options = await context.newPage();
    // A connected browser whose instance has no pattern yet.
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.evaluate(
      async ({ baseUrl, apiKey }) => {
        await chrome.storage.local.set({
          piwiConnection: {
            instanceUrl: baseUrl,
            apiKey,
            projectMappings: [],
            serverMappings: [],
            serverProjects: [],
            serverSyncedAt: 0,
            connectedAs: '',
          },
        });
      },
      { baseUrl, apiKey: API_KEY },
    );
    patterns = [];
    const site = 'https://staging.shop.example';
    // What the popup's "Add this site" opens: a new settings tab with the pattern in its address.
    await options.close();
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extensionId}/options.html#add=${encodeURIComponent(`${site}/**`)}`);
    await grantPermissions(settings);

    await expect(settings.locator('#add-site')).toBeVisible();
    await expect(settings.locator('#add-pattern')).toHaveValue(`${site}/**`);
    await expect(settings.locator('#add-project')).toHaveValue('1');
    await settings.locator('#add-environment').fill('staging');
    await settings.getByRole('button', { name: 'Add to Piwi' }).click();

    await expect(settings.locator('#status')).toHaveText(`Added ${site}/** to Shop.`);
    expect(addedPatterns[addedPatterns.length - 1]).toEqual({
      pattern: `${site}/**`,
      environment: 'staging',
      branch: null,
    });
    await expect(settings.locator('#server-mappings .server-row')).toContainText(`${site}/**`);
  });

  test('the popup offers to add a site no pattern covers', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(async (baseUrl) => {
      await chrome.storage.local.set({
        piwiConnection: {
          instanceUrl: baseUrl,
          apiKey: '',
          projectMappings: [],
          serverMappings: [{ urlPattern: 'https://shop.example/**', projectId: 1, projectLabel: 'Shop' }],
          serverProjects: [{ id: 1, label: 'Shop', canEdit: true }],
          serverSyncedAt: 1,
          connectedAs: '',
        },
      });
    }, baseUrl);
    // Opened as a tab, the popup is its own active tab: point it at a site instead.
    await popup.addInitScript(() => {
      chrome.tabs.query = (async () => [
        { id: 4242, url: 'https://staging.shop.example/cart', active: true },
      ]) as unknown as typeof chrome.tabs.query;
    });
    await popup.reload();

    const offer = popup.locator('#add-site-row');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('No project matches this site.');
    const opened = context.waitForEvent('page');
    await offer.getByRole('button', { name: 'Add this site' }).click();
    const settings = await opened;
    expect(settings.url()).toBe(
      `chrome-extension://${extensionId}/options.html#add=${encodeURIComponent('https://staging.shop.example/**')}`,
    );
  });

  test('the popup makes no offer on a site a server pattern covers', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate(async (baseUrl) => {
      await chrome.storage.local.set({
        piwiConnection: {
          instanceUrl: baseUrl,
          apiKey: '',
          projectMappings: [],
          serverMappings: [{ urlPattern: 'https://shop.example/**', projectId: 1, projectLabel: 'Shop' }],
          serverProjects: [],
          serverSyncedAt: 1,
          connectedAs: '',
        },
      });
    }, baseUrl);
    await popup.addInitScript(() => {
      chrome.tabs.query = (async () => [
        { id: 4242, url: 'https://shop.example/cart', active: true },
      ]) as unknown as typeof chrome.tabs.query;
    });
    await popup.reload();
    await expect(popup.locator('#active-project')).toBeVisible();
    await expect(popup.locator('#active-project option').nth(1)).toHaveText('Shop');
    await expect(popup.locator('#add-site-row')).toBeHidden();
  });
});
