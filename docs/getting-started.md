---
title: Getting started
lang: en-US
---

# Getting started

## What is Piwi Dashboard?

Piwi Dashboard is a self-hosted web application that collects, stores, and visualizes your [Playwright](https://playwright.dev) test results over time. It replaces the ephemeral HTML reports that CI produces with a permanent, searchable history of every test run — making it easy to spot flaky tests, track regressions, and share results with your team.

**Key benefits:**
- See test health trends across hundreds of runs
- Stream results live from CI — no waiting for the full run to finish
- Store HTML reports and trace files permanently for later debugging
- Analyse performance regressions with avg/P90 duration charts
- Self-hosted and open-source — your data stays on your infrastructure

## Requirements

- **Node.js 24+** — required for native SQLite support (`node:sqlite`)
- **npm** — for package management
- **PostgreSQL 14+** — optional; required only when using the PostgreSQL backend

## Quick start with Docker

The fastest way to get started is with the pre-built container image:

```bash
docker pull ghcr.io/phenx/piwi-dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

Visit `http://localhost:3000` to access the dashboard.

See [Deployment](./deployment) for detailed Docker, Docker Compose, PostgreSQL, and Kubernetes options.

## Running from source

```bash
# Clone the repository
git clone https://github.com/PhenX/piwi-dashboard.git
cd playwright-dashboard/application

# Install dependencies
npm install

# Start the development server
npm run dev
```

The dashboard will be available at `http://localhost:3000`.  
The SQLite database is automatically created on the first API call.

## Submitting your first test result

Once the dashboard is running, submit a test result to verify everything works:

```bash
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "my-project",
    "status": "passed",
    "startTime": "2024-01-01T12:00:00Z",
    "duration": 120000,
    "totalTests": 2,
    "passedTests": 1,
    "failedTests": 1,
    "skippedTests": 0,
    "testCases": [
      {
        "title": "should login successfully",
        "status": "passed",
        "duration": 1500,
        "location": "tests/login.spec.ts:10:5",
        "retries": 0
      },
      {
        "title": "should handle errors",
        "status": "failed",
        "duration": 2300,
        "location": "tests/errors.spec.ts:5:5",
        "error": "Expected true but got false",
        "retries": 1
      }
    ]
  }'
```

The project `my-project` is created automatically if it doesn't exist yet.

## Using the Piwi Dashboard reporter

The recommended way to integrate is via the custom reporter package — it handles uploading results, HTML reports, and trace files automatically.

Install it:

```bash
npm install --save-dev @phenx/piwi-dashboard-reporter
```

Then add it to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@phenx/piwi-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
    }],
  ],
  use: {
    trace: 'retain-on-failure',
  },
})
```

Run your tests and results will appear in the dashboard:

```bash
npx playwright test
```

See the [Reporter](./reporter) page for the full configuration reference, including live streaming, multiple report types, performance metrics, and authentication.

## Dashboard navigation

After submitting results, the dashboard provides:

| Page | Purpose |
|------|---------|
| **Home** (`/`) | Overview stats, test trend chart, and quick access to recent projects |
| **Projects** (`/projects`) | Searchable table of all projects with status, duration, and tag filters |
| **Project detail** (`/projects/:id`) | Run history for a single project with breakdown charts |
| **Performance** (`/projects/:id/performance`) | Duration trends, slowest tests ranking, side-by-side run comparison |
| **Test run** (`/test-runs/:id`) | Individual test cases with status, errors, traces, and reports |
| **Test case** (`/test-cases/:id`) | Detailed view of a single test including steps, web vitals, and network data |
| **Settings** (`/settings`) | User management, storage stats, tag management, and cleanup tools |

## Development commands

Run these from the `application/` directory:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm test` | Run Playwright functional tests |
| `npm run db:generate` | Generate SQLite migration from schema changes |
| `npm run db:generate:pg` | Generate PostgreSQL migration from schema changes |
| `npm run db:studio` | Open Drizzle Studio to browse the SQLite database |
| `npm run db:studio:pg` | Open Drizzle Studio to browse the PostgreSQL database |
| `npm run seed:demo` | Regenerate demo seed data for the live demo |

> **Migration workflow:** edit `server/database/schema.ts` → run `npm run db:generate` (SQLite) or `npm run db:generate:pg` (PostgreSQL) → review the generated `.sql` file → restart the app. Never create migration files or edit `meta/_journal.json` by hand — the Drizzle migrator depends on the journal to track which migrations have been applied, and manual entries cause it to silently skip the migration.
