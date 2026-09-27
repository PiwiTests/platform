import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';
import { waitForHydration } from './utils';

/**
 * Connecting Piwi Picker: the device authorization the extension runs. The
 * extension's side is driven here through the same requests it sends; the
 * page it opens is driven in the browser.
 */

async function poll(request: import('@playwright/test').APIRequestContext, base: string, deviceCode: string) {
  const res = await request.post(`${base}/api/extension/connect/token`, { data: { deviceCode } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { status: string; apiKey?: string; user?: { name: string } | null };
}

test.describe('connect, authentication off', () => {
  test('Allow on the verification page confirms the connection, once', async ({ page, request }) => {
    const start = await request.post('/api/extension/connect', { data: { browser: 'Chrome', os: 'Linux' } });
    expect(start.ok()).toBeTruthy();
    const codes = (await start.json()) as {
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      interval: number;
      expiresIn: number;
    };
    expect(codes.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(codes.interval).toBe(5);
    expect(codes.expiresIn).toBe(600);
    expect(new URL(codes.verificationUrl).pathname).toBe('/extension/connect');

    expect((await poll(request, '', codes.deviceCode)).status).toBe('pending');

    await page.goto(new URL(codes.verificationUrl).pathname + new URL(codes.verificationUrl).search);
    await waitForHydration(page);
    await expect(page.getByTestId('connect-client')).toHaveText('Piwi Picker in Chrome on Linux');
    await expect(page.getByTestId('connect-code')).toHaveText(codes.userCode);
    await page.getByRole('button', { name: 'Allow' }).click();
    await expect(page.getByText('Allowed.')).toBeVisible();

    expect(await poll(request, '', codes.deviceCode)).toEqual({ status: 'approved', apiKey: '', user: null });
    expect((await poll(request, '', codes.deviceCode)).status).toBe('expired');
  });

  test('Deny reaches the extension as denied', async ({ page, request }) => {
    const codes = (await (
      await request.post('/api/extension/connect', { data: { browser: 'Firefox', os: 'macOS' } })
    ).json()) as { deviceCode: string; userCode: string };
    await page.goto(`/extension/connect?code=${codes.userCode}`);
    await waitForHydration(page);
    await page.getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByText('Denied.')).toBeVisible();
    expect((await poll(request, '', codes.deviceCode)).status).toBe('denied');
    // A decided request cannot be answered again.
    const again = await request.post('/api/extension/connect/decision', {
      data: { userCode: codes.userCode, allow: true },
    });
    expect(again.status()).toBe(409);
  });

  test('an unknown code shows an error, and a malformed device code reads as expired', async ({ page, request }) => {
    await page.goto('/extension/connect?code=BCDF-GHJK');
    await waitForHydration(page);
    await expect(page.getByText('No connect request has this code')).toBeVisible();
    expect((await poll(request, '', 'not-a-device-code')).status).toBe('expired');
  });
});

// ── Authentication on (CI only): the key is created for the user who allows ──

const AUTH_BASE = 'http://localhost:3097';
const ADMIN = { username: 'admin', password: 'adminpassword123' };

async function authApi(method: string, path: string, body?: unknown, cookie?: string) {
  return fetch(`${AUTH_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

test.describe.serial('connect, authentication on', () => {
  test.skip(!process.env.CI, 'The auth-enabled server runs in CI only (see playwright.config.ts webServer)');

  test('signing in comes back to the page, and Allow hands the extension a key for that user', async ({
    page,
    request,
  }) => {
    await authApi('POST', '/api/auth/setup', { ...ADMIN, name: 'Admin' });
    const codes = (await (
      await authApi('POST', '/api/extension/connect', { browser: 'Edge', os: 'Windows' })
    ).json()) as { deviceCode: string; userCode: string; verificationUrl: string };

    // The public endpoints answer without a session; the page does not.
    expect((await poll(request, AUTH_BASE, codes.deviceCode)).status).toBe('pending');
    expect((await authApi('GET', `/api/extension/connect/request?code=${codes.userCode}`)).status).toBe(401);

    await page.goto(`${AUTH_BASE}/extension/connect?code=${codes.userCode}`);
    await page.waitForURL(/\/login\?redirect=/);
    await page.getByLabel('Username').fill(ADMIN.username);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(/\/extension\/connect\?code=/);
    await expect(page.getByTestId('connect-code')).toHaveText(codes.userCode);
    await page.getByRole('button', { name: 'Allow' }).click();
    await expect(page.getByText('Allowed.')).toBeVisible();

    const approved = await poll(request, AUTH_BASE, codes.deviceCode);
    expect(approved.status).toBe('approved');
    expect(approved.apiKey).toMatch(/^pd_[0-9a-f]{64}$/);
    // Named `Admin` unless another spec on this server set the admin up first, without a name.
    expect(approved.user?.name).toMatch(/^admin$/i);
    expect((await poll(request, AUTH_BASE, codes.deviceCode)).status).toBe('expired');

    // The key works, reads the patterns, and is listed with the user's keys under the browser's name.
    const submit = await fetch(`${AUTH_BASE}/api/test-runs/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': approved.apiKey! },
      body: JSON.stringify({
        projectName: PROJECT.URL_PATTERNS_AUTH,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      }),
    });
    expect(submit.ok).toBeTruthy();
    const patterns = await fetch(`${AUTH_BASE}/api/extension/url-patterns`, {
      headers: { 'X-API-Key': approved.apiKey! },
    });
    expect(((await patterns.json()) as { user: { name: string } }).user).toEqual(approved.user);
    const cookie = ((await authApi('POST', '/api/auth/login', ADMIN)).headers.get('set-cookie') ?? '').split(';')[0]!;
    const me = (await (await authApi('GET', '/api/auth/me', undefined, cookie)).json()) as { user: { id: number } };
    const userId = me.user.id;
    const keys = (await (await authApi('GET', `/api/users/${userId}/api-keys`, undefined, cookie)).json()) as {
      items: Array<{ name: string }>;
    };
    expect(keys.items.map((k) => k.name)).toContain('Piwi Picker in Edge on Windows');
  });
});
