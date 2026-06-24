# Piwi Dashboard

**Self-hosted Playwright test results dashboard.** Collect, store, and visualize your end-to-end test results over time — failures, performance trends, flaky tests, and live run streaming — without sending data to any third party.

📖 [Full documentation](https://piwitests.github.io) · 🎮 [Live demo](https://piwitests.github.io/demo/) · 💬 [GitHub](https://github.com/piwitests/platform)

> **Disclaimer:** Piwi Dashboard is not affiliated with, endorsed by, or connected to Microsoft Corporation.

---

## Quick start

```bash
# Linux / macOS
docker run -d \
  --name piwi-dashboard \
  -p 3000:3000 \
  -v $(pwd)/.data:/app/.data \
  ghcr.io/piwitests/dashboard:latest
```

```powershell
# Windows (PowerShell)
docker run -d `
  --name piwi-dashboard `
  -p 3000:3000 `
  -v ${PWD}/.data:/app/.data `
  ghcr.io/piwitests/dashboard:latest
```

Open `http://localhost:3000`. The SQLite database and file storage are created automatically inside `.data/`.

---

## Image details

| Property   | Value                              |
|------------|------------------------------------|
| Base image | `node:24-alpine`                   |
| Platforms  | `linux/amd64`, `linux/arm64`       |
| Image size | ~200 MB                            |
| Registry   | `ghcr.io/piwitests/dashboard`     |
| Run as     | Non-root (`nodejs`, UID/GID 1001)  |

### Available tags

| Tag       | Description                            |
|-----------|----------------------------------------|
| `latest`  | Latest stable release                  |
| `v1.2.3`  | Exact version (pinned, recommended)    |
| `v1.2`    | Latest patch for a minor version       |
| `v1`      | Latest release for a major version     |

---

## Volumes

Mount a host directory at `/app/.data` to persist all data between container restarts:

```bash
docker run -d -p 3000:3000 -v /your/data/path:/app/.data ghcr.io/piwitests/dashboard:latest
```

> On Windows (PowerShell), use a host path like `C:\piwi\data` in place of `/your/data/path`.

`/app/.data` contains:

- `piwi.db` — SQLite database (skipped when `PIWI_DATABASE_URL` is set)
- `storage/` — HTML reports and trace files (skipped when S3 is configured)

> **Permission note (Linux hosts only):** The container runs as UID 1001. If you see permission errors, run `chmod -R 777 /your/data/path` or `chown -R 1001:1001 /your/data/path`. On Windows/macOS, Docker Desktop manages this automatically.

---

## Environment variables

### Core

| Variable   | Default | Description                   |
|------------|---------|-------------------------------|
| `PORT`     | `3000`  | Port the server listens on    |
| `NODE_ENV` | `production` | Set automatically        |

### Database

By default, Piwi uses SQLite stored in `/app/.data/piwi.db`. Set `PIWI_DATABASE_URL` to use PostgreSQL instead.

| Variable        | Default           | Description                                          |
|-----------------|-------------------|------------------------------------------------------|
| `PIWI_DATABASE_PATH` | `.data/piwi.db`   | Path to the SQLite file (ignored when `PIWI_DATABASE_URL` is set) |
| `PIWI_DATABASE_URL`  | —                 | PostgreSQL connection string — switches to PostgreSQL when set. Format: `postgresql://user:pass@host:5432/dbname` |

### File storage

| Variable              | Default   | Description                                         |
|-----------------------|-----------|-----------------------------------------------------|
| `PIWI_STORAGE_TYPE`        | `local`   | `local` or `s3`                                     |
| `PIWI_STORAGE_PATH`        | `.data/storage` | Local storage directory (only when `PIWI_STORAGE_TYPE=local`) |
| `PIWI_S3_BUCKET`           | —         | S3 bucket name                                      |
| `PIWI_S3_REGION`           | —         | S3 region (e.g. `us-east-1`, `auto` for R2)         |
| `PIWI_S3_ACCESS_KEY_ID`    | —         | S3 access key ID                                    |
| `PIWI_S3_SECRET_ACCESS_KEY`| —         | S3 secret access key                                |
| `PIWI_S3_ENDPOINT`         | —         | Custom endpoint for S3-compatible services (MinIO, R2, Spaces…) |
| `PIWI_S3_FORCE_PATH_STYLE` | `true` when `PIWI_S3_ENDPOINT` is set | Override path-style URL behavior |

### Security & authentication

| Variable                       | Default | Description                                                             |
|--------------------------------|---------|-------------------------------------------------------------------------|
| `PIWI_SECRET_KEY`              | —       | **Recommended in all deployments.** Master key for AES-256-GCM encryption of sensitive values stored in the database (AI API keys, SCM tokens). Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` (or `openssl rand -hex 32`) |
| `PIWI_AUTH_ENABLED`            | —       | Set to `true` to enable authentication                                  |
| `PIWI_AUTH_SECRET`             | —       | **Required when auth is enabled.** Random string used to sign session cookies. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` (or `openssl rand -hex 32`) |
| `PIWI_OAUTH_GOOGLE_CLIENT_ID`  | —       | Google OAuth client ID (shows "Sign in with Google" when set with secret) |
| `PIWI_OAUTH_GOOGLE_CLIENT_SECRET` | —    | Google OAuth client secret                                              |
| `PIWI_OAUTH_GITHUB_CLIENT_ID`  | —       | GitHub OAuth client ID (shows "Sign in with GitHub" when set with secret) |
| `PIWI_OAUTH_GITHUB_CLIENT_SECRET` | —    | GitHub OAuth client secret                                              |

### AI diagnosis (optional)

These can also be configured through the Settings UI at runtime.

| Variable              | Default | Description                                                          |
|-----------------------|---------|----------------------------------------------------------------------|
| `PIWI_AI_PROVIDER`    | —       | `anthropic` or `openai`                                              |
| `PIWI_AI_API_KEY`     | —       | API key for the selected provider                                    |
| `PIWI_AI_MODEL`       | `claude-opus-4-8` (Anthropic) | Model name                              |
| `PIWI_AI_BASE_URL`    | —       | Base URL for OpenAI-compatible providers (e.g. `http://ollama:11434/v1`) |
| `PIWI_AI_AUTO_DIAGNOSE` | —     | Set to `true` to automatically diagnose new failure clusters on run completion |

---

## Docker Compose examples

### Minimal — SQLite + local storage

```yaml
services:
  piwi-dashboard:
    image: ghcr.io/piwitests/dashboard:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/.data
    restart: unless-stopped
```

### With authentication enabled

```yaml
services:
  piwi-dashboard:
    image: ghcr.io/piwitests/dashboard:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/.data
    environment:
      PIWI_SECRET_KEY: "replace-with-openssl-rand-hex-32-output"
      PIWI_AUTH_ENABLED: "true"
      PIWI_AUTH_SECRET: "replace-with-a-different-openssl-rand-hex-32-output"
    restart: unless-stopped
```

### PostgreSQL + S3 storage

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: piwi
      POSTGRES_PASSWORD: piwi
      POSTGRES_DB: piwi_dashboard
    volumes:
      - pg-data:/var/lib/postgresql/data
    restart: unless-stopped

  piwi-dashboard:
    image: ghcr.io/piwitests/dashboard:latest
    ports:
      - "3000:3000"
    environment:
      PIWI_DATABASE_URL: postgresql://piwi:piwi@postgres:5432/piwi_dashboard
      PIWI_STORAGE_TYPE: s3
      PIWI_S3_BUCKET: my-piwi-bucket
      PIWI_S3_REGION: us-east-1
      PIWI_S3_ACCESS_KEY_ID: your-access-key
      PIWI_S3_SECRET_ACCESS_KEY: your-secret-key
      PIWI_SECRET_KEY: "replace-with-openssl-rand-hex-32-output"
      PIWI_AUTH_ENABLED: "true"
      PIWI_AUTH_SECRET: "replace-with-a-different-openssl-rand-hex-32-output"
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  pg-data:
```

### MinIO (self-hosted S3)

```yaml
services:
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio-data:/data
    restart: unless-stopped

  piwi-dashboard:
    image: ghcr.io/piwitests/dashboard:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/.data
    environment:
      PIWI_STORAGE_TYPE: s3
      PIWI_S3_ENDPOINT: http://minio:9000
      PIWI_S3_BUCKET: piwi-dashboard
      PIWI_S3_REGION: us-east-1
      PIWI_S3_ACCESS_KEY_ID: minioadmin
      PIWI_S3_SECRET_ACCESS_KEY: minioadmin
    restart: unless-stopped

volumes:
  minio-data:
```

---

## Setting up authentication

When `PIWI_AUTH_ENABLED=true`, authentication is required. On first run (empty user table), create the initial admin account:

```bash
# Linux / macOS
curl -X POST http://localhost:3000/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-secure-password",
    "name": "Administrator"
  }'
