import { randomBytes } from 'node:crypto';
import { and, eq, inArray, lt, notExists, or } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { apiKeys, oauthAuthorizationRequests, oauthClients, oauthGrants, users } from '../database/schema';
import type { OAuthClient, User } from '../database/schema';
import type { DbClient } from '../database';
import { generateApiKey, getUserAccessCached, isAuthEnabled, requireAuth } from './auth';
import { getDatabase } from '../database';
import { resolvePublicBaseUrl } from './oauth-helpers';
import { timingSafeEqualStr } from './timing-safe';
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_MS,
  AUTHORIZATION_CODE_PREFIX,
  AUTHORIZATION_CODE_TTL_MS,
  AUTHORIZATION_REQUEST_TTL_MS,
  CLIENT_ID_PREFIX,
  CLIENT_SECRET_PREFIX,
  IDLE_CLIENT_TTL_MS,
  MCP_OAUTH_SCOPE,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_MS,
  cleanClientName,
  cleanClientUri,
  describeRedirectTarget,
  isCodeChallenge,
  mcpOAuthUrls,
  parseRedirectUris,
  pkceVerifies,
  redirectUriMatches,
  resourceMatches,
  hashSecret,
  wantsClientSecret,
  withQueryParams,
  mcpWwwAuthenticate,
  type ClientCredentials,
  type RedirectTarget,
} from './mcp-oauth-helpers';

/**
 * The OAuth 2.1 authorization server MCP clients sign in through, as the MCP
 * authorization specification describes it: dynamic client registration
 * (RFC 7591), the authorization code flow with PKCE, and short-lived access
 * tokens renewed with rotating refresh tokens. The user answers on the consent
 * page of this instance, signed in as usual. Each grant owns an API key row
 * named after the client, which is what carries the user's access, what the
 * agents' write log names and what the user revokes. Codes, tokens and client
 * secrets are stored as SHA-256 hashes only. Access tokens authenticate the MCP
 * endpoint and nothing else.
 */

/** Expired authorization requests older than this are deleted on the next authorization. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
/** The longest `state` an authorization request may carry. */
const MAX_STATE_LENGTH = 2000;
/** `last_used_at` of the grant's API key is written at most this often. */
const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

const randomToken = (prefix: string) => `${prefix}${randomBytes(32).toString('hex')}`;

/** The public base URL of this instance: `PIWI_SITE_URL`, else the request's origin. */
export function publicBaseUrl(event: H3Event): string {
  const siteUrl = (useRuntimeConfig(event).public as { siteUrl?: string })?.siteUrl;
  const url = getRequestURL(event);
  return resolvePublicBaseUrl(siteUrl, `${url.protocol}//${url.host}`);
}

/** An OAuth error answer (RFC 6749 §5.2): the code a client branches on and a sentence for its logs. */
export interface OAuthError {
  status: 400 | 401;
  error: string;
  description: string;
}

const oauthError = (error: string, description: string, status: 400 | 401 = 400): OAuthError => ({
  status,
  error,
  description,
});

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591)
// ---------------------------------------------------------------------------

export interface ClientRegistration {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
  client_name: string;
  client_uri?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
}

/**
 * Registers a client and deletes the ones idle for {@link IDLE_CLIENT_TTL_MS}
 * with no grant. A client that asks for `client_secret_post` or
 * `client_secret_basic` receives a secret; any other is public.
 */
