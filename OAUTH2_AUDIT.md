# OAuth2 Implementation Audit

**Date:** 2026-06-25
**Scope:** OAuth2 sign-in (Google, GitHub) — security, UX, and documentation.
**Primary files reviewed:**
- `application/server/utils/oauth.ts` — core flow (state, code exchange, userinfo, user provisioning)
- `application/server/api/auth/oauth/[provider]/login.get.ts` — initiate endpoint
- `application/server/api/auth/oauth/[provider]/callback.get.ts` — callback endpoint
- `application/nuxt.config.ts` — runtime config / provider exposure
- `application/app/pages/login.vue`, `app/pages/settings/account.vue`, `app/pages/settings/users.vue` — UX
- `docs/authentication.md`, `docs/configuration.md`, `application/.env.example` — docs
- `application/server/database/schema.sqlite.ts` (users table), `shared/handlers/users.ts`, `server/utils/notifications/dispatch.ts`

Overall the implementation is solid and follows the Authorization Code flow correctly: CSRF state in an httpOnly cookie, server-side secret-based code exchange (no implicit grant), provider-verified email gating before account linking, and OAuth-only users blocked from password login. The findings below are concrete improvements, ordered by severity.

> **Status (2026-06-25):** All actionable findings have been implemented.
> - **Round 1** (`oauth.ts`, `login.vue`, docs): 1.1, 1.2, 3.2, 3.3, and the conflict handling for 1.3/2.2.
> - **Round 2**: **1.4** PKCE (S256, Google), **1.6** `PIWI_SITE_URL`-based redirect URI, **2.3** explicit Connect/Disconnect on the account page (new `POST /api/auth/oauth/[provider]/unlink`, `link=1` flow, `me` exposes `hasPassword`), **2.4** `PIWI_OAUTH_ALLOWED_DOMAINS` + `PIWI_OAUTH_GITHUB_ALLOWED_ORGS` allowlists and a new-account provisioning log. Granular error codes added for 2.2 (`domain-not-allowed`, `org-not-allowed`, `already-linked`, `link-requires-login`).
> - **1.5** remains a note only (single-use random state cleared before compare — not exploitable).
> - **Tests:** the security-relevant decision logic was extracted into a pure module (`server/utils/oauth-helpers.ts`) and covered by `tests/unit/oauth-helpers.test.ts` (PKCE S256 incl. the RFC 7636 vector, redirect-URI resolution, allowlist matching, and the find/link/create/conflict + unlink decisions). Run with `npm run app:test:unit`.

---

## 1. Security

### 1.1 — HIGH: [FIXED] `email` / `emailVerified` columns are never populated for OAuth users
**File:** `oauth.ts` → `findOrCreateOAuthUser` (insert at ~L302–313, link branch at ~L286–297)

On both create and link, the code writes `username`, `name`, `avatarUrl`, `oauthProvider`, `oauthProviderId` — but **never sets the `email` or `emailVerified` columns.** The provider email is only stored in `username`.

Impact:
- **Email notifications break for OAuth users.** `notifications/dispatch.ts:134` reads `users.email` and throws `"Account has no email address"` when it's null. An OAuth user with a verified provider email still cannot receive personal email notifications.
- **Account page (`account.vue`) shows an empty email field** for OAuth users ("Email is managed by *provider*") even though the provider supplied one.
- **Admin user list (`users.vue`) shows no email and `emailVerified` is always false** for OAuth users.
- The `idx_users_email` unique index and the verified-email signal are effectively dead for OAuth accounts.

**Fix:** in `findOrCreateOAuthUser`, set `email` and `emailVerified` on the insert (and on the link/update branch), e.g. `email: email || null, emailVerified` alongside the existing fields. Decide whether `username` should remain the email or become a stable provider handle (see 1.2).

### 1.2 — MEDIUM: [FIXED] Account linking keys off `username`, not the `email` column
**File:** `oauth.ts` L282 — `where(eq(users.username, email))`

