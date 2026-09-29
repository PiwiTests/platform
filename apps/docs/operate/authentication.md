---
title: Authentication
description: "Turn on sign-in and roles, create the first administrator, configure Google and GitHub OAuth, and manage user accounts."
lang: en-US
---

# Authentication

The dashboard supports optional sign-in with role-based access control. Authentication is **disabled by default**: every endpoint then behaves as a single administrator. Turn it on before anyone else can reach the instance; the [production checklist](./production-checklist) lists the rest of what to set.

## Roles

| Role | Description |
|------|-------------|
| **Administrator** | Full access to every project and feature — editing projects, managing users, and deleting runs. Never restricted by project access. |
| **Reporter** | Submits results and can triage, but only for the **projects it's assigned to**. |
| **User** | Read-only access to the **projects it's assigned to**. |

Administrators always see everything. **Reporter** and **User** accounts are additionally scoped by [project access](./project-access): they only see and act on the projects assigned to them.

## Enabling authentication

1. Set these variables wherever you configure the server (the container's environment, `.env`, or your host's
   dashboard):

   ```bash
   PIWI_AUTH_ENABLED=true
   PIWI_AUTH_SECRET=your-auth-secret-here  # signs session cookies
   PIWI_SECRET_KEY=your-secret-key-here    # encrypts stored credentials (AI keys, SCM tokens)
   ```

   Generate a strong random value for each secret (run it twice):

   <<< @/snippets/secret.sh{bash}

2. Restart the server. It refuses to start with authentication on and no `PIWI_AUTH_SECRET`.

## Initial setup

When authentication is enabled and no users exist yet, opening the dashboard lands on the login page, which shows a **Create the first admin account** form in place of the sign-in form. Fill it in and you are signed in as the administrator, with no API call needed.

For provisioning an instance from a script, the same step is available as an API call:

::: code-group

```bash [Linux / macOS]
curl -X POST http://localhost:3000/api/auth/setup -H "Content-Type: application/json" -d '{"username": "admin", "password": "your-secure-password", "name": "Administrator"}'
```

```powershell [Windows (PowerShell)]
$body = @{ username = 'admin'; password = 'your-secure-password'; name = 'Administrator' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/setup `
  -ContentType 'application/json' -Body $body
```

:::

Both routes go through the same setup endpoint, which is only available while the users table is empty and is rate-limited per client address.

## Logging in

Sign in at `/login`. Sessions are stored in encrypted cookies and last for 7 days. The session cookie is marked `Secure`, so browser sign-in needs HTTPS — over plain `http://` it only works on `localhost`.

## OAuth (Google, GitHub)

Users can sign in with Google or GitHub instead of a username and password.

### Configuring OAuth

1. **Register an OAuth application** with each provider you want to use:

   - **Google**: Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth 2.0 Client ID, and add the Google callback URL below to the authorized redirect URIs.
   - **GitHub**: Go to **Settings → Developer settings → OAuth Apps** on GitHub, create a new OAuth app, and set its callback URL to the GitHub one below.

   ```text
   https://your-domain.com/api/auth/oauth/google/callback
   https://your-domain.com/api/auth/oauth/github/callback
   ```

2. **Set the credentials** alongside the other variables:

   ```bash
   PIWI_OAUTH_GOOGLE_CLIENT_ID=your-google-client-id
   PIWI_OAUTH_GOOGLE_CLIENT_SECRET=your-google-client-secret
   PIWI_OAUTH_GITHUB_CLIENT_ID=your-github-client-id
   PIWI_OAUTH_GITHUB_CLIENT_SECRET=your-github-client-secret
   ```

   Only configure the providers you actually want to use. OAuth buttons appear automatically on the login page when both a provider's `CLIENT_ID` and `CLIENT_SECRET` are set.

3. **Restart the server.** The login page now shows **Sign in with Google** and/or **Sign in with GitHub** buttons above the password form.

> **Behind a reverse proxy:** set `PIWI_SITE_URL` to your public URL (e.g. `https://piwi.example.com`). The OAuth `redirect_uri` is built from it, so it stays consistent with the value you registered even when the proxy rewrites the request host. Without it the redirect URI is inferred from the incoming request.

### Restricting who can sign in (allowlists)

By default any account at a configured provider can sign in (and a new **user**-role account is created). To restrict access:

- **`PIWI_OAUTH_ALLOWED_DOMAINS`** — comma-separated email domains (e.g. `example.com,acme.org`). Only **verified** provider emails in these domains may sign in. Applies to all providers — ideal for limiting Google Workspace sign-in to your company domain.
- **`PIWI_OAUTH_GITHUB_ALLOWED_ORGS`** — comma-separated GitHub org logins. The user must be a member of at least one. Enabling this requests the `read:org` scope so membership (including private) can be checked.

Rejected sign-ins are returned to the login page with an explanatory message.

### Account linking

A first sign-in with a provider either links an existing account or creates a new one:

- If a user with the same **verified** email exists (and isn't already linked to a *different* provider), the existing account is linked to the provider. Linking needs proof on both sides: the provider must assert the email is verified, **and** the local account must have verified it too (through the verification link, an accepted invite, or an earlier provider sign-in). This stops an attacker-controlled public email, or an address someone typed into their own profile, from capturing another person's sign-in.
- If the matching account has **not** verified the address, the sign-in is refused with an explanatory message instead of being linked. The account's owner signs in with its password (or accepts their invite first) and connects the provider from **Settings → Account**.
- If the matching account is **already linked to a different provider**, the sign-in is refused: one provider is linked per account, so sign in with the original method instead.
- Otherwise, a new user is created with the **User** role and no password, so it always signs in through its provider. GitHub accounts with no verified primary email always get a new account.

The dashboard does not keep the provider's tokens: the access token is used once to read the profile, then discarded. OAuth is not available in demo mode.

### Connecting / disconnecting a provider

Signed-in users can link a provider explicitly from **Settings → Account → Connected accounts**:

- **Connect** starts the OAuth flow in "link" mode and attaches the provider identity to the current account (rather than creating a new one). A provider identity already linked to another account is refused.
- **Disconnect** removes the link. It's only allowed when the account also has a password set, so a provider-only user can't lock themselves out — set a password first.

## User management

Administrators manage accounts under **Settings → Users** (`/settings/users`). **Add user** creates one with a
username, password, role and optional display name.

### Changing a role

Each row's **Role** column is an inline selector — pick a new role to reassign it immediately (the user's active sessions are revoked so the change takes effect at once). This is the only way to change an existing account's role, including accounts created through [OAuth](#oauth-google-github), which always start with the **User** role. The **last remaining administrator cannot be demoted**, so an instance can never be left without one.

Which projects a Reporter or User can open is [project access](./project-access), and the keys that let CI and scripts sign in are [API keys](./api-keys).

## Disabling authentication

Set `PIWI_AUTH_ENABLED=false`, or remove the variable, and restart the server. Every endpoint is then accessible
without authentication.

## Related

- [Project access](./project-access): which projects each Reporter and User can open
- [API keys](./api-keys): authenticating the reporter, CI and scripts
- [Production checklist](./production-checklist): the secrets, TLS and proxy settings to go with it
- [Configuration reference](/reference/configuration#authentication): every authentication and OAuth variable
