---
title: Getting started
lang: en-US
---

# Getting started

## Requirements

- **Node.js 24+** — required for native SQLite support
- **npm** — for package management
- **PostgreSQL 14+** — optional; required only when using the PostgreSQL backend

## Quick start with Docker

The fastest way to get started is with the pre-built container image:

```bash
docker pull ghcr.io/phenx/playwright-dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/playwright-dashboard:latest
```

Visit `http://localhost:3000` to access the dashboard.

See [Deployment](./deployment) for detailed Docker and production deployment options.

## Running from source

```bash
# Clone the repository
git clone https://github.com/PhenX/playwright-dashboard.git
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

## Using the Playwright reporter

The easiest way to integrate the dashboard into your test workflow is via the custom reporter package.

Install it:

```bash
npm install --save-dev @phenx/playwright-dashboard-reporter
```

Then add it to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@phenx/playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
    }],
  ],
  use: {
    trace: 'retain-on-failure',
  },
})
```

See the [Reporter](./reporter) page for the full configuration reference.

## Development commands

Run these from the `application/` directory:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm test` | Run functional tests |
| `npm run db:generate` | Generate SQLite migration from schema changes |
| `npm run db:generate:pg` | Generate PostgreSQL migration from schema changes |
| `npm run db:studio` | Open Drizzle Studio to browse the SQLite database |
| `npm run db:studio:pg` | Open Drizzle Studio to browse the PostgreSQL database |
