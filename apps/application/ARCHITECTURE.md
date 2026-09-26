# Dashboard app — architecture map

Reference for `apps/application/`: what exists and where. The **rules** for changing it live in
[`AGENTS.md`](AGENTS.md) — read that before editing.

This map describes structure and intent, not every file. Directory listings and the auto-generated
[`/_openapi.json`](#backend) are the authority on exact names.

## Shape

```
app/          Vue 4 SPA/SSR front end — pages, components, composables, utils, layouts
server/       Nitro back end — api/, routes/, utils/, database/, middleware/, tasks/
shared/       Types, constants, pure helpers shared by app + server + demo (`#shared/...`)
app/demo/     In-browser mirror of the server for the demo SPA
scripts/      Seed generation, demo media capture, DB query helper
tests/        Playwright specs (`*.spec.ts`) + Vitest unit tests (`tests/unit/*.test.ts`)
types/        Front-end API response types (`api.ts`)
```

## Shared types & core

- `shared/types.ts` — the **wire contract**: `TestCasePayload`, `StreamEventPayload`, `TestRunSubmitPayload`,
  `TestRunFinishPayload`, the `TestRunStatus` / `TestCaseStatus` unions, and the `Role` enum. Server endpoints import it
  directly via `#shared/types`.
- The small wire **leaf shapes** (`BrowserConfig`, `TestStepEvent`, `SuiteConfigEntry`, `TestAnnotation`,
  `FilterDetails`, `TestSourceFrame`) live in `@piwitests/core/wire` and are re-exported here — one source of truth
  shared with the reporter. Per-case payloads stay app-side; the reporter's `WireTestCase` stays reporter-side. The two
  are kept compatible by `tests/unit/wire-shared-drift.test.ts`.
- `@piwitests/core` (`packages/core/`) is a private, **zero-dependency**, browser/worker/server-safe package holding
  pure cross-cutting logic: locator generation/scoring, ARIA parsing + element-match healing, locator-healing types, the
  wire leaves, and the locator-method list. It ships **TypeScript source** (no build step) — Vite/Vitest transpile it,
  the reporter's tsup inlines it. The app consumes it through thin `shared/*` re-export shims.

## Database

Drizzle ORM over **SQLite (libSQL)** or **PostgreSQL (postgres.js)**, chosen at runtime by `PIWI_DATABASE_URL`.

- `server/database/schema.sqlite.ts` and `schema.pg.ts` — the real schemas (edit both).
- `server/database/schema.ts` — a conditional re-export that picks a dialect at module init; type-checking uses the
  SQLite schema as canonical. Never edit it to add tables.
- `server/database/migrations/` (SQLite) and `migrations-pg/` (PostgreSQL, auto-run on startup).

Tables, by area:

| Area               | Tables                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Core results       | `projects`, `test_runs`, `test_suites`, `test_cases`, `test_runs_cases`, `network_requests`                                   |
| Failure analysis   | `failure_clusters`, `failure_cluster_aliases`, `cluster_merge_suggestions`, `failure_diagnoses`, `failure_diagnosis_versions` |
| Evidence & storage | `files`, `trace_resources`, `trace_blobs`, `case_payloads`, `locator_snapshots`, `locator_usages`                             |
| Metadata           | `tags`, `project_tags`, `markers`, `entity_links`, `app_settings`, `test_functions`, `test_selections`                        |
| Identity           | `users`, `api_keys`, `account_tokens`, `project_assignments`                                                                  |
| Notifications      | `notification_channels`, `subscriptions`, `notification_deliveries`                                                           |

Non-obvious ones:

- **`case_payloads`** — content-addressed storage for large per-execution text (`aria_snapshot`, `test_source`,
  `test_source_frames`): one row per unique content per project (SHA-256 `hash`, unique `(project_id, hash)`),
  referenced from `test_runs_cases.*_payload_id`. See the rule in `AGENTS.md`.
- **`locator_snapshots`** — one row per locator call site (`test_case_id` + `location`), upserted each run with the
  latest element attributes and pre-computed ranked alternatives. Unique index on `(test_case_id, location)`;
  `last_seen_run_id` FK is `ON DELETE set null`.
- **`locator_usages`** — the locator index: one row per (test case, Playwright project, branch, call site, action,
  canonical chain), read from the steps of each ingested execution; `branch` is `''` for the default branch, and a
  view of another branch replaces the default rows of the tests that ran on it. Feeds "Who uses this?", the project's Locators page and the
  extension's Tested elements (`GET /api/projects/:id/locator-index`).
- **`account_tokens`** — single-use SHA-256-hashed tokens for reset/invite/verify, with a purpose enum and TTL enforced
  at query time.
- **`notification_deliveries`** — an outbox: `dedupeKey` unique for idempotency, `status`, `attempts` + `scheduledFor`
  for progressive retry (1/5/15/60/240 min).
- **`entity_links`** — external URLs (Jira, GitHub…) attached to a run, execution or test case via three nullable FK
  columns with `ON DELETE CASCADE`, mirroring the `files` pattern. Provider auto-detected by `shared/link-detect.ts`.

## Backend

Nitro file-based routing under `server/api/`, plus `server/routes/` for non-`/api` routes. The auto-generated
**OpenAPI 3.1** spec at `/_openapi.json` and the in-app reference at `/docs` are the authoritative endpoint list — this
is only the shape of it.

| Family                                                                  | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-runs/`                                                            | Ingest (`submit`, `upload`, `import` + `import/check`), the streaming protocol (`setup`, `start`, `[id]/events`, `[id]/finish`, `[id]/case-files`), run detail, SSE `stream`, network requests, comparison, deletion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `test-cases/`, `test-run-cases/`                                        | Stable test-case detail/history/traces; per-execution detail, execution-scoped diagnosis (`diagnose`, `diagnosis`, `diagnosis-context`), locator healing, DOM snapshots                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `projects/`                                                             | List (heavy stats), `menu` (slim sidebar list, one SELECT), `overview`, detail, CRUD, members, flaky tests, spec health, trends, SCM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `failure-clusters/`, `cluster-merge-suggestions/`, `failure-diagnoses/` | Cluster detail and triage, AI diagnosis (`diagnose`, `context`, `commits`, `commit-diff`, `base-commit`), semantic merge suggestions, diagnosis version history and feedback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `analytics/[widget]`                                                    | Cross-project analytics widgets backing `/analytics`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `auth/`, `users/`                                                       | Login/logout/me/setup, OAuth, password reset & change, email verification, invites, user + API-key management                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `channels/`, `subscriptions/`, `notifications/stream`                   | Notification destinations, per-project subscriptions, SSE delivery stream                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `settings/`                                                             | AI, SMTP and other admin settings (secrets never returned; env-managed flags exposed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `files/`, `traces/`, `markers/`, `links/`, `tags/`, `search`, `admin/`  | Artifact download, trace checks, timeline markers, entity links, tags, global search, admin stats/cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `projects/[id]/test-functions`, `test-functions/[id]`                   | The browser extension's function catalog — CRUD, plus `test-functions/extract` (AI: pasted source → a proposed catalog entry, unsaved draft) and `test-functions/validate-proposal` (no AI call — parses/validates a pasted-back AI reply against the same schema, for instances with no AI configured; mirrored in demo mode since it's AI-free)                                                                                                                                                                                                                                                                                                                                                                                                                |
| `projects/[id]/selections`, `selections/[key]`                          | Named, data-driven test selections — CRUD, `[key]/resolve` (definition → matching tests + `playwright test` command, with `shard` duration-balancing, what `piwi select` / `piwi run` call), `preview` (ad-hoc definition), `suggestions` (proposed `slow`/`feature` tags + a mined smoke suite), `impact` (changed files → affected tests, what `piwi run impact --base` calls) and `analytics` (per-selection health + drift-from-last-run + unselected-test coverage). Resolver + CRUD in `shared/handlers/selections.ts`, suggestions in `shared/handlers/selection-suggestions.ts`, analytics in `shared/handlers/selection-analytics.ts`, impact in `server/utils/selection-impact.ts`; definition shape/validation/materialization in `shared/selection/` |
| `health`, `version`, `apps/desktop/`                                    | Readiness probe (200/503 with DB check), build info, desktop-shell helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `server/routes/mcp.post.ts`                                             | The MCP server endpoint (tool defs in `shared/mcp-tools.ts`, handlers in `server/utils/mcp/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `server/routes/__piwi/`                                                 | Desktop session bootstrap, guarded by `server/middleware/desktop-guard.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Key server utilities (`server/utils/`):

| File / folder                                                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `persist-run-cases.ts`                                        | The single write path for run cases — every ingest site goes through it                                                                                                                                                                                                                                                                                                                    |
| `blob-report.ts`                                              | Reads a Playwright blob report (`report.jsonl` + `resources/`) into run + `RunCaseInput`s for the import endpoint                                                                                                                                                                                                                                                                          |
| `trace-import.ts`                                             | Rebuilds one execution from a bare `trace.zip` — title, browser, timing and error from the trace's own headers                                                                                                                                                                                                                                                                             |
| `archive-reader.ts`                                           | The server's ZIP half of the import parsers (the demo supplies its own), inflating entries on demand                                                                                                                                                                                                                                                                                       |
| `import-evidence.ts`                                          | Recovers ARIA snapshot / source snippet from `error-context`, and console entries from the trace, for imported executions                                                                                                                                                                                                                                                                  |
| `upload-limits.ts`                                            | Effective multipart ceiling (`PIWI_IMPORT_MAX_BYTES`), shared by `upload` and `import` and surfaced to the import page                                                                                                                                                                                                                                                                     |
| `case-payloads.ts`                                            | Content-addressed payload upsert/inline/resolve                                                                                                                                                                                                                                                                                                                                            |
| `locator-healing.ts`                                          | Shared `upsertLocatorSnapshots`, `getLocatorHealing`, `saveLocatorPick` (server + demo)                                                                                                                                                                                                                                                                                                    |
| `locator-usages.ts`                                           | Shared locator index: step indexing on ingest, "Who uses this?", `getLocatorIndex` (server + demo)                                                                                                                                                                                                                                                                                         |
| `project-access.ts`                                           | `getProjectScope`, `requireProjectAccess`, `requireResolvedProjectAccess`, entity resolvers                                                                                                                                                                                                                                                                                                |
| `route-required-roles.ts`, `route-roles-match.ts`             | Read `x-required-roles` from compiled route metas; rou3 matching                                                                                                                                                                                                                                                                                                                           |
| `ai-*.ts`                                                     | Provider abstraction, diagnosis, context building + limits, research stage, embeddings, images, system prompt, function-catalog extraction from pasted code (rules/schema/prompt-builder live in `shared/test-function-extract-prompt.ts` — one source for the AI-calling endpoint, the dashboard's no-AI-credits "copy prompt" flow, and the MCP `create_test_function` tool description) |
| `cluster-*.ts`                                                | Similarity, semantic adjudication, naming, reconciliation                                                                                                                                                                                                                                                                                                                                  |
| `scm/`                                                        | Repo history, diffs and patch validation for AI diagnosis                                                                                                                                                                                                                                                                                                                                  |
| `notifications/`                                              | `match.ts` (subscription matching → outbox rows), `dispatch.ts` (`sweepOutbox`, HMAC-SHA256 `X-Piwi-Signature`), `emit.ts`, `run-notifications.ts`                                                                                                                                                                                                                                         |
| `email.ts`, `account-tokens.ts`, `rate-limit.ts`, `crypto.ts` | SMTP transport + templates, single-use tokens (reset 1 h / verify 24 h / invite 72 h), in-memory sliding window, AES-256-GCM                                                                                                                                                                                                                                                               |
| `export-request.ts`, `export-assets.ts`                       | Offline-export endpoints' shared plumbing: format parsing, download headers, size budget, storage-backed asset reader                                                                                                                                                                                                                                                                      |
| `trace-reconstruct.ts`                                        | Rebuilds a full trace ZIP from a slim blob + the shared resource pool; used by the file endpoint and by exports                                                                                                                                                                                                                                                                            |
| `retention.ts`                                                | Nightly pruning of runs, notification history, diagnosis versions and orphan payloads                                                                                                                                                                                                                                                                                                      |
| `compute-regression-signals.ts`, `flaky-classify.ts`          | `isNewRegression` / `isNewFlaky` signals; flaky root-cause classification                                                                                                                                                                                                                                                                                                                  |
| `server/tasks/notifications/sweep.ts`                         | Nitro scheduled task — sweeps the outbox every minute                                                                                                                                                                                                                                                                                                                                      |

Import orchestration is shared, not mirrored: `shared/handlers/import-runs.ts` owns everything after parsing, with
the server and demo supplying an `ImportPort` for the parts that genuinely differ.

Offline export follows the same split: `shared/export/` collects the bundle, renders the self-contained HTML and
Markdown, and writes the ZIP (fflate, so it runs in the demo's service worker too); server and demo differ only in the
`ExportAssetReader` that fetches evidence bytes. `server/utils/trace-zip.ts` is unrelated — it stores rather than
deflates and exists for trace-blob reconstruction.

## Front end

### Pages (`app/pages/`)

`/` dashboard home · `/projects` + `/projects/[id]` · `/projects/[id]/test-functions` (the browser extension's
function catalog — add by hand, via AI extraction from pasted code, or — with no AI configured — copy a prompt for
your own AI chat and paste its reply back in) · `/projects/[id]/selections` (test selections — builder with live
preview and the runnable command) · `/test-runs/[id]` · `/test-cases/[id]` (stable
case across runs) · `/test-run-cases/[id]` (one execution) · `/failure-clusters/[id]` · `/analytics` · `/settings/*` ·
`/docs` (in-app API reference) · `/mcp` · `/login`, `/forgot-password`, `/reset-password` (public, layout-free).

`/test-run-cases/[id]` is **diagnosis-first**: a failing execution opens on a **Diagnosis** tab (full-width error card,
then a right rail of verdict/cluster/AI cards beside a left evidence funnel); a passing one opens on **Steps** with an
**Artifacts** tab. Both keep **Performance** and **History**. The tab is synced to `?tab=` with legacy aliases, and the
page `provide`s a section locator so an AI citation can reveal and scroll to the matching evidence block.

### Components (`app/components/`)

Domain subfolders, all auto-imported **without a folder prefix** (`pathPrefix: false`), so names are globally unique:

| Folder                                                                  | Scope                                                                                                                |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `shared/`                                                               | Cross-page primitives and widgets — see below                                                                        |
| `run/`                                                                  | Run detail: summary, cases table, workers timeline, comparison, slow endpoints, failure groups, reports              |
| `test-case/`                                                            | Single-execution detail: summary, verdict, cluster card, AI card, evidence, console/network, DOM/ARIA, history       |
| `cluster/`                                                              | Failure-cluster detail: summary, per-case evidence tabs, investigation + baseline picker, commit browser             |
| `diagnosis/`                                                            | AI diagnosis panel: context preview + coverage strip, result with evidence citations, export                         |
| `project/`                                                              | Project detail charts, flaky list, cluster list, SCM changes, subscribe bell                                         |
| `analytics/`                                                            | Cross-project widgets: scorecard, heatmaps, leaderboards, trend charts, insights feed                                |
| `home/`, `layout/`, `settings/`, `apps/desktop/`, `apps/docs/`, `demo/` | Home filters; app shell/nav; settings surfaces; desktop-only cards; in-app API reference; demo-only banner/simulator |

Shared building blocks worth knowing before writing new markup (`AGENTS.md` makes reuse a rule):

- **Structure** — `SectionCard` (standard icon/title/count/subtitle header, `actions` + `footer` slots),
  `CollapsibleSectionCard` (same contract + required `storageKey`, cookie-persisted fold state via `useFoldedState`,
  `#folded` peek slot), `FoldableSummary`, `DetailPageLayout` (summary + tabs + panels with correct flex height at `lg`+,
  single-document scroll below), `SummaryMetaStrip` + `MetaStripGroup` (the wrapping fact-group footer of detail
  summary cards).
- **States** — `EmptyState`, `LoadingState`, `ErrorState` (with an `action` slot).
- **Data display** — `StatTile` + `StatTileGrid` (auto-fitting, no per-page breakpoints), `TableScroller`,
  `FilterToolbar`, `ChartCard` (header + `legend`), the SVG chart primitives `ChartFrame` (self-measuring plot area,
  y-axis) / `ChartTooltip` / `ChartMarkerLines` / `ChartLegend` / `ChartMarkerTooltip`, `MiniRunBars`,
  `DurationValue` (tight `210ms` via
  the pure `splitDuration`), `CodeBlock`, `MarkdownPreview`, `DiffPatch` / `DiffFile`, `LocatorCode` (a locator
  expression syntax-highlighted through `@piwitests/picker-dom`'s `tokenizeLocator`), `ErrorText` (error text with
  its ANSI colors rendered — a one-line `line` preview for lists and cells, or the full `block`).
- **Navigation & actions** — `NavbarActions` (every `UDashboardNavbar` `#right` group; labels collapse to icons below
  `xl`), `BreadcrumbNav` (drop-in for `UBreadcrumb` and the page title of every detail page — the navbar never
  repeats it; only the current crumb truncates, middle levels hide below `2xl`, ancestors collapse into a dropdown
  below `sm`), `OpenInIdeLink` +
  `OpenInIdeSettingsModal`, `DocLink`, `LinkChip` / `EntityLinks`.
- **Help & settings** — `HelpHint` (topic keys from `app/utils/help-content.ts`), `SettingsField`, `EnvManagedBadge`,
  `EnvManagedAlert`.
- **Domain widgets** — `RunStatusBadge`, `StatusChip` (status icon + label in one badge, for detail summaries),
  `TestStatusBar`, `TagBadge` / `TagsSelect`, `BrowserBadge`, `MarkerBadge` / `MarkerFormModal`,
  `ZoomableImage` (a click / keyboard-accessible image with a hover "Enlarge" affordance) driving
  `ScreenshotLightbox` (full-screen, keyboard-navigable, with an actual-size zoom toggle for large captures),
  `VideoPlayer`, `TraceListItem`, `LocatorHealingPanel` / `LocatorAlternativeRow`,
  `SnapshotLocatorPicker`, `EnvironmentDiffCard`, `DataLocationCard`.

### Composables & utils

`app/composables/` covers cross-component state and behaviour — auth and dashboard shell, run streaming
(`useRunStream`, `useNotificationStream`), diagnosis (`useClusterDiagnosis`, `useStreamingDiagnosis`,
`useDiagnosisNotification`), timeline (`useTimelineModel`, `useTimelineViewport`), fold/tree state
(`useFoldedState`, `useFoldableSummary`, `useTreeViewCookie`), settings derivation (`useSettingsNav`,
`useSettingsEnvState`), analytics scope, the run page's retry command (`useRunRetryCommand` — one failing set and one
shared mode for every copy button on the page), IDE preferences (`useOpenInIde`), desktop detection (`useIsDesktop`,
`useTauri`), demo helpers, and small utilities (`useCopy` / `useCopyRich` — use these instead of hand-rolling
`navigator.clipboard`, `useAiStatus`, `useChartTooltip`).

`app/utils/` holds pure helpers: `index.ts` (`formatDuration`, `splitDuration`, `getStatusColor`, `getFileApiPath`,
`formatRelativeTime`, `createSortHeader`, `formatBytes`, `errorMessage`, patch/commit helpers, cluster colour maps),
`performance-hints.ts`, `ide-links.ts`, `help-content.ts`, `settings-metadata.ts`, `openapi.ts` / `openapi-console.ts`,
`status-palette.ts` (`STATUS_PALETTE` / `statusPalette` — the test outcome colors every bar, chart, history cell,
timeline bar and filter chip uses, backed by the `--color-status-*` tokens in `assets/css/main.css`), `pass-rate.ts`
(the one threshold set and color scale for every colored pass rate, heatmap cells included), `chart.ts` (the
per-chart series definitions the plots and their legends share, and the tick/stack/bar geometry behind the SVG
charts). `retry-command.ts` (`buildRetryCommand` — `file-line` / `grep` / `file` modes,
shell-escaped, capped at 4096 chars) and `locator-edit.ts` (`buildLocatorEdit` — rewrite the failing locator call on a
source line) now live in `shared/` so the server and demo share them (the fix plan builds the same verify command and
edits); thin `app/utils/` re-export shims keep them auto-imported. Locator-line edits become a git-applyable unified
diff via `shared/heal-edit.ts` (`buildHealEdit` / `buildUnifiedLineDiff`), and `shared/callsite-location.ts`
(`parseCallsiteLocation`) parses a captured `file:line:col` (drive-letter-safe).

## Demo SPA

`PIWI_DEMO_MODE=true` builds a client-only SPA: a PWA service worker (`app/service-worker/demo-sw.ts`) intercepts
`/api/` and serves it from in-browser sql.js (WASM SQLite) through Drizzle, persisted in IndexedDB. `app/demo/api/router.ts`
dispatches to per-domain handlers that mirror the server; `app/demo/db.client.ts` is shared by SW and main thread.
Live updates use a BroadcastChannel instead of SSE. Rules and invariants: see `AGENTS.md`.

## Key features

Auto-created projects on first submission · run ingest by JSON, multipart upload or live streaming (with shard merge and
crash recovery) · HTML reports, traces, videos and screenshots stored under `.data/storage/` with relative paths ·
flaky detection with root-cause classification and impact scoring · failure clustering with semantic merge suggestions ·
AI diagnosis grounded in real SCM diffs, optionally two-stage · locator healing · timeline markers · notifications
(email, Slack, webhook, browser) · an MCP server for AI agents · optional auth with project-level permissions ·
retention and storage housekeeping · offline export of an execution or a cluster as self-contained HTML, a ZIP of the
raw evidence, or a printed PDF.