Linking matches an existing local account by `username === providerEmail`. Consequences:
- Password users created with a non-email username (the docs' own example creates `admin`) can **never be auto-linked**, even with a matching verified email — a second, separate account is silently created instead.
- Two providers returning the same verified email (e.g. Google then GitHub) **overwrite each other's `oauthProvider`/`oauthProviderId`** on the shared row. The displaced provider's `(provider, id)` lookup then misses and re-links on next login — accounts "ping-pong" between providers and `name`/`avatar` flip-flop.

**Fix:** match against the `email` column (once 1.1 populates it) instead of `username`, and treat provider identity as additive. A clean model is a dedicated identities/links table, or at minimum guard against clobbering an existing distinct `(provider,id)`.

### 1.3 — MEDIUM: [FIXED] Username collision on new OAuth user creation → confusing failure
**File:** `oauth.ts` insert ~L302

If a local account already has `username === providerEmail` but the OAuth email is **not** verified (e.g. GitHub with no primary-verified email, so the link branch is skipped), the insert hits the `username` UNIQUE constraint, throws, and the user is bounced to `/login?error=oauth-failed` with no actionable explanation. Safe, but poor diagnosis. Resolving 1.2 (and only auto-creating when no email/username conflict exists) removes this path; otherwise surface a specific `error=account-exists`.

### 1.4 — LOW: [FIXED] No PKCE on the authorization request
**File:** `oauth.ts` `initiateOAuth`

The flow relies solely on the `state` cookie + confidential client secret. That's acceptable for a server-side confidential client, but adding PKCE (`code_challenge`/`code_verifier`, verifier stored next to `state`) is now standard hardening (OAuth 2.1 makes it the default) and costs little. Recommended, not blocking.

### 1.5 — LOW: [OPEN/NOTE] `state` comparison is not constant-time; cookie not host-bound
`query.state !== savedState` (L349) is a plain string compare. Because `state` is a single-use 256-bit random value cleared immediately (`clearOAuthState` before the check), timing leakage is not practically exploitable — note only. The state cookie also has no `__Host-`/`__Secure-` prefix; given `secure` is already set on HTTPS this is minor.

### 1.6 — LOW: [FIXED] Redirect URI derived from request `Host`
**File:** `oauth.ts` `getRedirectUri` uses `getRequestURL(event).host`

Behind a reverse proxy/misconfigured `X-Forwarded-Host`, the computed `redirect_uri` can diverge from the registered one. Providers reject mismatches (so this is a robustness/config issue, not an open redirect), but it can cause hard-to-debug failures. Consider deriving the callback base from `PIWI_SITE_URL` when set, for consistency with email links.

### 1.7 — INFO: Good practices confirmed
- Final redirect target is a fixed `'/'` — **no open-redirect / `returnTo` injection.** ✓
- Authorization Code flow with server-side secret exchange; no token ever reaches the browser. ✓
- Provider error/token-exchange bodies are caught and collapsed to generic `?error=` codes; raw provider text is only `console.error`-logged, not shown to the user. ✓
- OAuth-only users (empty password) are rejected by `verifyUser` — cannot fall back to password login. ✓
- GitHub email is upgraded to the primary **verified** address via `/user/emails`; unverified → `emailVerified=false`, blocking auto-link. ✓
- Auto-link gated on `emailVerified` — prevents takeover via an attacker-controlled public email (documented as §1.3 in-code). ✓

---

## 2. UX

### 2.1 — MEDIUM: [FIXED] OAuth users see an empty, non-actionable email card
Driven by 1.1. `account.vue` shows the verified/not-verified banner off a `null` email and an empty disabled input. Once the email column is populated, this becomes correct automatically (banner should read "Verified" for verified provider emails).

### 2.2 — LOW: [FIXED] Callback failures funnel to a single generic message
`handleOAuthCallback` maps most failures to `oauth-failed` → "OAuth authentication failed." Distinct, common cases (provider returned no verified email, account-already-exists, token exchange/provider outage) would benefit from specific `?error=` codes and copy so users know whether to retry, use a password, or contact an admin. The error-code → message map already exists in `login.vue:24` and is easy to extend.

### 2.3 — LOW: [FIXED] No account-linking affordance for existing logged-in users
A password user cannot "Connect Google/GitHub" from `account.vue`; linking only happens implicitly at login via email match (and only when 1.2 is addressed). A "Connect account" button on the account page would make linking explicit and predictable.

### 2.4 — LOW: [FIXED] New OAuth users always get `Role.USER` with no admin signal
Reasonable default, but there is no notification/queue for admins that a new OAuth account appeared, and no allowlist (e.g. restrict to a Google Workspace domain / GitHub org). For self-hosted dashboards, a `PIWI_OAUTH_ALLOWED_DOMAINS`/org allowlist would be a valuable, expected control. Consider for the roadmap.

### 2.5 — INFO: Login page UX is good
Provider buttons render only when configured, demo mode hides them, the password/OAuth separator and error alert are clear. ✓

---

## 3. Documentation

### 3.1 — GOOD coverage
`docs/authentication.md` has a dedicated OAuth section: provider registration (correct callback URLs), env vars, button auto-display rule, a "How it works" flow, and notes (OAuth-only users can't use password login, not available in demo, avatars shown). `configuration.md`, `.env.example`, and the OpenAPI `security: []` annotations on both endpoints are all in sync. The auto-link verified-email rule has an in-code comment.

### 3.2 — LOW: [FIXED] Docs describe linking "by email" but code links by username
`authentication.md:127` says *"If a user with the same email exists, the existing account is linked."* The code actually matches `username` (1.2). Either fix the code to match the docs (preferred) or correct the docs.

### 3.3 — LOW: [FIXED] Undocumented behaviors worth adding
- Behavior when a provider returns **no verified email** (GitHub): a fresh `USER` account is created and not linked.
- That OAuth users currently **cannot receive email notifications** (until 1.1 is fixed) — and once fixed, that their email comes from the provider.
- Reverse-proxy guidance for the callback URL / `X-Forwarded-Host` (ties to 1.6).
- No token revocation/refresh: access tokens are used once at login and discarded (the dashboard keeps only its own session). Worth a one-line note so operators don't expect provider-side session linkage.

---

## Recommended priority

1. **1.1** — populate `email`/`emailVerified` for OAuth users (fixes notifications + account/admin UI; small, high-value).
2. **1.2 / 3.2** — link by `email` column and make provider identity additive; align docs.
3. **1.3 / 2.2** — specific error codes for collision / no-verified-email / provider failure.
4. **1.4** — add PKCE.
5. **2.3 / 2.4** — explicit account linking and an optional domain/org allowlist.

None of the findings are actively exploitable in the default configuration; 1.1 and 1.2 are the ones with real functional impact today.
