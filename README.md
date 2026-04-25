# Playwright Dashboard

[![Nuxt UI](https://img.shields.io/badge/Made%20with-Nuxt%20UI-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)
[![Docker](https://img.shields.io/badge/Docker-Available-2496ED?logo=docker&labelColor=020420)](https://github.com/PhenX/playwright-dashboard/pkgs/container/playwright-dashboard)

A modern dashboard for storing and visualizing Playwright test results, built with Nuxt 4 and powered by [Nuxt UI](https://ui.nuxt.com).

## Features

- 📊 **Test Results Storage** - Store complete Playwright test run data
- 🎯 **Project Organization** - Tests organized by projects with automatic project creation
- 📈 **Dashboard Overview** - View test statistics and trends at a glance
- ⚡ **Performance Tracking** - Step-level timing, avg/P90 duration trends, slowest tests analysis
- 🌐 **Network Request Analysis** - Find slow API endpoints grouped by HTTP method and normalised route
- 🔬 **Browser Web Vitals** - Capture TTFB, DOMContentLoaded, FCP and more via the Performance API
- 📊 **Run Comparison** - Side-by-side delta view of two test runs with improved/regressed/unchanged summary
- 🔍 **Detailed Views** - Drill down from projects → test runs → test cases → traces
- 🔌 **REST API** - Simple JSON API for submitting test results
- 📦 **Playwright Reporter** - Custom reporter for automatic result submission
- 💾 **SQLite Database** - Lightweight database storage with Drizzle ORM
- 📁 **File Upload** - Upload HTML reports and trace files
- ☁️ **Flexible Storage** - Local file storage (default) or S3-compatible storage (AWS S3, MinIO, DigitalOcean Spaces, Cloudflare R2)
- 🎨 **Modern UI** - Beautiful interface with light/dark mode support
- 🚀 **Auto-create Projects** - Unknown projects are automatically created via API
- 🔐 **Authentication** - Optional role-based access control (administrator, reporter, user)
- 🐳 **Docker Support** - Pre-built container images (~200MB)

## Requirements

- **Node.js 22+** - Required for native SQLite support
- **npm** - For package management

## Quick Start

### Using Docker (Recommended)

The fastest way to get started:

```bash
docker pull ghcr.io/phenx/playwright-dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/playwright-dashboard:latest
```

Visit `http://localhost:3000` to access the dashboard.

📖 See [DOCKER.md](DOCKER.md) for detailed Docker deployment instructions.

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
  -F "report_html=@./playwright-report.gz" \
  -F "trace_0=@./test-results/test-1/trace.zip"
```

You can attach **multiple report types** in a single upload:

```bash
curl -X POST http://localhost:3000/api/test-runs/upload \
  -F "projectName=my-project" \
  -F "testRun=..." \
  -F "testCases=..." \
  -F "report_html=@./playwright-report.gz" \
  -F "report_monocart=@./monocart-report.gz" \
  -F "report_allure=@./allure-results.gz" \
  -F "report_blob=@./blob-report.zip"
```

**Form Fields:**
- `projectName` - Project name (string)
- `testRun` - Test run metadata (JSON string)
- `testCases` - Array of test cases (JSON string)
- `htmlReport` - HTML report archive (legacy, same as `report_html`)
- `report_<type>` - Report archive for type (e.g. `report_html`, `report_monocart`, `report_allure`, `report_blob`)
- `report_label_<type>` - Optional display label override for the given report type
- `trace_N` - Trace file for test case at index N (optional, multiple allowed)

### API Endpoints

**Submission:**
- `POST /api/test-runs/submit` - Submit test results as JSON (auto-creates projects)
- `POST /api/test-runs/upload` - Upload test results with reports and trace files

**Query:**
- `GET /api/projects` - List all projects with statistics
- `GET /api/projects/[id]` - Get project details with test runs
- `GET /api/projects/[id]/performance` - Performance trend data (last N runs with avg/P90 durations)
- `GET /api/projects/[id]/slow-tests` - Top 20 slowest tests with avg/max/min/trend
- `GET /api/test-runs/[id]` - Get test run details with test cases
- `GET /api/test-runs/[id]/network-requests` - Network requests grouped by HTTP method + normalised route
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

### Multiple Reports

You can attach multiple report types to a single test run. Each report appears as a separate button in the dashboard UI.

```typescript
export default defineConfig({
  reporter: [
    ['list'],
    ['@playwright/test/reporter-html', { outputFolder: 'playwright-report' }],
    ['monocart-reporter', { name: 'My Tests', outputFile: 'monocart-report/index.html' }],
    ['allure-playwright', { resultsDir: 'allure-results' }],
    ['blob'],
    ['playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-test-project',
      reports: [
        { type: 'html' },                                         // playwright-report/ (default)
        { type: 'monocart' },                                     // monocart-report/   (default)
        { type: 'allure', dir: 'allure-results' },                // custom directory
        { type: 'blob', dir: 'blob-report', label: 'Blob Archive' } // downloadable zip
      ]
    }]
  ],
});
```

**Built-in report types with auto-detected directories:**

| Type         | Default directory   | Behaviour in UI       |
|--------------|---------------------|-----------------------|
| `html`       | `playwright-report/`| Opens in new tab      |
| `monocart`   | `monocart-report/`  | Opens in new tab      |
| `allure`     | `allure-results/`   | Opens in new tab      |
| `blob`       | `blob-report/`      | Downloaded as archive |

Any other type is also accepted; the directory must be provided via `dir`.

### Options

- `serverUrl` (string): Dashboard server URL (default: `http://localhost:3000`)
- `projectName` (string): Project name in dashboard (default: `default-project`)
- `uploadTraces` (boolean): Upload trace files (default: `true`)
- `uploadReport` (boolean): Upload Playwright HTML report (default: `true`)
- `reports` (array): Additional report types to upload (see [Multiple Reports](#multiple-reports))
- `projectDescription` (string): Project description (optional)
- `relatedIssue` (string): Related issue reference, e.g., "JIRA-123" (optional)
- `ciInfo` (string): CI job information (optional)
- `tags` (string[]): Tags to categorize test runs (optional)
- `customData` (object): Additional custom metadata (optional)
- `collectScmInfo` (boolean): Auto-collect git info (default: `true`)
- `collectCiInfo` (boolean): Auto-collect CI environment info (default: `true`)
- `collectPerformanceMetrics` (boolean): Collect step timings, network requests and web vitals (default: `true`)

### Performance Metrics & Network Analysis

Enable automatic collection of network request timing and browser Web Vitals by importing the dashboard fixture instead of `@playwright/test`:

```typescript
// fixtures.ts (or directly in your test file)
import { test as base } from '@playwright/test'
import { dashboardFixtures } from 'playwright-dashboard-reporter/fixtures'

export const test = base.extend(dashboardFixtures)
export { expect } from '@playwright/test'
```

Or use the drop-in replacement directly:

```typescript
// Import from the fixtures module instead of @playwright/test
import { test, expect } from 'playwright-dashboard-reporter/fixtures'
```

When the fixture is active, the reporter automatically uploads per-test:
- **Network requests** – method, URL, status code, duration, resource type; aggregated on the dashboard into a *Slow API Endpoints* table grouped by `METHOD + normalised route` (e.g. `/api/users/:id`)
- **Browser Web Vitals** – TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint – displayed with colour-coded thresholds

### Metadata Collection

The reporter automatically collects and displays:
- **SCM Info**: Git commit, branch, author, commit message (auto-collected)
- **CI Info**: Build number, job name, build URL for Jenkins, GitHub Actions, GitLab CI, CircleCI, Travis CI, Azure Pipelines (auto-collected)
- **Playwright Config**: Browser info, viewport, workers, timeout settings (auto-collected)
- **Custom Data**: Any additional metadata you provide via options

Example with metadata:
```typescript
export default defineConfig({
  reporter: [
    ['playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
      projectDescription: 'E2E tests for the application',
      relatedIssue: 'PROJ-123',
      tags: ['regression', 'critical'],
      customData: {
        environment: 'staging',
        version: '1.2.3'
      }
    }]
  ],
});
```

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

## File Storage Configuration

The dashboard supports two storage backends for storing test artifacts (HTML reports, trace files, etc.):

- **Local File Storage** (default) - Stores files in the local file system
- **AWS S3 Storage** - Stores files in an S3 bucket (or S3-compatible services like MinIO, DigitalOcean Spaces, etc.)

### Local Storage (Default)

By default, files are stored locally in the `.data/storage` directory. No configuration is required.

To customize the local storage path:

```bash
# In .env file
STORAGE_TYPE=local
STORAGE_PATH=/custom/path/to/storage
```

### S3 Storage

To use S3 storage, you need to configure the following environment variables:

```bash
# In .env file
STORAGE_TYPE=s3

# Required S3 settings
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key

# Optional: Custom S3 endpoint (for S3-compatible services)
S3_ENDPOINT=https://s3.example.com
```

#### AWS Credentials

You can obtain AWS credentials from:
1. **AWS Console** → IAM → Users → Create User → Create Access Key
2. Ensure the IAM user has permissions to read/write objects in the specified bucket

Required IAM permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:HeadObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

#### S3-Compatible Services

The dashboard works with S3-compatible services by setting the `S3_ENDPOINT` variable:

**MinIO:**
```bash
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=playwright-dashboard
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
```

**DigitalOcean Spaces:**
```bash
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_BUCKET=your-space-name
S3_REGION=nyc3
S3_ACCESS_KEY_ID=your-spaces-key
S3_SECRET_ACCESS_KEY=your-spaces-secret
```

**Cloudflare R2:**
```bash
S3_ENDPOINT=https://[account-id].r2.cloudflarestorage.com
S3_BUCKET=your-bucket-name
S3_REGION=auto
S3_ACCESS_KEY_ID=your-r2-access-key
S3_SECRET_ACCESS_KEY=your-r2-secret-key
```

### Storage Architecture

The dashboard uses an abstraction layer that allows switching between storage backends without code changes. Files are stored with relative paths (e.g., `project-1/run-123/index.html`) making it easy to migrate between storage backends.

### Installing AWS SDK (if needed)

The AWS SDK is automatically installed as a dependency. If you encounter any issues:

```bash
npm install @aws-sdk/client-s3
```

## Database Management

The dashboard uses Drizzle ORM with SQLite for database storage. Database schema changes are managed through Drizzle migrations.

### Automatic Migrations

The database is automatically migrated when the application starts. On first API call, Drizzle will:
1. Check for pending migrations
2. Apply any new migrations
3. Track applied migrations in the `__drizzle_migrations` table

No manual intervention is required for normal operation.

### Managing Database Schema

If you need to modify the database schema:

```bash
# 1. Edit the schema file
# Edit server/database/schema.ts

# 2. Generate a new migration
npm run db:generate

# 3. (Optional) Review the generated migration
# Check server/database/migrations/XXXX_name.sql

# 4. Restart the application
# Migrations will be applied automatically on next startup
npm run dev
```

### Database Scripts

```bash
# Generate a new migration from schema changes
npm run db:generate

# Apply migrations to database (automatic on app startup)
npm run db:migrate

# Push schema changes directly (skip migrations, for dev only)
npm run db:push

# Open Drizzle Studio to browse database
npm run db:studio
```

### Migration Files

Migrations are stored in `server/database/migrations/`:
- `XXXX_name.sql` - SQL migration files
- `meta/_journal.json` - Migration history
- `meta/XXXX_snapshot.json` - Schema snapshots

**Important**: Never delete or modify existing migration files. Always generate new migrations for schema changes.

### Database Location

The SQLite database is stored at `.data/playwright.db` by default. You can customize this location with the `DATABASE_PATH` environment variable:

```bash
DATABASE_PATH=/custom/path/database.db npm run dev
```

## Project Structure

```
├── .data/                    # SQLite database and local file storage (gitignored)
│   ├── playwright.db        # SQLite database
│   └── storage/             # Local file storage (HTML reports, traces)
├── app/
│   ├── pages/               # Dashboard pages
│   │   ├── index.vue        # Home dashboard
│   │   ├── projects/        # Project pages
│   │   │   ├── index.vue    # Projects list
│   │   │   ├── [id].vue     # Project details with test runs
│   │   │   ├── [id]/        # Sub-pages per project
│   │   │   │   ├── performance.vue  # Performance trend + slowest tests + run comparison
│   │   │   │   └── test-cases.vue   # All test cases for a project
│   │   ├── test-runs/[id].vue   # Test run details + slow API endpoints table
│   │   └── test-cases/[id].vue  # Test case details + steps, web vitals, network requests
│   ├── components/
│   │   └── PerformanceTrendChart.vue  # Line chart for duration trends
│   └── layouts/
│       └── default.vue      # Main layout with navigation
├── server/
│   ├── database/
│   │   ├── schema.ts        # Database schema (Drizzle ORM)
│   │   ├── index.ts         # Database initialization
│   │   └── migrations/      # Drizzle migration files
│   │       ├── 0000_*.sql   # Initial schema
│   │       ├── 0001_*.sql   # Performance columns
│   │       ├── 0002_*.sql   # Network requests & web vitals columns
│   │       └── meta/         # Migration metadata
│   ├── storage/             # Storage abstraction layer
│   │   ├── index.ts         # Storage factory
│   │   ├── local.ts         # Local file storage adapter
│   │   ├── s3.ts            # S3 storage adapter
│   │   └── types.ts         # Storage interfaces
│   └── api/                 # API endpoints
│       ├── projects/
│       │   ├── index.get.ts
│       │   ├── [id].get.ts
│       │   ├── [id]/performance.get.ts   # Performance trend data
│       │   └── [id]/slow-tests.get.ts    # Slowest test cases
│       ├── test-runs/
│       │   ├── submit.post.ts
│       │   ├── upload.post.ts
│       │   ├── [id].get.ts
│       │   └── [id]/network-requests.get.ts  # Grouped network requests
│       ├── test-cases/[id].get.ts
│       └── files/[...path].get.ts
├── reporter/                # Playwright Reporter package
│   ├── index.js            # Reporter implementation
│   ├── fixtures.js         # Page fixture for network/web vitals capture
│   ├── index.d.ts          # TypeScript definitions
│   ├── package.json
│   └── README.md           # Reporter documentation
├── tests/                  # Functional tests
│   ├── api-server.spec.ts
│   ├── dashboard-ui.spec.ts
│   ├── performance-api.spec.ts
│   ├── performance-ui.spec.ts
│   ├── reporter-integration.spec.ts
│   ├── file-upload.spec.ts
│   ├── fixtures.ts         # Shared test fixture (uses dashboardFixtures)
│   └── README.md           # Test documentation
├── playwright.config.ts    # Playwright test configuration
├── drizzle.config.ts       # Drizzle migration configuration
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

- **API Server Tests** (`api-server.spec.ts`): REST API endpoints, error handling, data validation
- **Dashboard UI Tests** (`dashboard-ui.spec.ts`): Page rendering, navigation, responsive design (uses `dashboardFixtures`)
- **Performance API Tests** (`performance-api.spec.ts`): Performance endpoints, network requests, web vitals storage
- **Performance UI Tests** (`performance-ui.spec.ts`): Performance views, run comparison, web vitals display (uses `dashboardFixtures`)
- **Reporter Integration Tests** (`reporter-integration.spec.ts`): Reporter functionality, configuration, fixtures exports
- **File Upload Tests** (`file-upload.spec.ts`): File uploads, downloads, security

See [`tests/README.md`](./application/tests/README.md) for detailed testing documentation.

## Database Schema

The dashboard uses SQLite with the following tables:

- **projects** - Test projects
- **test_runs** - Test execution runs (includes `avg_test_duration`, `p90_test_duration` for trend queries)
- **test_runs_cases** - Individual test cases (includes `steps`, `slowest_step`, `network_requests`, `web_vitals` JSON columns)
- **traces** - Playwright trace files
- **users** - User accounts for authentication

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
