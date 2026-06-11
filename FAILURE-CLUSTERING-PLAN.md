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

## Implemented — phases 2 + 3 (June 11, 2026)

### Endpoints

- `GET /api/test-runs/[id]/failure-groups` — clusters touching a run:
  signature, error type, selector, `caseCount` (distinct test cases),
  `isNew`/`firstSeenAt`, `flaky` (a test in the cluster passed on retry in
  this run), `workerCorrelated` heuristic (multiple tests failing on the same
  worker while the run used several), affected cases with `passedOnRetry`.
  Sorted by `caseCount` descending.
- `GET /api/projects/[id]/failure-clusters` — project-level board data:
  signature, error type, `occurrences` (raw row count incl. retries),
  `affectedTests` (distinct test cases ever hit), last-seen run id/status/
  start time. 404 for unknown projects, like the sibling project endpoints.
- `GET /api/test-cases/[id]` now returns a `failureCluster` block
  (signature, `sameRunCaseCount`, `isNew`, first-seen run) for clustered
  failures.

### UI

- Run detail page: conditional "Failure groups" tab (`FailureGroups.vue`) —
  card per cluster with New/Known-since/Flaky/Same-worker badges, expandable
  affected-test list, and a Filter action that filters `TestCasesList` by
  `failureClusterId`.
- Project detail page: `FailureClustersList.vue` card (shown when the project
  has failed runs) listing clusters with affected-test counts and last-seen
  links.
- Test case page: cluster line in `TestCaseErrorCard.vue` ("Matches N other
  failing tests in this run · known since run #X"), cluster context appended
  to the AI fix prompt (`app/utils/fix-prompt.ts`).

### Demo mode

- Seed generates 8 failure clusters with diverse error patterns and links
  failed `test_runs_cases` rows via `failure_cluster_id`.
- Demo router handles both new endpoints (`apiGetFailureGroups`,
  `apiGetProjectFailureClusters`) mirroring the server logic, and the demo
  run-detail handler returns `failureClusterId` so the cluster filter works
  in demo builds.

### Post-review adaptations (second pass)

- Demo `apiGetTestRun` was missing `failureClusterId` → cluster filter and
  tab count were broken in demo mode; fixed.
- `types/api.ts` `FailureGroup` type didn't match the actual endpoint
  response; replaced with the real shape (+ `FailureGroupCase`) and
  `FailureGroups.vue` now imports it instead of a local copy.
- Project clusters endpoint: restored the 404 for unknown projects and the
  `affectedTests` distinct count (server + demo + UI display) — `occurrences`
  alone over-counts retries and goes stale after run deletion.
- Endpoint tests added in `tests/failure-clusters.spec.ts` (grouping flags,
  flaky-on-retry, cross-run aggregation, 404).

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

## Implemented (June 11, 2026 — afternoon)

- **Cluster status**: `status` column (`open`/`resolved`/`ignored`) with
  optional `triage_note` on `failure_clusters`.
- Schema + migrations (SQLite 0019, PG 0010): `ALTER TABLE ADD COLUMN status`,
  `triage_note`, and index on `status`.
- `PATCH /api/failure-clusters/[id]/status` — update status + optional triage
  note; validates status values, returns 400/404.
- `GET /api/projects/[id]/failure-clusters` now returns `status` + `triageNote`
  and supports `?status=open|resolved|ignored` filter.
- `GET /api/test-runs/[id]/failure-groups` returns `status` + `triageNote` per
  group.
- `GET /api/test-cases/[id]` returns `status` + `triageNote` in the
  `failureCluster` block.
- UI: status badges on `FailureClustersList.vue`, `FailureGroups.vue`,
  `TestCaseErrorCard.vue`. `FailureClustersList.vue` has a status filter
  dropdown and an inline triage panel (status selector + optional note +
  save/cancel) that calls the PATCH endpoint.
- Demo seed updated: `status` column in CREATE TABLE, `status: 'open'` on all
  clusters, `triage_note: null`.
- Demo router + handlers for the PATCH endpoint, including the missing
  `failureCluster` block in `apiGetTestCase`.
- Tests: 5 new e2e tests (status default, PATCH update, PATCH validation,
  status filter, failure-groups status field).
- Docs: `docs/api.md` updated with the PATCH endpoint docs and new fields.

## Implemented — Pillar 2 (June 11, 2026)

### What changed since green?

- **`GET /api/test-runs/[id]/regression-context`** — for any failing run,
  resolves the most recent prior passing run (`status = 'passed'`) for the
  same project, then computes:
  - `commitRange` — `fromSha`/`toSha`, `fromShort`/`toShort`, `repositoryUrl`
    (SSH URLs normalized to HTTPS, credentials stripped), `compareUrl`
    (GitHub / GitLab / Bitbucket compare links auto-constructed), and
    `gitCommand` (`git log --oneline <from>..<to>`) for copy-paste.
    `null` when SCM metadata is absent or commits are identical.
  - `metadataDiff` — array of `{ key, label, before, after }` entries for
    fields that changed between the two runs: `environment`, `branch`,
    `ci_provider`, `browsers` (from `htmlReport.projects[*].use.browserName`).
  - `newFailures` — count of test cases that were `passed` in the last green
    run but `failed` or `timedOut` here (deduped per `test_case_id` across
    retries).
  - Returns `{ hasGreen: false }` when no prior passing run exists.

- **`app/components/RegressionContext.vue`** — "Regression" tab on the run
  detail page (shown when the run has failures):
  - Last green run link + relative time.
  - New-failures badge or "no new regressions" note.
  - Commit range card: `from` → `to` SHA badges, "View commits" button
    (GitHub/GitLab compare URL), copyable `git log` command.
  - Metadata changes table (environment / branch / CI / browser changes).
  - No-commit-info hint pointing to `collectScmInfo: true`.

- **Demo mode**: `apiGetRegressionContext` in `app/demo/api/test-runs.ts`
  mirrors the server logic; route registered in `app/demo/api/router.ts`.

- **Tests**: `application/tests/regression-context.spec.ts` — 7 serial e2e
  tests: no-prior-green, last-green + new-failures count, GitHub compare URL,
  SSH remote normalization, metadata diff, empty diff, identical-SHA null
  range, 404. Project `regression-context-test` registered in
  `shared/test-project-names.ts`.

- **Docs**: `docs/api.md` documents the new endpoint with full field table and
  compare-URL behavior.

## Not yet implemented (next phases)
- **Pillar 3 (full)**: cross-run flakiness scoring + dedicated flaky board
  (the per-run flaky/worker-correlated flags cover the basic case).
- **Pillar 4**: server-side AI diagnosis per cluster.
- Optional: backfill endpoint for pre-existing failures (explicitly skipped —
  "ignore existing data") and lazy re-clustering on `FINGERPRINT_VERSION`
  bumps.
