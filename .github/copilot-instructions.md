# Playwright Dashboard - Copilot Instructions

## Project Overview
This is a Playwright test results dashboard built with Nuxt 4, using the Nuxt UI dashboard template. It stores and displays Playwright test results organized by projects.

## Architecture

### Database
- **ORM**: Drizzle ORM with better-sqlite3
- **Location**: `.data/playwright.db` (SQLite database)
- **Schema**: Defined in `server/database/schema.ts`
- **Tables**:
  - `projects` - Test projects
  - `test_runs` - Test execution runs
  - `test_cases` - Individual test cases
  - `traces` - Playwright traces for test cases

### Backend (Server Directory)
- **Database**: `server/database/` - Schema and database initialization
- **API Routes**: `server/api/` - REST API endpoints
  - `POST /api/test-runs/submit` - Submit new test results (auto-creates projects)
  - `GET /api/projects` - List all projects with stats
  - `GET /api/projects/[id]` - Get project details with test runs
  - `GET /api/test-runs/[id]` - Get test run details with test cases
  - `GET /api/test-cases/[id]` - Get test case details with traces

### Frontend (App Directory)
- **Pages**:
  - `/` - Dashboard home with overview statistics
  - `/projects` - List of all projects
  - `/projects/[id]` - Project detail page with test runs
  - `/test-runs/[id]` - Test run detail page with test cases
  - `/test-cases/[id]` - Test case detail page with traces and errors
- **Layout**: `app/layouts/default.vue` - Main dashboard layout with sidebar navigation

## Key Features
1. **Auto-create Projects**: Unknown projects submitted via API are automatically created
2. **Test Result Storage**: Stores complete test run information including:
   - Test status (passed, failed, timedout, skipped)
   - Duration and timing information
   - Test case details and locations
   - Error messages for failed tests
   - Trace file paths
3. **Dashboard Views**: Multiple views for projects, runs, and test cases
4. **REST API**: Simple JSON API for submitting test results

## Code Style
- **Keep it simple**: Code is intentionally simple for easy modifications by AI assistants
- **TypeScript**: Fully typed with TypeScript
- **Nuxt conventions**: Follow Nuxt 4 file-based routing and auto-imports
- **UI Components**: Use Nuxt UI components (@nuxt/ui)

## Development Commands
```bash
npm install          # Install dependencies
npm run dev          # Start development server (http://localhost:3000)
npm run build        # Build for production
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
```

## Making Changes

### Adding New Database Fields
1. Update schema in `server/database/schema.ts`
2. Update table creation SQL in `server/database/index.ts`
3. Update TypeScript types (auto-inferred from schema)

### Adding New API Endpoints
1. Create file in `server/api/` following Nuxt file-based routing
2. Use `eventHandler()` wrapper
3. Import and use `getDatabase()` for DB access
4. Return JSON data directly

### Adding New Pages
1. Create Vue component in `app/pages/` following Nuxt file-based routing
2. Use `<UDashboardPanel>` wrapper for consistent layout
3. Use `useFetch()` composable for API calls
4. Use Nuxt UI components for consistent styling

### Modifying Navigation
1. Edit `app/layouts/default.vue`
2. Update `links` array with new menu items

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
- Edit `app/pages/index.vue`
- Update `stats` computed property

### Add filtering to project list
- Edit `app/pages/projects.vue`
- Add filter UI and logic

### Store additional test metadata
- Update `server/database/schema.ts` to add fields
- Update API endpoint to accept new fields
- Update UI pages to display new fields

## Important Notes
- Database is auto-initialized on first API call
- Projects are auto-created when first test results are submitted
- All dates are stored as Unix timestamps in SQLite
- Keep code simple and well-documented for easy AI modifications