export async function registerClient(
  db: DbClient,
  metadata: Record<string, unknown>,
  now = new Date(),
): Promise<ClientRegistration | OAuthError> {
  const redirect = parseRedirectUris(metadata.redirect_uris);
  if ('problem' in redirect) return oauthError('invalid_redirect_uri', redirect.problem);
  const grantTypes = metadata.grant_types ?? ['authorization_code'];
  if (!Array.isArray(grantTypes) || !grantTypes.includes('authorization_code')) {
    return oauthError('invalid_client_metadata', 'grant_types must include authorization_code');
  }
  if (grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
    return oauthError('invalid_client_metadata', 'only authorization_code and refresh_token are supported');
  }
  const responseTypes = metadata.response_types ?? ['code'];
  if (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== 'code')) {
    return oauthError('invalid_client_metadata', 'only the code response type is supported');
  }

  await db
    .delete(oauthClients)
    .where(
      and(
        lt(oauthClients.lastUsedAt, new Date(now.getTime() - IDLE_CLIENT_TTL_MS)),
        notExists(db.select({ id: oauthGrants.id }).from(oauthGrants).where(eq(oauthGrants.clientId, oauthClients.id))),
      ),
    );

  const clientId = `${CLIENT_ID_PREFIX}${randomBytes(16).toString('hex')}`;
  const secret = wantsClientSecret(metadata.token_endpoint_auth_method) ? randomToken(CLIENT_SECRET_PREFIX) : null;
  const clientName = cleanClientName(metadata.client_name);
  const clientUri = cleanClientUri(metadata.client_uri);
  await db.insert(oauthClients).values({
    clientId,
    clientSecretHash: secret ? hashSecret(secret) : null,
    clientName,
    clientUri,
    redirectUris: redirect.uris,
    createdAt: now,
    lastUsedAt: now,
  });

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: clientName,
    ...(clientUri ? { client_uri: clientUri } : {}),
    redirect_uris: redirect.uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: secret ? (metadata.token_endpoint_auth_method as string) : 'none',
    scope: MCP_OAUTH_SCOPE,
  };
}

async function findClient(db: DbClient, clientId: unknown): Promise<OAuthClient | null> {
  if (typeof clientId !== 'string' || !clientId.startsWith(CLIENT_ID_PREFIX)) return null;
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
  return client ?? null;
}

/**
 * The client a token or revocation request comes from, or why it is refused:
 * an unknown client, or a confidential one without its secret.
 */
async function authenticateClient(db: DbClient, creds: ClientCredentials): Promise<OAuthClient | OAuthError> {
  const client = await findClient(db, creds.clientId);
  if (!client) return oauthError('invalid_client', 'Unknown client; register again', 401);
  if (client.clientSecretHash) {
    if (!creds.clientSecret || !timingSafeEqualStr(hashSecret(creds.clientSecret), client.clientSecretHash)) {
      return oauthError('invalid_client', 'Client authentication failed', 401);
    }
  }
  return client;
}

async function touchClient(db: DbClient, client: OAuthClient, now: Date): Promise<void> {
  await db.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, client.id));
}

// ---------------------------------------------------------------------------
// Authorization request and consent
// ---------------------------------------------------------------------------

/** What the authorize endpoint does with a request. */
export type AuthorizationStart =
  /** Ask the user: send the browser to the consent page with this request id. */
  | { kind: 'consent'; requestId: string }
  /** Answer the client: send the browser back to its redirect URI with an error. */
  | { kind: 'redirect'; url: string }
  /** The client or its redirect URI is not known, so there is nowhere safe to send an answer. */
  | { kind: 'refused'; error: 'invalid_client' | 'invalid_redirect_uri' };

/**
 * Checks an authorization request (RFC 6749 §4.1.1, PKCE required) and stores
 * it for the consent page. Deletes the requests expired for more than a day and
 * the grants whose refresh token expired, with their API keys.
 */
