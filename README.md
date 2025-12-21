# Playwright Dashboard

[![Nuxt UI](https://img.shields.io/badge/Made%20with-Nuxt%20UI-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)

A modern dashboard for storing and visualizing Playwright test results, built with Nuxt 4 and powered by [Nuxt UI](https://ui.nuxt.com).

## Features

- 📊 **Test Results Storage** - Store complete Playwright test run data
- 🎯 **Project Organization** - Tests organized by projects with automatic project creation
- 📈 **Dashboard Overview** - View test statistics and trends at a glance
- 🔍 **Detailed Views** - Drill down from projects → test runs → test cases → traces
- 🔌 **REST API** - Simple JSON API for submitting test results
- 📦 **Playwright Reporter** - Custom reporter for automatic result submission
- 💾 **SQLite Database** - Lightweight database storage with Drizzle ORM
- 📁 **File Upload** - Upload HTML reports and trace files
- 🎨 **Modern UI** - Beautiful interface with light/dark mode support
- 🚀 **Auto-create Projects** - Unknown projects are automatically created via API
- 🔐 **Authentication** - Optional role-based access control (administrator, reporter, user)

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

### Submit Test Results (JSON)

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
    "testCases": [...]
  }'
```

### Upload Test Results with Files (HTML Reports & Traces)

Upload Playwright test results with HTML reports and trace files:

```bash
curl -X POST http://localhost:3000/api/test-runs/upload \
  -F "projectName=my-project" \
  -F "testRun={\"status\":\"passed\",\"startTime\":\"2024-01-01T12:00:00Z\",\"duration\":120000,\"totalTests\":10,\"passedTests\":9,\"failedTests\":1,\"skippedTests\":0}" \
  -F "testCases=[{\"title\":\"test 1\",\"status\":\"passed\",\"duration\":1500,\"location\":\"tests/test.spec.ts:10:5\"}]" \
  -F "htmlReport=@./playwright-report/index.html" \
  -F "trace_0=@./test-results/test-1/trace.zip"
```

**Form Fields:**
- `projectName` - Project name (string)
- `testRun` - Test run metadata (JSON string)
- `testCases` - Array of test cases (JSON string)
- `htmlReport` - HTML report file (optional)
- `trace_N` - Trace file for test case at index N (optional, multiple allowed)

### API Endpoints

**Submission:**
- `POST /api/test-runs/submit` - Submit test results as JSON (auto-creates projects)
- `POST /api/test-runs/upload` - Upload test results with HTML reports and trace files

**Query:**
- `GET /api/projects` - List all projects with statistics
- `GET /api/projects/[id]` - Get project details with test runs
- `GET /api/test-runs/[id]` - Get test run details with test cases
- `GET /api/test-cases/[id]` - Get test case details with traces

**Files:**
- `GET /api/files/[...path]` - Download HTML reports and trace files

## Using the Playwright Reporter

The dashboard includes a custom Playwright reporter for automatic test result submission.

### Installation

```bash
cd reporter
npm install
npm link
```

In your Playwright project:

```bash
npm link playwright-dashboard-reporter
```

### Configuration

Add to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'], // Keep your existing reporters
    ['playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-test-project',
      uploadTraces: true,
      uploadReport: true
    }]
  ],
  
  use: {
    trace: 'retain-on-failure', // Enable traces
  },
});
```

### Options

- `serverUrl` (string): Dashboard server URL (default: `http://localhost:3000`)
- `projectName` (string): Project name in dashboard (default: `default-project`)
- `uploadTraces` (boolean): Upload trace files (default: `true`)
- `uploadReport` (boolean): Upload HTML report (default: `true`)

See [`reporter/README.md`](./reporter/README.md) for detailed documentation.

## Authentication

The dashboard supports optional user authentication with role-based access control.

### Overview

Three user roles are available:

- **Administrator**: Full access to all features including editing projects and managing users
- **Reporter**: Can only use API endpoints for submitting test results (`/api/test-runs/submit` and `/api/test-runs/upload`)
- **User**: Read-only access to all dashboard pages and data

### Enabling Authentication

Authentication is **disabled by default**. To enable it:

1. Copy the `.env.example` file to `.env`:
   ```bash
   cd application
   cp .env.example .env
   ```

2. Edit `.env` and set the following variables:
   ```bash
   NUXT_AUTH_ENABLED=true
   NUXT_AUTH_SECRET=your-secret-key-here
   ```

   **Important**: Generate a strong secret key for production:
   ```bash
   openssl rand -hex 32
   ```

3. Restart the application

### Initial Setup

When authentication is first enabled, create an administrator account:

```bash
curl -X POST http://localhost:3000/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "your-secure-password",
    "name": "Administrator"
  }'
```

This endpoint is only available when no users exist in the database.

### Logging In

1. Navigate to `/login` in your browser
2. Enter your username and password
3. Upon successful login, you'll be redirected to the dashboard

### User Management

User accounts can be managed through the admin interface at `/settings/users`. This page is accessible to administrators, or to anyone when authentication is disabled (with an informational message).

To create additional users:

1. Navigate to `/settings/users` in the dashboard
2. Click "Add User" to create a new account
3. Set username, password, role, and optional display name

### API Authentication

When authentication is enabled:

- API endpoints require authentication via session cookies
- POST/PUT/DELETE endpoints require appropriate role permissions
- GET endpoints remain public (read-only access)
- Sessions are stored in encrypted cookies and last for 7 days

### Security Considerations

- Always use HTTPS in production
- Use strong, unique passwords
- Generate a strong random secret for `NUXT_AUTH_SECRET`
- The default secret should never be used in production
- Passwords are hashed using scrypt with per-password salts

### Disabling Authentication

To disable authentication:

1. Set `NUXT_AUTH_ENABLED=false` in `.env`
2. Or remove the environment variable entirely
3. Restart the application

When disabled, all endpoints are accessible without authentication.

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
│       │   ├── upload.post.ts
│       │   └── [id].get.ts
│       ├── test-cases/[id].get.ts
│       └── files/[...path].get.ts
├── reporter/                # Playwright Reporter package
│   ├── index.js            # Reporter implementation
│   ├── index.d.ts          # TypeScript definitions
│   ├── package.json
│   └── README.md           # Reporter documentation
├── tests/
│   └── functional/         # Functional tests
│       ├── api-server.spec.ts
│       ├── dashboard-ui.spec.ts
│       ├── reporter-integration.spec.ts
│       ├── file-upload.spec.ts
│       └── README.md       # Test documentation
├── playwright.config.ts    # Playwright test configuration
└── .github/
    └── copilot-instructions.md  # Instructions for AI assistants
```

## Testing

The project includes comprehensive functional tests using Playwright Test.

### Run Tests

```bash
# Run all tests
npm test

# Run with UI mode
npm run test:ui

# View test report
npm run test:report
```

### Test Coverage

- **API Server Tests**: REST API endpoints, error handling, data validation
- **Dashboard UI Tests**: Page rendering, navigation, responsive design
- **Reporter Integration Tests**: Reporter functionality, configuration, uploads
- **File Upload Tests**: File uploads, downloads, security

See [`tests/functional/README.md`](./tests/functional/README.md) for detailed testing documentation.

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
