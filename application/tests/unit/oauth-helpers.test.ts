import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  base64url,
  generateCodeVerifier,
  codeChallengeS256,
  generateState,
  resolvePublicBaseUrl,
  buildRedirectUri,
  parseAllowList,
  emailDomainOf,
  isEmailDomainAllowed,
  isOrgAllowed,
  resolveProvisioningAction,
  resolveLinkAction,
  resolveUnlink,
  type OAuthUserRow,
  type OAuthProfile,
} from '../../server/utils/oauth-helpers';
import { Role } from '#shared/types';

// Convenience builders -------------------------------------------------------

const profile = (over: Partial<OAuthProfile> = {}): OAuthProfile => ({
  provider: 'google',
  providerId: 'pid-1',
  email: 'alice@example.com',
  emailVerified: true,
  name: 'Alice',
  avatar: 'https://img/a.png',
  ...over,
});

const row = (over: Partial<OAuthUserRow> = {}): OAuthUserRow => ({
  id: 1,
  email: null,
  emailVerified: false,
  oauthProvider: null,
  oauthProviderId: null,
  avatarUrl: null,
  name: null,
  password: '',
  ...over,
});

// PKCE -----------------------------------------------------------------------

describe('PKCE', () => {
  test('base64url has no +, / or = padding', () => {
    // Bytes FB FF BF encode to "+/+/" in standard base64 → must become "-_-_".
    const encoded = base64url(Buffer.from([0xfb, 0xff, 0xbf]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toBe('-_-_');
  });

  test('codeChallengeS256 matches RFC 7636 Appendix B test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(codeChallengeS256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('codeChallengeS256 equals manual S256 derivation', () => {
    const verifier = generateCodeVerifier();
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(codeChallengeS256(verifier)).toBe(expected);
  });

  test('generated verifier and state are url-safe and high-entropy', () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
    expect(generateState()).toMatch(/^[a-f0-9]{64}$/);
    expect(generateState()).not.toBe(generateState());
  });
});

// Redirect URI ---------------------------------------------------------------

describe('redirect URI', () => {
  test('prefers configured site URL and trims trailing slashes', () => {
    expect(resolvePublicBaseUrl('https://piwi.example.com/', 'http://localhost:3000')).toBe('https://piwi.example.com');
    expect(resolvePublicBaseUrl('https://piwi.example.com///', 'http://x')).toBe('https://piwi.example.com');
  });

  test('falls back to the request origin when site URL is unset', () => {
    expect(resolvePublicBaseUrl(undefined, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolvePublicBaseUrl('', 'https://proxy.host')).toBe('https://proxy.host');
  });

  test('builds the provider callback path', () => {
    expect(buildRedirectUri('https://piwi.example.com', 'github')).toBe(
      'https://piwi.example.com/api/auth/oauth/github/callback',
    );
  });
});

// Allowlists -----------------------------------------------------------------

describe('allowlists', () => {
  test('parseAllowList splits, trims, lower-cases and drops blanks', () => {
    expect(parseAllowList(' Example.com, ACME.org ,, ')).toEqual(['example.com', 'acme.org']);
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList('')).toEqual([]);
  });

  test('emailDomainOf extracts the lower-cased domain', () => {
    expect(emailDomainOf('Bob@Example.COM')).toBe('example.com');
    expect(emailDomainOf('no-domain')).toBe('');
  });

  test('empty domain allowlist allows everyone', () => {
    expect(isEmailDomainAllowed('x@any.io', false, [])).toBe(true);
  });

  test('domain allowlist requires a verified email in an allowed domain', () => {
    const allowed = ['example.com'];
    expect(isEmailDomainAllowed('alice@example.com', true, allowed)).toBe(true);
    expect(isEmailDomainAllowed('alice@example.com', false, allowed)).toBe(false); // unverified
    expect(isEmailDomainAllowed('eve@evil.com', true, allowed)).toBe(false); // wrong domain
    expect(isEmailDomainAllowed('', true, allowed)).toBe(false); // no email
  });

  test('org allowlist matches case-insensitively, empty = unrestricted', () => {
    expect(isOrgAllowed(['acme'], [])).toBe(true);
    expect(isOrgAllowed(['Acme', 'other'], ['acme'])).toBe(true);
    expect(isOrgAllowed(['other'], ['acme'])).toBe(false);
    expect(isOrgAllowed([], ['acme'])).toBe(false);
  });
});

// Provisioning ---------------------------------------------------------------