export async function startAuthorization(
  db: DbClient,
  query: Record<string, unknown>,
  baseUrl: string,
  now = new Date(),
): Promise<AuthorizationStart> {
  await pruneExpired(db, now);

  const client = await findClient(db, query.client_id);
  if (!client) return { kind: 'refused', error: 'invalid_client' };
  const requested = typeof query.redirect_uri === 'string' ? query.redirect_uri : null;
  const redirectUri = requested ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : null);
  if (!redirectUri || !redirectUriMatches(client.redirectUris, redirectUri)) {
    return { kind: 'refused', error: 'invalid_redirect_uri' };
  }

  // The state goes back unchanged, so one too long to store is refused rather than cut.
  const state = typeof query.state === 'string' && query.state.length <= MAX_STATE_LENGTH ? query.state : null;
  const urls = mcpOAuthUrls(baseUrl);
  const refuse = (error: string, description: string): AuthorizationStart => ({
    kind: 'redirect',
    url: withQueryParams(redirectUri, { error, error_description: description, state, iss: urls.issuer }),
  });
  if (typeof query.state === 'string' && state === null) {
    return refuse('invalid_request', `state is at most ${MAX_STATE_LENGTH} characters`);
  }
  if (query.response_type !== 'code') {
    return refuse('unsupported_response_type', 'Only response_type=code is supported');
  }
  if (query.code_challenge_method !== 'S256' || !isCodeChallenge(query.code_challenge)) {
    return refuse('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256');
  }
  if (query.resource !== undefined && !resourceMatches(query.resource, urls.resource)) {
    return refuse('invalid_target', `This server issues tokens for ${urls.resource} only`);
  }

  const requestId = randomBytes(32).toString('hex');
  await db.insert(oauthAuthorizationRequests).values({
    requestIdHash: hashSecret(requestId),
    clientId: client.id,
    redirectUri,
    state,
    codeChallenge: query.code_challenge,
    scope: MCP_OAUTH_SCOPE,
    resource: urls.resource,
    status: 'pending',
    expiresAt: new Date(now.getTime() + AUTHORIZATION_REQUEST_TTL_MS),
    createdAt: now,
  });
  await touchClient(db, client, now);
  return { kind: 'consent', requestId };
}

async function pruneExpired(db: DbClient, now: Date): Promise<void> {
  await db
    .delete(oauthAuthorizationRequests)
    .where(lt(oauthAuthorizationRequests.expiresAt, new Date(now.getTime() - PRUNE_AFTER_MS)));
  // Deleting the API key deletes its grant.
  await db
    .delete(apiKeys)
    .where(
      inArray(
        apiKeys.id,
        db.select({ id: oauthGrants.apiKeyId }).from(oauthGrants).where(lt(oauthGrants.refreshExpiresAt, now)),
      ),
    );
}

export type AuthorizationStatus = 'pending' | 'approved' | 'denied' | 'consumed';

export interface AuthorizationRequestView {
  /** What the client calls itself: self-asserted at registration. */
  clientName: string;
  clientUri: string | null;
  /** Where the answer goes. */
  redirect: RedirectTarget;
  createdAt: string;
  expiresAt: string;
  /** `expired` once past its expiry without an answer; `consumed` once the client redeemed its code. */
  status: AuthorizationStatus | 'expired';
}

async function findRequest(db: DbClient, requestId: unknown) {
  if (typeof requestId !== 'string' || !/^[0-9a-f]{64}$/.test(requestId)) return null;
  const [row] = await db
    .select({ request: oauthAuthorizationRequests, client: oauthClients })
    .from(oauthAuthorizationRequests)
    .innerJoin(oauthClients, eq(oauthAuthorizationRequests.clientId, oauthClients.id))
    .where(eq(oauthAuthorizationRequests.requestIdHash, hashSecret(requestId)));
  return row ?? null;
}

/** What the consent page shows for a request id; null when no request has it. */
export async function describeAuthorization(
  db: DbClient,
  requestId: unknown,
  now = new Date(),
): Promise<AuthorizationRequestView | null> {
  const row = await findRequest(db, requestId);
  if (!row) return null;
  const status = row.request.status as AuthorizationStatus;
  const expired = status === 'pending' && row.request.expiresAt.getTime() <= now.getTime();
  return {
    clientName: row.client.clientName,
    clientUri: row.client.clientUri,
    redirect: describeRedirectTarget(row.request.redirectUri),
    createdAt: row.request.createdAt.toISOString(),
    expiresAt: row.request.expiresAt.toISOString(),
    status: expired ? 'expired' : status,
  };
}

export type AuthorizationDecision =
  | { status: 'approved' | 'denied'; redirectTo: string }
  | { status: 'not-found' | 'expired' | 'already-decided' };

/**
 * Records the signed-in user's answer and returns where to send the browser:
 * the client's redirect URI with a code, or with `access_denied`.
 */
