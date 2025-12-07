# Playwright Dashboard

[![Nuxt UI](https://img.shields.io/badge/Made%20with-Nuxt%20UI-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)

A modern dashboard for storing and visualizing Playwright test results, built with Nuxt 4 and powered by [Nuxt UI](https://ui.nuxt.com).

## Features

- 📊 **Test Results Storage** - Store complete Playwright test run data
- 🎯 **Project Organization** - Tests organized by projects with automatic project creation
- 📈 **Dashboard Overview** - View test statistics and trends at a glance
- 🔍 **Detailed Views** - Drill down from projects → test runs → test cases → traces
- 🔌 **REST API** - Simple JSON API for submitting test results
- 💾 **SQLite Database** - Lightweight database storage with Drizzle ORM
- 🎨 **Modern UI** - Beautiful interface with light/dark mode support
- 🚀 **Auto-create Projects** - Unknown projects are automatically created via API

## Quick Start

### Installation

```bash
npm install
```

### Development Server

Start the development server on `http://localhost:3000`:

```bash
npm run dev
```

The database will be automatically initialized on first API call.

## API Usage

### Submit Test Results

Send test results to the dashboard via POST request:

```bash
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "my-project",
    "status": "passed",
    "startTime": "2024-01-01T12:00:00Z",
    "duration": 120000,
    "totalTests": 10,
    "passedTests": 9,
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
        "retries": 1,
        "traces": [
          {
            "tracePath": "/traces/error-test-trace.zip"
          }
        ]
      }
    ]
  }'
```

### API Endpoints

- `POST /api/test-runs/submit` - Submit test run results (auto-creates projects)
- `GET /api/projects` - List all projects with statistics
- `GET /api/projects/[id]` - Get project details with test runs
- `GET /api/test-runs/[id]` - Get test run details with test cases
- `GET /api/test-cases/[id]` - Get test case details with traces

## Project Structure

```
├── .data/                    # SQLite database storage (gitignored)
├── app/
│   ├── pages/               # Dashboard pages
│   │   ├── index.vue        # Home dashboard
│   │   ├── projects.vue     # Projects list
│   │   ├── projects/[id].vue    # Project details
│   │   ├── test-runs/[id].vue   # Test run details
│   │   └── test-cases/[id].vue  # Test case details
│   └── layouts/
│       └── default.vue      # Main layout with navigation
├── server/
│   ├── database/
│   │   ├── schema.ts        # Database schema (Drizzle ORM)
│   │   └── index.ts         # Database initialization
│   └── api/                 # API endpoints
│       ├── projects.get.ts
│       ├── projects/[id].get.ts
│       ├── test-runs/
│       │   ├── submit.post.ts
│       │   └── [id].get.ts
│       └── test-cases/[id].get.ts
└── .github/
    └── copilot-instructions.md  # Instructions for AI assistants
```

## Database Schema

The dashboard uses SQLite with the following tables:

- **projects** - Test projects
- **test_runs** - Test execution runs
- **test_cases** - Individual test cases
- **traces** - Playwright trace files

## Production

Build the application for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Development Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
```

## Contributing

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for detailed development guidelines and architecture information.
