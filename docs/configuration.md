---
title: Configuration reference
lang: en-US
---

# Configuration reference

Piwi is configured entirely through environment variables. It runs with **zero configuration** out of the box — SQLite and local file storage are created automatically under `.data/`. Set variables only to change a default.

Variables can go in `application/.env` (see `application/.env.example`) or be passed to the container/process. Where a value can also be set in the Settings UI, **the environment variable always wins** and the UI shows that field read-only.

## General

| Variable | Default | Description |
|----------|---------|-------------|
| `PIWI_SITE_URL` | — | Public base URL of the instance (e.g. `https://piwi.example.com`). Used to build links in emails. |
| `PIWI_SECRET_KEY` | insecure dev default | Master key for AES-256-GCM encryption of secrets stored in the database (AI API keys, webhook/SCM secrets). **Strongly recommended in production**, even without auth. Generate with `openssl rand -hex 32`. |

## Database

Piwi uses SQLite by default. Setting `PIWI_DATABASE_URL` switches it to PostgreSQL; migrations run automatically on startup.

| Variable | Default | Description |
|----------|---------|-------------|
| `PIWI_DATABASE_PATH` | `.data/piwi.db` | Path to the SQLite database file. |
| `PIWI_DATABASE_URL` | — | PostgreSQL connection string (e.g. `postgres://user:pass@host:5432/piwi`). When set, PostgreSQL is used instead of SQLite. |

See [Deployment](./deployment) for PostgreSQL setup.

## Storage

Controls where test artifacts (HTML reports, traces, attachments) are stored.

| Variable | Default | Description |
|----------|---------|-------------|
| `PIWI_STORAGE_TYPE` | `local` | `local` or `s3`. |
| `PIWI_STORAGE_PATH` | `.data/storage` | Directory for local storage. |
| `PIWI_S3_BUCKET` | — | Bucket name (S3). |
| `PIWI_S3_REGION` | — | Region (S3). |
| `PIWI_S3_ACCESS_KEY_ID` | — | Access key (S3). |
| `PIWI_S3_SECRET_ACCESS_KEY` | — | Secret key (S3). |
| `PIWI_S3_ENDPOINT` | — | Custom endpoint for S3-compatible services (MinIO, R2, Spaces). |
| `PIWI_S3_FORCE_PATH_STYLE` | `false` | Use path-style addressing (required by some S3-compatible services). |

Full details and IAM examples: [Storage configuration](./storage).

## Authentication

Authentication is optional and off by default. When disabled, all endpoints behave as a single virtual administrator.

| Variable | Default | Description |
|----------|---------|-------------|
| `PIWI_AUTH_ENABLED` | `false` | `true` to enable role-based access control and API keys. |
| `PIWI_AUTH_SECRET` | — | Secret used to sign/encrypt session cookies. Required when auth is enabled. |
| `PIWI_OAUTH_GOOGLE_CLIENT_ID` | — | Google OAuth client ID (optional SSO). |
| `PIWI_OAUTH_GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret. |
| `PIWI_OAUTH_GITHUB_CLIENT_ID` | — | GitHub OAuth client ID (optional SSO). |
| `PIWI_OAUTH_GITHUB_CLIENT_SECRET` | — | GitHub OAuth client secret. |

See [Authentication](./authentication) for roles, API keys, and project assignments.

## AI diagnosis

| Variable | Default | Description |
|----------|---------|-------------|
| `PIWI_AI_PROVIDER` | — | `anthropic` or `openai`. |
| `PIWI_AI_API_KEY` | — | Provider API key. |
| `PIWI_AI_MODEL` | `claude-opus-4-8` (Anthropic) | Model name. |
| `PIWI_AI_BASE_URL` | — | Base URL for OpenAI-compatible providers (e.g. Ollama). |
| `PIWI_AI_AUTO_DIAGNOSE` | `false` | `true` to auto-diagnose new clusters on run finish. |

The `PIWI_AI_MAX_*` and `PIWI_AI_SLOW_REQUEST_MS` context-limit variables are documented in [AI diagnosis → Context limits](./ai-diagnosis#context-limits-and-token-cost).

## Email (SMTP)

Required for email notifications and account flows (verification, password reset, invites). Set via environment only.

| Variable | Default | Description |
|----------|---------|-------------|
| `PIWI_SMTP_HOST` | — | SMTP hostname. |
| `PIWI_SMTP_PORT` | `587` | SMTP port. |
| `PIWI_SMTP_USER` | — | SMTP username. |
| `PIWI_SMTP_PASS` | — | SMTP password (never returned by the API). |
| `PIWI_SMTP_FROM` | — | From address. |
| `PIWI_SMTP_FROM_NAME` | — | From display name (optional). |
| `PIWI_SMTP_SECURE` | `false` | `true` for port 465 (implicit TLS). |

See [Notifications](./notifications) for channels and subscriptions.

## Build-time

These affect how the app is built rather than how a running instance behaves, and are mostly for contributors.

| Variable | Description |
|----------|-------------|
| `PIWI_DEMO_MODE` | Build a fully client-side demo SPA (no server) backed by in-browser SQLite. |
| `PIWI_BUILD_DIR` | Override the build output directory. |

::: tip
Variables prefixed `PIWI_*_TEST_*`, `PIWI_MAILPIT_*`, and `PIWI_POSTGRES_TEST_URL` exist only for the functional test harness and are not used by a normal deployment.
:::
