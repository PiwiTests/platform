# Piwi Dashboard — Agent Instructions

> **Note:** Piwi Dashboard is **not affiliated with, endorsed by, or connected to Microsoft Corporation** in any way.  
> The name "Piwi" was chosen as a playful, unrelated name — it has no connection to any existing product or brand.  
> Piwi Dashboard was originally called "Playwright Dashboard" and was renamed to avoid any confusion with Microsoft's Playwright testing framework.

This file provides project context for any AI agent (opencode, Copilot, Cursor, etc.).

## Project Overview

Piwi test results dashboard built with **Nuxt 4**, Nuxt UI dashboard template. Stores and displays Playwright test results organized by projects.

## Prerequisites

- Node.js 24+, npm, Git
- Commands run from `application/` unless noted

## Repository Structure

```
application/            — Nuxt 4 dashboard app
application/shared/     — Shared types, constants & utilities
application/tests/      — Functional tests (Playwright)
plans/                  — Design docs, audit plans & roadmap (see below)
reporter/               — Custom Playwright reporter package (TypeScript → compiled JS)
```

> **Global tracking files:** 
> - `plans/roadmap.md` — single source of truth for product direction, priorities, and progress
> - `plans/exploration-findings.md` — log of bugs, tech debt, inconsistencies, and non-critical issues discovered during exploration (auto-appended by agents)
> 
> Detailed per-feature implementation plans live alongside them. (`plans/` is gitignored, so these are local working docs, not committed.)

## Quick Start

```bash
cd application
npm install
npm run dev          # http://localhost:3000
```

SQLite database auto-initializes on first API call.

## Architecture

### Shared types (`application/shared/types.ts`)
- `TestCasePayload`, `StreamEventPayload`, `TestRunFinishPayload` — API payload shapes
- `TestRunStatus`, `TestCaseStatus` — status type unions
- Server endpoints import directly from `../../../shared/types`
- Reporter uses structural typing (no direct import) to avoid leaking paths into `.d.ts`

### Database
- **ORM**: Drizzle ORM (SQLite via libSQL, or PostgreSQL via postgres.js)
- **Schema**: `application/server/database/schema.ts`
- **Migrations**: `application/server/database/migrations/` (SQLite) or `migrations-pg/` (PostgreSQL, auto-run on startup based on `PIWI_DATABASE_URL`)
- **Tables**: `projects`, `test_runs`, `test_cases`, `test_runs_cases`, `failure_clusters`, `failure_diagnoses`, `app_settings`, `files`, `trace_resources`, `trace_blobs`, `tags`, `project_tags`, `users`, `api_keys`, `account_tokens`, `notification_channels`, `subscriptions`, `notification_deliveries`
- `users` has `email` (unique, nullable) and `emailVerified` (boolean) columns added
- `account_tokens`: single-use SHA-256-hashed tokens for reset/invite/verify; purpose enum; TTL enforced at query time
- `notification_channels`: email/slack/webhook destinations; webhook secrets AES-256-GCM encrypted via `crypto.ts`
- `subscriptions`: links a user to a channel + optional project; `events` JSON array; `filters` JSON; `mode` realtime/digest; `mutedUntil` timestamp; `active` boolean
- `notification_deliveries`: outbox table; `dedupeKey` unique constraint for idempotency; `status` pending/sent/failed/skipped; `attempts` + `scheduledFor` for progressive retry (1/5/15/60/240 min backoff)
- **Audit**: See `plans/` for schema audit plans with findings and recommended changes

### Backend (server/api/)
Nuxt file-based routing:
- `GET /_openapi.json` — Auto-generated OpenAPI 3.1 spec (enabled via `nitro.experimental.openAPI`)
- `GET /docs` — Interactive API reference UI (Scalar) generated from the OpenAPI spec
- `POST /api/test-runs/submit` — Submit JSON test results
- `POST /api/test-runs/upload` — Upload with HTML reports + traces
- `POST /api/test-runs/start` / `[id]/events` / `[id]/finish` — Streaming protocol (live runs)
- `POST /api/test-runs/[id]/case-files` — Upload one case's trace + attachments during a streaming run (streamToken auth, idempotent, publishes `case-files` SSE event)
- `GET /api/projects` — List projects with stats (heavy: runs, test case counts, reports, tags)
- `GET /api/projects/menu` — Slim project list for sidebar navigation (`id`, `name`, `label` only; one SELECT, no joins)
- `GET /api/projects/[id]` — Project details + runs
- `GET /api/test-runs/[id]` — Run details + cases
- `GET /api/test-cases/[id]` — Case details + steps, web vitals, network requests
- `GET /api/test-cases/[id]/traces` — Trace files for a test case
- `GET /api/test-cases/[id]/history` — Execution history across runs
- `GET /api/files/[...path]` — Download reports/traces
- `GET /api/projects/[id]/flaky-tests` — Cross-run flakiness analysis (retry-pass + alternation detection)
- `GET /api/failure-clusters/[id]/diagnosis` — Stored AI diagnosis + saved `manualBaseCommit` for a cluster
- `POST /api/failure-clusters/[id]/diagnose` — Run AI diagnosis synchronously; 503 if unconfigured; accepts `baseCommit`, `selectedCommitShas`, `additionalContext`, `images` in body
- `PATCH /api/failure-clusters/[id]/base-commit` — Persist a manual baseline commit SHA for a cluster
- `GET /api/failure-clusters/[id]/commits` — Recent commits for the cluster's repo with `limit` and `hasMore`; includes aggregate diff when `baseline` query param is provided
- `GET /api/failure-clusters/[id]/commit-diff` — Diff (files + patches) for a single commit SHA (`?sha=`)
- `GET /api/failure-clusters/[id]/context` — Preview the full AI context that would be sent; accepts `baseCommit` and `selectedCommitShas` query params
- `GET /api/ai/status` — Public AI configuration status (never returns the key)
- `GET /api/settings/ai` — Admin: full AI settings including `hasApiKey`, `envManaged`
- `PUT /api/settings/ai` — Admin: save provider/model/key/baseUrl/autoDiagnose
- `POST /api/settings/ai/test` — Admin: smoke-test the configured AI provider
- `GET /api/settings/smtp` — Admin: SMTP display config (host/port/user/from; never returns password); `envManaged: true`
- `POST /api/settings/smtp/test` — Admin: send test email to `{ to }` via env-configured SMTP
- `POST /api/auth/forgot-password` — Public, rate-limited (5/15 min/IP); sends reset email; always returns `{ success: true }` (no enumeration)
- `POST /api/auth/reset-password` — Public; accepts `{ token, password }`; accepts both `reset` and `invite` token purposes; single-use
- `POST /api/auth/change-password` — Authenticated; `{ currentPassword, newPassword }`
- `GET /api/auth/verify-email?token=` — Public; marks email verified; redirects to `/settings/account?verified=1`
- `POST /api/auth/send-verify-email` — Authenticated; mints a `verify` token and emails it
- `POST /api/users/[id]/invite` — Admin; sends invite email with a reset-password link (mode=invite)
- `PATCH /api/users/[id]` — Admin; update name, email, or role
- `GET /api/channels` — Authenticated; lists user's channels + global channels (admins see all)
- `POST /api/channels` — Authenticated; creates channel; admins can set `global: true`; webhook secrets encrypted at rest
- `DELETE /api/channels/[id]` — Authenticated; owner or admin
- `POST /api/channels/[id]/test` — Authenticated; sends a test delivery through the channel
- `GET /api/subscriptions?projectId=` — Authenticated; lists subscriptions with joined channel info; optional projectId filter
- `POST /api/subscriptions` — Authenticated; `{ channelId, projectId?, events[], filters?, mode, digestAt? }`
- `PATCH /api/subscriptions/[id]` — Authenticated; update events/filters/mode/digestAt/mutedUntil/active
- `DELETE /api/subscriptions/[id]` — Authenticated; owner or admin

