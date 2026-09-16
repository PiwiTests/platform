---
title: Upgrading
lang: en-US
---

# Upgrading

Piwi is pre-1.0. Patch and minor releases can carry breaking changes, and the database schema moves
with them. Upgrading is normally a one-line change — but it's a one-way door, so it's worth knowing
what happens before you pull a new tag.

## The short version

1. Read the [changelog](https://github.com/PiwiTests/platform/blob/main/CHANGELOG.md) for the versions
   you're skipping, looking for **⚠ BREAKING CHANGES**.
2. **Back up** the database and file storage ([how](./deployment#backups)).
3. Pull the new tag and restart.
4. Check the logs for `migrations completed successfully`, then confirm the version at
   **Settings → About**.

## What happens when a new version starts

On boot, before the server accepts a single request:

1. **Database migrations run automatically** — SQLite or PostgreSQL, whichever you're on. There is no
   separate migrate command and nothing to run by hand.
2. **A project-assignments backfill** runs (idempotent, safe on every start).
3. **Failure clusters are re-fingerprinted** if the fingerprint algorithm changed in this release.
   This is non-destructive: existing clusters are updated in place, and clusters that now collide are
   merged rather than dropped, so your triage statuses and notes survive.

Steps 2 and 3 log an error and continue if they fail — they never block startup. **Step 1 does not.**
If a migration fails, the server refuses to start rather than serving against a half-migrated schema.
That's deliberate: a loud failure you can restore from beats silent corruption.

## Downgrading is not supported

Migrations are **forward-only** — there are no down migrations. Once a new version has migrated your
database, an older version will not run against it correctly, and starting one may make things worse.

So the rollback path is not "pull the old tag", it's **restore your backup**:

1. Stop the container.
2. Restore the database and `.data/storage/` from the backup you took before upgrading.
3. Start the previous version's tag.

This is the entire reason step 2 of the short version isn't optional.

## Pin a version

Running `latest` in production means an unattended `docker pull` can move you across a breaking change.
Pin the exact version and bump it deliberately:

```yaml
# docker-compose.yml
services:
  piwi:
    image: phenx/piwitests-server:0.26.1   # not :latest
```

The available tag patterns — and the GHCR mirror — are in
[Deployment → Available tags](./deployment#available-tags).

## Verifying the upgrade landed

Three ways, in increasing order of automation:

- **Settings → About** shows the running version, the build SHA, the Node version, and which database
  backend is active.
- `GET /api/version` returns the same thing as JSON, with no authentication required:

  ```bash
  curl -s http://localhost:3000/api/version
  ```

- `GET /api/health` is the readiness probe — it verifies database connectivity and returns 503 when
  the database isn't reachable, which is what you want a container orchestrator watching.

In the startup logs, the lines worth grepping for are `Running <dialect> migrations from …` and
`migrations completed successfully`.

## Upgrading the reporter

The reporter and the dashboard version independently, and you do **not** have to upgrade them in
lockstep:

- A **newer reporter against an older server** degrades gracefully — if the server doesn't understand
  streaming, the reporter falls back to batch submission on its own.
- An **older reporter against a newer server** keeps working; wire fields are added, not repurposed.

That said, features land in pairs. Locator healing needs both a reporter that captures snapshots and a
server that ranks them, so if a new capability doesn't appear, matching the two versions is the first
thing to try.

```bash
npm install --save-dev @piwitests/reporter@latest
```

## Upgrading the desktop app

The [desktop build](/features/desktop) bundles its own server, so installing a newer build upgrades both. Its
database lives outside the app bundle and is migrated on first launch, exactly as the server does —
which means the same forward-only rule applies. Back up its data directory before a major jump.

## If an upgrade goes wrong

**The container won't start after upgrading.** Check the logs for `Migration error`. The schema is
mid-flight or incompatible; restore your backup and open an
[issue](https://github.com/PiwiTests/platform/issues) with the error.

**The dashboard loads but data looks wrong.** Don't downgrade — restore the backup instead, then
report what you saw. Downgrading on a migrated database compounds the problem.

**Failure clusters look reorganized.** Expected after a fingerprint-algorithm change: clusters that now
share a root cause have merged. Triage state is carried across the merge.

## See also

- [Deployment → Backups](./deployment#backups) — what to back up and how
- [Deployment → Available tags](./deployment#available-tags) — what to pin
- [Changelog](https://github.com/PiwiTests/platform/blob/main/CHANGELOG.md) — breaking changes per release
