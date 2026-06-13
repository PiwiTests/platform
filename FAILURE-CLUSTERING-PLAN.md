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

## Implemented — Pillars 3 + 4 (June 13, 2026)

### Pillar 3 — Flaky tests board

- **`GET /api/projects/[id]/flaky-tests`** (`server/api/projects/[id]/flaky-tests.get.ts`) — cross-run
  flakiness analysis over up to N recent terminal runs. Scores each test:
  `round(100 × (0.6 × retryRate + 0.4 × altRate))`, clamp 1–100. Returns tests
  with ≥ 3 runs AND (retryPassRuns ≥ 1 OR alternations ≥ 2), sorted by score
  descending (top 50).
- **`FlakyTestsList.vue`** — card on the project detail page displaying detected
  flaky tests with score badge, retry-pass count, status-flip count, failure rate,
  and relative "last flake" time. Linked to the test case detail page via
  `latestRunsCaseId`.
- **Demo mode**: `apiGetProjectFlakyTests` in `app/demo/api/ai.ts` mirrors the
  server algorithm in-browser. Route registered in `app/demo/api/router.ts`.
- **Tests**: `application/tests/flaky-tests.spec.ts` — 6 serial e2e tests
  (empty result for <3 runs, retry-pass detection, stable-test exclusion,
  alternation detection, runs window clamping, score sort, 404).
  Project name `FLAKY_BOARD` registered in `shared/test-project-names.ts`.

### Pillar 4 — AI root-cause diagnosis

- **Schema**: `failure_diagnoses` table (unique on `cluster_id`; ON DELETE CASCADE)
  and `app_settings` key/value table. SQLite migration 0022, PG journal updated.
- **`server/utils/ai-provider.ts`** — `resolveAiConfig()` (env → DB precedence),
  `callAiProvider()` (Anthropic SDK + plain fetch for OpenAI-compatible),
  `AiConfig` type.
- **`server/utils/ai-diagnosis.ts`** — `buildClusterContext()` (context string
  builder: error signature, affected tests with steps/console/network/ARIA,
  retry behavior, regression context), `runClusterDiagnosis()` (concurrency guard
  via module-level `Set<number>`, upsert to 'running', call LLM, parse JSON, update
  row), `autoDiagnoseRun()` (fire-and-forget, max 3 new clusters per run).
- **`shared/ai-diagnosis.ts`** — `AiDiagnosisResult` interface + `DIAGNOSIS_JSON_SCHEMA`.
- **7 HTTP endpoints** — see §7 in the plan below; all implemented as described.
- **Auto-diagnose hooks** added to `submit.post.ts`, `upload.post.ts`, `finish.post.ts`.
- **`diagnosis` compact field** (`{ status, category, confidence, summary }`)
  added to failure-groups, project-clusters, and test-case cluster responses.
- **`ClusterDiagnosis.vue`** — diagnosis card component: shows "Diagnose with AI"
  button (when configured + no diagnosis), spinner while running, full completed
  card with category/confidence badges, evidence list, suggested fix with copyable
  code, prevention tips; re-diagnose and stale-running recovery.
- **`useAiStatus.ts`** composable — fetches `GET /api/ai/status` once per
  navigation context; used by `ClusterDiagnosis.vue` to gate the "Diagnose" button.
- **`app/pages/settings/ai.vue`** — AI provider settings page (provider select,
  API key, model, base URL, auto-diagnose switch, test-connection button).
- **Demo mode**: `app/demo/api/ai.ts` + routes for all 7 endpoints; 2 pre-seeded
  diagnoses in `public/demo/seed.sql` (clusters 1 and 3).
- **Tests**: `application/tests/ai-diagnosis.spec.ts` — 10 serial e2e tests
  covering the full lifecycle (unconfigured 503, configure provider, diagnose
  endpoint, GET diagnosis, re-diagnose with force, 409 for in-progress, diagnosis
  surfaced in failure-groups).

Verification: typecheck ✓, lint ✓, demo seed ✓ (8 clusters, 2 diagnoses).

## Not yet implemented (next phases)
- Optional: backfill endpoint for pre-existing failures (explicitly skipped —
  "ignore existing data") and lazy re-clustering on `FINGERPRINT_VERSION`
  bumps. (Still out of scope.)

---

# Detailed implementation plan — Pillars 3 + 4 ("Fix it" layer)

> Written June 12, 2026 after a full design/recon session. Everything below
> was verified against the codebase as of commit `2909790` (branch
> `various-ui-improvements`). Execute top to bottom; the cut line is §11
> (flaky board) — §1–§10 form a coherent shippable increment on their own.

## §0 — Pre-flight findings (read before touching anything)

### 0.1 Migration journal hazard (CRITICAL)

The drizzle migrator picks `max(created_at)` from the `__drizzle_migrations`
table as a watermark and only applies migrations whose journal `when` is
**greater**. The journals currently contain broken values:

| Journal | Entry | `when` | Problem |
|---|---|---|---|
| SQLite | `0019_cluster_status` | `1788500000000` | (intentionally future-dated — this is the watermark) |
| SQLite | `0020_cuddly_rockslide` | `178850565778` | **12 digits — year 1975.** Botched manual edit (a digit was dropped) |
| SQLite | `0021_cuddly_satana` | `1781285075008` | < watermark |
| PG | `0010_cluster_status` | `1788500000000` | watermark |
| PG | `0011_bored_ego` | `1788580593013` | OK |
| PG | `0012_furry_nico_minoru` | `1781285080802` | < watermark |