describe('resolveProvisioningAction', () => {
  test('refresh: identity match keeps profile + email in sync, OR-ing verification', () => {
    const existing = row({
      id: 7,
      email: 'old@example.com',
      emailVerified: true,
      oauthProvider: 'google',
      oauthProviderId: 'pid-1',
    });
    const action = resolveProvisioningAction(profile({ email: 'new@example.com', emailVerified: false }), existing);
    expect(action).toEqual({
      kind: 'refresh',
      userId: 7,
      set: { avatarUrl: 'https://img/a.png', name: 'Alice', email: 'new@example.com', emailVerified: true },
    });
  });

  test('refresh: keeps stored email when provider sends none', () => {
    const existing = row({
      id: 7,
      email: 'kept@example.com',
      emailVerified: true,
      oauthProvider: 'google',
      oauthProviderId: 'pid-1',
    });
    const action = resolveProvisioningAction(profile({ email: '', emailVerified: false }), existing);
    expect(action.kind).toBe('refresh');
    if (action.kind === 'refresh') {
      expect(action.set.email).toBe('kept@example.com');
      expect(action.set.emailVerified).toBe(true);
    }
  });

  test('link: verified email matches an unlinked local account', () => {
    const local = row({ id: 9, email: 'alice@example.com' });
    const action = resolveProvisioningAction(profile(), undefined, local);
    expect(action).toEqual({
      kind: 'link',
      userId: 9,
      set: {
        oauthProvider: 'google',
        oauthProviderId: 'pid-1',
        avatarUrl: 'https://img/a.png',
        name: 'Alice',
        emailVerified: true,
      },
    });
  });

  test('link: re-linking the same provider identity is allowed (not a conflict)', () => {
    const local = row({ id: 9, email: 'alice@example.com', oauthProvider: 'google', oauthProviderId: 'pid-1' });
    expect(resolveProvisioningAction(profile(), undefined, local).kind).toBe('link');
  });

  test('conflict: verified email matches an account linked to a different provider', () => {
    const local = row({ id: 9, email: 'alice@example.com', oauthProvider: 'github', oauthProviderId: 'gh-9' });
    expect(resolveProvisioningAction(profile({ provider: 'google' }), undefined, local)).toEqual({ kind: 'conflict' });
  });

  test('create: no matches → new OAuth-only user with email populated', () => {
    const action = resolveProvisioningAction(profile());
    expect(action.kind).toBe('create');
    if (action.kind === 'create') {
      expect(action.values).toMatchObject({
        username: 'alice@example.com',
        password: '',
        role: Role.USER,
        email: 'alice@example.com',
        emailVerified: true,
        oauthProvider: 'google',
        oauthProviderId: 'pid-1',
      });
    }
  });

  test('create: an unverified email is not used to link, even if it matches', () => {
    // emailMatch is only passed by the caller for verified emails; with an
    // unverified email the resolver must fall through to create regardless.
    const local = row({ id: 9, email: 'alice@example.com' });
    const action = resolveProvisioningAction(profile({ emailVerified: false }), undefined, local);
    expect(action.kind).toBe('create');
    if (action.kind === 'create') expect(action.values.emailVerified).toBe(false);
  });
});

// Explicit linking -----------------------------------------------------------

describe('resolveLinkAction', () => {
  test('conflict when the provider identity belongs to another user', () => {
    const me = row({ id: 1, password: 'hash' });
    const takenBy = row({ id: 2, oauthProvider: 'google', oauthProviderId: 'pid-1' });
    expect(resolveLinkAction(me, profile(), takenBy)).toEqual({ kind: 'conflict' });
  });

  test('links and backfills only missing profile fields', () => {
    const me = row({
      id: 1,
      email: 'mine@corp.com',
      emailVerified: true,
      name: 'My Name',
      avatarUrl: null,
      password: 'hash',
    });
    const action = resolveLinkAction(me, profile({ email: 'alice@example.com', name: 'Alice', avatar: 'A.png' }));
    expect(action.kind).toBe('link');
    if (action.kind === 'link') {
      // existing name/email kept; missing avatar backfilled from provider
      expect(action.set).toMatchObject({
        oauthProvider: 'google',
        oauthProviderId: 'pid-1',
        email: 'mine@corp.com',
        emailVerified: true,
        name: 'My Name',
        avatarUrl: 'A.png',
      });
    }
  });

  test('re-linking the same identity to the same user is allowed', () => {
    const me = row({ id: 1, password: 'hash' });
    const same = row({ id: 1, oauthProvider: 'google', oauthProviderId: 'pid-1' });
    expect(resolveLinkAction(me, profile(), same).kind).toBe('link');
  });

  test('adopts provider email + verification when the account has none', () => {
    const me = row({ id: 1, email: null, emailVerified: false, password: 'hash' });
    const action = resolveLinkAction(me, profile({ email: 'alice@example.com', emailVerified: true }));
    if (action.kind === 'link') {
      expect(action.set.email).toBe('alice@example.com');
      expect(action.set.emailVerified).toBe(true);
    }
  });
});

// Unlink ---------------------------------------------------------------------

describe('resolveUnlink', () => {
  test('refuses when the provider is not the linked one', () => {
    expect(resolveUnlink(row({ oauthProvider: 'github', password: 'hash' }), 'google')).toEqual({
      ok: false,
      reason: 'not-linked',
    });
    expect(resolveUnlink(undefined, 'google')).toEqual({ ok: false, reason: 'not-linked' });
  });

  test('refuses to remove the only sign-in method (no password)', () => {
    expect(resolveUnlink(row({ oauthProvider: 'google', password: '' }), 'google')).toEqual({
      ok: false,
      reason: 'no-password',
    });
  });

  test('allows when linked and a password exists', () => {
    expect(resolveUnlink(row({ oauthProvider: 'google', password: 'hash' }), 'google')).toEqual({ ok: true });
  });
});
