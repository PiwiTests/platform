import { createHash, randomBytes } from 'node:crypto';
import { test, expect } from './fixtures';

/**
 * An MCP client's OAuth sign-in, driven the way a client runs it: the 401
 * challenge, discovery, registration, the authorization request in the
 * browser (sign-in, consent), the code exchange with PKCE, the MCP call, the
 * refresh, and the connection listed with the user's API keys.
 */

test.describe('MCP OAuth, authentication off', () => {
  test('there is no authorization server, and the MCP endpoint needs no token', async ({ request }) => {
    expect((await request.get('/.well-known/oauth-protected-resource/mcp')).status()).toBe(404);
    expect((await request.get('/.well-known/oauth-authorization-server')).status()).toBe(404);
    expect((await request.post('/oauth/register', { data: { redirect_uris: ['http://127.0.0.1/cb'] } })).status()).toBe(
      404,
    );
    const ping = await request.post('/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(ping.ok()).toBeTruthy();
  });
});

// ── Authentication on (CI only) ─────────────────────────────────────────────

const AUTH_BASE = 'http://localhost:3097';
const ADMIN = { username: 'admin', password: 'adminpassword123' };
const REDIRECT = 'http://127.0.0.1:33418/callback';

const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return { status: res.status, body: (await res.json()) as Record<string, string | number> };
}

async function mcp(token: string, method: string, params?: unknown) {
  return fetch(`${AUTH_BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

test.describe.serial('MCP OAuth, authentication on', () => {
  test.skip(!process.env.CI, 'The auth-enabled server runs in CI only (see playwright.config.ts webServer)');

  test('a client signs in through the consent page and calls the MCP server with its tokens', async ({ page }) => {
    await fetch(`${AUTH_BASE}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ADMIN, name: 'Admin' }),
    });

    // 1. The unauthenticated call names the resource metadata, which names the authorization server.
    const challenge = await mcp('', 'ping');
    expect(challenge.status).toBe(401);
    const resourceMetadataUrl = /resource_metadata="([^"]+)"/.exec(
      challenge.headers.get('www-authenticate') ?? '',
    )?.[1];
    expect(resourceMetadataUrl).toBe(`${AUTH_BASE}/.well-known/oauth-protected-resource/mcp`);
    const resource = (await (await fetch(resourceMetadataUrl!)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(resource.resource).toBe(`${AUTH_BASE}/mcp`);
    const server = (await (
      await fetch(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, string>;
    expect(server.registration_endpoint).toBe(`${AUTH_BASE}/oauth/register`);

    // 2. Dynamic client registration.
    const registered = await fetch(server.registration_endpoint!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'E2E MCP client', redirect_uris: [REDIRECT] }),
    });
    expect(registered.status).toBe(201);
    const { client_id: clientId } = (await registered.json()) as { client_id: string };

    // 3. The authorization request opens in the browser: sign in, then the consent page.
    const verifier = base64url(randomBytes(32));
    const authorize = new URL(server.authorization_endpoint!);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: base64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      state: 'e2e-state',
      resource: resource.resource,
    }).toString();
    // The loopback redirect goes nowhere in the test: capture it instead.
    const seen: { callback?: URL } = {};
    await page.route(
      (url) => url.href.startsWith(REDIRECT),
      async (route) => {
        seen.callback = new URL(route.request().url());
        await route.fulfill({ body: 'ok' });
      },
    );
    await page.goto(authorize.toString());
    await page.waitForURL(/\/login\?redirect=/);
    await page.getByLabel('Username').fill(ADMIN.username);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(/\/oauth\/consent\?request=/);
    await expect(page.getByTestId('oauth-client')).toHaveText('E2E MCP client');
    await expect(page.getByTestId('oauth-returns-to')).toHaveText('An application on this computer');
    await page.getByRole('button', { name: 'Allow' }).click();
    await expect.poll(() => seen.callback?.searchParams.get('state')).toBe('e2e-state');
    const code = seen.callback!.searchParams.get('code')!;
    expect(seen.callback!.searchParams.get('iss')).toBe(AUTH_BASE);

    // 4. The code is redeemed once, with the verifier.
    const exchange = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: resource.resource,
    };
    const issued = await tokenRequest(exchange);
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'mcp' });
    const accessToken = String(issued.body.access_token);

    // 5. The access token works on the MCP endpoint, and nowhere else.
    const tools = (await (await mcp(accessToken, 'tools/list')).json()) as { result: { tools: unknown[] } };
    expect(tools.result.tools.length).toBeGreaterThan(0);
    expect(
      (await fetch(`${AUTH_BASE}/api/projects`, { headers: { Authorization: `Bearer ${accessToken}` } })).status,
    ).toBe(401);

    // 6. The refresh token renews both; the old access token stops working.
    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: String(issued.body.refresh_token),
      client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
    const stale = await mcp(accessToken, 'ping');
    expect(stale.status).toBe(401);
    expect(stale.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect((await mcp(String(refreshed.body.access_token), 'ping')).ok).toBeTruthy();

    // 7. The connection is listed with the user's API keys, named after the client.
    const me = (await (await page.request.get(`${AUTH_BASE}/api/auth/me`)).json()) as { user: { id: number } };
    const keys = (await (await page.request.get(`${AUTH_BASE}/api/users/${me.user.id}/api-keys`)).json()) as {
      items: Array<{ name: string; oauth: boolean }>;
    };
    expect(keys.items).toContainEqual(expect.objectContaining({ name: 'E2E MCP client', oauth: true }));

    // 8. A replayed code is refused and ends the connection.
    expect((await tokenRequest(exchange)).body.error).toBe('invalid_grant');
    expect((await mcp(String(refreshed.body.access_token), 'ping')).status).toBe(401);
  });

  test('Deny sends the client access_denied', async ({ page }) => {
    const { client_id: clientId } = (await (
      await fetch(`${AUTH_BASE}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'E2E denied client', redirect_uris: [REDIRECT] }),
      })
    ).json()) as { client_id: string };
    const seen: { callback?: URL } = {};
    await page.route(
      (url) => url.href.startsWith(REDIRECT),
      async (route) => {
        seen.callback = new URL(route.request().url());
        await route.fulfill({ body: 'ok' });
      },
    );
    await page.request.post(`${AUTH_BASE}/api/auth/login`, { data: ADMIN });
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: base64url(createHash('sha256').update('v'.repeat(43)).digest()),
      code_challenge_method: 'S256',
      state: 'denied-state',
    });
    await page.goto(`${AUTH_BASE}/oauth/authorize?${query}`);
    await page.getByRole('button', { name: 'Deny' }).click();
    await expect.poll(() => seen.callback?.searchParams.get('error')).toBe('access_denied');
    expect(seen.callback!.searchParams.get('state')).toBe('denied-state');
  });

  test('an unknown client lands on the consent page with an explanation', async ({ page }) => {
    await page.request.post(`${AUTH_BASE}/api/auth/login`, { data: ADMIN });
    await page.goto(`${AUTH_BASE}/oauth/authorize?client_id=mcpc_unknown&response_type=code`);
    await expect(page.getByText('This MCP client is not registered on this instance')).toBeVisible();
  });
});
