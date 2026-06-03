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
- `GET` endpoints remain publicly accessible (read-only).
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