### Frontend (app/)
- **Pages** (`app/pages/`):
  - `/` — Dashboard home with stats
  - `/projects` — Project list
  - `/projects/[id]` — Project detail
  - `/test-runs/[id]` — Run detail
  - `/test-cases/[id]` — Case detail (detailed revamp: traces, run context, AI fix prompt, timing comparison, improved error display)
- **Components** (`app/components/`): organized into domain subfolders; all auto-imported without folder prefix (Nuxt `pathPrefix: false`).
  - **`shared/`** — UI primitives used across multiple pages: `RunStatusBadge`, `TestStatusBar`, `RunReports`, `TagBadge`, `TagsSelect`, `BrowserBadge`, `CiEnvCard`, `SourceInfoCard`, `CodeBlock`, `MarkdownPreview`, `ScreenshotLightbox`
  - **`run/`** — Test run detail page (`/test-runs/[id]`): `RunSummary` (summary card + CI/Source/Other metadata), `TestCasesList` (paginated table, sticky headers, row highlighting via `meta.class.tr`), `WorkersTimeline` (clickable bars, emits `selectTestCase`), `RunCompare` (self-contained, watches internal `compareRunA`), `SlowEndpoints` (fetches `/api/test-runs/:id/network-requests` internally), `FailureGroups`, `RunReports`
  - **`test-case/`** — Test case detail page (`/test-cases/[id]`): `TestCaseStatusCard` (title, location, duration, retries, worker, slowest step, timing vs avg), `TestCaseSummary`, `TestCaseRunContext` (environment, CI, branch, commit, browser), `TestCaseTracesCard`, `TestCaseErrorCard` (copy button, collapsible errors, cluster info row), `TestCaseConsoleCard`, `TestCaseAttachmentsCard`, `TestCaseHistoryChart`, `TestEvidenceSection`, `TestEvidenceScreenshots`, `TestEvidenceSignals`, `TestEvidenceTraces`
  - **`cluster/`** — Failure cluster detail (`/failure-clusters/[id]`): `ClusterDiagnosis` (AI diagnosis panel: commit picker, context preview, run/re-run, result display), `CommitPicker` (baseline selector with aggregate diff stats, caches per baseline), `CommitBrowserModal` (full-screen split modal: paginated commit list + per-commit diff), `ClusterInvestigation`, `ClusterTestEvidence`, `RegressionContext`
  - **`project/`** — Project detail page (`/projects/[id]`): `PassRateChart`, `PerformanceTrendChart`, `TestRunsChart`, `FlakyTestsList` (score badges, retry-pass / alternation breakdown), `FailureClustersList`, `ScmChangesView`, `SubscribeBell` (notification subscribe popover; hidden when auth disabled)
  - **`layout/`** — App shell / navigation: `ProjectsMenu`, `UserMenu`, `GetStartedWizard`
  - **`demo/`** — Demo mode only: `DemoBanner`, `DemoInitScreen`, `DemoSimulator`
  - **Shared building blocks in `shared/`** (prefer these over re-implementing):
    - `SectionCard` — `UCard` with a standard header: optional `icon` (+ `iconClass`), `title`, optional `(count)` and `subtitle` (prop or `subtitle` slot). `actions` slot for header-right controls, `footer` slot forwarded to `UCard`. Use for any card that needs an icon/title (and optional description) header.
    - `EmptyState` / `LoadingState` / `ErrorState` — centered empty/loading/error blocks (`ErrorState` has an `action` slot for a retry button). Default `py-8` padding, disable with `:padded="false"`.
    - `ChartLegend` — `{ color, label }[]` legend dots (use `dense` for inline charts).
    - `DiffPatch` (colored unified-diff lines) and `DiffFile` (file card: sticky header + `DiffPatch`). Use for any SCM patch rendering.
