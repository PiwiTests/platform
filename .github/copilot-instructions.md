# Playwright Dashboard — Copilot Instructions

> **For any AI agent**: See [`AGENTS.md`](../AGENTS.md) (root) for the canonical project reference.  
> This file is kept in sync with `AGENTS.md` and exists for GitHub Copilot integration.

## Project Overview

Playwright test results dashboard built with **Nuxt 4**, Nuxt UI dashboard template. Stores and displays Playwright test results organized by projects.

## Prerequisites

- Node.js 24+, npm, Git
- Commands run from `application/` unless noted

## Quick Start

```bash
cd application
npm install
npm run dev          # http://localhost:3000
```

SQLite database auto-initializes on first API call.

## Repository Structure

```
application/       — Nuxt 4 dashboard app
application/tests/ — Functional tests (Playwright)
reporter/          — Custom Playwright reporter package
```

## Architecture

### Database
- **ORM**: Drizzle ORM + better-sqlite3
- **Schema**: `application/server/database/schema.ts`
- **Migrations**: `application/server/database/migrations/` (auto-run on startup)
- **Tables**: `projects`, `test_runs`, `test_cases`, `test_runs_cases`, `traces`, `users`

### Backend (server/api/)
Nuxt file-based routing:
- `POST /api/test-runs/submit` — Submit JSON test results (auto-creates projects)
- `POST /api/test-runs/upload` — Upload with HTML reports + trace files
- `GET /api/projects` — List projects with stats
- `GET /api/projects/[id]` — Project details + runs
- `GET /api/test-runs/[id]` — Run details + cases
- `GET /api/test-cases/[id]` — Case details + traces
- `GET /api/files/[...path]` — Download reports/traces

### Frontend (app/pages/)
- `/` — Dashboard home with stats
- `/projects` — Project list
- `/projects/[id]` — Project detail
- `/test-runs/[id]` — Run detail
- `/test-cases/[id]` — Case detail

### Tests
- **Location**: `application/tests/`
- **Files**: `api-server.spec.ts`, `dashboard-ui.spec.ts`, `file-upload.spec.ts`, `reporter-integration.spec.ts`, `zstd-compression.spec.ts`
- **Config**: `application/playwright.config.ts`

### Reporter
- `reporter/index.js` — Custom Playwright reporter
- `reporter/index.d.ts` — TypeScript types
- `reporter/package.json` — NPM package

## Key Features
- Auto-create projects on submission
- Stores: status, duration, errors, HTML reports (full directory with assets), trace files
- File storage: `.data/storage/` — paths stored relative to storage dir
- REST + multipart upload APIs
- Paths stored relative (e.g., `project-1/run-123/index.html`) for portability

## Code Style & UI
- Keep it simple, full TypeScript, Nuxt 4 conventions, Nuxt UI components
- **Sentence case** in UI (e.g., "Test runs")
- **Relative dates** via date-fns (full timestamp on hover)
- **Human-readable durations** (exact ms on hover)

## Environment
- `.env.example` in `application/` — `NUXT_PUBLIC_SITE_URL` (optional)
- Works with no env vars; `.data/` created automatically

## Dev Commands (from `application/`)

| Command | Purpose |
|---------|---------|
| `npm install` | Install deps |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Run functional tests |
| `npm run test:ui` | Tests with UI mode |
| `npm run test:report` | View test report |
| `npm run db:generate` | Generate migration |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema (dev only) |
| `npm run db:studio` | Drizzle Studio |

### Reporter (from `reporter/`)
```bash
cd reporter
npm install
npm link
```

## Making Changes

- **DB fields**: Update `schema.ts` → `npm run db:generate` → review migration → restart
- **API endpoints**: Create file in `server/api/` → use `eventHandler()` + `getDatabase()`
- **Pages**: Create Vue file in `app/pages/` → use `<UDashboardPanel>` + `useFetch()`
- **Navigation**: Edit `app/layouts/default.vue` links array
- **Tests**: Create `.spec.ts` in `application/tests/` → run `npm test`
- **Reporter**: Edit `reporter/index.js` + `index.d.ts` → test with `npm link`

## Testing API

```bash
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{"projectName":"my-test-project","status":"passed","startTime":"2024-01-01T12:00:00Z","duration":120000,"totalTests":10,"passedTests":9,"failedTests":1,"skippedTests":0,"testCases":[{"title":"should login successfully","status":"passed","duration":1500,"location":"tests/login.spec.ts:10:5"}]}'
```

## Common Tasks

### Add new statistics to home page
- Edit `application/app/pages/index.vue`, update `stats` computed property

### Add filtering to project list
- Edit `application/app/pages/projects/index.vue`, add filter UI and logic

### Store additional test metadata
- Update `schema.ts` → API endpoint → UI page

### Add new test coverage
- Create `.spec.ts` in `application/tests/`, follow existing patterns, run `npm test`

### Update reporter functionality
- Modify `reporter/index.js` + `index.d.ts`, link or publish

## Troubleshooting

- **DB locked**: Stop other processes accessing `.data/playwright.db`
- **DB not created**: Make first API call
- **Corrupted DB**: Delete `.data/` and restart
- **Port 3000 in use**: `PORT=3001 npm run dev`
- **Module not found**: `npm install` in `application/`
- **Tests failing**: No dev server on port 3000 (tests start their own)
- **Reporter not found**: `npm link` in `reporter/` then in target project

## Documentation (keep in sync with code)

- `docs/` — VitePress site published to GitHub Pages
- `README.md` — Landing page

Update the relevant doc in the same commit as code changes:

| Change | Doc |
|--------|-----|
| API endpoint | `docs/api.md` |
| Reporter option/fixture | `docs/reporter.md` |
| Auth behavior/roles | `docs/authentication.md` |
| Storage config/DB migration | `docs/storage.md` |
| Deployment/Docker | `docs/deployment.md` |
| Requirements/quick-start | `docs/getting-started.md` |
| Major feature | `docs/index.md` + detail page |
| Top-level feature list/Docker | `README.md` |

No doc update needed for: internal refactors, test-only changes, dependency bumps, bug fixes restoring documented behavior.

## Important Notes
- DB auto-initialized on first API call
- Projects auto-created on first submission
- All dates stored as Unix timestamps in SQLite
- Run typecheck, lint, and tests before final commit
