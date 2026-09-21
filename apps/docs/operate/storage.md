---
title: Storage configuration
lang: en-US
---

# Storage configuration

Test artifacts — HTML reports, trace files, screenshots, videos, attachments — are written to one of
two backends. Runs, test cases and settings live in the [database](./database) instead.

Every variable below is an ordinary environment variable: pass it to the container, put it in your
`.env`, or set it in your host's dashboard. The
[configuration generator](/reference/configuration/generator) will write the block for you.

## Local storage (default)

Files are stored under `.data/storage/`. No configuration is required.

To customize the path:

```bash
PIWI_STORAGE_TYPE=local
PIWI_STORAGE_PATH=/custom/path/to/storage
```

## S3-compatible storage

Any S3-compatible service can be used: AWS S3, RustFS, DigitalOcean Spaces, Cloudflare R2, and others.

```bash
PIWI_STORAGE_TYPE=s3

PIWI_S3_BUCKET=your-bucket-name
PIWI_S3_REGION=us-east-1

# Optional: static credentials and a custom endpoint for S3-compatible services
PIWI_S3_ACCESS_KEY_ID=your-access-key
PIWI_S3_SECRET_ACCESS_KEY=your-secret-key
PIWI_S3_ENDPOINT=https://s3.example.com
```

### AWS S3

When the static credential variables are omitted, Piwi uses the AWS SDK default credential chain. This supports ECS
task roles, EC2 instance roles, environment credentials and shared AWS configuration without storing access keys in
Piwi. If either static credential variable is set, both are required.

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

### RustFS