- **Composables** (`app/composables/`):
  - `useAiStatus.ts` — Fetches `GET /api/ai/status` once; shared across components to show/hide AI actions
  - `useCopy.ts` — `{ copy, copied }` clipboard helper (wraps VueUse `useClipboard`); `copy(text, { toast })`. Use instead of hand-rolling `navigator.clipboard` + a `copied` flag.
  - `useChartMarkers.ts` — Shared interactive SVG-marker + floating-tooltip logic for the `@unovis/vue` trend charts. Returns `{ tooltipData, tooltipPos, onRenderComplete }`; bind `:on-render-complete` on the `VisXYContainer`.
- **Pages** (`app/pages/`):
  - `/settings/account` — Email address + verification, change password, OAuth provider info (auth-gated)
  - `/settings/notifications` — SMTP status card (read-only from env), notification channels CRUD, subscription list with mute/delete
  - `/settings/ai` — AI diagnosis configuration (provider, model, API key, base URL, auto-diagnose toggle)
  - `/forgot-password` — Public, layout-free; no user enumeration in UI
  - `/reset-password` — Public, layout-free; handles both reset and invite (`?mode=invite`) flows
- **Utilities** (`app/utils/`):
  - `performance-hints.ts` — Generates performance warnings for slow/flaky tests
  - `index.ts` — Shared helpers: `formatDuration`, `getStatusColor`, `getFileApiPath`, `formatRelativeTime`, `createSortHeader`, `formatBytes`, `errorMessage` (unwrap `$fetch` errors), `filterCommits`, `scmFileStatusMeta`, `parsePatchLines`/`patchLineClass`, `clusterStatusColor`, `clusterErrorTypeColor`

### Reporter
- `reporter/src/index.ts` — Entry point (re-exports class + `createGlobalSetup`)
- `reporter/src/reporter.ts` — `PiwiDashboardReporter` (Playwright hooks + running counters; hands off to `RunSubmitter`)
- `reporter/src/run-submitter.ts` — `RunSubmitter` class (the three-tier submit/fallback ladder: streaming → multipart → JSON → recovery)
- `reporter/src/config.ts` — `PiwiDashboardOptions` interface + defaults + centralized `PIWI_*` env map (`PIWI_ENV_KEYS`, `resolveOptions`, `applyOptionsToEnv`)
- `reporter/src/config-wrapper.ts` — `wrapConfig` (injects reporter + global setup into a Playwright config)
- `reporter/src/helpers.ts` — `getSetupFilePath`, `computeInstanceId`, `workerIndexOf`, `createGlobalSetup`
- `reporter/src/http-client.ts` — `HttpClient` class (one `request()` core with socket timeout; login/postJSON/postFormData)
- `reporter/src/uploader.ts` — `Uploader` class (upload strategies: JSON, multipart, streaming files)
- `reporter/src/serializer.ts` — Pure serializers: `toWireTestCase`, `serializeRun`, `resolveOverallStatus` (single source of truth for the wire field list)
- `reporter/src/types.ts` — Reporter-local domain model (`CollectedTestCase`, `WireTestCase`, `StreamEvent` discriminated union). Structurally compatible with `shared/types.ts` but not imported from it (avoids leaking the monorepo path into the published `.d.ts`)
- `reporter/src/logger.ts` — `Logger` class (owns the `[Piwi Dashboard]` prefix and the verbose gate; replaces ~46 hand-typed prefixes + scattered `verbose` constructor params)
- `reporter/src/stream-manager.ts` — `StreamManager` class (event batching, retry/backoff, live file uploads; tracks uploaded cases in a `WeakSet` instead of a `_filesUploaded` side-channel on the data object)
- `reporter/src/stream-buffer.ts` — `StreamBuffer` class (persistent event buffer)
- `reporter/src/crash-recovery.ts` — `CrashRecovery` class (recovery data)
- `reporter/src/file-handler.ts` — `FileHandler` class (report/trace/attachment ops; single-case trace hashing)
- `reporter/src/metadata-collector.ts` — `MetadataCollector` class (CI/SCM/browser config + suite-hierarchy metadata; owns all Playwright-internal suite access via `getSuiteInfo`/`getBrowserConfig`)
- `reporter/src/step-analyzer.ts` — Pure functions (step analysis, performance)
- `reporter/src/compression.ts` — Directory gzip archiver
- `reporter/src/fixtures.ts` — Playwright fixtures for network/web-vitals/console
- `reporter/package.json` — NPM package
- Source is TypeScript (`.ts` in `src/`); compile with `npm run reporter:build` to produce `.js` + `.d.ts` in `dist/`

## Key Features
- Auto-create projects on submission
- Stores: status, duration, errors, HTML reports (full directory with assets), trace files
- File storage: `.data/storage/` — paths stored relative to storage dir
- REST + multipart upload APIs
- Auto-generated OpenAPI 3.1 spec at `/_openapi.json` with interactive Scalar UI at `/docs`

