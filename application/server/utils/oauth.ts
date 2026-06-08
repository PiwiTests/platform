import type { H3Event } from 'h3'
import { randomBytes } from 'node:crypto'
import { getDatabase } from '../database'
import { users } from '../database/schema'
import { eq, and } from 'drizzle-orm'
import { setUserSession, isAuthEnabled } from './auth'
import type { SessionData } from './auth'
import type { User } from '../database/schema'

// ---------------------------------------------------------------------------
// Provider configurations
// ---------------------------------------------------------------------------

interface OAuthProviderConfig {
  clientId: string
  clientSecret: string
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scopes: string[]
  extraParams?: Record<string, string>
  mapUser: (raw: Record<string, unknown>) => { id: string, email: string, name: string, avatar: string }
}

function getProviderConfig(event: H3Event, provider: string): OAuthProviderConfig | null {
  const config = useRuntimeConfig(event).oauth as Record<string, { clientId: string, clientSecret: string }> | undefined
  const providerConfig = config?.[provider]
  if (!providerConfig?.clientId || !providerConfig?.clientSecret) {
    return null
  }

  switch (provider) {
    case 'google': {
      return {
        clientId: providerConfig.clientId,
        clientSecret: providerConfig.clientSecret,
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        scopes: ['openid', 'email', 'profile'],
        extraParams: { access_type: 'offline', prompt: 'consent' },
        mapUser: raw => ({
          id: String(raw.id),
          email: String(raw.email ?? ''),
          name: String(raw.name ?? raw.email ?? ''),
          avatar: String(raw.picture ?? '')
        })
      }
    }
    case 'github': {
      return {
        clientId: providerConfig.clientId,
        clientSecret: providerConfig.clientSecret,
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scopes: ['read:user', 'user:email'],
        mapUser: raw => ({
          id: String(raw.id),
          email: String(raw.email ?? raw.login ?? ''),
          name: String(raw.name ?? raw.login ?? ''),
          avatar: String(raw.avatar_url ?? '')
        })
      }
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// State cookie helpers
// ---------------------------------------------------------------------------

const STATE_COOKIE = 'oauth_state'
const STATE_EXPIRY_SEC = 600 // 10 minutes

function setOAuthState(event: H3Event, state: string): void {
  setCookie(event, STATE_COOKIE, state ?? '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_EXPIRY_SEC
  })
}

function getOAuthState(event: H3Event): string | null {
  return getCookie(event, STATE_COOKIE) ?? null
}

function clearOAuthState(event: H3Event): void {
  deleteCookie(event, STATE_COOKIE)
}

// ---------------------------------------------------------------------------
// Generate state parameter
// ---------------------------------------------------------------------------

function generateState(): string {
  return randomBytes(32).toString('hex')
}

// ---------------------------------------------------------------------------
// Build redirect URI for the callback
// ---------------------------------------------------------------------------

function getRedirectUri(event: H3Event, provider: string): string {
  const url = getRequestURL(event)
  return `${url.protocol}//${url.host}/api/auth/oauth/${provider}/callback`
}

// ---------------------------------------------------------------------------
// Initiate OAuth: generate state, set cookie, return redirect URL
// ---------------------------------------------------------------------------

export function initiateOAuth(event: H3Event, provider: string): string | null {
  if (!isAuthEnabled(event)) {
    return null
  }

  const providerCfg = getProviderConfig(event, provider)
  if (!providerCfg) {
    return null
  }

  const state = generateState()
  setOAuthState(event, state)

  const params = new URLSearchParams({
    client_id: providerCfg.clientId,
    redirect_uri: getRedirectUri(event, provider),
    response_type: 'code',
    scope: providerCfg.scopes.join(' '),
    state
  })

  if (providerCfg.extraParams) {
    for (const [key, value] of Object.entries(providerCfg.extraParams)) {
      params.set(key, value)
    }
  }

  return `${providerCfg.authorizationUrl}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Exchange authorization code for access token
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string
  token_type: string
  scope: string
}

async function exchangeCode(event: H3Event, provider: string, code: string): Promise<TokenResponse> {
  const providerCfg = getProviderConfig(event, provider)
  if (!providerCfg) {
    throw createError({ statusCode: 400, message: `Unknown OAuth provider: ${provider}` })
  }

  const body = new URLSearchParams({
    client_id: providerCfg.clientId,
    client_secret: providerCfg.clientSecret,
    code,
    redirect_uri: getRedirectUri(event, provider),
    grant_type: 'authorization_code'
  })

  const res = await fetch(providerCfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString()
  })

  if (!res.ok) {
    const text = await res.text()
    throw createError({ statusCode: 502, message: `Token exchange failed: ${res.status} ${text}` })
  }

  return res.json() as Promise<TokenResponse>
}

// ---------------------------------------------------------------------------
// Fetch user info from the provider
// ---------------------------------------------------------------------------

async function fetchProviderUser(event: H3Event, provider: string, accessToken: string): Promise<{ id: string, email: string, name: string, avatar: string }> {
  const providerCfg = getProviderConfig(event, provider)
  if (!providerCfg) {
    throw createError({ statusCode: 400, message: `Unknown OAuth provider: ${provider}` })
  }

  const res = await fetch(providerCfg.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!res.ok) {
    const text = await res.text()
    throw createError({ statusCode: 502, message: `Failed to fetch user info: ${res.status} ${text}` })
  }

  const raw = await res.json() as Record<string, unknown>
  return providerCfg.mapUser(raw)
}

// ---------------------------------------------------------------------------
// Find existing OAuth user or create a new one
// ---------------------------------------------------------------------------

async function findOrCreateOAuthUser(
  provider: string,
  providerId: string,
  email: string,
  name: string,
  avatar: string
): Promise<User> {
  const db = await getDatabase()

  // Try to find existing user by OAuth provider + id
  const existing = await db
    .select()
    .from(users)
    .where(and(eq(users.oauthProvider, provider), eq(users.oauthProviderId, providerId)))

  if (existing[0]) {
    // Update avatar and name in case they changed at the provider
    const updated = await db
      .update(users)
      .set({ avatarUrl: avatar || null, name: name || null, updatedAt: new Date() })
      .where(eq(users.id, existing[0].id))
      .returning()
    return updated[0]!
  }

  // Check if a user with this email/username already exists (for linking)
  const byUsername = await db
    .select()
    .from(users)
    .where(eq(users.username, email))

  if (byUsername[0]) {
    // Link existing user to OAuth provider
    const updated = await db
      .update(users)
      .set({
        oauthProvider: provider,
        oauthProviderId: providerId,
        avatarUrl: avatar || null,
        name: name || null,
        updatedAt: new Date()
      })
      .where(eq(users.id, byUsername[0].id))
      .returning()
    return updated[0]!
  }

  // Create new user with empty password (OAuth-only)
  const result = await db
    .insert(users)
    .values({
      username: email,
      password: '',
      role: 'user',
      name: name || null,
      avatarUrl: avatar || null,
      oauthProvider: provider,
      oauthProviderId: providerId
    })
    .returning()

  const user = result[0]
  if (!user) {
    throw createError({ statusCode: 500, message: 'Failed to create user' })
  }

  return user
}

// ---------------------------------------------------------------------------
// Handle OAuth callback: validate state, exchange code, create/find user,
// set session, return redirect URL
// ---------------------------------------------------------------------------

export async function handleOAuthCallback(event: H3Event, provider: string): Promise<string> {
  if (!isAuthEnabled(event)) {
    return '/login?error=auth-disabled'
  }

  const query = getQuery(event) as { code?: string, state?: string, error?: string }

  // User denied the authorization request
  if (query.error) {
    return '/login?error=access-denied'
  }

  // Validate state to prevent CSRF
  const savedState = getOAuthState(event)
  clearOAuthState(event)

  if (!query.state || !savedState || query.state !== savedState) {
    return '/login?error=invalid-state'
  }

  if (!query.code) {
    return '/login?error=missing-code'
  }

  try {
    // Exchange code for access token
    const token = await exchangeCode(event, provider, query.code)

    // Fetch user info from provider
    const providerUser = await fetchProviderUser(event, provider, token.access_token)

    // Find or create local user
    const user = await findOrCreateOAuthUser(
      provider,
      providerUser.id,
      providerUser.email,
      providerUser.name,
      providerUser.avatar
    )

    // Set session
    const sessionData: SessionData = {
      userId: user.id,
      username: user.username,
      role: user.role
    }
    await setUserSession(event, sessionData)

    return '/'
  } catch (err) {
    console.error(`[OAuth] ${provider} callback failed:`, err)
    return '/login?error=oauth-failed'
  }
}
