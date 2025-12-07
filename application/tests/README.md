# Functional Tests

This directory contains functional tests for the Playwright Dashboard using Playwright Test.

## Test Structure

- **`api-server.spec.ts`** - Tests for REST API endpoints
  - Project creation and retrieval
  - Test run submission and querying
  - Test case details
  - Error handling

- **`dashboard-ui.spec.ts`** - Tests for the dashboard UI
  - Home page rendering
  - Projects list and navigation
  - Project details page
  - Test run details page
  - Project switcher dropdown
  - Responsive design

- **`reporter-integration.spec.ts`** - Tests for the Playwright reporter
  - Reporter module loading
  - Configuration options
  - Test result collection
  - Upload to server
  - TypeScript definitions

- **`file-upload.spec.ts`** - Tests for file upload functionality
  - HTML report upload
  - Trace file upload
  - File download
  - Security (path traversal prevention)
  - Error handling

## Running Tests

### All Tests
```bash
npm test
```

### Specific Test File
```bash
npx playwright test api-server.spec.ts
```

### With UI Mode
```bash
npm run test:ui
```

### View Test Report
```bash
npm run test:report
```

### Watch Mode
```bash
npx playwright test --watch
```

## Configuration

Tests are configured in `playwright.config.ts` at the project root. Key settings:

- **baseURL**: `http://localhost:3000`
- **webServer**: Automatically starts the dev server before tests
- **retries**: 2 retries on CI, 0 locally
- **fullyParallel**: Tests run in parallel for speed

## Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright browsers (if not already installed):
   ```bash
   npx playwright install
   ```

3. The dev server will start automatically when running tests

## Writing New Tests

Follow these patterns when adding tests:

### API Tests
```typescript
test('should do something', async ({ request }) => {
  const response = await request.get('/api/endpoint');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data).toBeDefined();
});
```

### UI Tests
```typescript
test('should display element', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Element')).toBeVisible();
});
```

### Setup/Teardown
```typescript
test.beforeEach(async ({ request }) => {
  // Setup test data
  await request.post('/api/test-runs/submit', { data: {...} });
});
```

## Debugging Tests

### Debug Mode
```bash
npx playwright test --debug
```

### Generate Code
```bash
npx playwright codegen http://localhost:3000
```

### View Trace
```bash
npx playwright show-trace trace.zip
```

## CI/CD Integration

Tests are designed to run in CI environments:

- Automatic dev server startup
- Retry failed tests
- HTML report generation
- Screenshot on failure
- Video recording on failure

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Use beforeEach/afterEach for setup/teardown
3. **Assertions**: Use meaningful expect() assertions
4. **Selectors**: Prefer role-based selectors over CSS
5. **Waiting**: Use built-in auto-waiting, avoid manual waits
6. **Data**: Create test data dynamically, don't rely on existing data

## Troubleshooting

### Port Already in Use
If port 3000 is in use, the tests will fail to start. Stop any running dev servers:
```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill
```

### Tests Timing Out
Increase timeout in playwright.config.ts or specific tests:
```typescript
test('slow test', async ({ page }) => {
  test.setTimeout(60000); // 60 seconds
  // ... test code
});
```

### Database Issues
Tests use the same database as dev. If tests fail due to data conflicts, delete the database:
```bash
rm -rf .data/playwright.db
```

## Coverage

To see what's covered by tests, review the test files. Future improvements:
- Add code coverage reporting
- Integration tests with real Playwright reporter
- Performance testing
- Load testing