## Code Style
- Keep it simple (AI-friendly codebase)
- Full TypeScript, Nuxt 4 conventions, Nuxt UI components
- Sentence case in UI (e.g., "Test runs"), relative dates with date-fns, human-readable durations
- Use American English spelling throughout (e.g., "initialize", "organize", "color")
- **Extract shared Vue components** when the same block of template exceeds ~10 lines and appears more than once — avoid duplicating markup with identical logic across components
- **Never duplicate logic between server and demo code.** Both `server/` and `app/demo/api/` mirror each other (same DB schema, same persist logic). Any new utility function that would otherwise need to live in both places must be extracted into a shared module — either in `server/utils/` (demo imports via `~~/server/utils/...`) or `shared/` — and imported by both. Exceptions only when the implementation fundamentally differs (e.g., error handling, auth).
- **Capture global change requests**: when I ask you to apply a change across multiple files (e.g., "update all X to Y"), add a new instruction rule to `AGENTS.md` documenting that pattern so future edits follow the same convention
- **Flaky root cause classification**: Add new categories to `classifyFlakyRootCause()` in `server/utils/flaky-classify.ts`. Keyword arrays at the top of the file. New column `flaky_root_cause` on `test_cases` table. Include `rootCause` field in `FlakyTest` response type (`types/api.ts`). `FlakyTestsList.vue` renders it via `TagBadge` with root-cause color mapping.
- **Impact scoring**: Compute `wastedCiMinutes` and `impact` in `getProjectFlakyTests` (`shared/handlers/projects.ts`). Sort flaky tests by impact descending. Include `impact`, `wastedCiMinutes`, `avgFailedDurationMs` in `FlakyTest`. Color scale: green < 5min, amber < 30min, red >= 30min in UI.
- **Regression signals**: `isNewRegression` and `isNewFlaky` columns on `test_runs_cases` (integer, 0/1). Computed after run finish via `computeRegressionSignals()` (`server/utils/compute-regression-signals.ts`). Called from `finish.post.ts`. Included in `getTestRun` and `getTestRunCase` response mappers. `TestCasesList.vue` shows red "NEW" and purple "FLAKY" badges with checkbox filter toggles.
- **Spec health**: Endpoint `GET /api/projects/[id]/spec-health` groups by spec prefix. `SpecHealthHeatmap.vue` renders pass-rate colored cells. Add `spec-health` to `validTabs` and `tabItems` in project `index.vue` page.

## Environment
- `.env.example` in `application/` — `PIWI_SITE_URL` (optional)
- Works with no env vars set; `.data/` created automatically
- `PIWI_SECRET_KEY` — master key for AES-256-GCM encryption of secrets stored in the DB (AI API keys, SCM tokens). Recommended in production even without auth enabled. Generate with `openssl rand -hex 32`. Falls back to an insecure default in development.
- AI diagnosis env vars (all optional — can also be set via Settings UI):
  - `PIWI_AI_PROVIDER` — `anthropic` or `openai`
  - `PIWI_AI_API_KEY` — API key (env takes precedence over DB; `envManaged: true` in status)
  - `PIWI_AI_MODEL` — model name (default: `claude-opus-4-8` for Anthropic)
  - `PIWI_AI_BASE_URL` — base URL for OpenAI-compatible providers (e.g. `http://localhost:11434/v1`)
  - `PIWI_AI_AUTO_DIAGNOSE` — `true` to auto-diagnose new clusters on run finish
- AI diagnosis **context limits** — cap how much evidence (and tokens) go into each diagnosis. Defaults live in `shared/ai-context-limits.ts`; resolved as defaults ← stored settings (`ai_context_limits` in `app_settings`) ← env (`server/utils/ai-context-limits.ts#resolveContextLimits`). Editable in Settings → AI, or pinned via env (env wins, UI shows the field read-only). Env vars: `PIWI_AI_MAX_SAMPLE_ERROR_CHARS`, `PIWI_AI_MAX_SCM_PATCH_BUDGET`, `PIWI_AI_MAX_AFFECTED_TESTS`, `PIWI_AI_MAX_STEPS`, `PIWI_AI_MAX_CONSOLE_ENTRIES`, `PIWI_AI_MAX_CONSOLE_ENTRY_CHARS`, `PIWI_AI_MAX_NETWORK_REQUESTS`, `PIWI_AI_MAX_ARIA_SNAPSHOT_CHARS`, `PIWI_AI_MAX_TEST_SOURCE_CHARS`.
- SMTP email env vars (all required for email features; read-only in Settings UI — not stored in DB):
  - `PIWI_SMTP_HOST` — SMTP hostname
  - `PIWI_SMTP_PORT` — port (default: `587`)
  - `PIWI_SMTP_USER` — SMTP username
  - `PIWI_SMTP_PASS` — SMTP password (never returned by API)
  - `PIWI_SMTP_FROM` — from address (`noreply@example.com`)
  - `PIWI_SMTP_FROM_NAME` — display name (optional)
  - `PIWI_SMTP_SECURE` — `true` for port 465 TLS (default: `false`)
  - `PIWI_SITE_URL` — public base URL used in email links (e.g. `https://piwi.example.com`)

## Dev Commands (from `application/`)

| Command | Purpose |
|---------|---------|
| `npm install` | Install deps |
| `npm run app:dev` | Dev server |
| `npm run app:build` | Production build |
| `npm run app:typecheck` | TypeScript check |
| `npm run app:lint` | oxlint |
| `npm run app:lint:fix` | oxlint (auto-fix) |
| `npm run app:format` | oxfmt (format files) |
| `npm run app:format:check` | oxfmt (check formatting) |
| `npm test` | Run functional tests |
| `npm run db:generate` | Generate migration |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema (dev only) |
| `npm run db:studio` | Drizzle Studio |
| `npm run app:seed:demo` | Regenerate demo seed data |
| `npm run app:generate:demo` | Build demo SPA |
| `npm run app:check:demo` | Verify demo routes |
| `node scripts/db-query.mjs "<sql>"` | Query the local SQLite DB directly |

**DB query examples** (run from `application/`):
```bash
node scripts/db-query.mjs "SELECT key, value FROM app_settings"
node scripts/db-query.mjs "SELECT id, name FROM projects" --json
```

### Reporter commands (from `reporter/`)

