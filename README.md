# Playwright Dashboard

A simple Nuxt-based dashboard for managing and viewing Playwright test results.

## Features

- 📊 View test runs organized by projects
- 🧪 Track test results, traces, and reports
- 📡 REST API for receiving test results
- 🎨 Clean UI built with Nuxt UI
- 💾 Simple JSON file storage (no database required)

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Visit http://localhost:3000

### Production

```bash
npm run build
npm run preview
```

## API Endpoints

### Projects

- `GET /api/projects` - List all projects
- `POST /api/projects` - Create a new project
  ```json
  {
    "name": "My Project",
    "description": "Optional description"
  }
  ```
- `GET /api/projects/:id` - Get project details
- `GET /api/projects/:id/runs` - Get test runs for a project

### Test Runs

- `POST /api/test-runs` - Submit a test run
  ```json
  {
    "projectId": "project-id",
    "status": "passed",
    "totalTests": 10,
    "passed": 9,
    "failed": 1,
    "skipped": 0,
    "flaky": 0,
    "duration": 30000
  }
  ```
- `GET /api/test-runs/:id` - Get test run details

## Data Storage

All data is stored as JSON files in the `data/` directory:
- `data/projects/` - Project definitions
- `data/test-runs/` - Test run results
- `data/traces/` - Test traces (future)

## Architecture

This dashboard is intentionally kept simple to make future modifications by Copilot agents easier:
- Minimal dependencies
- Clear file structure
- Simple JSON storage
- Straightforward API design
- Well-typed with TypeScript