```

```powershell
# Windows (PowerShell)
$body = @{ username = 'admin'; password = 'your-secure-password'; name = 'Administrator' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/setup `
  -ContentType 'application/json' -Body $body
```

This endpoint is only available before any user is created. After that, manage users from **Settings → Users** in the dashboard UI.

**Roles:**

| Role          | Permissions                                                    |
|---------------|----------------------------------------------------------------|
| Administrator | Full access: edit projects, manage users, delete runs          |
| Reporter      | Submit test results only (for CI service accounts)             |
| User          | Read-only access to all dashboard pages                        |

---

## Connecting the Playwright reporter

Install the reporter in your test project:

```bash
npm install --save-dev @piwitests/reporter
```

Add it to `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@piwitests/reporter', {
      serverUrl: 'http://your-dashboard:3000',
      projectName: 'my-project',
    }],
  ],
  use: {
    trace: 'retain-on-failure',
  },
})
```

Results appear in the dashboard after each run. The project is created automatically on first submission.

### With authentication (API key — recommended for CI)

Generate an API key in **Settings → Users → API keys**, store it as a CI secret, then:

```typescript
['@piwitests/reporter', {
  serverUrl: 'https://your-dashboard.example.com',
  projectName: 'my-project',
  apiKey: process.env.PIWI_API_KEY,
}]
```

### Common reporter options

| Option           | Default | Description                                        |
|------------------|---------|----------------------------------------------------|
| `serverUrl`      | `http://localhost:3000` | Dashboard URL                        |
| `projectName`    | `default-project` | Project name (auto-created)                |
| `uploadTraces`   | `true`  | Upload `.zip` trace files                          |
| `uploadReport`   | `true`  | Upload the Playwright HTML report                  |
| `streaming`      | `true`  | Stream results live as tests run                   |
| `environment`    | —       | Tag the run (e.g. `staging`, `production`)         |
| `tags`           | —       | Array of tags for the run                          |
| `apiKey`         | —       | API key (preferred for CI)                         |
| `username`       | —       | Username (alternative to API key)                  |
| `password`       | —       | Password (used with `username`)                    |

---

## Upgrading

Pull the latest image and recreate the container:

```bash
docker pull ghcr.io/piwitests/dashboard:latest
docker compose up -d --pull always
```

Database migrations run automatically on startup — no manual steps required.

---

## Troubleshooting

**Volume permission error** (Linux hosts only — Docker Desktop on Windows/macOS handles this automatically)

```bash
mkdir -p .data && chmod 777 .data
```

Or pre-create the directory owned by UID 1001:
```bash
mkdir -p .data && chown 1001:1001 .data
```

**Port already in use** — map to a different host port:

```bash
# Linux / macOS
docker run -p 8080:3000 -v $(pwd)/.data:/app/.data ghcr.io/piwitests/dashboard:latest
```

```powershell
# Windows (PowerShell)
docker run -p 8080:3000 -v ${PWD}/.data:/app/.data ghcr.io/piwitests/dashboard:latest
```

**SQLite locked / concurrent write errors** — SQLite supports only one writer at a time. For multi-instance or high-concurrency deployments, switch to PostgreSQL by setting `PIWI_DATABASE_URL`.

**Container exits immediately** — check logs:

```bash
docker logs piwi-dashboard
```

**Data not persisted after restart** — make sure you mount the volume (`-v`) when running the container.

---

## License

MIT — [source code on GitHub](https://github.com/piwitests/platform)
