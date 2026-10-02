import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test, expect } from '@playwright/test';
import { extensionWorker, launchWithExtension } from './fixtures.js';
import { cookieOriginPatterns } from '../../src/shared/storage-state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * A site with a login: `/login` sets an httpOnly session cookie and a token in
 * localStorage, and `/account` greets whoever has both. The login is saved
 * with the real extension and loaded into a new browser context as a
 * Playwright test would, with `storageState`.
 */
function startSite(): Promise<{ origin: string; close: () => void }> {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    if (request.url === '/login') {
      response.setHeader('set-cookie', [
        'sid=s3cr3t; HttpOnly; Path=/; SameSite=Lax',
        'theme=dark; Path=/account; Max-Age=86400',
      ]);
      response.end(`<!doctype html><p>Logged in</p><script>localStorage.setItem('token', 'tok-42')</script>`);
      return;
    }
    const cookie = request.headers.cookie ?? '';
    const name = cookie.includes('sid=s3cr3t') ? 'Ada' : null;
    response.end(
      `<!doctype html><p id="who">${name ? `Hello ${name}` : 'Please log in'}</p>` +
        `<p id="token"></p><script>document.getElementById('token').textContent = localStorage.getItem('token') ?? 'no token'</script>`,
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() }),
    );
  });
}

test('saves the login as a storageState file a new context logs in with', async () => {
  const site = await startSite();
  // The grants a person gives in the click that saves: the cookies permission and the site's host, the port aside.
  const extension = mkdtempSync(path.join(tmpdir(), 'piwi-login-ext-'));
  cpSync(DIST, extension, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  writeFileSync(
    path.join(extension, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      permissions: [...manifest.permissions, 'cookies'],
      optional_permissions: [],
      host_permissions: cookieOriginPatterns(new URL(site.origin).hostname),
    }),
  );
  const context = await launchWithExtension(extension);
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    const extensionId = (await extensionWorker(context)).url().split('/')[2]!;
    const page = await context.newPage();
    await page.goto(`${site.origin}/login`);
    await expect(page.getByText('Logged in')).toBeVisible();
    await page.goto(`${site.origin}/account`);
    await expect(page.locator('#who')).toHaveText('Hello Ada');

    const login = await context.newPage();
    await login.goto(`chrome-extension://${extensionId}/popup.html`);
    const tabId = await login.evaluate(
      async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0]?.id,
      site.origin,
    );
    await login.goto(
      `chrome-extension://${extensionId}/login.html?tabId=${tabId}&url=${encodeURIComponent(`${site.origin}/account`)}`,
    );
    await expect(login.getByRole('heading', { name: 'Save login for tests' })).toBeVisible();
    await expect(login.getByText(`Site: ${site.origin}`)).toBeVisible();
    await expect(login.getByRole('note')).toContainText('Use a test account');

    const download = login.waitForEvent('download');
    await login.getByRole('button', { name: 'Save login file' }).click();
    const file = await (await download).path();
    expect((await download).suggestedFilename()).toBe('user.json');
    await expect(login.getByRole('status')).toHaveText('Saved user.json with 2 cookies. 1 localStorage entry.');
    const state = JSON.parse(readFileSync(file, 'utf8'));
    expect(state.cookies.find((c: { name: string }) => c.name === 'sid')).toMatchObject({
      value: 's3cr3t',
      httpOnly: true,
      expires: -1,
      sameSite: 'Lax',
    });
    expect(state.origins).toEqual([{ origin: site.origin, localStorage: [{ name: 'token', value: 'tok-42' }] }]);

    // What `test.use({ storageState })` does: a new context, logged in from the start.
    const fresh = await browser.newContext({ storageState: file });
    const account = await fresh.newPage();
    await account.goto(`${site.origin}/account`);
    await expect(account.locator('#who')).toHaveText('Hello Ada');
    await expect(account.locator('#token')).toHaveText('tok-42');
    const anonymous = await (await browser.newContext()).newPage();
    await anonymous.goto(`${site.origin}/account`);
    await expect(anonymous.locator('#who')).toHaveText('Please log in');
  } finally {
    await browser.close();
    await context.close();
    site.close();
  }
});
