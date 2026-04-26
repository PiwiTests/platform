# Playwright Dashboard Reporter

A custom Playwright reporter that sends test results to a Playwright Dashboard server.

## Installation

```bash
npm install --save-dev @phenx/playwright-dashboard-reporter
```

Or if you're using the dashboard from this repository:

```bash
cd playwright-dashboard/reporter
npm install
```

Then link it in your test project:

```bash
npm link @phenx/playwright-dashboard-reporter
```

## Usage

Add the reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['@phenx/playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-test-project',
      uploadTraces: true,
      uploadReport: true
    }]
  ],
  
  // Make sure to enable trace and HTML report
  use: {
    trace: 'retain-on-failure', // or 'on'
  },
});
```

## Configuration Options

| Option                      | Type     | Default                   | Description                                                                       |
|-----------------------------|----------|---------------------------|-----------------------------------------------------------------------------------|
| `serverUrl`                 | string   | `'http://localhost:3000'` | URL of the Playwright Dashboard server                                            |
| `projectName`               | string   | `'default-project'`       | Name of the project to report results under                                       |
| `uploadTraces`              | boolean  | `true`                    | Whether to upload trace files to the dashboard                                    |
| `uploadReport`              | boolean  | `true`                    | Whether to upload the HTML report to the dashboard                                |
| `projectDescription`        | string   | -                         | Description of the project                                                        |
| `relatedIssue`              | string   | -                         | Related issue reference (e.g., JIRA ticket like "PROJ-123")                       |
| `ciInfo`                    | string   | -                         | CI job information (e.g., Jenkins job URL)                                        |
| `tags`                      | string[] | -                         | Tags to categorize the test run                                                   |
| `customData`                | object   | -                         | Additional custom metadata as key-value pairs                                     |
| `collectScmInfo`            | boolean  | `true`                    | Whether to automatically collect SCM info (git commit, branch, author)            |
| `collectCiInfo`             | boolean  | `true`                    | Whether to automatically collect CI environment info                              |
| `collectPerformanceMetrics` | boolean  | `true`                    | Whether to collect step timings, network requests and web vitals from the fixture |

## Performance Metrics & Fixture

### Network Requests and Web Vitals

To automatically capture network request timing and browser Web Vitals, use the `dashboardFixtures` in your test setup:

**Option A – extend your existing fixtures:**

```typescript
// fixtures.ts
import { test as base, expect } from '@playwright/test';
import { dashboardFixtures } from '@phenx/playwright-dashboard-reporter/fixtures';

export const test = base.extend(dashboardFixtures);
export { expect };
```

Then import `test` from your fixture file in every test:

```typescript
import { test, expect } from './fixtures';
```

**Option B – drop-in replacement for `@playwright/test`:**

```typescript
import { test, expect } from '@phenx/playwright-dashboard-reporter/fixtures';
```

### What gets captured

With the fixture active, per-test attachments are automatically added for the reporter to pick up:

- **`playwright-dashboard-network`** – Array of `{ method, url, status, duration, startTime, resourceType }` for every finished request. The dashboard aggregates these into a *Slow API Endpoints* table, grouping by `METHOD + normalised route` (numeric IDs → `:id`, UUIDs → `:uuid`).
- **`playwright-dashboard-web-vitals`** – Browser performance metrics from the last navigated page: TTFB, DOM Interactive, DOMContentLoaded, Load Complete (from `PerformanceNavigationTiming`), plus First Paint and First Contentful Paint (from `PerformancePaintTiming`).

Both are only collected when `collectPerformanceMetrics` is `true` (the default).

## Automatic Metadata Collection

The reporter automatically collects metadata from various sources:

### SCM Information (Git)
When `collectScmInfo` is enabled (default), the reporter automatically collects:
- Commit hash
- Branch name
- Author name
- Commit message
- Remote URL (if available)

### CI Information
When `collectCiInfo` is enabled (default), the reporter automatically detects and collects information from:
- **Jenkins**: Build number, build URL, job name
- **GitHub Actions**: Run ID, run number, workflow, actor, repository, ref, SHA
- **GitLab CI**: Pipeline ID, pipeline URL, job ID, job URL, job name
- **CircleCI**: Build number, build URL, job name, workflow
- **Travis CI**: Build number, build URL, job number
- **Azure Pipelines**: Build number, build ID, build URL, job name

### Playwright Configuration
The reporter also includes metadata from Playwright's configuration:
- Project configurations (browser, viewport, etc.)
- Worker count
- Test timeout
- Parallel execution settings

## Usage Examples

### Basic Configuration
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['@phenx/playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-test-project',
      uploadTraces: true,
      uploadReport: true
    }]
  ],
  
  use: {
    trace: 'retain-on-failure',
  },
});
```

