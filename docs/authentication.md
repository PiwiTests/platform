---
title: Authentication
lang: en-US
---

# Authentication

The dashboard supports optional user authentication with role-based access control. Authentication is **disabled by default**.

## Roles

| Role | Description |
|------|-------------|
| **Administrator** | Full access to all features including editing projects, managing users, and deleting runs |
| **Reporter** | Can only call submission API endpoints (`/api/test-runs/submit` and `/api/test-runs/upload`) |
| **User** | Read-only access to all dashboard pages and data |

## Enabling authentication

1. Copy the example environment file:

   ```bash
   cd application
   cp .env.example .env
   ```

2. Edit `.env` and set:

   ```bash
   NUXT_AUTH_ENABLED=true
   NUXT_AUTH_SECRET=your-secret-key-here
   ```

   Generate a strong secret key for production:

   ```bash
   openssl rand -hex 32
   ```

3. Restart the application.

## Initial setup

When authentication is first enabled and no users exist, create the first administrator account:

```bash
curl -X POST http://localhost:3000/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-secure-password",
    "name": "Administrator"
  }'
```

This endpoint is only available when the users table is empty.

## Logging in

Navigate to `/login` in your browser, or use the API:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-secure-password"}'
```

Sessions are stored in encrypted cookies and last for 7 days.

## OAuth (Google, GitHub)

The dashboard supports signing in with Google or GitHub as an alternative to username/password authentication.

### Configuring OAuth

1. **Register an OAuth application** with each provider you want to use:

   - **Google**: Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 Client ID, and add `https://your-domain.com/api/auth/oauth/google/callback` to the authorized redirect URIs.
   - **GitHub**: Go to **Settings → Developer settings → OAuth Apps** on GitHub, create a new OAuth app, and set the callback URL to `https://your-domain.com/api/auth/oauth/github/callback`.

2. **Add the credentials to your `.env` file:**

   ```bash
   NUXT_OAUTH_GOOGLE_CLIENT_ID=your-google-client-id
   NUXT_OAUTH_GOOGLE_CLIENT_SECRET=your-google-client-secret
   NUXT_OAUTH_GITHUB_CLIENT_ID=your-github-client-id
   NUXT_OAUTH_GITHUB_CLIENT_SECRET=your-github-client-secret
   ```

   Only configure the providers you actually want to use. OAuth buttons appear automatically on the login page when both a provider's `CLIENT_ID` and `CLIENT_SECRET` are set.

3. **Restart the application.** The login page now shows **Sign in with Google** and/or **Sign in with GitHub** buttons above the password form.

### How it works

1. User clicks an OAuth button on the login page.
2. The server redirects to the provider's authorization page with a cryptographically random `state` parameter stored in an httpOnly cookie.
3. After authorization, the provider redirects back to the callback URL.
4. The server validates the `state` cookie (CSRF protection), exchanges the code for an access token, and fetches the user's profile (name, email, avatar).
5. A local user is created or linked:
   - If a user with the same OAuth provider + ID exists, their name/avatar are updated.
   - If a user with the same email exists, the existing account is linked to the OAuth provider.
   - Otherwise, a new user is created with the **user** role and an empty password (password login disabled for OAuth-only users).
6. A session is established (same encrypted cookie as password login), and the browser is redirected to the dashboard homepage.

### Notes

- OAuth users have an empty password and **cannot sign in with username/password**. They must always use their OAuth provider.
- The reporter (CI/CD) authentication is unaffected — it continues to use API keys or username/password.
- OAuth is **not available in demo mode**; the buttons are not shown.
- Avatar URLs from the provider are displayed in the user menu when available.

## User management

User accounts are managed through the admin interface at `/settings/users`.  
This page is accessible to administrators (or to everyone when authentication is disabled, with an informational message).

To create additional users:

1. Navigate to `/settings/users`
2. Click **Add user**
3. Set username, password, role, and optional display name

## API authentication

When authentication is enabled:

- `POST` / `PUT` / `DELETE` endpoints require an active session with appropriate role permissions.
- `GET` endpoints remain publicly accessible (read-only), **except** `GET /api/users`, which requires an authenticated session so the user list (usernames and roles) is not exposed to anonymous callers.
- The reporter's submission endpoints (`/api/test-runs/submit` and `/api/test-runs/upload`) accept both session cookies and API keys.

## API keys

API keys are the recommended way to authenticate CI pipelines and the Playwright reporter. They are long-lived tokens tied to a specific user account.

### Security properties

- Keys are generated with 256 bits of cryptographic entropy (`pd_` prefix + 64-character hex string).
- Only a SHA-256 hash of the key is stored in the database — the plaintext is shown **once** at creation time and never retrievable again.
- Each key displays a short prefix (`pd_xxxxxxxx…`) in the UI for identification without revealing the secret.
- Keys are sent as `Authorization: Bearer <key>` or `X-API-Key: <key>` headers.
- Keys can be given an optional expiry date.

### Creating an API key

1. Navigate to **Settings → Users** in the dashboard.
2. Click the key icon next to the user you want to generate a key for.
3. Click **Create API key**, enter a descriptive name (e.g. "GitHub Actions"), and set an optional expiry.
4. Copy the key **immediately** — it will never be shown again.
5. Store it as a CI secret (e.g. `DASHBOARD_API_KEY`).

### Revoking an API key

1. Navigate to **Settings → Users** and click the key icon.
2. Click the trash icon next to the key you want to revoke.
3. The key stops working immediately.

### Using the API key in the reporter

```typescript
// playwright.config.ts
export default defineConfig({
  reporter: [
    ['@phenx/piwi-dashboard-reporter', {
      serverUrl: 'https://your-dashboard.example.com',
      projectName: 'my-project',
      apiKey: process.env.DASHBOARD_API_KEY,
    }],
  ],
})
```

### Using the API key in raw HTTP calls

```bash
# Authorization: Bearer header (recommended)
curl -X POST https://your-dashboard.example.com/api/test-runs/submit \
  -H "Authorization: Bearer pd_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{ ... }'

# X-API-Key header (alternative)
curl -X POST https://your-dashboard.example.com/api/test-runs/submit \
  -H "X-API-Key: pd_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

## Using the reporter with session authentication (username/password)

As an alternative to API keys, create a dedicated user with the **reporter** role for your CI pipelines:

1. Log in as an administrator in `/settings/users` and add a new user with the **Reporter** role.

2. Configure the reporter with the credentials:

   ```typescript
   // playwright.config.ts
   export default defineConfig({
     reporter: [
       ['@phenx/piwi-dashboard-reporter', {
         serverUrl: 'https://your-dashboard.example.com',
         projectName: 'my-project',
         username: process.env.DASHBOARD_USERNAME,
         password: process.env.DASHBOARD_PASSWORD,
       }],
     ],
   })
   ```

3. Add `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` as secrets in your CI provider.

The reporter automatically calls `/api/auth/login` before each upload and uses the resulting session for all subsequent requests.

> **Tip:** API keys are preferred over username/password for CI because they don't require a login round-trip and can be individually revoked.

## Security considerations

- Always use HTTPS in production.
- Use strong, unique passwords.
- Generate a strong random secret for `NUXT_AUTH_SECRET`.
- Passwords are hashed using scrypt with per-password salts.
- Never use the default secret in production.

## Disabling authentication

To disable authentication:

1. Set `NUXT_AUTH_ENABLED=false` in `.env`, or remove the variable entirely.
2. Restart the application.

When disabled, all endpoints are accessible without authentication.
