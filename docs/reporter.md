---
title: Reporter
lang: en-US
---

# Piwi Dashboard reporter

The `@phenx/piwi-dashboard-reporter` package is a custom Playwright reporter that automatically uploads test results, HTML reports, and trace files to the dashboard after each run.

## Installation

```bash
npm install --save-dev @phenx/piwi-dashboard-reporter
```

## Basic configuration

Add the reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@phenx/piwi-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
    }],
  ],
  use: {
    trace: 'retain-on-failure',
  },
})
```

## Configuration options

| Option                      | Type     | Default                   | Description                                                                   |
|-----------------------------|----------|---------------------------|-------------------------------------------------------------------------------|
| `serverUrl`                 | string   | `'http://localhost:3000'` | URL of the Piwi Dashboard server                                        |
| `projectName`               | string   | `'default-project'`       | Name of the project to report results under                                   |
| `uploadTraces`              | boolean  | `true`                    | Upload trace files to the dashboard                                           |
| `uploadReport`              | boolean  | `true`                    | Upload the Playwright HTML report                                             |
| `reports`                   | array    | —                         | Additional report types to upload (see [Multiple reports](#multiple-reports)) |
| `streaming`                 | boolean  | `true`                    | Enable live streaming of results (falls back to batch if unsupported)         |
| `streamingBatchSize`        | number   | `5`                       | Number of test results to batch before sending                                |
| `streamingBatchDelay`       | number   | `2000`                    | Max delay (ms) before flushing pending events                                 |
| `projectDescription`        | string   | —                         | Description of the project                                                    |
| `environment`               | string   | —                         | Deployment environment for this run, e.g. `"production"`, `"staging"`, `"integration"` |
| `relatedIssue`              | string   | —                         | Related issue reference, e.g. `"JIRA-123"`                                    |
| `ciInfo`                    | string   | —                         | CI job information                                                            |
| `tags`                      | string[] | —                         | Tags to categorize the test run                                               |
| `customData`                | object   | —                         | Additional custom metadata as key-value pairs                                 |
| `collectScmInfo`            | boolean  | `true`                    | Auto-collect git commit, branch, author                                       |
| `collectCiInfo`             | boolean  | `true`                    | Auto-collect CI environment info                                              |
| `collectPerformanceMetrics` | boolean  | `true`                    | Collect step timings, network requests and web vitals                         |
| `username`                  | string   | —                         | Username for dashboard login (use `apiKey` instead when possible)             |
| `password`                  | string   | —                         | Password for dashboard login (used with `username`)                           |
| `apiKey`                    | string   | —                         | API key for authentication (preferred over `username`/`password` for CI)      |

## Live streaming

By default, the reporter streams test results to the dashboard in real-time as tests complete. This allows you to monitor test progress live in the dashboard UI.

### How it works

1. When tests start, the reporter creates a run on the server with `running` status
2. As each test completes, results are sent in batches to the server
3. The dashboard UI shows a live progress bar and test results as they arrive
4. When tests finish, the reporter finalizes the run with the overall status

### Disabling streaming

If you prefer the original batch-only behavior (all results sent at the end):

```typescript
['@phenx/piwi-dashboard-reporter', {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  streaming: false,
}]
```

### Tuning batch parameters

Control how frequently results are sent during streaming:

```typescript
['@phenx/piwi-dashboard-reporter', {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  streamingBatchSize: 10,     // send every 10 tests
  streamingBatchDelay: 5000,  // or every 5 seconds
}]
```

### Backward compatibility

- If the server doesn't support streaming (e.g. older version), the reporter automatically falls back to batch mode
- The existing `submit` and `upload` endpoints continue to work unchanged

## Multiple reports

Attach multiple report types to a single test run. Each report appears as a separate button in the dashboard UI.

```typescript
export default defineConfig({
  reporter: [
    ['list'],
    ['@playwright/test/reporter-html', { outputFolder: 'playwright-report' }],
    ['monocart-reporter', { name: 'My Tests', outputFile: 'monocart-report/index.html' }],
    ['blob'],
    ['@phenx/piwi-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
      reports: [
        { type: 'html' },
        { type: 'monocart' },
        { type: 'blob', dir: 'blob-report', label: 'Blob archive' },
      ],
    }],
  ],
})
```

Built-in report types with auto-detected directories:

| Type       | Default directory    | Behavior in UI        |
|------------|----------------------|-----------------------|
| `html`     | `playwright-report/` | Opens in new tab      |
| `monocart` | `monocart-report/`   | Opens in new tab      |
| `blob`     | `blob-report/`       | Downloaded as archive |

Any other type is also accepted; the directory must be provided via `dir`.

## Performance metrics & Web Vitals

To automatically capture network request timing and browser Web Vitals, use the `dashboardFixtures` in your test setup.

**Option A – extend your existing fixtures:**

```typescript
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { dashboardFixtures } from '@phenx/piwi-dashboard-reporter/fixtures'