| Command | Purpose |
|---------|---------|
| `npm run reporter:build` | Compile TypeScript (from `src/`) to `.js` + `.d.ts` (in `dist/`) |
| `npm run reporter:dev`   | Watch mode — auto-recompile on changes |
| `npm run reporter:format`| Format source code with oxfmt |
| `npm run reporter:test`  | Run unit tests with `tsx --test` |
| `npm run lint`           | Lint with oxlint               |
| `npm run lint:fix`       | Lint with auto-fix             |

## Making Changes

...**Reporter**: Edit `.ts` files in `reporter/src/` → `npm run reporter:build` (from `reporter/`) → test with `npm link`

### Source files

| Path                          | Responsibility                              |
|-------------------------------|---------------------------------------------|
| `src/reporter.ts`             | Orchestrator — Playwright hooks + fallback  |
| `src/config.ts`               | Options interface + defaults                |
| `src/http-client.ts`          | HTTP transport layer                        |
| `src/uploader.ts`             | Upload strategies (JSON, multipart)         |
| `src/stream-buffer.ts`        | Persistent JSONL buffer                     |
| `src/crash-recovery.ts`       | Recovery data management                    |
| `src/file-handler.ts`         | Report/trace/attachment file operations     |
| `src/metadata-collector.ts`   | CI, SCM, Playwright config metadata         |
| `src/step-analyzer.ts`        | Step categorization + performance analysis  |
| `src/helpers.ts`              | Pure utility functions                      |
| `src/compression.ts`          | Directory gzip archiver                     |
| `src/config-wrapper.ts`       | `wrapConfig` — injects Piwi `globalSetup` into a Playwright config |
| `src/fixtures.ts`             | Playwright fixtures                         |
| `src/index.ts`                | Package entry point (class + `wrapConfig` + types) |

## Key server utilities

| File | Purpose |
|------|---------|
| `server/utils/email.ts` | `getSmtpConfig()`, `isEmailConfigured()`, `sendEmail({to,subject,html,text})` (lazy transport, no-op if unconfigured), template renderers for reset/invite/verify/test/run-notification emails |
| `server/utils/account-tokens.ts` | `mintAccountToken(db, userId, purpose)` → plaintext (SHA-256 stored), `validateAccountToken`, `consumeAccountToken`; TTLs: reset=1h, verify=24h, invite=72h |
| `server/utils/rate-limit.ts` | `checkRateLimit(key, limit, windowMs)` — simple in-memory sliding-window rate limiter |
| `server/utils/notifications/match.ts` | `matchAndEnqueue(db, event, payload)` — queries active subscriptions, applies filters (branch/status/mute/threshold), inserts `notification_deliveries` rows with dedupeKey |
| `server/utils/notifications/dispatch.ts` | `sweepOutbox(db)` — dispatches pending deliveries to email/Slack/webhook; handles retry backoff; webhook uses HMAC-SHA256 `X-Piwi-Signature` |
| `server/utils/notifications/emit.ts` | `emitNotification(db, event, payload)` — gates on `isAuthEnabled`, calls matchAndEnqueue then kicks sweepOutbox fire-and-forget |
| `server/utils/notifications/run-notifications.ts` | `emitRunNotifications(db, runId)` — emits `run.finished` / `run.failed` / `run.failed.default_branch` / `cluster.new` after run finalization |
| `server/tasks/notifications/sweep.ts` | Nitro scheduled task (`notifications:sweep`) — calls `sweepOutbox(db)` every minute |
| `shared/notification-events.ts` | `NOTIFICATION_EVENTS` tuple, `NotificationEvent` type, payload interfaces, `renderEventSubject(event, payload)` |

## Authentication & Authorization

- **Roles are defined as a TypeScript string enum** (`Role` in `shared/types.ts`): `ADMINISTRATOR`, `REPORTER`, `USER`. Use `Role.ADMINISTRATOR` etc. everywhere — never raw string literals.
- **Auth is optional**: enabled by `PIWI_AUTH_ENABLED=true` env var. When disabled, `requireAuth()` returns a virtual admin user, so all endpoints work without auth.
- **Two auth methods** (when enabled): session cookie (browser) or API key (Bearer token or `X-API-Key` header, `pd_` prefix).

### Endpoint Auth Requirements (MUST follow)

All endpoints MUST call `requireAuth(event)` or `requireAuth(event, [roles])` at the top of the handler:

| Role array | Who can access | Used for |
|---|---|---|
| no arg (any authenticated) | Any logged-in user | Read endpoints: project list, run details, test cases, clusters, etc. |
| `[Role.ADMINISTRATOR, Role.REPORTER]` | Reporter + Admin | Submitting test results, uploading, streaming runs, trace checks, failure cluster triage |
| `[Role.ADMINISTRATOR]` | Admin only | User management, settings, project CRUD, tags, admin endpoints |
| `[Role.ADMINISTRATOR, Role.REPORTER, Role.USER]` | All roles | Self-service API key management |

- **Streaming protocol** endpoints (`begin`, `events`, `finish`, `case-files`) use **stream token** auth (not `requireAuth`) — the token is validated against the stored run's `streamToken`.
- **Public endpoints** (no auth required): `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/setup`, OAuth flow endpoints, `GET /api/ai/status`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `GET /api/auth/verify-email`.

### Implementing Auth on a New Endpoint

```typescript
import { Role } from '../../../shared/types';
import { requireAuth } from '../../utils/auth';

export default eventHandler(async (event) => {
  await requireAuth(event, [Role.ADMINISTRATOR]); // or plain requireAuth(event)
  // ...
});
```

When the `User` type from DB has `role: string`, cast to `Role`: `user.role as Role`.

### OpenAPI Security Annotations

