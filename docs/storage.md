---
title: Storage configuration
lang: en-US
---

# Storage configuration

The dashboard supports two storage backends for test artifacts (HTML reports, trace files, etc.).

## Local storage (default)

Files are stored in the `.data/storage/` directory relative to the application. No configuration is required.

To customize the path:

```bash
# In application/.env
PIWI_STORAGE_TYPE=local
PIWI_STORAGE_PATH=/custom/path/to/storage
```

## S3-compatible storage

Any S3-compatible service can be used: AWS S3, MinIO, DigitalOcean Spaces, Cloudflare R2, and others.

```bash
# In application/.env
PIWI_STORAGE_TYPE=s3

PIWI_S3_BUCKET=your-bucket-name
PIWI_S3_REGION=us-east-1
PIWI_S3_ACCESS_KEY_ID=your-access-key
PIWI_S3_SECRET_ACCESS_KEY=your-secret-key

# Optional: custom endpoint for S3-compatible services
PIWI_S3_ENDPOINT=https://s3.example.com
```

### AWS S3

Obtain credentials from **AWS Console → IAM → Users → Create user → Create access key**.

Minimum required IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:HeadObject"],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

### MinIO

```bash
PIWI_STORAGE_TYPE=s3
PIWI_S3_ENDPOINT=http://localhost:9000
PIWI_S3_BUCKET=piwi-dashboard
PIWI_S3_REGION=us-east-1
PIWI_S3_ACCESS_KEY_ID=minioadmin
PIWI_S3_SECRET_ACCESS_KEY=minioadmin
```

Path-style URLs are enabled automatically when `PIWI_S3_ENDPOINT` is set (as required by MinIO and most self-hosted S3-compatible services). Set `PIWI_S3_FORCE_PATH_STYLE=false` to override this behavior.

### DigitalOcean Spaces

```bash
PIWI_STORAGE_TYPE=s3
PIWI_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
PIWI_S3_BUCKET=your-space-name
PIWI_S3_REGION=nyc3
PIWI_S3_ACCESS_KEY_ID=your-spaces-key
PIWI_S3_SECRET_ACCESS_KEY=your-spaces-secret
```

### Cloudflare R2

```bash
PIWI_STORAGE_TYPE=s3
PIWI_S3_ENDPOINT=https://[account-id].r2.cloudflarestorage.com
PIWI_S3_BUCKET=your-bucket-name
PIWI_S3_REGION=auto
PIWI_S3_ACCESS_KEY_ID=your-r2-access-key
PIWI_S3_SECRET_ACCESS_KEY=your-r2-secret-key
```

## Storage management

The **Settings › Storage** page (`/settings/storage`) provides administrators with:

- **Statistics** — total projects, test runs, unique test cases, traces, stored reports, aggregate report size, and actual on-disk storage size (local only).
- **Cleanup** — permanently delete all test runs older than a configurable number of days (7, 14, 30, 60, 90, 180, or 365 days). A confirmation dialog is shown before any data is deleted.

You can also delete individual test runs:

- From the **test run detail page** — click the red **Delete** button in the page header.
- From the **project detail page** — click the **Delete** button in the Actions column of the test runs table.

## Storage architecture

The dashboard uses an abstraction layer that allows switching backends without any code changes. Files are stored using relative paths (e.g. `project-1/run-123/index.html`), making migration between backends straightforward.

## Database storage

The dashboard supports two database backends: **SQLite** (default, zero-configuration) and **PostgreSQL** (for production multi-user deployments).

### SQLite (default)

SQLite requires no configuration. The database file is created automatically at `.data/piwi.db`.

To customize the path:

```bash
PIWI_DATABASE_PATH=/custom/path/database.db npm run dev
```

### PostgreSQL

Set the `PIWI_DATABASE_URL` environment variable to switch to PostgreSQL:

```bash
PIWI_DATABASE_URL=postgresql://user:password@localhost:5432/piwi_dashboard npm run dev
```

The dashboard creates all required tables automatically on startup via migrations.

#### Local development with Docker

```bash
docker run -d -p 5432:5432 \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=piwi_dashboard \
  postgres:16-alpine
```

Then start the dashboard:

```bash
PIWI_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/piwi_dashboard npm run dev
```

#### Schema changes (PostgreSQL)

To generate a new PostgreSQL migration after editing `schema.pg.ts`:

```bash
PIWI_DATABASE_URL=postgresql://... npm run db:generate:pg
npm run db:migrate:pg
```

| Script | Description |
|--------|-------------|
| `npm run db:generate` | Generate SQLite migration |
| `npm run db:migrate` | Apply SQLite migrations |
| `npm run db:generate:pg` | Generate PostgreSQL migration |
| `npm run db:migrate:pg` | Apply PostgreSQL migrations |
| `npm run db:studio` | Browse SQLite database |
| `npm run db:studio:pg` | Browse PostgreSQL database |

### Schema changes (SQLite)

If you modify the database schema:

```bash
# 1. Edit application/server/database/schema.sqlite.ts
# 2. Generate a new migration
npm run db:generate

# 3. Restart the application — migrations apply automatically on startup
npm run dev
```

::: warning
Never delete or modify existing migration files. Always generate new migrations for schema changes.
:::