### With Performance Metrics Fixture
```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['@phenx/playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-test-project'
    }]
  ],
  use: {
    trace: 'retain-on-failure',
  },
});

// tests/fixtures.ts  ← create this file
import { test as base, expect } from '@playwright/test';
import { dashboardFixtures } from '@phenx/playwright-dashboard-reporter/fixtures';

export const test = base.extend(dashboardFixtures);
export { expect };

// tests/home.spec.ts  ← use the fixture file
import { test, expect } from './fixtures';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading')).toBeVisible();
  // network requests & web vitals are captured automatically
});
```

### With Custom Metadata
```typescript
export default defineConfig({
  reporter: [
    ['@phenx/playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-test-project',
      projectDescription: 'End-to-end tests for the main application',
      relatedIssue: 'PROJ-123',
      tags: ['regression', 'critical'],
      customData: {
        environment: 'staging',
        version: '1.2.3',
        testSuite: 'smoke-tests'
      }
    }]
  ],
});
```

### Disable Automatic Collection
```typescript
export default defineConfig({
  reporter: [
    ['@phenx/playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-test-project',
      collectScmInfo: false,              // Don't collect git info
      collectCiInfo: false,               // Don't collect CI info
      collectPerformanceMetrics: false    // Don't collect step/network/vitals data
    }]
  ],
});
```

## Features

- **Automatic Upload**: Automatically uploads test results after test run completion
- **Complete HTML Reports**: Compresses and uploads entire HTML report directory with all assets (CSS, JS, images, fonts) using gzip compression
- **Trace Files**: Uploads trace files from test attachments (configure with `trace: 'on'` or `trace: 'retain-on-failure'` in Playwright config)
- **Performance Metrics**: Collects step-level timing, avg/P90 durations, and top slowest tests
- **Network Analysis**: Captures and groups network requests by route for finding slow API endpoints
- **Browser Web Vitals**: Captures TTFB, FCP, DOMContentLoaded and more via the Performance API
- **Fallback**: Falls back to JSON-only upload if file upload fails
- **Status Tracking**: Tracks passed, failed, skipped, and timed-out tests
- **Project Management**: Automatically creates projects if they don't exist

## How It Works

1. The reporter collects test results during the test run
2. After all tests complete, it uploads results to the dashboard
3. If `uploadReport` is enabled, it compresses the entire `playwright-report` directory using gzip and uploads it
4. If `uploadTraces` is enabled, it finds and uploads all trace files
5. If the `dashboardFixtures` are used, network request and web vitals attachments are included per test case
6. The server decompresses the report and makes it available for viewing
7. Results are visible in the Playwright Dashboard web interface with fully functional HTML reports

## Example Output

```
[Playwright Dashboard] Starting test run for project: my-test-project
[Playwright Dashboard] Test run completed. Status: failed (Playwright result.status: failed)
[Playwright Dashboard] Total: 10, Passed: 9, Failed: 1, Skipped: 0, TimedOut: 0
[Playwright Dashboard] Compressing HTML report directory: /path/to/playwright-report
[Playwright Dashboard] Adding HTML report archive: 2458391 bytes
[Playwright Dashboard] Adding trace file: test-results/test-1/trace.zip
[Playwright Dashboard] Found 1 trace files
[Playwright Dashboard] Successfully uploaded test results with files to http://localhost:3000
[Playwright Dashboard] Test Run ID: 1, Project ID: 1
[Playwright Dashboard] HTML Report: .data/storage/project-1/run-1234-index.html
[Playwright Dashboard] Uploaded 1 trace files
```

## Requirements

- Node.js 18 or higher
- Playwright Test 1.40 or higher
- Running Playwright Dashboard server

## Troubleshooting

### Reporter not uploading files

Make sure:
1. HTML report is generated (add `html` reporter to your config)
2. Traces are enabled in your Playwright config
3. The dashboard server is running and accessible

### Network/Web Vitals not appearing

Make sure:
1. You are importing `test` from `@phenx/playwright-dashboard-reporter/fixtures` (or extending with `dashboardFixtures`)
2. The `collectPerformanceMetrics` option is not set to `false`
3. Your tests navigate to at least one page (`await page.goto(...)`)

### Connection errors

- Check that `serverUrl` is correct and the server is running
- Verify network connectivity to the dashboard server
- Check firewall settings if running on different machines

## License

MIT
