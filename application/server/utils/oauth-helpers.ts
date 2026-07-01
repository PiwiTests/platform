// Pure, dependency-free OAuth helpers.
//
// Everything here is free of Nuxt/h3/DB context so it can be unit-tested in
// isolation. `oauth.ts` owns the I/O (cookies, fetch, DB) and delegates the
// security-relevant decisions to these functions.

import { randomBytes, createHash } from 'node:crypto';
import { Role } from '#shared/types';

// ---------------------------------------------------------------------------
// PKCE (RFC 7636)
// ---------------------------------------------------------------------------

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

export function codeChallengeS256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Redirect URI / public base URL
// ---------------------------------------------------------------------------

/**
 * Public base URL of the instance. Prefers an explicitly configured site URL
 * (stable behind a reverse proxy) and falls back to the request origin.
 */
export function resolvePublicBaseUrl(siteUrl: string | undefined, requestOrigin: string): string {
  if (siteUrl) {
    return siteUrl.replace(/\/+$/, '');
  }
  return requestOrigin.replace(/\/+$/, '');
}

export function buildRedirectUri(baseUrl: string, provider: string): string {
  return `${baseUrl}/api/auth/oauth/${provider}/callback`;
}

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

/** Parse a comma-separated allowlist into trimmed, lower-cased, non-empty entries. */
export function parseAllowList(raw: unknown): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function emailDomainOf(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/**
 * Whether a sign-in email satisfies the domain allowlist. An empty allowlist
 * means "no restriction". When restricted, the email must be provider-verified
 * and its domain present in the list.
 */
export function isEmailDomainAllowed(email: string, emailVerified: boolean, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) {
    return true;
  }
  if (!emailVerified || !email) {
    return false;
  }
  return allowedDomains.includes(emailDomainOf(email));
}

/** Whether the user's org memberships satisfy the org allowlist (empty = no restriction). */
export function isOrgAllowed(memberOrgs: string[], allowedOrgs: string[]): boolean {
  if (allowedOrgs.length === 0) {
    return true;
  }
  const member = new Set(memberOrgs.map((o) => o.toLowerCase()));
  return allowedOrgs.some((o) => member.has(o));
}

// ---------------------------------------------------------------------------
// Account provisioning / linking decisions
// ---------------------------------------------------------------------------

/** Minimal shape of a users row the resolvers need to reason about. */
export interface OAuthUserRow {
  id: number;
  email: string | null;
  emailVerified: boolean;
  oauthProvider: string | null;
  oauthProviderId: string | null;
  avatarUrl: string | null;
  name: string | null;
  password: string;
}

export interface OAuthProfile {
  provider: string;
  providerId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatar: string;
}

export type ProvisioningAction =
  | { kind: 'refresh'; userId: number; set: Record<string, unknown> }
  | { kind: 'link'; userId: number; set: Record<string, unknown> }
  | { kind: 'conflict' }
  | { kind: 'create'; values: Record<string, unknown> };

/**
 * Decide how to provision a sign-in given the user (if any) already linked to
 * this provider identity and the user (if any) owning the verified email.
 *
 * - `refresh`  — identity already linked → keep profile + email in sync.
 * - `link`     — verified email matches a local account not yet linked.
 * - `conflict` — verified email matches an account linked to a *different*
 *                provider identity (single-provider schema can't hold both).
 * - `create`   — no match → make a new OAuth-only account.
 */
export function resolveProvisioningAction(
  profile: OAuthProfile,
  identityMatch?: OAuthUserRow,
  emailMatch?: OAuthUserRow,
): ProvisioningAction {
  const { provider, providerId, email, emailVerified, name, avatar } = profile;

  if (identityMatch) {
    return {
      kind: 'refresh',
      userId: identityMatch.id,
      set: {
        avatarUrl: avatar || null,
        name: name || null,
        email: email || identityMatch.email,
        emailVerified: emailVerified || identityMatch.emailVerified,
      },
    };
  }

  if (emailVerified && email && emailMatch) {
    const linkedElsewhere =
      Boolean(emailMatch.oauthProvider) &&
      Boolean(emailMatch.oauthProviderId) &&
      (emailMatch.oauthProvider !== provider || emailMatch.oauthProviderId !== providerId);

    if (linkedElsewhere) {
      return { kind: 'conflict' };
    }

    return {
      kind: 'link',
      userId: emailMatch.id,
      set: {
        oauthProvider: provider,
        oauthProviderId: providerId,
        avatarUrl: avatar || null,
        name: name || null,
        emailVerified: true,
      },
    };
  }

  return {
    kind: 'create',
    values: {
      username: email,
      password: '',
      role: Role.USER,
      name: name || null,
      email: email || null,
      emailVerified,
      avatarUrl: avatar || null,
      oauthProvider: provider,
      oauthProviderId: providerId,
    },
  };
}

export type LinkAction = { kind: 'conflict' } | { kind: 'link'; set: Record<string, unknown> };

/**
 * Decide how to link a provider to an already-signed-in user. Refuses when the
 * provider identity already belongs to a different account; otherwise backfills
 * only the profile fields the user is missing (never overwriting their values).
 */
export function resolveLinkAction(
  currentUser: OAuthUserRow,
  profile: OAuthProfile,
  identityTakenBy?: OAuthUserRow,
): LinkAction {
  if (identityTakenBy && identityTakenBy.id !== currentUser.id) {
    return { kind: 'conflict' };
  }

  return {
    kind: 'link',
    set: {
      oauthProvider: profile.provider,
      oauthProviderId: profile.providerId,
      avatarUrl: currentUser.avatarUrl ?? (profile.avatar || null),
      name: currentUser.name ?? (profile.name || null),
      email: currentUser.email ?? (profile.email || null),
      emailVerified: currentUser.email ? currentUser.emailVerified : profile.emailVerified,
    },
  };
}

export type UnlinkDecision = { ok: true } | { ok: false; reason: 'not-linked' | 'no-password' };

/**
 * Whether a user may unlink `provider`. Refuses to remove the only sign-in
 * method (an account with no password would be locked out).
 */
export function resolveUnlink(user: OAuthUserRow | undefined, provider: string): UnlinkDecision {
  if (!user || user.oauthProvider !== provider) {
    return { ok: false, reason: 'not-linked' };
  }
  if (!user.password) {
    return { ok: false, reason: 'no-password' };
  }
  return { ok: true };
}
