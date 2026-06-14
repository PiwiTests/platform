# Functional Tests

This directory contains functional tests for the Piwi Dashboard using Playwright Test.

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
npm run app:test:ui
```

### View Test Report

```bash
npm run app:test:report
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
- **workers**: 1 (serial execution — the suite uses static project names shared across tests, requiring sequential cleanup)

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

### UI Tests (with dashboard fixture)

```typescript
// Import from fixtures.ts so network requests and web vitals are captured
import { test, expect } from './fixtures';

test('should display element', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Element')).toBeVisible();
  // network requests & web vitals are automatically attached to the test report
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
7. **Fixtures**: Import `test` from `./fixtures` in all UI tests for automatic network and web vitals capture

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

Tests use the same database as dev. If tests fail due to data conflicts, delete the database (and all data) before running tests:

```bash
rm -rf .data
```
