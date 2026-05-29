# Playwright Dashboard - Copilot Instructions

## Project Overview
This is a Playwright test results dashboard built with Nuxt 4, using the Nuxt UI dashboard template. It stores and displays Playwright test results organized by projects.

## Prerequisites
Before working on this project, ensure you have:
- **Node.js**: Version 24 or higher (CI uses Node.js 24)
- **npm**: Comes with Node.js, used for package management
- **Git**: For version control

## Quick Start
To get the dashboard running locally:

```bash
# Navigate to the application directory
cd application

# Install dependencies
npm install

# Start the development server
npm run dev
```

The dashboard will be available at `http://localhost:3000`. The SQLite database will be automatically initialized on the first API call.

## Repository Structure
The repository is organized into three main parts:
- **application/** - The Nuxt 4 dashboard application
- **application/tests/** - Functional tests for the dashboard
- **reporter/** - Custom Playwright reporter package for automatic result submission

## Architecture

### Database
- **ORM**: Drizzle ORM with better-sqlite3
- **Migrations**: Managed by Drizzle Kit with automatic migration on startup
- **Location**: `application/.data/playwright.db` (SQLite database)
- **Schema**: Defined in `application/server/database/schema.ts`
- **Migrations**: Stored in `application/server/database/migrations/`
- **Tables**:
  - `projects` - Test projects
  - `test_runs` - Test execution runs
  - `test_cases` - Individual test cases
  - `test_runs_cases` - Junction table linking test runs to test cases
  - `traces` - Playwright traces for test cases
  - `users` - User accounts for authentication

### Backend (Server Directory)
- **Database**: `application/server/database/` - Schema and database initialization
- **API Routes**: `application/server/api/` - REST API endpoints
  - `POST /api/test-runs/submit` - Submit new test results as JSON (auto-creates projects)
  - `POST /api/test-runs/upload` - Upload test results with HTML reports and trace files
  - `GET /api/projects` - List all projects with stats
  - `GET /api/projects/[id]` - Get project details with test runs
  - `GET /api/test-runs/[id]` - Get test run details with test cases
  - `GET /api/test-cases/[id]` - Get test case details with traces
  - `GET /api/files/[...path]` - Download HTML reports and trace files

### Frontend (App Directory)
- **Pages**: `application/app/pages/`
  - `/` - Dashboard home with overview statistics
  - `/projects` - List of all projects
  - `/projects/[id]` - Project detail page with test runs
  - `/test-runs/[id]` - Test run detail page with test cases
  - `/test-cases/[id]` - Test case detail page with traces and errors
- **Layout**: `application/app/layouts/default.vue` - Main dashboard layout with sidebar navigation

### Tests
- **Location**: `application/tests/`
- **Test Files**:
  - `api-server.spec.ts` - REST API endpoint tests
  - `dashboard-ui.spec.ts` - Dashboard UI tests
  - `file-upload.spec.ts` - File upload functionality tests
  - `reporter-integration.spec.ts` - Playwright reporter integration tests
  - `zstd-compression.spec.ts` - Compression functionality tests
- **Config**: `application/playwright.config.ts`

### Reporter Package
- **Location**: `reporter/`
- **Main File**: `reporter/index.js` - Custom Playwright reporter implementation
- **Types**: `reporter/index.d.ts` - TypeScript definitions
- **Package**: `reporter/package.json` - NPM package configuration

## Key Features
1. **Auto-create Projects**: Unknown projects submitted via API are automatically created
2. **Test Result Storage**: Stores complete test run information including:
   - Test status (passed, failed, timedout, skipped)
   - Duration and timing information
   - Test case details and locations
   - Error messages for failed tests
   - Complete HTML report directories (with all assets: CSS, JS, images, fonts)
   - Trace files (can be downloaded and opened in Playwright Trace Viewer)
3. **Dashboard Views**: Multiple views for projects, runs, and test cases
4. **REST API**: 
   - JSON API for submitting test results
   - Multipart API for uploading HTML reports (as zip) and trace files
5. **File Storage**: 
   - HTML reports extracted and stored in `application/.data/storage` directory
   - Trace files stored alongside test cases
   - All report assets (CSS, JS, images) properly served with correct MIME types
   - **Path Storage**: Database stores relative paths (e.g., `project-1/run-123/index.html`) without the storage directory prefix for portability

## Code Style
- **Keep it simple**: Code is intentionally simple for easy modifications by AI assistants
- **TypeScript**: Fully typed with TypeScript
- **Nuxt conventions**: Follow Nuxt 4 file-based routing and auto-imports
- **UI Components**: Use Nuxt UI components (@nuxt/ui)

## UI best practices
- Do not capitalize every word in the UI. Use sentence case for better readability (e.g., "Test runs" instead of "Test Runs").
- When displaying dates and times, use relative formats (e.g., "5 minutes ago") instead of absolute timestamps for better user experience, with the full timestamp, human-readable format, and timezone available on hover for clarity. (use date-fns)
- When displaying durations, use human-readable formats (e.g., "2m 30s" instead of "150000 ms") for better readability, with the exact duration in milliseconds available on hover for precision. (use date-fns)

## Environment Configuration
The application uses minimal environment configuration:

- **`.env.example`**: Template for environment variables (in `application/` directory)
- **`NUXT_PUBLIC_SITE_URL`**: (Optional) Public URL for OG Image generation

To configure:
```bash
cd application
cp .env.example .env
# Edit .env with your values (optional)
```

The application works without any environment variables set. Database and storage are automatically created in `application/.data/`.

## Development Commands

### Dashboard Application (from `application/` directory)
```bash
cd application
npm install          # Install dependencies
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Build for production
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
npm test             # Run functional tests
npm run test:ui      # Run tests with UI mode
npm run test:report  # View test report

# Database migration commands
npm run db:generate  # Generate new migration from schema changes
npm run db:migrate   # Apply pending migrations (automatic on startup)
npm run db:push      # Push schema changes directly (dev only, skip migrations)
npm run db:studio    # Open Drizzle Studio to browse database
```

### Reporter Package (from `reporter/` directory)
```bash
cd reporter
npm install          # Install dependencies
npm link             # Link package for local development
```

## Making Changes

### Adding New Database Fields
1. Update schema in `application/server/database/schema.ts`
2. Generate a new migration with `npm run db:generate`
3. Review the generated migration file in `application/server/database/migrations/`
4. Restart the application - migrations run automatically on startup
5. TypeScript types are auto-inferred from schema

### Adding New API Endpoints
1. Create file in `application/server/api/` following Nuxt file-based routing
2. Use `eventHandler()` wrapper
3. Import and use `getDatabase()` for DB access
4. Return JSON data directly

### Adding New Pages
1. Create Vue component in `application/app/pages/` following Nuxt file-based routing
2. Use `<UDashboardPanel>` wrapper for consistent layout
3. Use `useFetch()` composable for API calls
4. Use Nuxt UI components for consistent styling

### Modifying Navigation
1. Edit `application/app/layouts/default.vue`
2. Update `links` array with new menu items

### Adding Tests
1. Create test file in `application/tests/` with `.spec.ts` extension
2. Follow existing test patterns (see `application/tests/README.md`)
3. Run tests with `npm test` from the `application/` directory

### Modifying Reporter
1. Edit reporter logic in `reporter/index.js`
2. Update TypeScript definitions in `reporter/index.d.ts`
3. Test changes by linking: `cd reporter && npm link`

## Testing API
Submit test results using curl or any HTTP client:

```bash
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "my-test-project",
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
        "location": "tests/login.spec.ts:10:5"
      }
    ]
  }'
```

## Common Tasks

### Add new statistics to home page
- Edit `application/app/pages/index.vue`
- Update `stats` computed property

### Add filtering to project list
- Edit `application/app/pages/projects/index.vue`
- Add filter UI and logic

### Store additional test metadata
- Update `application/server/database/schema.ts` to add fields
- Update API endpoint in `application/server/api/` to accept new fields
- Update UI pages in `application/app/pages/` to display new fields

### Add new test coverage
- Create new test in `application/tests/` directory
- Follow patterns from existing tests
- Run with `npm test` from `application/` directory

### Update reporter functionality
- Modify `reporter/index.js` for reporter logic
- Update `reporter/index.d.ts` for TypeScript types
- Publish updated package or link locally for testing

## Troubleshooting

### Database Issues
- **Database locked**: Ensure no other process is accessing `application/.data/playwright.db`
- **Database not created**: Database is auto-initialized on first API call; try submitting a test result
- **Corrupted database**: Delete `application/.data/` directory and restart the server

### Development Server Issues
- **Port 3000 already in use**: Change port with `PORT=3001 npm run dev` or stop other process
- **Module not found errors**: Run `npm install` in `application/` directory
- **TypeScript errors**: Run `npm run typecheck` to see all type issues

### Test Issues
- **Tests failing**: Ensure dev server is not running on port 3000 (tests start their own server)
- **Trace files not found**: Ensure traces are enabled in Playwright config with `trace: 'retain-on-failure'` or `trace: 'on'`
- **HTML report missing**: Check that Playwright is generating reports with HTML reporter: `reporter: [['html', { outputFolder: 'playwright-report' }]]`

### Reporter Issues
- **Reporter not found**: Run `npm link` in `reporter/` directory, then `npm link @phenx/playwright-dashboard-reporter` in your test project
- **Uploads failing**: Verify `serverUrl` in reporter config points to running dashboard
- **Authentication errors**: This dashboard has no authentication; check network connectivity

## Maintaining documentation

The project has two documentation surfaces that must stay in sync with code changes:

1. **`docs/`** — VitePress documentation site published to https://phenx.github.io/playwright-dashboard.  
   Each page covers a specific topic:
   - `docs/getting-started.md` — requirements, quick-start, first API call, dev commands
   - `docs/reporter.md` — reporter options, multiple reports, fixtures, metadata collection
   - `docs/api.md` — all REST API endpoints with request/response examples
   - `docs/authentication.md` — roles, enabling auth, user management
   - `docs/storage.md` — local and S3 storage config, DB schema management
   - `docs/deployment.md` — Docker, Docker Compose, Kubernetes, production build

2. **`README.md`** — concise project landing page; links out to the docs site.

### When to update docs

Update the relevant `docs/` page(s) **in the same commit** as your code change whenever you:

- Add, remove, or change an **API endpoint** (path, method, request/response shape) → `docs/api.md`
- Add, remove, or change a **reporter option** or fixture behavior → `docs/reporter.md`
- Change **authentication** behavior, roles, or setup steps → `docs/authentication.md`
- Change **storage** configuration, environment variables, or DB migration workflow → `docs/storage.md`
- Change **deployment** steps, Docker image tags, environment variables, or compose/k8s examples → `docs/deployment.md`
- Change **requirements** (Node.js version, dependencies) or the **quick-start** flow → `docs/getting-started.md`
- Add or remove a major **feature** → `docs/index.md` (hero features list) and the relevant detail page

Update `README.md` only when the top-level feature list or the quick-start Docker commands change.

### What does NOT require a doc update

- Internal refactors with no user-visible effect
- Test-only changes
- Dependency bumps with no API/behavior change
- Bug fixes that restore already-documented behavior

## Important Notes
- Database is auto-initialized on first API call
- Projects are auto-created when first test results are submitted
- All dates are stored as Unix timestamps in SQLite
- Keep code simple and well-documented for easy AI modifications
- Run typecheck, lint, and tests before the final commit