export const test = base.extend(dashboardFixtures)
export { expect }
```

Then import `test` from your fixture file in every test:

```typescript
import { test, expect } from './fixtures'

test('homepage loads', async ({ page }) => {
  await page.goto('/')
  // network requests & web vitals are captured automatically
})
```

**Option B – drop-in replacement:**

```typescript
import { test, expect } from '@phenx/piwi-dashboard-reporter/fixtures'
```

### What gets captured

- **Network requests** — method, URL, status code, duration, resource type. Aggregated on the dashboard into a *Slow API endpoints* table grouped by `METHOD + normalized route` (e.g. `/api/users/:id`).
- **Browser Web Vitals** — TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint — displayed with color-coded thresholds.

Both are only collected when `collectPerformanceMetrics` is `true` (the default).

## Automatic metadata collection

### SCM information (Git)

When `collectScmInfo` is enabled (default), the reporter collects:

- Commit hash and message
- Branch name
- Author name
- Remote URL

### CI information

When `collectCiInfo` is enabled (default), the reporter auto-detects:

| Platform        | Collected fields                                          |
|-----------------|-----------------------------------------------------------|
| GitHub Actions  | Run ID, run number, workflow, actor, repository, ref, SHA |
| Jenkins         | Build number, build URL, job name                         |
| GitLab CI       | Pipeline ID, pipeline URL, job ID, job URL, job name      |
| CircleCI        | Build number, build URL, job name, workflow               |
| Travis CI       | Build number, build URL, job number                       |
| Azure Pipelines | Build number, build ID, build URL, job name               |

### Playwright configuration

The reporter also records browser project configs, worker count, test timeout, and parallel settings.

## With custom metadata

```typescript
export default defineConfig({
  reporter: [
    ['@phenx/piwi-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
      projectDescription: 'End-to-end tests for the main application',
      environment: 'staging',
      relatedIssue: 'PROJ-123',
      tags: ['regression', 'critical'],
      customData: {
        version: '1.2.3',
      },
    }],
  ],
})
```

## Disabling automatic collection

```typescript
export default defineConfig({
  reporter: [
    ['@phenx/piwi-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
      collectScmInfo: false,
      collectCiInfo: false,
      collectPerformanceMetrics: false,
    }],
  ],
})
```

## How it works

1. The reporter collects test results during the run.
2. After all tests complete, it uploads results to the dashboard.
3. If `uploadReport` is enabled, the entire `playwright-report/` directory is compressed with gzip and uploaded.
4. If `uploadTraces` is enabled, all trace files found in test attachments are uploaded.
5. If `dashboardFixtures` are active, network request and web vitals attachments are included per test case.
6. The server decompresses the report and makes it available for viewing, with fully functional HTML reports.

## Troubleshooting

### Reporter not uploading files

- Make sure an HTML reporter is configured: `['html', { outputFolder: 'playwright-report' }]`
- Make sure traces are enabled: `use: { trace: 'retain-on-failure' }`
- Check the dashboard server is running and accessible at `serverUrl`

### Network/Web Vitals not appearing

- Import `test` from `@phenx/piwi-dashboard-reporter/fixtures` (or extend with `dashboardFixtures`)
- Verify `collectPerformanceMetrics` is not set to `false`
- Ensure tests navigate to at least one page (`await page.goto(...)`)

### Connection errors

- Verify `serverUrl` is correct and the server is running
- Check network connectivity and firewall settings

## With authentication enabled

When the dashboard has authentication enabled, the reporter must authenticate before submitting results.

### Recommended: API key (preferred for CI)

Generate an API key in the dashboard UI (Settings → Users → API keys button), then configure the reporter:

```typescript
export default defineConfig({
  reporter: [
    ['@phenx/piwi-dashboard-reporter', {
      serverUrl: 'http://your-dashboard.example.com',
      projectName: 'my-project',
      apiKey: process.env.DASHBOARD_API_KEY,
    }],
  ],
})
```

The key is sent as an `Authorization: Bearer <key>` header. Store it in a CI secret — never hard-code it.

### Alternative: username/password

```typescript
export default defineConfig({
  reporter: [
    ['@phenx/piwi-dashboard-reporter', {
      serverUrl: 'http://your-dashboard.example.com',
      projectName: 'my-project',
      username: process.env.DASHBOARD_USERNAME,
      password: process.env.DASHBOARD_PASSWORD,
    }],
  ],
})
```

The reporter calls `/api/auth/login` automatically before each upload.

See [Authentication](/authentication) for details on enabling auth, creating users, and managing API keys.
