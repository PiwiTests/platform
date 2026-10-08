import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

/**
 * The OAuth authorization server MCP clients sign in through: registration,
 * the consent decision, the code exchange with PKCE, refresh rotation, replay
 * and revocation, and the access token the MCP endpoint accepts.
 */

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set.
delete process.env.PIWI_DATABASE_URL;
const oauth = await import('../../server/utils/mcp-oauth');
const helpers = await import('../../server/utils/mcp-oauth-helpers');
const { listUserApiKeys } = await import('#shared/handlers/users');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;
let userId: number;

const BASE = 'https://piwi.example.com';
const T0 = new Date('2026-09-01T10:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
// RFC 7636 appendix B.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://127.0.0.1:33418/callback';

beforeEach(async () => {
  const client = createClient({ url: ':memory:' });
  // Revoking a grant deletes its API key and relies on the cascade, as the server's connections do.
  await client.execute('PRAGMA foreign_keys=ON');
  db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  const [user] = await db
    .insert(schema.users)
    .values({ username: 'tester', password: 'x', role: 'member', name: 'Test User' })
    .returning();
  userId = user!.id;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = () => db as any;
const publicClient = (clientId: string) => ({ clientId, clientSecret: null, basic: false });

async function register(metadata: Record<string, unknown> = {}) {
  const result = await oauth.registerClient(
    anyDb(),
    { client_name: 'Claude Code (piwi)', redirect_uris: [REDIRECT], ...metadata },
    T0,
  );
  if ('error' in result) throw new Error(result.description);
  return result;
}

async function consent(clientId: string, query: Record<string, unknown> = {}, now = T0) {
  const start = await oauth.startAuthorization(
    anyDb(),
    {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      state: 'xyz',
      resource: `${BASE}/mcp`,
      ...query,
    },
    BASE,
    now,
  );
  if (start.kind !== 'consent') throw new Error(`expected consent, got ${JSON.stringify(start)}`);
  return start.requestId;
}

async function allowedCode(clientId: string, now = T0) {
  const requestId = await consent(clientId, {}, now);
  const decision = await oauth.decideAuthorization(anyDb(), { requestId, userId, allow: true }, BASE, now);
  if (decision.status !== 'approved') throw new Error(decision.status);
  return new URL(decision.redirectTo).searchParams.get('code')!;
}

async function tokens(clientId: string, now = T0) {
  const code = await allowedCode(clientId, now);
  const result = await oauth.exchangeToken(
    anyDb(),
    { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER },
    publicClient(clientId),
    BASE,
    now,
  );
  if ('error' in result) throw new Error(result.description);
  return result;
}

describe('helpers', () => {
  test('redirect URIs: https, http on this computer, or an application scheme; never a fragment', () => {
    expect(helpers.redirectUriProblem('https://claude.ai/api/mcp/auth_callback')).toBeNull();
    expect(helpers.redirectUriProblem('http://localhost:6274/oauth/callback')).toBeNull();
    expect(helpers.redirectUriProblem('http://[::1]:8080/cb')).toBeNull();
    expect(helpers.redirectUriProblem('cursor://anysphere.cursor-retrieval/oauth/callback')).toBeNull();
    expect(helpers.redirectUriProblem('http://evil.example/cb')).toMatch(/other than this computer/);
    expect(helpers.redirectUriProblem('javascript:alert(1)')).toMatch(/scheme/);
    expect(helpers.redirectUriProblem('https://claude.ai/cb#x')).toMatch(/fragment/);
    expect(helpers.redirectUriProblem('/relative')).toMatch(/absolute/);
  });

  test('a loopback redirect URI matches on any port, any other only exactly', () => {
    expect(helpers.redirectUriMatches([REDIRECT], 'http://127.0.0.1:51000/callback')).toBe(true);
    expect(helpers.redirectUriMatches([REDIRECT], 'http://127.0.0.1:51000/other')).toBe(false);
    expect(helpers.redirectUriMatches([REDIRECT], 'http://localhost:33418/callback')).toBe(false);
    expect(helpers.redirectUriMatches(['https://a.example/cb'], 'https://a.example:444/cb')).toBe(false);
  });

  test('the resource is the MCP endpoint, whatever its query or trailing slash', () => {
    expect(helpers.resourceMatches(`${BASE}/mcp?modules=core`, `${BASE}/mcp`)).toBe(true);
    expect(helpers.resourceMatches(`${BASE}/mcp/`, `${BASE}/mcp`)).toBe(true);
    expect(helpers.resourceMatches(`${BASE}/api`, `${BASE}/mcp`)).toBe(false);
    expect(helpers.resourceMatches('https://other.example/mcp', `${BASE}/mcp`)).toBe(false);
    expect(helpers.resourceMatches('not a url', `${BASE}/mcp`)).toBe(false);
  });

  test('PKCE S256, as RFC 7636 computes it', () => {
    expect(helpers.isCodeChallenge(CHALLENGE)).toBe(true);
    expect(helpers.pkceVerifies(VERIFIER, CHALLENGE)).toBe(true);
    expect(helpers.pkceVerifies(`${VERIFIER.slice(0, -1)}A`, CHALLENGE)).toBe(false);
    expect(helpers.pkceVerifies('short', CHALLENGE)).toBe(false);
  });

  test('client credentials come from Basic auth or the body', () => {
    const basic = `Basic ${Buffer.from('mcpc_a:s%3Acret').toString('base64')}`;
    expect(helpers.readClientCredentials(basic, {})).toEqual({
      clientId: 'mcpc_a',
      clientSecret: 's:cret',
      basic: true,
    });
    expect(helpers.readClientCredentials(undefined, { client_id: 'mcpc_b' })).toEqual({
      clientId: 'mcpc_b',
      clientSecret: null,
      basic: false,
    });
  });

  test('the metadata documents point at each other, and the challenge at the resource metadata', () => {
    const resource = helpers.protectedResourceMetadata(BASE);
    expect(resource.resource).toBe(`${BASE}/mcp`);
    expect(resource.authorization_servers).toEqual([BASE]);
    const server = helpers.authorizationServerMetadata(BASE);
    expect(server.issuer).toBe(BASE);
    expect(server.registration_endpoint).toBe(`${BASE}/oauth/register`);
    expect(server.code_challenge_methods_supported).toEqual(['S256']);
    expect(helpers.mcpWwwAuthenticate(BASE)).toBe(
      `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
    );
    expect(helpers.mcpWwwAuthenticate(BASE, 'expired')).toMatch(
      /^Bearer error="invalid_token", error_description="expired", /,
    );
  });

  test('a client name is cleaned and bounded', () => {
    expect(helpers.cleanClientName('  Claude <script>Code  ')).toBe('Claude scriptCode');
    expect(helpers.cleanClientName('')).toBe('MCP client');
    expect(helpers.cleanClientName('x'.repeat(100))).toHaveLength(60);
  });
});

describe('registration', () => {
  test('a public client gets an id and no secret', async () => {
    const client = await register();
    expect(client.client_id).toMatch(/^mcpc_[0-9a-f]{32}$/);
    expect(client.client_secret).toBeUndefined();
    expect(client.token_endpoint_auth_method).toBe('none');
    expect(client.redirect_uris).toEqual([REDIRECT]);
  });

  test('a client asking for client_secret_post gets a secret, stored hashed, and must send it', async () => {
    const client = await register({ token_endpoint_auth_method: 'client_secret_post' });
    expect(client.client_secret).toMatch(/^mcps_[0-9a-f]{64}$/);
    const [row] = await db.select().from(schema.oauthClients);
    expect(row!.clientSecretHash).toBe(createHash('sha256').update(client.client_secret!).digest('hex'));
    const refused = await oauth.exchangeToken(
      anyDb(),
      { grant_type: 'refresh_token', refresh_token: 'pdr_x' },
      publicClient(client.client_id),
      BASE,
      T0,
    );
    expect(refused).toMatchObject({ status: 401, error: 'invalid_client' });
  });

  test('a bad redirect URI or grant type is refused', async () => {
    expect(await oauth.registerClient(anyDb(), { redirect_uris: ['http://evil.example/cb'] }, T0)).toMatchObject({
      error: 'invalid_redirect_uri',
    });
    expect(await oauth.registerClient(anyDb(), { redirect_uris: [] }, T0)).toMatchObject({
      error: 'invalid_redirect_uri',
    });
    expect(
      await oauth.registerClient(anyDb(), { redirect_uris: [REDIRECT], grant_types: ['client_credentials'] }, T0),
    ).toMatchObject({ error: 'invalid_client_metadata' });
  });

  test('a client idle for 30 days with no grant is deleted at the next registration', async () => {
    const idle = await register();
    const connected = await register();
    await tokens(connected.client_id);
    await oauth.registerClient(anyDb(), { redirect_uris: [REDIRECT] }, at(31 * 24 * 3600));
    const ids = (await db.select().from(schema.oauthClients)).map((c) => c.clientId);
    expect(ids).not.toContain(idle.client_id);
    expect(ids).toContain(connected.client_id);
  });
});

describe('authorization request', () => {
  test('an unknown client or redirect URI is refused without redirecting', async () => {
    const client = await register();
    const base = { response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256' };
    expect(await oauth.startAuthorization(anyDb(), { ...base, client_id: 'mcpc_nope' }, BASE, T0)).toEqual({
      kind: 'refused',
      error: 'invalid_client',
    });
    expect(
      await oauth.startAuthorization(
        anyDb(),
        { ...base, client_id: client.client_id, redirect_uri: 'https://evil.example/cb' },
        BASE,
        T0,
      ),
    ).toEqual({ kind: 'refused', error: 'invalid_redirect_uri' });
  });

  test('a request without PKCE, or for another resource, goes back to the client with an error', async () => {
    const client = await register();
    const noPkce = await oauth.startAuthorization(
      anyDb(),
      { response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, state: 's1' },
      BASE,
      T0,
    );
    expect(noPkce.kind).toBe('redirect');
    const url = new URL((noPkce as { url: string }).url);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('error')).toBe('invalid_request');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('iss')).toBe(BASE);

    const other = await oauth.startAuthorization(
      anyDb(),
      {
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        resource: 'https://other.example/mcp',
      },
      BASE,
      T0,
    );
    expect(new URL((other as { url: string }).url).searchParams.get('error')).toBe('invalid_target');

    // A state too long to return unchanged is refused, not cut.
    const longState = await oauth.startAuthorization(
      anyDb(),
      { response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, state: 's'.repeat(2001) },
      BASE,
      T0,
    );
    const refused = new URL((longState as { url: string }).url).searchParams;
    expect([refused.get('error'), refused.get('state')]).toEqual(['invalid_request', null]);
  });

  test('the consent page reads the client, where the answer goes, and the status', async () => {
    const client = await register();
    const requestId = await consent(client.client_id, { redirect_uri: 'http://127.0.0.1:50123/callback' });
    expect(await oauth.describeAuthorization(anyDb(), requestId, T0)).toMatchObject({
      clientName: 'Claude Code (piwi)',
      redirect: { kind: 'loopback', label: '' },
      status: 'pending',
    });
    expect((await oauth.describeAuthorization(anyDb(), requestId, at(11 * 60)))?.status).toBe('expired');
    expect(await oauth.describeAuthorization(anyDb(), 'f'.repeat(64), T0)).toBeNull();
    expect(await oauth.describeAuthorization(anyDb(), 'not-an-id', T0)).toBeNull();
  });

  test('Allow sends the code back with the state, once; Deny sends access_denied', async () => {
    const client = await register();
    const requestId = await consent(client.client_id);
    const allowed = await oauth.decideAuthorization(anyDb(), { requestId, userId, allow: true }, BASE, T0);
    expect(allowed.status).toBe('approved');
    const back = new URL((allowed as { redirectTo: string }).redirectTo);
    expect(back.searchParams.get('code')).toMatch(/^pda_[0-9a-f]{64}$/);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe(BASE);
    expect((await oauth.decideAuthorization(anyDb(), { requestId, userId, allow: false }, BASE, T0)).status).toBe(
      'already-decided',
    );

    const second = await consent(client.client_id);
    const denied = await oauth.decideAuthorization(anyDb(), { requestId: second, userId, allow: false }, BASE, T0);
    expect(new URL((denied as { redirectTo: string }).redirectTo).searchParams.get('error')).toBe('access_denied');

    const late = await consent(client.client_id);
    expect(
      (await oauth.decideAuthorization(anyDb(), { requestId: late, userId, allow: true }, BASE, at(11 * 60))).status,
    ).toBe('expired');
  });
});

describe('tokens', () => {
  test('the code is redeemed with its verifier for tokens that act as the user, through a key named after the client', async () => {
    const client = await register();
    const code = await allowedCode(client.client_id);
    const wrongVerifier = await oauth.exchangeToken(
      anyDb(),
      { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: 'x'.repeat(43) },
      publicClient(client.client_id),
      BASE,
      T0,
    );
    expect(wrongVerifier).toMatchObject({ error: 'invalid_grant' });

    const issued = await oauth.exchangeToken(
      anyDb(),
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        resource: `${BASE}/mcp`,
      },
      publicClient(client.client_id),
      BASE,
      T0,
    );
    if ('error' in issued) throw new Error(issued.description);
    expect(issued).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'mcp' });
    expect(issued.access_token).toMatch(/^pdo_[0-9a-f]{64}$/);
    expect(issued.refresh_token).toMatch(/^pdr_[0-9a-f]{64}$/);

    const resolved = await oauth.resolveOAuthAccessToken(anyDb(), issued.access_token, at(60));
    expect(resolved?.user.id).toBe(userId);
    const { apiKeys } = await listUserApiKeys(anyDb(), userId);
    expect(apiKeys).toEqual([
      expect.objectContaining({ id: resolved!.keyId, name: 'Claude Code (piwi)', oauth: true }),
    ]);
    // The plaintext is stored nowhere: only hashes.
    const [grant] = await db.select().from(schema.oauthGrants);
    expect(JSON.stringify(grant)).not.toContain(issued.access_token);
    expect(await oauth.resolveOAuthAccessToken(anyDb(), issued.access_token, at(3601))).toBeNull();
  });

  test('a code presented twice is refused and revokes what it issued', async () => {
    const client = await register();
    const code = await allowedCode(client.client_id);
    const params = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER };
    const first = await oauth.exchangeToken(anyDb(), params, publicClient(client.client_id), BASE, T0);
    if ('error' in first) throw new Error(first.description);
    expect(await oauth.exchangeToken(anyDb(), params, publicClient(client.client_id), BASE, T0)).toMatchObject({
      error: 'invalid_grant',
    });
    expect(await oauth.resolveOAuthAccessToken(anyDb(), first.access_token, T0)).toBeNull();
    expect(await db.select().from(schema.apiKeys)).toEqual([]);
  });

  test('another client cannot redeem the code', async () => {
    const client = await register();
    const thief = await register();
    const code = await allowedCode(client.client_id);
    expect(
      await oauth.exchangeToken(
        anyDb(),
        { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER },
        publicClient(thief.client_id),
        BASE,
        T0,
      ),
    ).toMatchObject({ error: 'invalid_grant' });
  });

  test('a refresh replaces both tokens, and replaying the old refresh token ends the grant', async () => {
    const client = await register();
    const first = await tokens(client.client_id);
    const refreshed = await oauth.exchangeToken(
      anyDb(),
      { grant_type: 'refresh_token', refresh_token: first.refresh_token },
      publicClient(client.client_id),
      BASE,
      at(3000),
    );
    if ('error' in refreshed) throw new Error(refreshed.description);
    expect(refreshed.refresh_token).not.toBe(first.refresh_token);
    expect(await oauth.resolveOAuthAccessToken(anyDb(), first.access_token, at(3000))).toBeNull();
    expect(await oauth.resolveOAuthAccessToken(anyDb(), refreshed.access_token, at(3000))).not.toBeNull();

    const replay = await oauth.exchangeToken(
      anyDb(),
      { grant_type: 'refresh_token', refresh_token: first.refresh_token },
      publicClient(client.client_id),
      BASE,
      at(3100),
    );
    expect(replay).toMatchObject({ error: 'invalid_grant' });
    expect(await oauth.resolveOAuthAccessToken(anyDb(), refreshed.access_token, at(3100))).toBeNull();
  });

  test('a refresh token expires 30 days after its last use, and the expired grant is pruned', async () => {
    const client = await register();
    const issued = await tokens(client.client_id);
    const day = 24 * 3600;
    expect(
      await oauth.exchangeToken(
        anyDb(),
        { grant_type: 'refresh_token', refresh_token: issued.refresh_token },
        publicClient(client.client_id),
        BASE,
        at(31 * day),
      ),
    ).toMatchObject({ error: 'invalid_grant' });

    const other = await tokens(client.client_id);
    expect((await db.select().from(schema.oauthGrants)).length).toBe(1);
    await consent(client.client_id, {}, at(31 * day));
    expect(await db.select().from(schema.oauthGrants)).toEqual([]);
    expect(await oauth.resolveOAuthAccessToken(anyDb(), other.access_token, T0)).toBeNull();
  });

  test('revoking a token, or deleting its API key, ends the grant', async () => {
    const client = await register();
    const first = await tokens(client.client_id);
    expect(await oauth.revokeToken(anyDb(), first.refresh_token, publicClient(client.client_id))).toBeNull();
    expect(await oauth.resolveOAuthAccessToken(anyDb(), first.access_token, T0)).toBeNull();

    const second = await tokens(client.client_id);
    const resolved = await oauth.resolveOAuthAccessToken(anyDb(), second.access_token, T0);
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, resolved!.keyId));
    expect(await oauth.resolveOAuthAccessToken(anyDb(), second.access_token, T0)).toBeNull();
    expect(await db.select().from(schema.oauthGrants)).toEqual([]);
  });

  test('an unsupported grant type, an API key or a malformed token is refused', async () => {
    const client = await register();
    expect(
      await oauth.exchangeToken(anyDb(), { grant_type: 'password' }, publicClient(client.client_id), BASE, T0),
    ).toMatchObject({ error: 'unsupported_grant_type' });
    expect(oauth.isOAuthAccessToken('pd_abc')).toBe(false);
    expect(await oauth.resolveOAuthAccessToken(anyDb(), 'pdo_unknown', T0)).toBeNull();
  });
});