[RustFS](https://rustfs.com) is an open-source (Apache-2.0), S3-compatible object store you can self-host — a common replacement for MinIO.

```bash
PIWI_STORAGE_TYPE=s3
PIWI_S3_ENDPOINT=http://localhost:9000
PIWI_S3_BUCKET=piwi-dashboard
PIWI_S3_REGION=us-east-1
PIWI_S3_ACCESS_KEY_ID=your-access-key
PIWI_S3_SECRET_ACCESS_KEY=your-secret-key
```

Set `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` on the RustFS server to match the credentials above — don't expose the default `rustfsadmin` account to a networked deployment.

Path-style URLs are enabled automatically when `PIWI_S3_ENDPOINT` is set (as required by RustFS and most self-hosted S3-compatible services). Set `PIWI_S3_FORCE_PATH_STYLE=false` to override this behavior.

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

- **Storage analysis** — total storage used and file count, the projects that consume the most space, a breakdown by file kind (traces, screenshots, videos, reports, attachments, visual diffs), storage growth over time, and the actual on-disk storage size (local only) — which also surfaces any untracked files lingering on disk.
- **Cleanup** — permanently delete all test runs older than a configurable number of days (7, 14, 30, 60, 90, 180, or 365 days). A confirmation dialog is shown before any data is deleted.

You can also delete individual test runs:

- From the **test run detail page** — click the red **Delete** button in the page header.
- From the **project detail page** — click the **Delete** button in the Actions column of the test runs table.

### Data retention

A nightly sweep (03:17 server time) handles recurring cleanup:

- **Test-run pruning** — deletes runs older than `PIWI_RETENTION_DAYS` days, including their files, traces, and reports. **Off by default**: deleting history is opt-in, so nothing is pruned until you set the variable.
- **Notification outbox pruning** — removes sent/failed delivery rows older than `PIWI_RETENTION_NOTIFICATION_DAYS` days (default 30).
- **Diagnosis history capping** — keeps the newest `PIWI_RETENTION_DIAGNOSIS_VERSIONS` versions per AI diagnosis (default 20).
- **Orphan sweep** — removes rows whose parent records were deleted by older versions.

The manual **Settings › Storage** cleanup remains available for one-off bulk deletes and uses the same deletion logic.

### Space reclamation

Deleting runs removes rows and stored files, but giving the freed pages back to the filesystem depends on the backend:

- **SQLite** — databases created by recent versions have `auto_vacuum=INCREMENTAL` enabled, so the cleanup endpoint reclaims space automatically. Databases created before that (where `PRAGMA auto_vacuum` reports `0`) need a one-off full rebuild: call the cleanup API with `{ "olderThanDays": ..., "vacuum": true }` to run a blocking `VACUUM` after the delete. Expect it to take a while on large databases.
- **PostgreSQL** — freed space is reused by PostgreSQL's autovacuum; no manual action is needed.

## Storage architecture

The dashboard uses an abstraction layer that allows switching backends without any code changes. Files are stored using relative paths (e.g. `project-1/run-123/index.html`), making migration between backends straightforward.

### Compression at rest

Trace files are the largest evidence Piwi keeps, and most of their bytes are text — the trace event
stream (`trace.trace`, `trace.network`, `trace.stacks`), the ARIA snapshots, and captured network bodies
(HTML, CSS, JavaScript, JSON). These are compressed where they are stored:

- The **slim events blob** — the part of each trace kept after the shared resources are split out —
  deflates its text entries per file, leaving already-compressed entries (screen-snapshot PNGs, fonts)
  stored as they are. The result is still an ordinary ZIP the Playwright trace viewer opens directly.
- The **shared resource pool** gzip-compresses each text resource on the way in and restores it on the
  way out; images, fonts and other already-compact resources are stored untouched. A resource is never
  written larger than it arrived.

Compression is transparent: reconstructed traces, the evidence views and offline exports all see the
original bytes, and resources written before compression existed keep reading unchanged. It stacks on top
of deduplication — a resource is stored once per project **and** compressed — and it needs no
configuration.

Shared resources are also **reference-counted**: each is freed as soon as no remaining trace references it,
so deleting some of a project's runs reclaims the resources unique to them without waiting for the whole
project to be removed. This applies automatically; evidence stored before an upgrade is enrolled by a
one-time background pass, and a nightly sweep frees anything left unreferenced.

### Evidence payload deduplication

Large failure evidence captured per execution — the page's ARIA snapshot, the failing test's source snippet, and its source stack frames — is stored content-addressed: each unique payload is written once per project (keyed by SHA-256) and executions reference it by id. A test that fails the same way across many runs, or across several browsers in one run, stores that evidence a single time instead of once per execution. Unreferenced payloads are garbage-collected when runs are deleted. Deduplication happens server-side at ingest, so it applies regardless of reporter version.

## Trace snapshots

A Playwright 1.63 trace can record an **aria tree** and a **screenshot** before and after every action (`trace: { snapshots: { dom, aria, screen } }`). Those files ride inside the trace ZIP — `aria/<callId>-<phase>.json` and `screenshots/<callId>-<phase>.png` — and the dashboard keeps them in the slim events blob alongside the trace stream, so the [Screen tab and the filmstrip](/features/evidence#aria-and-screen-snapshots) read them straight back.

The two kinds cost very differently:

- **`aria`** adds one small JSON tree per action per phase — a few hundred bytes each, negligible next to the trace it rides in. [`wrapConfig`](/guide/reporter#installing-via-wrapconfig) turns it on by default on Playwright 1.63+.
- **`screen`** adds a **PNG per action per phase** — by far the trace's biggest cost, growing with the page size and the number of actions. It stays **opt-in**: enable it only when you want the filmstrip and the before/after screenshots, and pair it with [data retention](#data-retention) so the extra bytes are swept. Enable it with `use: { trace: { mode: 'retain-on-failure', snapshots: { dom: true, aria: true, screen: true } } }`.

Unlike the network resource pool, these entries are not deduplicated across executions — each is unique to its action's page — so `screen` is the one capture option that visibly changes storage growth.

## See also

- [Database](./database) — SQLite versus PostgreSQL, and what lives there instead
- [Configuration reference](/reference/configuration#storage) — every `PIWI_STORAGE_*` and `PIWI_S3_*` variable
- [Backups](./deployment#backups) — copying the storage directory alongside the database
- [Offline export](/features/offline-export) — taking one investigation out of storage entirely
