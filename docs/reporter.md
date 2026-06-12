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
| `liveFileUploads`           | boolean  | `true`                    | Upload each test's trace and attachments as soon as the test finishes (streaming mode only) |
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
| `verbose`                   | boolean  | `false`                   | Enable verbose logging for debugging                                          |

## Live streaming

By default, the reporter streams test results to the dashboard in real-time as tests complete. This allows you to monitor test progress live in the dashboard UI.

### How it works

1. When tests start, the reporter creates a run on the server with `running` status
2. As each test completes, results are sent in batches to the server
3. With `liveFileUploads` (the default), each test's trace and attachments are uploaded right after the test finishes, so they are viewable on the test case page while the run is still in progress
4. The dashboard UI shows a live progress bar and test results as they arrive
5. When tests finish, the reporter finalizes the run with the overall status

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

## Global setup phase

By default a run appears on the dashboard as soon as the first test starts. If your Playwright config has a `globalSetup` step (seeding a database, authenticating, building the app under test, etc.), you can register the run *before* `globalSetup` runs so the dashboard shows an animated **initialising** state during setup.

Wrap your config's `globalSetup` with `createGlobalSetup`, passing the same options you give the reporter:

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'
import { createGlobalSetup } from '@phenx/piwi-dashboard-reporter'

const dashboard = {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  apiKey: process.env.DASHBOARD_API_KEY,
}

export default defineConfig({
  globalSetup: createGlobalSetup(dashboard),
  reporter: [
    ['list'],
    ['@phenx/piwi-dashboard-reporter', dashboard],
  ],
})
```

To keep an existing `globalSetup`, pass it as the second argument — it runs after the run is registered:

```typescript
globalSetup: createGlobalSetup(dashboard, async (config) => {
  // your existing setup logic
}),
```

Registration is best-effort: if the server is unreachable the error is non-fatal and the reporter simply creates the run normally once tests begin.

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

### Browser configuration per test case

The reporter automatically captures each test case's Playwright project configuration — `projectName`, `browserName`, `channel`, and `viewport` — via `test.parent.project()`. This is stored in the `browser` field of every test case result.

In the dashboard UI, the test run detail page shows a browser icon and project name as the first column of the test cases table, and you can filter by browser using the dropdown above the table.

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

## Development

The reporter source uses TypeScript (`.ts`) in `src/` and compiles to CommonJS JavaScript (`.js`) with type declarations (`.d.ts`) in `dist/` via the TypeScript compiler.

### Building

```bash
cd reporter
npm install
npm run reporter:build   # compile TypeScript from src/ to dist/
npm run reporter:dev     # watch mode — auto-recompile on changes
```

This produces 13 `.js` + 13 `.d.ts` files in `dist/` — one for each `.ts` source in `src/`.

The compiled output is what Playwright loads at runtime. The `package.json` `exports` field maps `@phenx/piwi-dashboard-reporter/fixtures` directly to `dist/fixtures.js`.

### Source layout

| File                      | Purpose                                              |
|---------------------------|------------------------------------------------------|
| `src/index.ts`            | Entry point — re-exports the class with `createGlobalSetup` attached |
| `src/reporter.ts`         | Main `PiwiDashboardReporter` orchestrator class (Playwright hooks, streaming lifecycle, upload fallback) |
| `src/config.ts`           | `DashboardReporterOptions` interface + `resolveOptions()` defaults merger |
| `src/helpers.ts`          | Utility functions: `getSetupFilePath`, `computeInstanceId`, `createGlobalSetup` |
| `src/http-client.ts`      | `HttpClient` class — HTTP/HTTPS transport (login, postJSON, postFormData) |
| `src/uploader.ts`         | `Uploader` class — upload strategies (JSON, multipart, streaming files) |
| `src/stream-buffer.ts`    | `StreamBuffer` class — persistent JSONL event buffer with staleness cleanup |
| `src/crash-recovery.ts`   | `CrashRecovery` class — save/load/retry recovery data after total failure |
| `src/file-handler.ts`     | `FileHandler` class — report directory detection, trace/attachment file ops |
| `src/metadata-collector.ts` | `MetadataCollector` class — CI, SCM, and Playwright config metadata |
| `src/step-analyzer.ts`    | Pure functions — step categorization, flattening, performance summary |
| `src/compression.ts`      | Directory gzip archiver |
| `src/fixtures.ts`         | Playwright fixtures for network/web-vitals/console capture |

### Shared types

Wire contract types are defined in `application/shared/types.ts` and used by the server for request validation. The reporter does not import them directly — it uses structural `any` typing (Playwright's runtime API is inherently untyped from the reporter's perspective). When making changes, keep the two sides consistent: the reporter's payload shapes must match the server's `TestCasePayload`, `StreamEventPayload`, and `TestRunFinishPayload`.