- Every endpoint has a `defineRouteMeta` block with `openAPI` metadata — this is non-negotiable.
- Auth/public distinction is documented via the `security` field:
  - **Public endpoints** (auth, ai/status): `security: []`
  - **All other endpoints**: inherit root-level `security: [{ bearerAuth: [] }, { sessionCookie: [] }]` defined in `nuxt.config.ts`.
- The root `nuxt.config.ts` defines `components.securitySchemes` with `bearerAuth` (API key) and `sessionCookie` (session) schemes. The `meta` is type-cast with `as any` to allow these extra OpenAPI fields — this is intentional.
- When adding a new endpoint, include `security: []` ONLY if it's truly public. All other endpoints inherit the default security automatically.

### Project-level Permissions

A **project assignment** layer sits atop the role system:

- **`ADMINISTRATOR`**: full access to all projects, never filtered, no assignment needed.
- **`REPORTER`** and **`USER`**: only see projects they're assigned to. Assignment can be **per-project** (list of project IDs) or **global** (all projects, `projectId = null`).
- **Default**: no assignments = no access. Existing users get backfilled with global access on upgrade.

Key implementation details:

- **Schema**: `project_assignments` table in both `schema.sqlite.ts` and `schema.pg.ts` with `userId` (FK users, cascade), `projectId` (nullable FK projects, cascade = global), `createdBy`, `createdAt`.
- **Authorization**: `server/utils/project-access.ts` — `getProjectScope(db, user)` returns `'all' | Set<number>`. `requireProjectAccess(event, projectId, roles?)` combines role + scope check. Admin/auth-off short-circuits to `'all'`.
- **List filtering**: Pass `scope` to shared handlers (`listProjects(db, scope)`, `getProjectMenu(db, scope)`, `getRecentTestRuns(db, scope)`, `searchProjectsTestRunsCases(db, q, scope)`). Empty set → `[]` immediate return.
- **Route verification**: Use `requireProjectAccess(event, projectId)` (or `resolveRunProjectId`/`resolveCaseProjectId`/`resolveClusterProjectId` + `requireProjectAccess`) in scoped endpoints instead of plain `requireAuth`.
- **Write endpoints** (`submit`, `upload`, `start`, `setup`): Existing project → `scopeAllows(scope, projectId)`. New project creation → only if `scope === 'all'`.
- **Management API**: `GET/PUT /api/users/[id]/projects` (per-user) and `GET/PUT /api/projects/[id]/members` (per-project), both admin-only.
- **Backfill**: Runs idempotently after DB migrations in `server/database/index.ts`. Gives all existing `USER`/`REPORTER` rows a global `projectId = null` assignment.
- **403 everywhere**: Role refusal AND scope refusal both return 403 with an explicit message.

## Making Changes

- **DB fields**: Update `schema.ts` → `npm run db:generate` (or `db:generate:pg` for PostgreSQL) → review migration → restart
  ⚠ Never create migration files or edit `_journal.json` manually — always use `npm run db:generate`.
- **API endpoints**: Create file in `server/api/` → use `eventHandler()` + `getDatabase()`
- **OpenAPI annotations**: Add `defineRouteMeta({ openAPI: { tags, summary, parameters, security, ... } })` to each new handler to appear in the auto-generated spec at `/_openapi.json` and `/docs`. Include `security: [{ bearerAuth: [] }]` for auth-required endpoints, `security: []` for public ones.
- **Pages**: Create Vue file in `app/pages/` → use `<UDashboardPanel>` + `useFetch()`
- **Components**: Create Vue file in the matching subfolder of `app/components/` (`shared/`, `run/`, `test-case/`, `cluster/`, `project/`, `layout/`, `demo/`) → all auto-imported without path prefix (Nuxt `pathPrefix: false`) → follow existing patterns:
  - Self-contained data fetching is preferred for tab content (use `watch` + `$fetch` or `useFetch` with `lazy: true`)
  - Pass props from parent page only for data already fetched at the page level
  - Use `v-if` for tab-switched components to ensure clean mount/unmount
- **Navigation**: Edit `app/layouts/default.vue` links array
- **Tests**: Create `.spec.ts` in `application/tests/` → run `npm test`
  - If the test creates a project, **add its name to `shared/test-project-names.ts`** (alphabetically sorted) so the global setup cleanup deletes it before the next run. Tests must use static project names, not `Date.now()` suffixes.
  - Use `PROJECT.YOUR_KEY` from `../shared/test-project-names` in test code instead of raw string literals. This ensures every project name is tracked in one place.
