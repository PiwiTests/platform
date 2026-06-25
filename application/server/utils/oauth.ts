import type { H3Event } from 'h3';
import { randomBytes } from 'node:crypto';
import { getDatabase } from '../database';
import { users } from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { Role } from '../../shared/types';
import { setUserSession, isAuthEnabled } from './auth';
import type { SessionData } from './auth';
import type { User } from '../database/schema';

// ---------------------------------------------------------------------------
// Provider configurations
// ---------------------------------------------------------------------------

interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  extraParams?: Record<string, string>;
  mapUser: (raw: Record<string, unknown>) => {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    avatar: string;
  };
}

function getProviderConfig(event: H3Event, provider: string): OAuthProviderConfig | null {
  const config = useRuntimeConfig(event).oauth as
    | Record<string, { clientId: string; clientSecret: string }>
    | undefined;
  const providerConfig = config?.[provider];
  if (!providerConfig?.clientId || !providerConfig?.clientSecret) {
    return null;
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
        mapUser: (raw) => ({
          id: String(raw.id),
          email: String(raw.email ?? ''),
          emailVerified: raw.email_verified === true,
          name: String(raw.name ?? raw.email ?? ''),
          avatar: String(raw.picture ?? ''),
        }),
      };
    }
    case 'github': {
      return {
        clientId: providerConfig.clientId,
        clientSecret: providerConfig.clientSecret,
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scopes: ['read:user', 'user:email'],
        mapUser: (raw) => ({
          id: String(raw.id),
          email: String(raw.email ?? raw.login ?? ''),
          emailVerified: false, // Overridden by /user/emails call in fetchProviderUser
          name: String(raw.name ?? raw.login ?? ''),
          avatar: String(raw.avatar_url ?? ''),
        }),
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// State cookie helpers
// ---------------------------------------------------------------------------

const STATE_COOKIE = 'oauth_state';
const STATE_EXPIRY_SEC = 600; // 10 minutes

function setOAuthState(event: H3Event, state: string): void {
  const url = getRequestURL(event);
  setCookie(event, STATE_COOKIE, state ?? '', {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_EXPIRY_SEC,
  });
}

function getOAuthState(event: H3Event): string | null {
  return getCookie(event, STATE_COOKIE) ?? null;
}

function clearOAuthState(event: H3Event): void {
  deleteCookie(event, STATE_COOKIE);
}

// ---------------------------------------------------------------------------
// Generate state parameter
// ---------------------------------------------------------------------------

function generateState(): string {
  return randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Build redirect URI for the callback
// ---------------------------------------------------------------------------

function getRedirectUri(event: H3Event, provider: string): string {
  const url = getRequestURL(event);
  return `${url.protocol}//${url.host}/api/auth/oauth/${provider}/callback`;
}

// ---------------------------------------------------------------------------
// Initiate OAuth: generate state, set cookie, return redirect URL
// ---------------------------------------------------------------------------

export function initiateOAuth(event: H3Event, provider: string): string | null {
  if (!isAuthEnabled(event)) {
    return null;
  }

  const providerCfg = getProviderConfig(event, provider);
  if (!providerCfg) {
    return null;
  }

  const state = generateState();
  setOAuthState(event, state);

  const params = new URLSearchParams({
    client_id: providerCfg.clientId,
    redirect_uri: getRedirectUri(event, provider),
    response_type: 'code',
    scope: providerCfg.scopes.join(' '),
    state,
  });

  if (providerCfg.extraParams) {
    for (const [key, value] of Object.entries(providerCfg.extraParams)) {
      params.set(key, value);
    }
  }

  return `${providerCfg.authorizationUrl}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Exchange authorization code for access token
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

async function exchangeCode(event: H3Event, provider: string, code: string): Promise<TokenResponse> {
  const providerCfg = getProviderConfig(event, provider);
  if (!providerCfg) {
    throw createError({ statusCode: 400, message: `Unknown OAuth provider: ${provider}` });
  }

  const body = new URLSearchParams({
    client_id: providerCfg.clientId,
    client_secret: providerCfg.clientSecret,
    code,
    redirect_uri: getRedirectUri(event, provider),
    grant_type: 'authorization_code',
  });

  const res = await fetch(providerCfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw createError({ statusCode: 502, message: `Token exchange failed: ${res.status} ${text}` });
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// Fetch user info from the provider
// ---------------------------------------------------------------------------

async function fetchProviderUser(
  event: H3Event,
  provider: string,
  accessToken: string,
): Promise<{ id: string; email: string; emailVerified: boolean; name: string; avatar: string }> {
  const providerCfg = getProviderConfig(event, provider);
  if (!providerCfg) {
    throw createError({ statusCode: 400, message: `Unknown OAuth provider: ${provider}` });
  }

  const res = await fetch(providerCfg.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw createError({ statusCode: 502, message: `Failed to fetch user info: ${res.status} ${text}` });
  }

  const raw = (await res.json()) as Record<string, unknown>;
  const user = providerCfg.mapUser(raw);

  // For GitHub, the primary user info endpoint may return an unverified public email.
  // Fetch the verified emails list from /user/emails and use the primary verified one.
  if (provider === 'github') {
    try {
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primaryVerified = emails.find((e) => e.primary && e.verified);
        if (primaryVerified) {
          user.email = primaryVerified.email;
          user.emailVerified = true;
        } else {
          user.emailVerified = false;
        }
      }
    } catch {
      // Fall back to the public email from the user info endpoint
    }
  }

  return user;
}

// ---------------------------------------------------------------------------
// Find existing OAuth user or create a new one
// ---------------------------------------------------------------------------

async function findOrCreateOAuthUser(
  provider: string,
  providerId: string,
  email: string,
  emailVerified: boolean,
  name: string,
  avatar: string,
): Promise<User> {
  const db = await getDatabase();

  // 1. Find a user already linked to this provider identity → refresh profile.
  const existing = await db
    .select()
    .from(users)
    .where(and(eq(users.oauthProvider, provider), eq(users.oauthProviderId, providerId)));

  if (existing[0]) {
    // Keep name/avatar and the provider-asserted email in sync (the provider is
    // the source of truth for OAuth-managed accounts).
    const updated = await db
      .update(users)
      .set({
        avatarUrl: avatar || null,
        name: name || null,
        email: email || existing[0].email,
        emailVerified: emailVerified || existing[0].emailVerified,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id))
      .returning();
    return updated[0]!;
  }

  // 2. Link to an existing local account by its verified email address.
  //    Only auto-link when the provider asserts the email is verified, preventing
  //    account takeover via an attacker-controlled public email (§1.3). Match on
  //    the dedicated `email` column (not `username`) so accounts created with a
  //    non-email username still link, and so the link is symmetric with the data
  //    surfaced in the account/admin UIs and used by email notifications.
  if (emailVerified && email) {
    const byEmail = await db.select().from(users).where(eq(users.email, email));
    const match = byEmail[0];

    if (match) {
      // Never hijack an account already linked to a *different* provider
      // identity — the single-provider schema cannot represent both, and
      // silently overwriting would let two providers ping-pong the linkage.
      if (
        match.oauthProvider &&
        match.oauthProviderId &&
        (match.oauthProvider !== provider || match.oauthProviderId !== providerId)
      ) {
        throw createError({
          statusCode: 409,
          data: { oauthError: 'account-exists' },
          message: 'This email is already linked to a different sign-in method.',
        });
      }

      const updated = await db
        .update(users)
        .set({
          oauthProvider: provider,
          oauthProviderId: providerId,
          avatarUrl: avatar || null,
          name: name || null,
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, match.id))
        .returning();
      return updated[0]!;
    }
  }

  // 3. Create a new user with empty password (OAuth-only). The provider email is
  //    stored in both `username` (login identifier) and `email` (notifications,
  //    account UI) so OAuth accounts are first-class for email features.
  const result = await db
    .insert(users)
    .values({
      username: email,
      password: '',
      role: Role.USER,
      name: name || null,
      email: email || null,
      emailVerified,
      avatarUrl: avatar || null,
      oauthProvider: provider,
      oauthProviderId: providerId,
    })
    .returning();

  const user = result[0];
  if (!user) {
    throw createError({ statusCode: 500, message: 'Failed to create user' });
  }

  return user;
}

// ---------------------------------------------------------------------------
// Handle OAuth callback: validate state, exchange code, create/find user,
// set session, return redirect URL
// ---------------------------------------------------------------------------

export async function handleOAuthCallback(event: H3Event, provider: string): Promise<string> {
  if (!isAuthEnabled(event)) {
    return '/login?error=auth-disabled';
  }

  // Check provider is configured before proceeding
  if (!getProviderConfig(event, provider)) {
    return '/login?error=invalid-provider';
  }

  const query = getQuery(event) as { code?: string; state?: string; error?: string };

  // User denied the authorization request
  if (query.error) {
    return '/login?error=access-denied';
  }

  // Validate state to prevent CSRF
  const savedState = getOAuthState(event);
  clearOAuthState(event);

  if (!query.state || !savedState || query.state !== savedState) {
    return '/login?error=invalid-state';
  }

  if (!query.code) {
    return '/login?error=missing-code';
  }

  try {
    // Exchange code for access token
    const token = await exchangeCode(event, provider, query.code);

    // Fetch user info from provider
    const providerUser = await fetchProviderUser(event, provider, token.access_token);

    // Find or create local user
    const user = await findOrCreateOAuthUser(
      provider,
      providerUser.id,
      providerUser.email,
      providerUser.emailVerified,
      providerUser.name,
      providerUser.avatar,
    );

    // Set session
    const sessionData: SessionData = {
      userId: user.id,
      username: user.username,
      role: user.role as Role,
    };
    await setUserSession(event, sessionData);

    return '/';
  } catch (err) {
    console.error(`[OAuth] ${provider} callback failed:`, err);
    const oauthError = (err as { data?: { oauthError?: string } })?.data?.oauthError;
    return `/login?error=${oauthError ?? 'oauth-failed'}`;
  }
}
