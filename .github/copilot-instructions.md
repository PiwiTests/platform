# Playwright Dashboard - Copilot Instructions

## Project Overview
This is a Playwright test results dashboard built with Nuxt 4, using the Nuxt UI dashboard template. It stores and displays Playwright test results organized by projects.

## Repository Structure
The repository is organized into three main parts:
- **application/** - The Nuxt 4 dashboard application
- **application/tests/** - Functional tests for the dashboard
- **reporter/** - Custom Playwright reporter package for automatic result submission

## Architecture

### Database
- **ORM**: Drizzle ORM with better-sqlite3
- **Location**: `application/.data/playwright.db` (SQLite database)
- **Schema**: Defined in `application/server/database/schema.ts`
- **Tables**:
  - `projects` - Test projects
  - `test_runs` - Test execution runs
  - `test_cases` - Individual test cases
  - `traces` - Playwright traces for test cases

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
2. Update table creation SQL in `application/server/database/index.ts`
3. Update TypeScript types (auto-inferred from schema)

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

## Important Notes
- Database is auto-initialized on first API call
- Projects are auto-created when first test results are submitted
- All dates are stored as Unix timestamps in SQLite
- Keep code simple and well-documented for easy AI modifications