- **Reporter**: Edit `.ts` files in `reporter/src/` → `npm run reporter:build` (from `reporter/`) → test with `npm link`
- **Shared types** (`application/shared/types.ts`): Wire contract between reporter and server. Server imports directly; reporter uses structural typing (do NOT add `import type` from shared in reporter method signatures — it leaks the monorepo path into published `.d.ts` files)
- **Entity links** (`shared/link-detect.ts`): Pure utility for detecting external URL provider (Jira, GitHub, etc.) and extracting keys. Uses domain regex matching, no dependencies. Provider enum includes `jira`, `github-issue`, `github-pr`, `gitlab-issue`, `gitlab-mr`, `bitbucket`, `confluence`, `slack`, `linear`, `notion`, `generic`.
- **Retry command** (`app/utils/retry-command.ts`): Pure function `buildRetryCommand(cases, opts?)` that builds a Playwright CLI command string. Three modes: `file-line` (default, most precise), `grep` (by title, survives line shifts), `file` (broadest, deduped files). Groups by project, escapes shell args, caps at 4096 chars with fallback modes.
- **Entity Links API** (`server/api/links/`): CRUD endpoints for attaching external URLs to runs, test-case runs, or test cases. Uses three nullable FK columns (`test_run_id`, `test_runs_case_id`, `test_case_id`) with `ON DELETE CASCADE` — matches the `files` table pattern. Provider auto-detected on create. `entityType` query param accepts `test_run`, `test_runs_case`, or `test_case`. Write requires `[ADMINISTRATOR, REPORTER]` role, read requires any authenticated role. Embed links in existing GET responses (`test-runs/[id]`, `test-cases/[id]`).
- **Adding a field to test run data**: Add to `shared/types.ts` payload(s) → add column to both `schema.sqlite.ts` and `schema.pg.ts` → `npm run db:generate && npm run db:generate:pg` → update `types/api.ts` (frontend types) → update all API handlers (`submit`, `upload`, `[id]/events`, `[id].get`, `[id]/stream.get`, `test-cases/[id].get`) → update server utils (`persist-run-cases.ts`) → **update reporter**: add the field to `reporter/src/types.ts` (`CollectedTestCase` + `WireTestCase`), accumulate it in `reporter.ts` `onTestEnd`/`onTestBegin`, and project it in `reporter/src/serializer.ts` `toWireTestCase` (per-case) or `serializeRun` (run-level). `serializeRun` is the single source of truth for the run body — both `Uploader.uploadJSON` and `Uploader.uploadWithFiles` call it, so a run-level field only touches one serializer now. → update demo (`scripts/generate-demo-seed.mjs`, `demo/api/reporter.ts`, `demo/api/test-runs.ts`, `demo/api/test-cases.ts`, `demo/simulator.ts`) → update UI components that consume the new field → `npm run app:seed:demo`

### Sharding Pattern

When implementing or extending sharding support:

- **runLabel**: Detected from CI env vars (`GITHUB_RUN_ID`, `CI_PIPELINE_ID`, etc.) by `MetadataCollector.detectCiRunLabel()` (reporter) and `detectCiRunLabel()` (helpers.ts). Users override via `PiwiDashboardOptions.runLabel`. Applied in `createGlobalSetup` too.
- **instanceId**: When `runLabel` is set, `computeInstanceId(projectName, runLabel)` uses `projectName|runLabel` instead of `hostname|projectName`. All shards share the same instanceId.
- **Per-shard tokens**: Each shard gets its own stream token. The server stores them in `RunEventBus.runStates[id].shardTokens` (`Set<string>`). Validated in `/events` and `/finish` endpoints as fallback when the main `streamToken` doesn't match.
- **Shard detection**: Reporter reads `config.shard` (from `--shard` CLI) in `onBegin`. Server detects sharded runs by `shardTotal > 1` in request bodies.
- **Server-side merge**: `/start`, `/setup`, and `/submit` reuse an existing run when `shardTotal > 1` and an active run with the same `instanceId` already exists. `/finish` accumulates counters via SQL `+` and sets final status only when `shardsFinished === shardTotal`. `cancelInstanceRuns()` skips sharded runs when `isShardedRun: true`.
- **DB columns**: `test_runs.shardTotal` (nullable integer) and `test_runs.shardsFinished` (integer, default 0).
- **New endpoint handler pattern**: Always validate shard tokens alongside the primary `streamToken`: check `cachedState.shardTokens?.has(body.streamToken)` as fallback. Use `validateAndReviveRun()` with the `isShardToken` callback.

## UI Patterns

- **UTable sticky headers**: Use the `sticky` boolean prop + `max-h-*` class on the table root element. Do NOT wrap tables in `overflow-y-auto` divs — UTable's own root handles overflow when `max-h` is set.
- **Row highlighting**: Use `:meta="{ class: { tr: 'highlight-class' } }"` on UTable, NOT `:row-attrs` (which is unsupported in Nuxt UI v4).
- **Tab panels with summary**: Use `DetailPageLayout` — renders the summary + tab bar + scrollable tab panels as direct flex children of the page body (no page scroll, only panel content scrolls). The component handles proper flex height propagation that `<UTabs>` content slots cannot provide.
  ```vue
  <DetailPageLayout v-model="activeTab" :tab-items="tabItems" :tab-panel-class="tabPanelClass">
    <template #summary>
      <!-- FoldableSummary or any summary content — rendered shrink-0 -->
      <RunSummary ... />
    </template>
    <template #tab-test-cases>
      <!-- Tab content — rendered inside flex-1 min-h-0 panel -->
      <TestCasesList ... />
    </template>
  </DetailPageLayout>
  ```
  The `tabPanelClass` prop lets tabs with self-scrolling content (UTable with `sticky`, etc.) use `overflow-hidden flex flex-col` instead of the default `overflow-y-auto`.
- **Data fetching in children**: For self-contained components rendered conditionally (e.g., tab content), use `watch` + `$fetch` with reactive triggers rather than `useFetch` with `lazy: true`, since `useFetch` may not fire until the component is mounted.

### UTable conventions (MUST follow)

- **Always use template slots for cell rendering** — NEVER use `cell:` callbacks with `h()` or `resolveComponent()` in column definitions. The only exception is `createSortHeader<T>()` in `header:`.
- **Slot naming**: `#${accessorKey}-cell="{ row }"` for data cells (e.g. `#errorType-cell`, `#lastSeenAt-cell`). For `id`-only columns use `#${id}-cell`. Header slots: `#${accessorKey}-header` or `#${id}-header`.
- **Sort headers**: Use `createSortHeader<T>('Label')` (from `app/utils/index.ts`) for every sortable column. Non-sortable columns (actions, badges without natural ordering) use a plain string.
- **Actions column pattern**:
  ```ts
  { id: 'actions', header: 'Actions' }
  ```
  ```html
  <template #actions-header><div class="text-right">Actions</div></template>
  <template #actions-cell="{ row }">
    <div class="flex justify-end gap-2">
      <UButton :to="`/.../${row.original.id}`" size="sm" variant="outline" trailing-icon="i-lucide-arrow-right">View</UButton>
    </div>
  </template>
  ```
