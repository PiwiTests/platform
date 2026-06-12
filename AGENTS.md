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
reporter/               — Custom Playwright reporter package (TypeScript → compiled JS)
```

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
- **Migrations**: `application/server/database/migrations/` (SQLite) or `migrations-pg/` (PostgreSQL, auto-run on startup based on `DATABASE_URL`)
- **Tables**: `projects`, `test_runs`, `test_cases`, `test_runs_cases`, `failure_clusters`, `files`, `trace_resources`, `trace_blobs`, `tags`, `project_tags`, `users`, `api_keys`

### Backend (server/api/)
Nuxt file-based routing:
- `POST /api/test-runs/submit` — Submit JSON test results
- `POST /api/test-runs/upload` — Upload with HTML reports + traces
- `POST /api/test-runs/start` / `[id]/events` / `[id]/finish` — Streaming protocol (live runs)
- `POST /api/test-runs/[id]/case-files` — Upload one case's trace + attachments during a streaming run (streamToken auth, idempotent, publishes `case-files` SSE event)
- `GET /api/projects` — List projects with stats
- `GET /api/projects/[id]` — Project details + runs
- `GET /api/test-runs/[id]` — Run details + cases
- `GET /api/test-cases/[id]` — Case details + steps, web vitals, network requests
- `GET /api/test-cases/[id]/traces` — Trace files for a test case
- `GET /api/test-cases/[id]/history` — Execution history across runs
- `GET /api/files/[...path]` — Download reports/traces

### Frontend (app/)
- **Pages** (`app/pages/`):
  - `/` — Dashboard home with stats
  - `/projects` — Project list
  - `/projects/[id]` — Project detail
  - `/test-runs/[id]` — Run detail
  - `/test-cases/[id]` — Case detail (detailed revamp: traces, run context, AI fix prompt, timing comparison, improved error display)
- **Components** (`app/components/`):
  - `RunSummary.vue` — Summary card + CI/Source/Other metadata blocks on test run detail page
  - `TestCasesList.vue` — Paginated test case table with sticky headers, row highlighting via `meta.class.tr`
  - `WorkersTimeline.vue` — Worker timeline with clickable bars (emits `selectTestCase`)
  - `RunCompare.vue` — Self-contained comparison component (watches internal `compareRunA`, fetches baseline run)
  - `SlowEndpoints.vue` — Self-contained network endpoints table (fetches `/api/test-runs/:id/network-requests` internally)
  - `RunStatusBadge.vue`, `TestStatusBar.vue`, `RunReports.vue` — Shared UI primitives
  - `TestCaseStatusCard.vue` — Header card: title, location, duration, retries, worker, slowest step, timing vs historical avg
  - `TestCaseRunContext.vue` — Run metadata: environment, CI provider, branch, commit, browser info
  - `TestCaseTracesCard.vue` — Trace file list with "Open trace" buttons
  - `TestCaseErrorCard.vue` — Error details with copy button and collapsible long errors
  - `TestCaseFixPromptCard.vue` — AI debug prompt with copy button for failed tests
- **Utilities** (`app/utils/`):
  - `performance-hints.ts` — Generates performance warnings for slow/flaky tests
  - `fix-prompt.ts` — Generates structured AI debug prompts from test failure context
  - `index.ts` — Shared helpers: `formatDuration`, `getStatusColor`, `getFileApiPath`, `formatRelativeTime`, `createSortHeader`, `formatBytes`

### Reporter
- `reporter/src/index.ts` — Entry point (re-exports class + `createGlobalSetup`)
- `reporter/src/reporter.ts` — Main `PiwiDashboardReporter` orchestrator class
- `reporter/src/config.ts` — `DashboardReporterOptions` interface + defaults
- `reporter/src/helpers.ts` — `getSetupFilePath`, `computeInstanceId`, `createGlobalSetup`
- `reporter/src/http-client.ts` — `HttpClient` class (HTTP transport)
- `reporter/src/uploader.ts` — `Uploader` class (upload strategies)
- `reporter/src/stream-buffer.ts` — `StreamBuffer` class (persistent event buffer)
- `reporter/src/crash-recovery.ts` — `CrashRecovery` class (recovery data)
- `reporter/src/file-handler.ts` — `FileHandler` class (report/trace/attachment ops)
- `reporter/src/metadata-collector.ts` — `MetadataCollector` class (CI/SCM metadata)
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

## Code Style
- Keep it simple (AI-friendly codebase)
- Full TypeScript, Nuxt 4 conventions, Nuxt UI components
- Sentence case in UI (e.g., "Test runs"), relative dates with date-fns, human-readable durations
- Use American English spelling throughout (e.g., "initialize", "organize", "color")

## Environment
- `.env.example` in `application/` — `NUXT_PUBLIC_SITE_URL` (optional)
- Works with no env vars set; `.data/` created automatically

## Dev Commands (from `application/`)

| Command | Purpose |
|---------|---------|
| `npm install` | Install deps |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Run functional tests |
| `npm run db:generate` | Generate migration |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema (dev only) |
| `npm run db:studio` | Drizzle Studio |

### Reporter commands (from `reporter/`)

| Command | Purpose |
|---------|---------|
| `npm run reporter:build` | Compile TypeScript (from `src/`) to `.js` + `.d.ts` (in `dist/`) |
| `npm run reporter:dev`   | Watch mode — auto-recompile on changes |
| `npm run reporter:format`| Format source code with oxfmt |

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
| `src/fixtures.ts`             | Playwright fixtures                         |
| `src/index.ts`                | Package entry point                         |

## Making Changes

- **DB fields**: Update `schema.ts` → `npm run db:generate` (or `db:generate:pg` for PostgreSQL) → review migration → restart
  ⚠ Never create migration files or edit `_journal.json` manually — always use `npm run db:generate`.
- **API endpoints**: Create file in `server/api/` → use `eventHandler()` + `getDatabase()`
- **Pages**: Create Vue file in `app/pages/` → use `<UDashboardPanel>` + `useFetch()`
- **Components**: Create Vue file in `app/components/` → follow existing patterns:
  - Self-contained data fetching is preferred for tab content (use `watch` + `$fetch` or `useFetch` with `lazy: true`)
  - Pass props from parent page only for data already fetched at the page level
  - Use `v-if` for tab-switched components to ensure clean mount/unmount
- **Navigation**: Edit `app/layouts/default.vue` links array
- **Tests**: Create `.spec.ts` in `application/tests/` → run `npm test`
  - If the test creates a project, **add its name to `shared/test-project-names.ts`** (alphabetically sorted) so the global setup cleanup deletes it before the next run. Tests must use static project names, not `Date.now()` suffixes.
  - Use `PROJECT.YOUR_KEY` from `../shared/test-project-names` in test code instead of raw string literals. This ensures every project name is tracked in one place.
- **Reporter**: Edit `.ts` files in `reporter/src/` → `npm run reporter:build` (from `reporter/`) → test with `npm link`
- **Shared types** (`application/shared/types.ts`): Wire contract between reporter and server. Server imports directly; reporter uses structural typing (do NOT add `import type` from shared in reporter method signatures — it leaks the monorepo path into published `.d.ts` files)

## UI Patterns

- **UTable sticky headers**: Use the `sticky` boolean prop + `max-h-*` class on the table root element. Do NOT wrap tables in `overflow-y-auto` divs — UTable's own root handles overflow when `max-h` is set.
- **Row highlighting**: Use `:meta="{ class: { tr: 'highlight-class' } }"` on UTable, NOT `:row-attrs` (which is unsupported in Nuxt UI v4).
- **Tab panels**: Use `<UTabs>` + `v-if` on each panel component to keep component lifecycle clean.
- **Data fetching in children**: For self-contained components rendered conditionally (e.g., tab content), use `watch` + `$fetch` with reactive triggers rather than `useFetch` with `lazy: true`, since `useFetch` may not fire until the component is mounted.

## UI Best Practices
- Sentence case headings/labels
- Relative dates via date-fns (full timestamp on hover)
- Human-readable durations (exact ms on hover)

## Documentation (keep in sync with code)
- `docs/` — VitePress site published to GitHub Pages
- `README.md` — Landing page
- Update the relevant doc in the same commit as code changes (see `docs/` files for what each covers)

## Troubleshooting
- DB locked? Stop other processes accessing `.data/piwi.db`
- Port 3000 in use? Use `PORT=3001 npm run dev`
- Tests failing? Ensure no dev server on port 3000 (tests start their own)
- Reporter not found? `npm link` in `reporter/` then in target project
- Migration not applying? If a migration file or `_journal.json` was created by hand (not via `npm run db:generate`), the Drizzle migrator may silently skip it — delete the hand-written migration, revert the journal entry, run `npm run db:generate` (or `db:generate:pg` for PostgreSQL), and manually run `ALTER TABLE ... ADD COLUMN` on the existing database if needed.
- Command appears frozen / no output? It probably launched an interactive pager. Use `git --no-pager <cmd>` for `diff`/`log`/`show`, and avoid commands that open an editor or wait for input (non-interactive shells hang on them).

## Testing API

```bash
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{"projectName":"my-project","status":"passed","startTime":"2024-01-01T12:00:00Z","duration":120000,"totalTests":10,"passedTests":9,"failedTests":1,"skippedTests":0,"testCases":[{"title":"should login","status":"passed","duration":1500,"location":"tests/login.spec.ts:10:5"}]}'
```

## Demo Mode

The app can be built as a fully client-side SPA (no server needed) by setting `NUXT_PUBLIC_DEMO_MODE=true`. The demo build:

1. **`npm run seed:demo`** — Generates `public/demo/seed.sql` (SQLite dump with 4 projects, 43 test cases, 61 test runs, 698 test-run-case rows, 8 failure clusters) and `public/demo/seed.version.json` (SHA-256 hash of the SQL content + timestamp).
2. **`npm run generate:demo`** — Builds the SPA with `ssr: false` and PWA service worker that intercepts `/api/` calls, serving them from in-browser sql.js (WASM SQLite) via Drizzle ORM.
3. The SQLite database is persisted in IndexedDB across page loads and re-seeded only when no persisted data exists.
4. **Staleness detection**: The build injects `demoDataVersion` (the SHA-256 hash from `seed.version.json`) into `runtimeConfig.public`. At runtime, the layout compares it against the version stored in IndexedDB and shows a "New demo data available" button in the sidebar footer. Clicking it wipes IndexedDB and reloads the page.
5. The service worker (`app/service-worker/demo-sw.ts`) handles API fetches via `app/demo/api/router.ts`. Both SW and main thread share `app/demo/db.client.ts` for DB initialization.
6. **Run simulator**: the demo banner hosts a "Simulate a test run" menu (`DemoSimulator.vue` + `useDemoSimulator`) that replays the reporter streaming protocol (setup → begin → events → finish) through `$fetch` against in-browser endpoint ports (`app/demo/api/reporter.ts`). Scenarios live in `app/demo/simulator.ts` and target the seeded `e2e-checkout` project so history/cluster features light up. Live updates flow over a BroadcastChannel (`app/demo/run-events.ts`) instead of SSE: `useRunStream` and the test-run detail page subscribe to it in demo mode.

## Important Notes
- DB auto-initialized on first API call
- Projects auto-created on first submission
- Dates stored as Unix timestamps in SQLite
- Run typecheck, lint, and tests before final commit
