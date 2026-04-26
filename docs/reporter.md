---
title: Reporter
lang: en-US
---

# Playwright reporter

The `@phenx/playwright-dashboard-reporter` package is a custom Playwright reporter that automatically uploads test results, HTML reports, and trace files to the dashboard after each run.

## Installation

```bash
npm install --save-dev @phenx/playwright-dashboard-reporter
```

## Basic configuration

Add the reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@phenx/playwright-dashboard-reporter', {
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
| `serverUrl`                 | string   | `'http://localhost:3000'` | URL of the Playwright Dashboard server                                        |
| `projectName`               | string   | `'default-project'`       | Name of the project to report results under                                   |
| `uploadTraces`              | boolean  | `true`                    | Upload trace files to the dashboard                                           |
| `uploadReport`              | boolean  | `true`                    | Upload the Playwright HTML report                                             |
| `reports`                   | array    | —                         | Additional report types to upload (see [Multiple reports](#multiple-reports)) |
| `projectDescription`        | string   | —                         | Description of the project                                                    |
| `relatedIssue`              | string   | —                         | Related issue reference, e.g. `"JIRA-123"`                                    |
| `ciInfo`                    | string   | —                         | CI job information                                                            |
| `tags`                      | string[] | —                         | Tags to categorise the test run                                               |
| `customData`                | object   | —                         | Additional custom metadata as key-value pairs                                 |
| `collectScmInfo`            | boolean  | `true`                    | Auto-collect git commit, branch, author                                       |
| `collectCiInfo`             | boolean  | `true`                    | Auto-collect CI environment info                                              |
| `collectPerformanceMetrics` | boolean  | `true`                    | Collect step timings, network requests and web vitals                         |
| `username`                  | string   | —                         | Username for dashboard login (use `apiKey` instead when possible)             |
| `password`                  | string   | —                         | Password for dashboard login (used with `username`)                           |
| `apiKey`                    | string   | —                         | API key for authentication (preferred over `username`/`password` for CI)      |

## Multiple reports

Attach multiple report types to a single test run. Each report appears as a separate button in the dashboard UI.

```typescript
export default defineConfig({
  reporter: [
    ['list'],
    ['@playwright/test/reporter-html', { outputFolder: 'playwright-report' }],
    ['monocart-reporter', { name: 'My Tests', outputFile: 'monocart-report/index.html' }],
    ['blob'],
    ['@phenx/playwright-dashboard-reporter', {
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

| Type       | Default directory    | Behaviour in UI       |
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
import { dashboardFixtures } from '@phenx/playwright-dashboard-reporter/fixtures'

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
import { test, expect } from '@phenx/playwright-dashboard-reporter/fixtures'
```

### What gets captured

- **Network requests** — method, URL, status code, duration, resource type. Aggregated on the dashboard into a *Slow API endpoints* table grouped by `METHOD + normalised route` (e.g. `/api/users/:id`).
- **Browser Web Vitals** — TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint — displayed with colour-coded thresholds.

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
    ['@phenx/playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-project',
      projectDescription: 'End-to-end tests for the main application',
      relatedIssue: 'PROJ-123',
      tags: ['regression', 'critical'],
      customData: {
        environment: 'staging',
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
    ['@phenx/playwright-dashboard-reporter', {
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

- Import `test` from `@phenx/playwright-dashboard-reporter/fixtures` (or extend with `dashboardFixtures`)
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
    ['@phenx/playwright-dashboard-reporter', {
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
    ['@phenx/playwright-dashboard-reporter', {
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