export async function decideAuthorization(
  db: DbClient,
  opts: { requestId: unknown; userId: number; allow: boolean },
  baseUrl: string,
  now = new Date(),
): Promise<AuthorizationDecision> {
  const row = await findRequest(db, opts.requestId);
  if (!row) return { status: 'not-found' };
  const { request } = row;
  if (request.status !== 'pending') return { status: 'already-decided' };
  if (request.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };

  const code = opts.allow ? randomToken(AUTHORIZATION_CODE_PREFIX) : null;
  const updated = await db
    .update(oauthAuthorizationRequests)
    .set({
      status: opts.allow ? 'approved' : 'denied',
      userId: opts.userId,
      decidedAt: now,
      ...(code ? { codeHash: hashSecret(code), expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS) } : {}),
    })
    .where(and(eq(oauthAuthorizationRequests.id, request.id), eq(oauthAuthorizationRequests.status, 'pending')))
    .returning({ id: oauthAuthorizationRequests.id });
  if (updated.length === 0) return { status: 'already-decided' };

  const iss = mcpOAuthUrls(baseUrl).issuer;
  return code
    ? { status: 'approved', redirectTo: withQueryParams(request.redirectUri, { code, state: request.state, iss }) }
    : {
        status: 'denied',
        redirectTo: withQueryParams(request.redirectUri, {
          error: 'access_denied',
          error_description: 'The user denied access',
          state: request.state,
          iss,
        }),
      };
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function newTokens(now: Date) {
  const accessToken = randomToken(ACCESS_TOKEN_PREFIX);
  const refreshToken = randomToken(REFRESH_TOKEN_PREFIX);
  return {
    columns: {
      accessTokenHash: hashSecret(accessToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshTokenHash: hashSecret(refreshToken),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    },
    body: (scope: string): TokenResponse => ({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.round(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope,
    }),
  };
}

/** Revokes a grant by deleting its API key, which deletes the grant with it. */
async function revokeGrant(db: DbClient, grantId: number): Promise<void> {
  await db
    .delete(apiKeys)
    .where(
      inArray(apiKeys.id, db.select({ id: oauthGrants.apiKeyId }).from(oauthGrants).where(eq(oauthGrants.id, grantId))),
    );
}

/** The token endpoint (RFC 6749 §3.2): redeems a code, or renews a grant's tokens with its refresh token. */
export async function exchangeToken(
  db: DbClient,
  params: Record<string, unknown>,
  creds: ClientCredentials,
  baseUrl: string,
  now = new Date(),
): Promise<TokenResponse | OAuthError> {
  const client = await authenticateClient(db, creds);
  if ('error' in client) return client;
  await touchClient(db, client, now);
  if (params.grant_type === 'authorization_code') return redeemCode(db, client, params, baseUrl, now);
  if (params.grant_type === 'refresh_token') return refreshGrant(db, client, params, now);
  return oauthError('unsupported_grant_type', 'Supported: authorization_code, refresh_token');
}

async function redeemCode(
  db: DbClient,
  client: OAuthClient,
  params: Record<string, unknown>,
  baseUrl: string,
  now: Date,
): Promise<TokenResponse | OAuthError> {
  const invalid = oauthError('invalid_grant', 'The authorization code is invalid, expired or already used');
  if (typeof params.code !== 'string' || !params.code.startsWith(AUTHORIZATION_CODE_PREFIX)) return invalid;
  const [request] = await db
    .select()
    .from(oauthAuthorizationRequests)
    .where(eq(oauthAuthorizationRequests.codeHash, hashSecret(params.code)));
  if (!request || request.clientId !== client.id) return invalid;
  // A code presented twice was intercepted, or replayed: the grant it created goes too (RFC 6749 §4.1.2).
  if (request.status === 'consumed') {
    if (request.grantId != null) await revokeGrant(db, request.grantId);
    return invalid;
  }
  if (request.status !== 'approved' || request.userId == null) return invalid;
  if (request.expiresAt.getTime() <= now.getTime()) return invalid;
  if (params.redirect_uri !== undefined && params.redirect_uri !== request.redirectUri) {
    return oauthError('invalid_grant', 'redirect_uri differs from the authorization request');
  }
  if (!pkceVerifies(params.code_verifier, request.codeChallenge)) {
    return oauthError('invalid_grant', 'code_verifier does not match the code_challenge');
  }
  if (params.resource !== undefined && !resourceMatches(params.resource, request.resource)) {
    return oauthError('invalid_target', `This server issues tokens for ${mcpOAuthUrls(baseUrl).resource} only`);
  }

  const claimed = await db
    .update(oauthAuthorizationRequests)
    .set({ status: 'consumed' })
    .where(and(eq(oauthAuthorizationRequests.id, request.id), eq(oauthAuthorizationRequests.status, 'approved')))
    .returning({ id: oauthAuthorizationRequests.id });
  if (claimed.length === 0) return invalid;

  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.id, request.userId));
  if (!owner) return invalid;

  // The grant's API key: it names the client and carries the user's access. Its own value is never handed out.
  const key = generateApiKey();
  const [apiKey] = await db
    .insert(apiKeys)
    .values({ userId: owner.id, name: client.clientName, keyHash: key.hash, keyPrefix: key.prefix, createdAt: now })
    .returning({ id: apiKeys.id });
  const tokens = newTokens(now);
  const [grant] = await db
    .insert(oauthGrants)
    .values({
      clientId: client.id,
      userId: owner.id,
      apiKeyId: apiKey!.id,
      scope: request.scope,
      resource: request.resource,
      ...tokens.columns,
      createdAt: now,
    })
    .returning({ id: oauthGrants.id });
  await db
    .update(oauthAuthorizationRequests)
    .set({ grantId: grant!.id })
    .where(eq(oauthAuthorizationRequests.id, request.id));
  return tokens.body(request.scope);
}