- **No `import { h, resolveComponent }` in table components** — if a component needs it for something other than a table cell, that's fine, but table cells must use slots.

## UI Best Practices
- Sentence case headings/labels
- Relative dates via date-fns (full timestamp on hover)
- Human-readable durations (exact ms on hover)
- Add `title` attribute on any button/control whose purpose isn't immediately obvious from its label alone. This provides a hover tooltip for clarity.

## Documentation (keep in sync with code)
- `docs/` — VitePress site published to GitHub Pages
- `README.md` — Landing page
- Update the relevant doc in the same commit as code changes (see `docs/` files for what each covers)
- **Backend logs** are documented in `docs/backend-logs.md`
- **Suite hierarchy (describe blocks)** and **test annotations** are documented in `docs/reporter.md` and `docs/api.md`

## Demo Data Requirements

When adding features with database columns, API response fields, or UI-visible changes, the demo data must be updated in four places:
1. **`scripts/generate-demo-seed.mjs`** — seed the new columns in the generated SQL
2. **`app/demo/api/`** — mirror any new server API response fields in the demo API handlers
3. **`app/demo/simulator.ts`** — emit any new streaming event fields in simulated runs
4. **`docs/`** — update the relevant documentation file

Always regenerate the seed SQL after changes: `cd application && npm run app:seed:demo`

## Troubleshooting
- DB locked? Stop other processes accessing `.data/piwi.db`
- Port 3000 in use? Use `PORT=3001 npm run dev`
- Tests failing? Ensure no dev server on port 3000 (tests start their own)
- Reporter not found? `npm link` in `reporter/` then in target project
- Migration not applying? If a migration file or `_journal.json` was created by hand (not via `npm run db:generate`), the Drizzle migrator may silently skip it — delete the hand-written migration, revert the journal entry, run `npm run db:generate` (or `db:generate:pg` for PostgreSQL), and manually run `ALTER TABLE ... ADD COLUMN` on the existing database if needed.
- Command appears frozen / no output? It probably launched an interactive pager. Use `git --no-pager <cmd>` for `diff`/`log`/`show`, and avoid commands that open an editor or wait for input (non-interactive shells hang on them).
- **Don't start the dev server interactively** — `npm run dev` / `nuxt dev` runs as a foreground process and blocks all subsequent commands. The tests handle server startup automatically via `webServer` in `playwright.config.ts`. If you need to start the server manually, do it as a background PowerShell job or use `Start-Process`. Starting it directly in a bash tool call will leave you stuck until the tool times out.

## Testing API

```bash
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{"projectName":"my-project","status":"passed","startTime":"2024-01-01T12:00:00Z","duration":120000,"totalTests":10,"passedTests":9,"failedTests":1,"skippedTests":0,"testCases":[{"title":"should login","status":"passed","duration":1500,"location":"tests/login.spec.ts:10:5"}]}'
```

## Demo Mode

The app can be built as a fully client-side SPA (no server needed) by setting `PIWI_DEMO_MODE=true`. The demo build:

1. **`npm run app:seed:demo`** — Generates `public/demo/seed.sql` (SQLite dump with 4 projects, 43 test cases, 61 test runs, 698 test-run-case rows, 8 failure clusters) and `public/demo/seed.version.json` (SHA-256 hash of the SQL content + timestamp).
2. **`npm run generate:demo`** — Builds the SPA with `ssr: false` and PWA service worker that intercepts `/api/` calls, serving them from in-browser sql.js (WASM SQLite) via Drizzle ORM.
3. The SQLite database is persisted in IndexedDB across page loads and re-seeded only when no persisted data exists.
4. **Staleness detection**: The build injects `demoDataVersion` (the SHA-256 hash from `seed.version.json`) into `runtimeConfig.public`. At runtime, the layout compares it against the version stored in IndexedDB and shows a "New demo data available" button in the sidebar footer. Clicking it wipes IndexedDB and reloads the page.
5. The service worker (`app/service-worker/demo-sw.ts`) handles API fetches via `app/demo/api/router.ts`. Both SW and main thread share `app/demo/db.client.ts` for DB initialization.
6. **Run simulator**: the demo banner hosts a "Simulate a test run" menu (`DemoSimulator.vue` + `useDemoSimulator`) that replays the reporter streaming protocol (setup → begin → events → finish) through `$fetch` against in-browser endpoint ports (`app/demo/api/reporter.ts`). Scenarios live in `app/demo/simulator.ts` and target the seeded `e2e-checkout` project so history/cluster features light up. Live updates flow over a BroadcastChannel (`app/demo/run-events.ts`) instead of SSE: `useRunStream` and the test-run detail page subscribe to it in demo mode.

## Important Notes
- DB auto-initialized on first API call
- Projects auto-created on first submission
- Dates stored as Unix timestamps in SQLite
- Run typecheck, lint, and tests only at the end before final commit (not after every task)

### Exploration & Audit Findings

When exploring the codebase or performing audits (schema reviews, dependency checks, code quality scans, etc.), log any bugs, inconsistencies, tech debt, or non-critical issues discovered in **`plans/exploration-findings.md`**. Use a structured format:

```markdown
## [Date] — [Exploration Type/Area]

### Finding: [Brief title]
- **File/Component**: location in codebase
- **Issue**: Description of the bug or inconsistency
- **Impact**: Severity and effect (e.g., "Low", "May affect performance", "Blocks feature X")
- **Suggested fix**: Recommended action (optional if the fix is obvious from the issue)
```

**Do not commit these findings to git** — they're local working notes. The roadmap (`plans/roadmap.md`) should reference notable findings under a dedicated "Known Issues & Tech Debt" section if they impact ongoing work or priorities.
