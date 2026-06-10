# Failure clustering — plan and implementation record

> Working document: captures the original design plan (June 2026) and what has
> been implemented so far. Not published to the docs site.

## Vision: a "Failure Intelligence" layer

The dashboard stores errors, steps, traces, history, network requests, console
logs and CI/SCM metadata — but it only *displays* failures. The goal of this
effort is to make it *explain* them, in four pillars:

1. **Failure clustering — "47 failures, 3 root causes"**
   Fingerprint each failure by normalizing the error (mask timeouts/ids/values,
   keep error category, message shape, locator, top app stack frame), then
   group failed cases by fingerprint. The run page stops showing a wall of red
   and starts showing failure groups.

2. **"What changed since green?"**
   For every failing test, resolve last-passing run → first-failing run and
   diff them: commit range (SCM metadata is already collected), environment,
   browser, durations, network request differences.

3. **Failure classification — flaky vs. new vs. known vs. infra**
   Using history + retries + worker/time correlation, badge every failure:
   flaky (passed on retry / alternates), new regression (first failure after a
   green streak), known (failing for N runs), infra-suspected (failures
   correlated by worker or time window).

4. **AI root-cause analysis**
   Upgrade the copy-paste fix prompt to a server-side integration that ingests
   the *cluster* context (normalized error, steps, console/network around the
   failure, last-green diff) and returns a structured diagnosis. Run once per
   cluster, not per test.

Pillars 1 + 2 are deterministic, need no external services, and are the
substrate that makes pillar 4 genuinely smart.

## Phase 1 design (clustering substrate)

- **Fingerprint util** in `application/shared/` (browser-compatible for demo
  mode): strip ANSI → cut message head before call log/stack → mask volatile
  tokens (received values, UUIDs, hashes, numbers) → extract error type,
  selector, top non-node_modules stack frame (file only, no line numbers) →
  SHA-256 over `FINGERPRINT_VERSION` + signals. Version is baked into the hash
  so algorithm changes re-form clusters instead of mixing silently.
- **Schema**: `failure_clusters` table (per-project, unique on
  `(project_id, fingerprint)`) + nullable `failure_cluster_id` FK on
  `test_runs_cases`. Run references (`first_seen_run_id`, `last_seen_run_id`)
  are intentionally **not** foreign keys — runs are deleted independently and
  clusters must survive them (stale ids tolerated; `occurrences` is a
  denormalized counter, not decremented on deletion — exact counts come from
  joins).
- **Ingestion hook**: `persistRunCases()` is the single funnel for submit,
  upload and streaming events — get-or-create clusters there (same prefetch
  pattern as shared `test_cases`), resolve insert races between concurrent
  streaming batches via the unique index + `onConflictDoNothing`.
- **Exposure**: `failureClusterId` added to `GET /api/test-runs/[id]` test
  cases so clustering is queryable (and testable) before the dedicated UI.

## Implemented (June 10, 2026)

- `application/shared/error-fingerprint.ts` — `extractErrorSignature()` +
  `computeErrorFingerprint()` (Web Crypto SHA-256, works in Node and service
  worker). Error types: timeout, assertion, strict-mode, navigation, crash,
  unknown.
- `failure_clusters` table + `test_runs_cases.failure_cluster_id` in
  `schema.sqlite.ts`, `schema.pg.ts`, re-exported from `schema.ts` (incl.
  `FailureCluster` types).
- Migrations `migrations/0018_failure_clusters.sql` and
  `migrations-pg/0009_failure_clusters.sql` with full snapshots and journal
  entries (see "Migration state notes" below — generated via drizzle-kit's
  programmatic API, not the CLI).
- Clustering hook in `server/utils/persist-run-cases.ts`
  (`getOrCreateFailureClusters`): fingerprints failed/timedout cases with
  error text, bumps `lastSeenRunId`/`occurrences` on existing clusters,
  stamps `failureClusterId` on junction rows. Dedup-skipped streaming rows do
  not count.
- `failureClusterId` exposed in `GET /api/test-runs/[id]` response test cases.
- Explicit cluster deletion in `server/api/tests/cleanup.delete.ts` (before
  project deletion). Admin cleanup needed no change (never deletes projects).
- Tests: `application/tests/failure-clusters.spec.ts` — 5 fingerprint unit
  tests (ANSI/duration invariance, received-value masking, selector
  discrimination, classification, stack-line invariance) + 2 e2e tests
  (grouping within a run via submit API, cluster reuse across runs).
  Project name `failure-clusters-test` registered in
  `shared/test-project-names.ts`.
- Docs: AGENTS.md tables list updated (also corrected the stale
  `reports`/`traces` entries to `files`/`trace_resources`/`trace_blobs`),
  `docs/api.md` run-detail endpoint mentions `failureClusterId`.
- Drive-by fix: `schema.pg.ts` `tags` table reused the index name
  `idx_projects_updated_at` (PG index names are schema-global); renamed to
  `idx_tags_updated_at`. This duplicate blocked drizzle-kit from processing
  the PG schema at all.

Verification: typecheck ✓, lint ✓, full functional suite ✓ (216 passed,
42 skipped — PG/S3 suites that need external services).

### Migration state notes (important for future schema changes)

The pre-existing migrations 0015–0017 (SQLite) and 0007–0008 (PG) were written
by hand: they have **no snapshots** and **future-dated journal timestamps**
(`when: 1788300000000` ≈ Sep 2026). Consequences:

- `npm run db:generate` could not be used for this change: it diffs against
  the stale 0014/0006 snapshots and demands interactive rename answers.
- Any migration generated with a normal `Date.now()` timestamp would be
  **silently skipped** by the drizzle migrator on databases that already
  applied the future-dated entries. The new entries therefore use
  `when: 1788400000000`.
- The 0018/0009 snapshots were generated from the *current schema code* via
  drizzle-kit's programmatic API, so they are complete — future
  `npm run db:generate` runs will diff cleanly against them. (Caveat: the
  snapshots describe schema-as-code; long-lived databases created before the
  hand-written era may differ in details such as the `updated_at` indexes,
  which were never created by any PG migration.)

### Demo mode

Untouched in phase 1: the demo router uses explicit column selects only and
never queries `failure_clusters`, so stale IndexedDB seeds keep working. When
phase 2 adds cluster endpoints, add handlers in `app/demo/api/router.ts` and
regenerate the seed (`npm run seed:demo`).

## Not yet implemented (next phases)

- **Phase 2 — surface clustering**: `GET /api/test-runs/[id]/failure-groups`
  (clusters touching a run: signature, count as
  `COUNT(DISTINCT test_case_id)` — retries produce one row each — affected
  cases, `isNew` vs `knownSince`); `FailureGroups.vue` on the run detail page
  (cards with "New in this run" / "Known since run #X" badges, click to filter
  `TestCasesList`); cluster line in `TestCaseErrorCard.vue`; cluster context in
  `app/utils/fix-prompt.ts`; demo router handlers + seed regen.
- **Phase 3 — project-level board**: `GET /api/projects/[id]/failure-clusters`
  (ongoing failures, trends), cluster `status` column (open/resolved/ignored).
- **Pillar 2**: last-green resolution + run diff view.
- **Pillar 3**: flaky/new/known/infra classification + flaky board.
- **Pillar 4**: server-side AI diagnosis per cluster.
- Optional: backfill endpoint for pre-existing failures (explicitly skipped —
  "ignore existing data") and lazy re-clustering on `FINGERPRINT_VERSION`
  bumps.