async function refreshGrant(
  db: DbClient,
  client: OAuthClient,
  params: Record<string, unknown>,
  now: Date,
): Promise<TokenResponse | OAuthError> {
  const invalid = oauthError('invalid_grant', 'The refresh token is invalid, expired or revoked');
  if (typeof params.refresh_token !== 'string' || !params.refresh_token.startsWith(REFRESH_TOKEN_PREFIX)) {
    return invalid;
  }
  const hash = hashSecret(params.refresh_token);
  const [grant] = await db
    .select()
    .from(oauthGrants)
    .where(or(eq(oauthGrants.refreshTokenHash, hash), eq(oauthGrants.previousRefreshTokenHash, hash)));
  if (!grant || grant.clientId !== client.id) return invalid;
  // A refresh token already exchanged for a new one was copied: the grant ends, for whoever holds it (OAuth 2.1 §4.3.1).
  if (grant.refreshTokenHash !== hash) {
    await revokeGrant(db, grant.id);
    return invalid;
  }
  if (grant.refreshExpiresAt.getTime() <= now.getTime()) {
    await revokeGrant(db, grant.id);
    return invalid;
  }

  const tokens = newTokens(now);
  const rotated = await db
    .update(oauthGrants)
    .set({ ...tokens.columns, previousRefreshTokenHash: hash, refreshedAt: now })
    .where(and(eq(oauthGrants.id, grant.id), eq(oauthGrants.refreshTokenHash, hash)))
    .returning({ id: oauthGrants.id });
  if (rotated.length === 0) return invalid;
  return tokens.body(grant.scope);
}

/**
 * Token revocation (RFC 7009): a client's access or refresh token ends its
 * grant. Unknown tokens, and tokens of another client, are ignored.
 */
export async function revokeToken(db: DbClient, token: unknown, creds: ClientCredentials): Promise<OAuthError | null> {
  const client = await authenticateClient(db, creds);
  if ('error' in client) return client;
  if (typeof token !== 'string' || token.length === 0) {
    return oauthError('invalid_request', 'token is required');
  }
  const hash = hashSecret(token);
  const [grant] = await db
    .select({ id: oauthGrants.id, clientId: oauthGrants.clientId })
    .from(oauthGrants)
    .where(or(eq(oauthGrants.accessTokenHash, hash), eq(oauthGrants.refreshTokenHash, hash)));
  if (grant && grant.clientId === client.id) await revokeGrant(db, grant.id);
  return null;
}