Consequences:
- Any DB that applied `0019`/`0010` **before** the browser-info feature
  shipped will **silently skip** `0020`/`0021` (SQLite) and `0012` (PG) — the
  `browser` column will be missing at runtime. This is a **pre-existing bug**,
  not caused by this plan. Do NOT "fix" the old entries by bumping their
  `when`: DBs that already applied them (with the small recorded
  `created_at`) would then **re-apply** them and crash on
  `duplicate column name: browser`. Surface the issue to the maintainer;
  remediation of shipped migrations is their call.
- **The new migrations from this plan MUST use `when: 1788600000000`** (both
  SQLite and PG) — greater than every existing value — otherwise they will be
  silently skipped on any DB that ever applied `0019`/`0010`.
- `npm run db:generate` writes `Date.now()` (≈ `1781…`) into the journal;
  **manually bump the new entry's `when` to `1788600000000` after
  generation.** This contradicts the AGENTS.md "never edit the journal" rule,
  but is the established workaround already used by 0018/0019 (see "Migration
  state notes" above).

### 0.2 Already done in the June 12 session (do not redo)

- The git index contained 8 phantom staged-then-deleted migration files
  (`0019_green_alex_wilder.sql`, `0020_aspiring_ink.sql`, etc. — leftovers
  from renames). They were unstaged with `git restore --staged`; committing
  them would have resurrected deleted migration files. **Done, nothing to do.**
- A first schema edit (failure_diagnoses + app_settings in
  `schema.sqlite.ts`) was applied then **reverted** to keep the tree clean
  for this plan. Re-apply it from §1 verbatim.

### 0.3 Architecture constraints discovered during recon

- **Tests reuse a running dev server** (`reuseExistingServer: !CI` in
  `playwright.config.ts`) → AI configuration cannot be env-only; it must be
  runtime-mutable (DB-backed settings) so the test suite can configure a mock
  provider via the API. Env vars override DB settings when present.
- **No global auth middleware.** Data GETs are unauthenticated by convention
  (`projects.get.ts` has no `requireAuth`). Mutating/admin endpoints call
  `requireAuth(event, roles?)` from `server/utils/auth.ts`; with auth
  disabled it returns a virtual administrator, so endpoints stay testable.
- **Demo mode** bundles `app/demo/api/*` handlers into a service worker; they
  import the SQLite drizzle schema directly (`~~/server/database/schema.sqlite`),
  so new tables are usable in demo handlers — but `scripts/generate-demo-seed.mjs`
  hand-writes `CREATE TABLE` statements and must be extended too. Server-side
  code (`server/`) is NOT part of the demo bundle, so the Anthropic SDK adds
  zero weight to the demo build.
- **Claude API decisions** (per the claude-api skill, June 2026):
  - Anthropic provider via the official **`@anthropic-ai/sdk`** (new dep in
    `application/package.json`), default model **`claude-opus-4-8`**.
  - Structured JSON via **`output_config: { format: { type: 'json_schema', schema } }`**
    (GA; the old `output_format` param is deprecated).
  - **Omit the `thinking` parameter entirely**: the model id is
    user-configurable and `thinking: {type:'adaptive'}` 400s on Haiku 4.5;
    omitting works on every model (Fable 5 has thinking always-on anyway).
  - `max_tokens: 8192`, non-streaming (safe under the ~16K guidance),
    client options `timeout: 120_000, maxRetries: 1`.
  - Check `stop_reason === 'refusal'` before reading content; treat as error.
  - Usage from `res.usage.input_tokens` / `output_tokens`.
- **OpenAI-compatible provider** (ollama, vLLM, OpenRouter, llama.cpp…) via
  plain `fetch` — no SDK. `POST {baseUrl}/chat/completions` with
  `response_format: {type:'json_object'}` (ignored harmlessly by servers that
  don't support it) + the JSON schema embedded in the system prompt, then
  robust JSON extraction (§2.3).

---

## §1 — Schema + migrations

### 1.1 `application/server/database/schema.sqlite.ts`

Insert before the `testRunsCases` table:

```ts
// AI failure diagnoses - one per failure cluster, produced by the configured LLM provider
export const failureDiagnoses = sqliteTable('failure_diagnoses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clusterId: integer('cluster_id').notNull().references(() => failureClusters.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('running'), // 'running', 'completed', 'failed'
  provider: text('provider'), // 'anthropic', 'openai'
  model: text('model'), // model id that produced the diagnosis
  category: text('category'), // 'app-bug', 'test-bug', 'flaky-test', 'infrastructure', 'environment', 'unknown'
  confidence: text('confidence'), // 'high', 'medium', 'low'
  summary: text('summary'), // one-line diagnosis shown in lists
  rootCause: text('root_cause'), // short root-cause explanation
  details: text('details', { mode: 'json' }), // full structured result: evidence, suggestedFix, preventionTips
  error: text('error'), // failure reason when status = 'failed'
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
}, table => ({
  clusterIdIdx: uniqueIndex('idx_failure_diagnoses_cluster_id').on(table.clusterId)
}))

// Application settings - key/value store for runtime-configurable settings (e.g. AI provider)
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
})
```

Type exports (next to the FailureCluster ones):

```ts
export type FailureDiagnosis = typeof failureDiagnoses.$inferSelect
export type NewFailureDiagnosis = typeof failureDiagnoses.$inferInsert
export type AppSetting = typeof appSettings.$inferSelect
export type NewAppSetting = typeof appSettings.$inferInsert
```

### 1.2 `schema.pg.ts` — mirror with PG types

Same columns using the file's existing conventions: `serial('id')`,
`jsonb('details')`, `jsonb('value')`,
`timestamp('…', { mode: 'date' }).notNull().$defaultFn(() => new Date())`.
Index names are schema-global in PG (see the `idx_tags_updated_at` incident
above) — `idx_failure_diagnoses_cluster_id` is unique, fine.

### 1.3 `schema.ts` — re-export both tables + 4 types from both dialect files
(follow exactly how `failureClusters` / `FailureCluster` are re-exported).

### 1.4 Generate migrations

```bash
cd application
npm run db:generate    -- --name=ai_diagnoses   # → migrations/0022_ai_diagnoses.sql
npm run db:generate:pg -- --name=ai_diagnoses   # → migrations-pg/0013_ai_diagnoses.sql
```

Snapshots `0021`/`0012` are healthy, so the diff is clean (pure additions, no
interactive prompts). Then **edit both journals**: set the new entry's `when`
to `1788600000000` (see §0.1). Review the SQL: 2 `CREATE TABLE` + 1
`CREATE UNIQUE INDEX` each.

---

## §2 — Shared diagnosis contract: `application/shared/ai-diagnosis.ts`

Browser-safe (demo imports it): pure data + pure functions, no Node APIs.

### 2.1 Types

```ts
export const DIAGNOSIS_CATEGORIES = ['app-bug', 'test-bug', 'flaky-test', 'infrastructure', 'environment', 'unknown'] as const
export type DiagnosisCategory = typeof DIAGNOSIS_CATEGORIES[number]
export const DIAGNOSIS_CONFIDENCES = ['high', 'medium', 'low'] as const
export type DiagnosisConfidence = typeof DIAGNOSIS_CONFIDENCES[number]

export interface AiDiagnosisResult {
  category: DiagnosisCategory
  confidence: DiagnosisConfidence
  summary: string                 // one line, ≤ 160 chars
  rootCause: string               // 2–4 sentences
  evidence: string[]              // 2–5 bullets pointing at concrete signals from the context
  suggestedFix: {
    description: string
    file: string | null           // most likely file to edit (from stack/test paths), null if unclear
    code: string | null           // optional code snippet (plain string, NOT markdown-fenced)
  }
  preventionTips: string[]        // 0–3 bullets
}
```

### 2.2 `DIAGNOSIS_JSON_SCHEMA`

JSON Schema object used both as Anthropic `output_config.format.schema` and
embedded in the OpenAI system prompt. Constraints that matter for the
Anthropic structured-outputs validator: `additionalProperties: false` on
**every** object, all properties `required`, nullable fields expressed as
`anyOf: [{type:'string'},{type:'null'}]` (NOT `type: ['string','null']`),
enums via `enum: [...DIAGNOSIS_CATEGORIES]`. No min/max constraints (not
supported by the validator).

### 2.3 `parseDiagnosisJson(text: string): AiDiagnosisResult`

Robust extraction for the OpenAI path (Anthropic structured output should
already be clean, but run it through the same function):
1. `JSON.parse(text)` directly; if it fails,
2. strip markdown fences (` ```json … ``` `); if that fails,
3. slice from first `{` to last `}` and parse; if that fails → `throw`.
Then normalize: unknown `category` → `'unknown'`, unknown `confidence` →
`'low'`, coerce `evidence`/`preventionTips` to `string[]` (filter
non-strings, cap at 8 entries), trim + cap `summary` at 300 chars, ensure
`suggestedFix` object exists with nullable `file`/`code`. Never return
`undefined` fields — the UI renders this shape blindly.

---

## §3 — Settings storage + AI config resolution

### 3.1 `server/utils/app-settings.ts`

```ts
getAppSetting<T>(db, key): Promise<T | null>      // select where key
setAppSetting(db, key, value): Promise<void>       // insert … onConflictDoUpdate (key) set value, updatedAt
deleteAppSetting(db, key): Promise<void>
```

### 3.2 `nuxt.config.ts` — add to `runtimeConfig` (server side, NOT public)

```ts
ai: {
  provider: process.env.NUXT_AI_PROVIDER || '',        // 'anthropic' | 'openai'
  apiKey: process.env.NUXT_AI_API_KEY || '',
  model: process.env.NUXT_AI_MODEL || '',
  baseUrl: process.env.NUXT_AI_BASE_URL || '',
  autoDiagnose: process.env.NUXT_AI_AUTO_DIAGNOSE === 'true'
},
```

Nitro overrides these at runtime from `NUXT_AI_*` env vars. Booleans arrive
as strings after override — compare with `String(x) === 'true'` (same
pattern as `isAuthEnabled`). Also add the 5 vars to `application/.env.example`.

### 3.3 Config resolution — in `server/utils/ai-provider.ts`

```ts
export interface AiConfig {
  provider: 'anthropic' | 'openai'
  apiKey: string            // may be '' for openai (ollama needs none)
  model: string             // '' → provider default ('claude-opus-4-8' for anthropic; required for openai)
  baseUrl: string | null
  autoDiagnose: boolean
  source: 'env' | 'settings'
}
export async function resolveAiConfig(db): Promise<AiConfig | null>
```

Precedence: if `runtimeConfig.ai.provider` is non-empty → env config wins
entirely (`source: 'env'`). Otherwise read `app_settings` key `'ai'`
(`source: 'settings'`). Returns `null` when neither configures a provider.
Validity: provider `anthropic` requires `apiKey`; provider `openai` requires
`baseUrl` + `model` (apiKey optional). Invalid/partial config → `null`.

---

## §4 — Provider layer: rest of `server/utils/ai-provider.ts`

`npm install @anthropic-ai/sdk` (in `application/`).

```ts
export interface AiCallOptions { system: string, user: string, jsonSchema?: object, maxTokens?: number }
export interface AiCallResult { text: string, model: string, inputTokens: number | null, outputTokens: number | null }
export async function callAiProvider(config: AiConfig, opts: AiCallOptions): Promise<AiCallResult>
```

**Anthropic branch:**

```ts
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic({
  apiKey: config.apiKey,
  baseURL: config.baseUrl || undefined,   // overridable → testable against a local mock
  timeout: 120_000,
  maxRetries: 1
})
const res = await client.messages.create({
  model: config.model || 'claude-opus-4-8',
  max_tokens: opts.maxTokens ?? 8192,
  system: opts.system,
  messages: [{ role: 'user', content: opts.user }],
  ...(opts.jsonSchema ? { output_config: { format: { type: 'json_schema', schema: opts.jsonSchema } } } : {})
})
if (res.stop_reason === 'refusal') throw new Error('The model declined to analyze this failure')
const text = res.content.find(b => b.type === 'text')?.text ?? ''
return { text, model: res.model, inputTokens: res.usage.input_tokens ?? null, outputTokens: res.usage.output_tokens ?? null }
```

No `thinking` param (§0.3). If the installed SDK version doesn't type
`output_config` yet, upgrade the SDK — do not cast to `any` silently.

**OpenAI branch:** `fetch` `POST {baseUrl.replace(/\/$/, '')}/chat/completions`
with headers `content-type: application/json` + `authorization: Bearer …`
(only when apiKey set); body
`{ model, max_tokens, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{role:'system', content: system + '\n\nRespond ONLY with a JSON object matching this schema:\n' + JSON.stringify(jsonSchema)}, {role:'user', content: user}] }`.
Non-2xx → throw `Error('openai provider returned HTTP <status>: <first 300 chars of body>')`.
Read `choices[0].message.content`, `usage.prompt_tokens`/`completion_tokens`.
Use a 120 s `AbortSignal.timeout`.

**Error normalization:** wrap both branches so callers get a single-line
`error.message` (≤ 500 chars) suitable for storing in `failure_diagnoses.error`
— include provider name, HTTP status if any, never the API key.

---

## §5 — Regression-context refactor (prereq for §6)

Extract the body of `server/api/test-runs/[id]/regression-context.get.ts`
into `server/utils/regression-context.ts`:

```ts
export interface RunForRegression { id, projectId, status, startTime, environment, metadata }
export async function computeRegressionContext(db, run: RunForRegression): Promise<RegressionContextResult>
```

Move `normalizeGitUrl`, `buildCompareUrl`, `getBrowserList`,
`computeMetadataDiff`, the last-green query, commit range, metadata diff and
new-failures computation verbatim. The endpoint keeps only: param parsing,
run fetch, 404, then `return computeRegressionContext(db, run)`. **Response
shape unchanged** — `regression-context.spec.ts` (7 tests) must still pass
untouched.

---

## §6 — Diagnosis engine: `server/utils/ai-diagnosis.ts`

### 6.1 System prompt (module const)

> You are a senior test engineer diagnosing Playwright test failures.
> You receive one failure *cluster*: several test failures sharing one
> normalized error signature, plus execution context. Identify the most
> likely single root cause. Ground every claim in the provided evidence —
> quote selectors, URLs, status codes or step names rather than speculating.
> If the evidence is insufficient, say so and lower your confidence.
> Categories: app-bug (the application under test broke), test-bug (the test
> code/locators are wrong), flaky-test (timing/race, passes on retry),
> infrastructure (CI workers, browser crashes, resources), environment
> (config/URL/credentials differences), unknown.

### 6.2 Context assembly — `buildClusterDiagnosisContext(db, cluster): Promise<string>`

Markdown-ish sections with hard caps (keep total ≲ 8 K tokens; caps as named
constants at the top of the file):

| Section | Source | Cap |
|---|---|---|
| Cluster | signature, errorType, selector, status, occurrences, distinct affected tests, first/last seen run ids + startTimes | — |
| Sample raw error | `cluster.sampleError` | 3 000 chars |
| Affected tests | distinct `testCases.title` + `filePath` joined via `failureClusterId` | 15 + "…and N more" |
| Representative execution | latest `testRunsCases` row of the cluster (order `id desc`): browser (projectName/browserName), retries, duration | — |
| → Steps | row.steps `[category] title (Nms)` | last 25 |
| → Console | row.consoleLogs, only `error`/`warning` types | 12 entries × 300 chars |
| → Failed network | row.networkRequests with `status >= 400` or `status === 0`: `METHOD url → status (Nms)` | 10 |
| → ARIA snapshot | row.ariaSnapshot | 1 500 chars |
| Retry behavior | did any test in the cluster pass on retry in `lastSeenRunId` (same query as failure-groups `flaky`) | — |
| What changed since green | `computeRegressionContext(db, lastSeenRun)` — last green run id/time, commit range from→to + `gitCommand`, metadataDiff lines, newFailures. **lastSeenRunId may point at a deleted run** (no FK): fetch defensively, omit section if missing | — |

Every section is omitted (not left empty) when data is absent.

### 6.3 `runClusterDiagnosis(db, cluster, config, opts?: { force?: boolean }): Promise<FailureDiagnosis>`

1. **Concurrency guard:** module-level `const running = new Set<number>()`.
   Caller checks `isDiagnosisRunning(clusterId)` (exported) for the 409; the
   function itself also refuses double entry (defensive).
2. Upsert the row to `status: 'running'` (insert
   `onConflictDoUpdate(target: clusterId)` clearing previous result fields +
   `error`, setting `provider`, `model: config.model || default`).
3. `t0 = Date.now()` → build context → `callAiProvider(config, { system, user, jsonSchema: DIAGNOSIS_JSON_SCHEMA })`
   → `parseDiagnosisJson(text)`.
4. Success → update row: `status 'completed'`, category, confidence, summary,
   rootCause, `details: { evidence, suggestedFix, preventionTips }`,
   inputTokens, outputTokens, `durationMs: Date.now() - t0`, updatedAt.
5. Failure → update row: `status 'failed'`, `error: message.slice(0, 500)`,
   durationMs. **Do not rethrow** — return the failed row (UI renders it).
6. `finally` → `running.delete(clusterId)`.
7. **Stale-running rule** (server restarts mid-call leave `'running'` rows):
   a row with `status 'running'` whose `updatedAt` is older than 5 minutes is
   treated everywhere as failed/re-runnable.

### 6.4 `autoDiagnoseRun(db, projectId, runId): Promise<void>`

`config = await resolveAiConfig(db)`; bail unless `config?.autoDiagnose`.
Select clusters `where projectId = … and firstSeenRunId = runId` (new in this
run), skip those with an existing `completed` diagnosis or fresh `running`
row, **cap at 3 clusters**, run sequentially (`for … await`) each wrapped in
try/catch + `console.error('[ai-diagnosis] …')`. Callers invoke it
fire-and-forget: `autoDiagnoseRun(db, projectId, runId).catch(e => console.error(…))`
— never `await`ed on the request path, never fails the response.

---

## §7 — HTTP endpoints (7 new files)

| Route | File | Auth | Behavior |
|---|---|---|---|
| `POST /api/failure-clusters/:id/diagnose?force=true` | `server/api/failure-clusters/[id]/diagnose.post.ts` | `requireAuth(event)` | 400 bad id; 404 unknown cluster; 503 `resolveAiConfig` null ("AI diagnosis is not configured"); 409 running & fresh (<5 min, §6.3.7); existing `completed` + no `force` → return it (no LLM call); else run §6.3 synchronously and return the row (200 even when `status: 'failed'`) |
| `GET /api/failure-clusters/:id/diagnosis` | `…/[id]/diagnosis.get.ts` | none | 404 unknown cluster; row or `null` |
| `GET /api/ai/status` | `server/api/ai/status.get.ts` | none | `{ configured: boolean, provider?, model?, autoDiagnose?, source? }` — **never the key** |
| `GET /api/settings/ai` | `server/api/settings/ai.get.ts` | admin | `{ provider, model, baseUrl, autoDiagnose, hasApiKey, envManaged }` (DB values; when env-managed return env values + `envManaged: true`) |
| `PUT /api/settings/ai` | `server/api/settings/ai.put.ts` | admin | 409 if env-managed. Body `{ provider, model?, baseUrl?, apiKey?, autoDiagnose? }`. `provider: null \| ''` → `deleteAppSetting('ai')` (lets tests reset). Validate provider ∈ {anthropic, openai} else 400; openai requires baseUrl+model (400). `apiKey` semantics: `undefined` → keep stored key, `''` → clear, string → replace. Returns the GET shape |
| `POST /api/settings/ai/test` | `server/api/settings/ai/test.post.ts` | admin | Resolve config (503 if none); call provider with `{ system: 'You are a connectivity check.', user: 'Reply with the single word OK.', maxTokens: 8 }` (no schema) → `{ success: true, model }` or `{ success: false, error }` (200) |

Nitro supports `settings/ai.get.ts` coexisting with `settings/ai/test.post.ts`.
API key stored plaintext in `app_settings` (self-hosted trust model, same as
the rest of the app) — masked everywhere outbound.

## §8 — Expose diagnosis in existing endpoints

Compact subset `{ status, category, confidence, summary }` (one
`inArray(failureDiagnoses.clusterId, ids)` query, mapped):

1. `GET /api/test-runs/:id/failure-groups` → `diagnosis: …|null` per group
   (+ add to `FailureGroup` in `types/api.ts`).
2. `GET /api/projects/:id/failure-clusters` → same per cluster
   (+ `ProjectFailureCluster`).
3. `GET /api/test-cases/:id` → inside the existing `failureCluster` block.

The full row (rootCause, details, tokens…) is only served by
`GET /api/failure-clusters/:id/diagnosis` — the UI component fetches it on
demand (§10.2).

## §9 — Auto-diagnose hooks (3 call sites)

Fire-and-forget `autoDiagnoseRun(db, projectId, runId)` (pattern §6.4) after
the run reaches a terminal status:

1. `submit.post.ts` — after the `publishGlobal({ type: 'run-submitted', … })`
   (~line 143).
2. `finish.post.ts` — **non-pending branch only** (after the `run-finished`
   `publishGlobal`, ~line 142). The `hasPendingUploads` branch ends in
   `finalizing` → covered by (3).
3. `upload.post.ts` — two spots: (a) after the `finalizing → finalStatus`
   transition block (~line 370), (b) after the legacy complete-run path
   finishes persisting cases (after `persistRunCases`, ~line 426, once the
   run row has its terminal status).

## §10 — UI

### 10.1 `app/composables/useAiStatus.ts`

`useState<AiStatus | null>('ai-status')` + module promise guard; on first
client-side call `$fetch('/api/ai/status')`, errors → `{ configured: false }`.
Demo mode answers via the demo router transparently.

### 10.2 `app/components/ClusterDiagnosis.vue` — props `{ clusterId: number }`

- On mount (client): `GET /api/failure-clusters/{id}/diagnosis` → `diagnosis`.
- States:
  - **not configured & no diagnosis** → render nothing (zero noise).
  - **configured & no diagnosis** → `UButton` "Diagnose with AI"
    (`i-lucide-sparkles`).
  - **running** (local POST in flight, or fetched row `status 'running'`) →
    spinner + "Analyzing failure cluster… this can take a minute". If the
    fetched row is running (someone else triggered it), poll the GET every
    3 s, stop after 2 min.
  - **completed** → category badge (colors: app-bug `error`, test-bug
    `warning`, flaky-test `warning`, infrastructure `info`, environment
    `secondary`, unknown `neutral`) + confidence badge + `summary`
    (font-medium) + `rootCause` paragraph + evidence `<ul>` + suggested fix
    (description; optional file as code chip; optional `code` in `<pre>` with
    copy button — reuse the copy pattern from `TestCaseErrorCard`) +
    prevention tips `<ul>` + footer meta line
    (`model · in/out tokens · duration · formatRelativeTime(updatedAt)`) +
    ghost "Re-diagnose" button (`POST …?force=true`).
  - **failed** → `UAlert` color error with `diagnosis.error` + "Retry".
- POST handler: `409` → switch to poll mode; other errors → toast.
- All fields rendered as plain text (no v-html) — LLM output is untrusted.

### 10.3 Integration points

- `FailureGroups.vue`: in the expanded section, below the case list:
  `<ClusterDiagnosis :cluster-id="group.clusterId" />`; on the header badge
  row, when `group.diagnosis?.status === 'completed'`, a subtle
  `i-lucide-sparkles` badge showing `group.diagnosis.category`.
- `FailureClustersList.vue`: per-row "AI" toggle button expanding a
  `<ClusterDiagnosis>` panel under the row; same header badge when present.
- `TestCaseErrorCard.vue`: when the `cluster` prop exists, render
  `<ClusterDiagnosis :cluster-id="cluster.id" />` after the cluster info line.
- `app/utils/fix-prompt.ts`: append a "Previous AI diagnosis" section when
  the case page has one (root cause + suggested fix), so the copy-paste
  prompt benefits from the server-side analysis.

### 10.4 `app/pages/settings/ai.vue` + nav

Nav entry in `settings.vue` links array:
`{ label: 'AI diagnosis', icon: 'i-lucide-sparkles', to: '/settings/ai' }`.
Page: fetch `GET /api/settings/ai`; if `envManaged` → info `UAlert` +
disabled form. Form fields: provider `USelect`
(`Anthropic API` / `OpenAI-compatible`), model `UInput` (placeholder
`claude-opus-4-8` for anthropic; `e.g. llama3.1, gpt-4o` for openai), API key
`UInput type=password` (placeholder `•••••••• (unchanged)` when `hasApiKey`;
help text "leave empty to keep, clear-and-save to remove" — UI sends
`undefined` when untouched), base URL `UInput` (required for openai —
`http://localhost:11434/v1`; optional proxy for anthropic), auto-diagnose
`USwitch` ("Automatically diagnose new failure clusters when a run finishes
— one LLM call per new cluster, max 3 per run"). Buttons: **Save** (PUT,
toast), **Test connection** (POST `/api/settings/ai/test`, toast
success/error; disabled until configured).

## §11 — Pillar 3: flaky tests board (cut line — ship §1–§10 without this if needed)

### 11.1 `GET /api/projects/:id/flaky-tests?runs=50` — `server/api/projects/[id]/flaky-tests.get.ts`

Algorithm (no auth, 404 unknown project, `runs` clamped 1–200):
1. Last N **terminal** runs (`status IN ('passed','failed','timedout','interrupted')`)
   by `startTime desc` → keep id + startTime; empty → `[]`.
2. All `testRunsCases` rows for those run ids: `testRunId, testCaseId, status,
   retries, browser, id`.
3. Per `(testCaseId, runId)`: group rows by
   `browserKey = browser?.projectName ?? browser?.browserName ?? ''`
   (multi-browser runs would otherwise fake retry-passes across browsers).
   Within a browser group (sorted by `retries`): `finalStatus` = status of the
   max-retries row; `retryPass` = group contains both a failed/timedOut row
   and a passed row. Run-level: `runFinalFailed` = any group's finalStatus ∈
   {failed, timedOut}; `runRetryPass` = any group retryPass.
4. Per `testCaseId` over its executed runs ordered oldest → newest:
   `totalRuns`, `failedRuns`, `retryPassRuns`,
   `alternations` = count of consecutive pairs where `runFinalFailed` flips.
5. Candidate iff `totalRuns >= 3 && (retryPassRuns >= 1 || alternations >= 2)`.
6. `score = clamp(1, 100, round(100 * (0.6 * retryPassRuns/totalRuns + 0.4 * alternations/max(1, totalRuns - 1))))`.
7. `lastFlakeAt` = startTime of the newest run with `runRetryPass`, else the
   newest alternation boundary. `latestRunsCaseId` = junction id of the
   newest attempt (links to `/test-cases/:id`).
8. Join titles/filePaths, sort score desc (tiebreak retryPassRuns desc),
   limit 50. Item shape: `{ testCaseId, latestRunsCaseId, title, filePath,
   totalRuns, failedRuns, retryPassRuns, alternations, failureRate, score,
   lastFlakeAt }` (+ `FlakyTest` type in `types/api.ts`).

### 11.2 `app/components/FlakyTestsList.vue`

Same self-fetching pattern as `FailureClustersList` (`useFetch`, lazy,
server:false, `runs` selector 20/50/100). Row: score badge (≥60 error, ≥30
warning, else neutral), title linking to `/test-cases/{latestRunsCaseId}`,
filePath muted, badges "passed on retry in N runs" / "M status flips" /
failure rate %, `lastFlakeAt` relative. Empty state: "No flaky tests detected
in the last N runs".

### 11.3 Project page

`app/pages/projects/[id]/index.vue`, `#failure-clusters` tab (~line 713):
render `<FlakyTestsList>` below `<FailureClustersList>`; consider renaming
the tab label to "Failures" (check the tabs array).

## §12 — Demo mode

1. **`app/demo/api/ai.ts`** (new):
   - `apiGetAiStatus()` → `{ configured: true, provider: 'demo', model: 'piwi-demo-analyst', autoDiagnose: false, source: 'demo' }`.
   - `apiGetClusterDiagnosis(id)` → row from demo DB or null.
   - `apiDiagnoseCluster(id, force)` → return existing completed unless
     force; else wait ~1200 ms, build a canned `AiDiagnosisResult` from the
     cluster row (template per `errorType`: timeout → selector/wait analysis;
     assertion → app-state regression; strict-mode → duplicate elements;
     navigation → environment URL; …), upsert into `failure_diagnoses`,
     return the row. Import types/constants from `#shared/ai-diagnosis`.
   - `apiGetAiSettings` / `apiPutAiSettings` / `apiTestAiSettings` → static
     plausible answers (`envManaged: false`, PUT echoes success — writes
     nothing).
   - `apiGetProjectFlakyTests(id, runs)` → same algorithm as §11.1 against
     the demo DB (the JS aggregation shares no server imports).
2. **`app/demo/api/router.ts`**: register the 7 routes (status GET, diagnosis
   GET, diagnose POST w/ `force` query, settings GET/PUT, settings test POST,
   flaky-tests GET with `runs` query).
3. **`scripts/generate-demo-seed.mjs`**: add `CREATE TABLE failure_diagnoses
   …` + `CREATE TABLE app_settings …` + the unique index (mirror the
   migration SQL); seed 2 completed diagnoses for two existing `CLUSTERS`
   ids (they carry explicit ids — pick the timeout one and the strict-mode
   one) with realistic evidence/fix content, `provider 'demo'`. Run
   `npm run seed:demo` and commit `public/demo/seed.sql` +
   `seed.version.json`.
4. Demo `apiGetFailureGroups` / `apiGetProjectFailureClusters` /
   `apiGetTestCase`: attach the same compact `diagnosis` subset as §8 (the
   post-review pass last time caught exactly this class of demo/server drift
   — don't skip it).

## §13 — Tests

### 13.1 `shared/test-project-names.ts`

Add (alphabetically): `AI_DIAGNOSIS: 'ai-diagnosis-test'`,
`FLAKY_BOARD: 'flaky-board-test'`.

### 13.2 `tests/ai-diagnosis.spec.ts` — `test.describe.serial`

Mock provider: in `beforeAll`, `http.createServer` on `127.0.0.1:0` (capture
the assigned port). Routes:
- `POST /v1/chat/completions` → OpenAI shape, body
  `JSON.stringify(cannedDiagnosis)` in `choices[0].message.content`,
  `usage: { prompt_tokens: 1200, completion_tokens: 300 }`. Count calls,
  store the last request body for context assertions.
- `POST /v1/messages` → Anthropic shape: `{ model: 'mock-claude', stop_reason:
  'end_turn', content: [{ type: 'text', text: JSON.stringify(canned) }],
  usage: { input_tokens: 1500, output_tokens: 280 } }`.
- Any path under `/broken/` → 500.

Tests (each PUTs the settings it needs; `afterAll` clears settings + closes
the server):
1. unconfigured: clear settings → `GET /api/ai/status` `{configured:false}`;
   `POST diagnose` on a real cluster → 503.
2. configure openai (baseUrl = mock) via PUT → status configured; GET
   settings has `hasApiKey` correct and never echoes the key.
3. submit a run with 2 identical-fingerprint failures (reuse the
   `failure-clusters.spec.ts` `submitRun` pattern with
   `PROJECT.AI_DIAGNOSIS`), read `failureClusterId` from the run detail →
   `POST diagnose` → row `completed`, parsed category/confidence/summary,
   tokens recorded; the mock's captured request contains the cluster
   signature and test titles (context-assembly proof).
4. `GET diagnosis` returns the row; `failure-groups` + project
   `failure-clusters` responses now carry the compact `diagnosis` subset.
5. second `POST diagnose` without force → same row, mock call count
   unchanged; with `?force=true` → call count +1.
6. anthropic path: PUT provider anthropic + apiKey + baseUrl = mock →
   `POST diagnose?force=true` → completed, `provider 'anthropic'`,
   `model 'mock-claude'`.
7. failure path: PUT baseUrl = `…/broken` → diagnose force → 200 with row
   `status 'failed'`, `error` mentions HTTP 500.
8. settings test endpoint: with mock configured → `{success:true}`.

### 13.3 `tests/flaky-tests.spec.ts` — serial

Submit 4 runs to `PROJECT.FLAKY_BOARD` via `/api/test-runs/submit`
(`testCases` entries can repeat a title with different `retries` values to
create retry rows — the dedup index allows it):
- test A: failed attempt (`retries:0`) + passed attempt (`retries:1`) in runs
  1 and 3 → `retryPassRuns: 2`.
- test B: final status alternates fail/pass/fail/pass (no retries) →
  `alternations: 3`.
- test C: always passes → must NOT appear.
Assert: ordering by score, every field of the §11.1 shape, `?runs=1` shrinks
the window (B's alternations drop), 404 for unknown project.

### 13.4 Caveat for local runs

The suite reuses a local dev server; AI settings are global state. The spec
must clear settings in `afterAll`, and tests must not assume a pristine
`app_settings` at entry (always PUT what they need first).

## §14 — Docs

1. `docs/api.md`: new "AI diagnosis" section (the 6 routes of §7 with field
   tables, force/409/503 semantics) + `flaky-tests` endpoint + note the
   `diagnosis` subset on failure-groups / failure-clusters / test-case
   responses.
2. `docs/ai-diagnosis.md` (new page; add to the sidebar in
   `docs/.vitepress/config.mts`): what it does, configuration via settings UI
   vs `NUXT_AI_*` env vars (precedence), provider matrix (Anthropic /
   OpenAI-compatible incl. an ollama example), auto-diagnose behavior + cost
   cap (≤3 calls/run), **privacy paragraph**: exactly what is sent to the LLM
   (error text, test titles/paths, console/network excerpts, ARIA snapshot,
   commit shas — and to whose endpoint), API key storage (DB, plaintext,
   admin-only endpoints; recommend env vars for stricter setups).
3. `AGENTS.md`: add `failure_diagnoses` + `app_settings` to the tables list;
   add `NUXT_AI_*` to the Environment section.
4. This file: move the executed parts into an "Implemented" section with the
   date.
5. `README.md`: one feature bullet if a feature list exists (check first).

## §15 — Verification checklist

```bash
cd application
npm install                 # pulls @anthropic-ai/sdk
npm run typecheck
npm run lint
npm test                    # full suite, incl. the 2 new specs
npm run seed:demo && git diff --stat public/demo/   # seed regenerates cleanly
```

Manual smoke (dev server):
1. `curl localhost:3000/api/ai/status` → `{configured:false}` on a fresh DB.
2. Configure a real or mock provider in `/settings/ai`, run "Test
   connection".
3. Submit a failing run (curl from AGENTS.md "Testing API" with an `error`
   field), open the run → Failure groups → "Diagnose with AI" → card renders.
4. Enable `autoDiagnose`, submit another failing run with a *new* error text
   → diagnosis appears without clicking.
5. SQLite: delete `.data/piwi.db`, boot, confirm migration `0022` applies —
   and on an *existing* DB too (that's the §0.1 `when` guard working).

## §16 — Risks / notes for the implementer

- **Do not bump `FINGERPRINT_VERSION`** — nothing here changes error
  normalization.
- The diagnose POST holds the HTTP request open for the LLM call (≤ 120 s);
  Nitro handles this fine, no job queue needed at this scale.
- `failure_diagnoses` cascade-deletes with its cluster; clusters
  cascade-delete with the project; `server/api/tests/cleanup.delete.ts`
  already deletes clusters explicitly before projects — diagnoses ride along
  via FK, but **verify `PRAGMA foreign_keys` is on in the libSQL client**
  (if not, delete diagnoses explicitly there too).
- Diagnosis is intentionally allowed on `resolved`/`ignored` clusters.
- If context size becomes an issue with small local models, the §6.2 caps
  are the tuning knobs — they are named constants, keep them that way.