// ---------------------------------------------------------------------------
// Access tokens on the MCP endpoint
// ---------------------------------------------------------------------------

/** Whether a Bearer value is an OAuth access token of this server (rather than an API key). */
export function isOAuthAccessToken(token: string | null | undefined): token is string {
  return !!token?.startsWith(ACCESS_TOKEN_PREFIX);
}

/**
 * The user and the grant's API key behind an access token, or null when it is
 * unknown, expired or revoked. Writes the key's `last_used_at` at most hourly,
 * as an API key's own use does.
 */
export async function resolveOAuthAccessToken(
  db: DbClient,
  token: string,
  now = new Date(),
): Promise<{ user: User; keyId: number } | null> {
  if (!isOAuthAccessToken(token)) return null;
  const [row] = await db
    .select({ grant: oauthGrants, user: users, keyLastUsedAt: apiKeys.lastUsedAt })
    .from(oauthGrants)
    .innerJoin(users, eq(oauthGrants.userId, users.id))
    .innerJoin(apiKeys, eq(oauthGrants.apiKeyId, apiKeys.id))
    .where(eq(oauthGrants.accessTokenHash, hashSecret(token)));
  if (!row || row.grant.accessExpiresAt.getTime() <= now.getTime()) return null;
  if (!row.keyLastUsedAt || now.getTime() - row.keyLastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.grant.apiKeyId));
  }
  return { user: row.user, keyId: row.grant.apiKeyId };
}

function bearerToken(event: H3Event): string | null {
  return (
    getRequestHeader(event, 'authorization')
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? null
  );
}

/**
 * Authenticates a request to the MCP endpoint: an OAuth access token, or what
 * `requireAuth` accepts (an API key, a session). Every 401 carries the
 * `WWW-Authenticate` challenge that points an MCP client at the resource
 * metadata, which is how a client finds out it can sign in.
 */
export async function requireMcpAuth(event: H3Event): Promise<User> {
  if (!isAuthEnabled(event)) return requireAuth(event);
  const token = bearerToken(event);
  if (isOAuthAccessToken(token)) {
    const db = await getDatabase();
    const resolved = await resolveOAuthAccessToken(db, token);
    if (!resolved) {
      setResponseHeader(
        event,
        'WWW-Authenticate',
        mcpWwwAuthenticate(publicBaseUrl(event), 'The access token is invalid or expired'),
      );
      throw apiError({ statusCode: 401, message: 'Invalid or expired access token' });
    }
    event.context.apiKeyId = resolved.keyId;
    event.context.access = await getUserAccessCached(db, resolved.user);
    return resolved.user;
  }
  try {
    return await requireAuth(event);
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode === 401) {
      setResponseHeader(event, 'WWW-Authenticate', mcpWwwAuthenticate(publicBaseUrl(event)));
    }
    throw err;
  }
}

/** 404 when authentication is off: every MCP request is then accepted without a token, so there is nothing to sign in to. */
export function requireMcpOAuthEnabled(event: H3Event): void {
  if (!isAuthEnabled(event)) {
    throw apiError({
      statusCode: 404,
      message: 'Authentication is off on this instance; the MCP server needs no token',
    });
  }
}

/**
 * Answers an OAuth error as RFC 6749 §5.2 shapes it, `{ error, error_description }`,
 * with a `Basic` challenge when the client authenticated through that header.
 */
export function sendOAuthError(event: H3Event, err: OAuthError, basic = false) {
  setResponseStatus(event, err.status);
  setResponseHeader(event, 'Cache-Control', 'no-store');
  if (err.status === 401 && basic) setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="piwi"');
  return { error: err.error, error_description: err.description };
}

/** A token or revocation request's parameters: form-encoded, as RFC 6749 asks, or JSON. */
export async function readOAuthParams(event: H3Event): Promise<Record<string, unknown>> {
  const body = await readBody(event).catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
