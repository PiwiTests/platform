# Piwi Dashboard Reporter

A custom Playwright reporter that sends test results to a [Piwi Dashboard](https://github.com/PhenX/piwi-dashboard) server. It handles uploading test results, HTML reports, trace files, and performance metrics — with optional live streaming of results as tests execute.

📖 **[Full documentation](https://phenx.github.io/piwi-dashboard/reporter)**

## Installation

```bash
npm install --save-dev @phenx/piwi-dashboard-reporter
```

## Quick start

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

Run your tests — results are uploaded automatically:

```bash
npx playwright test
```

## Configuration Options

| Option                      | Type     | Default                   | Description                                                            |
|-----------------------------|----------|---------------------------|------------------------------------------------------------------------|
| `serverUrl`                 | string   | `'http://localhost:3000'` | URL of the Piwi Dashboard server                                       |
| `projectName`               | string   | `'default-project'`       | Name of the project to report results under                            |
| `uploadTraces`              | boolean  | `true`                    | Whether to upload trace files to the dashboard                         |
| `uploadReport`              | boolean  | `true`                    | Whether to upload the HTML report to the dashboard                     |
| `reports`                   | array    | —                         | Additional report types to upload (html, monocart, blob, or custom)    |
| `streaming`                 | boolean  | `true`                    | Enable live streaming of results as tests complete                     |
| `streamingBatchSize`        | number   | `5`                       | Number of test results to batch before sending                         |
| `streamingBatchDelay`       | number   | `2000`                    | Max delay (ms) before flushing pending events                          |
| `projectDescription`        | string   | —                         | Description of the project                                             |
| `environment`               | string   | —                         | Deployment environment for the run, e.g. `production`, `staging`       |
| `relatedIssue`              | string   | —                         | Related issue reference (e.g., "PROJ-123")                             |
| `ciInfo`                    | string   | —                         | CI job information                                                     |
| `tags`                      | string[] | —                         | Tags to categorize the test run                                        |
| `customData`                | object   | —                         | Additional custom metadata as key-value pairs                          |
| `collectScmInfo`            | boolean  | `true`                    | Auto-collect git commit, branch, author                                |
| `collectCiInfo`             | boolean  | `true`                    | Auto-collect CI environment info                                       |
| `collectPerformanceMetrics` | boolean  | `true`                    | Collect step timings, network requests and web vitals from the fixture |
| `apiKey`                    | string   | —                         | API key for authentication (preferred for CI)                          |
| `username`                  | string   | —                         | Username for dashboard login (use `apiKey` instead when possible)      |
| `password`                  | string   | —                         | Password for dashboard login (used with `username`)                    |
| `verbose`                   | boolean  | `false`                   | Enable verbose logging for debugging                                   |

## Live streaming

By default, the reporter streams test results to the dashboard in real-time. This allows you to monitor progress live in the dashboard UI while CI is still running.

To disable streaming and send all results at the end:

```typescript
['@phenx/piwi-dashboard-reporter', {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  streaming: false,
}]
```

If the server doesn't support streaming (older versions), the reporter automatically falls back to batch mode.

## Multiple reports

Attach multiple report types to a single test run:

```typescript
export default defineConfig({
  reporter: [
    ['list'],
    ['@playwright/test/reporter-html', { outputFolder: 'playwright-report' }],
    ['monocart-reporter', { name: 'My Tests', outputFile: 'monocart-report/index.html' }],
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

## Performance Metrics & Web Vitals

To capture network request timing and browser Web Vitals, use the provided fixtures:

```typescript
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { dashboardFixtures } from '@phenx/piwi-dashboard-reporter/fixtures'

export const test = base.extend(dashboardFixtures)
export { expect }
```

Or as a drop-in replacement:

```typescript
import { test, expect } from '@phenx/piwi-dashboard-reporter/fixtures'
```

### What gets captured

- **Network requests** — method, URL, status, duration, resource type. Aggregated on the dashboard into a *Slow API Endpoints* table grouped by `METHOD + normalized route`.
- **Browser Web Vitals** — TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint — displayed with color-coded thresholds.

Both are only collected when `collectPerformanceMetrics` is `true` (the default).

## Authentication

When the dashboard has authentication enabled, use an API key (recommended for CI):

```typescript
['@phenx/piwi-dashboard-reporter', {
  serverUrl: 'https://your-dashboard.example.com',
  projectName: 'my-project',
  apiKey: process.env.DASHBOARD_API_KEY,
}]
```

Generate a key in the dashboard UI: **Settings → Users → API keys**. Store it as a CI secret.

Alternatively, use `username`/`password` — the reporter will call `/api/auth/login` automatically.

## Automatic Metadata Collection

### SCM Information (Git)

When `collectScmInfo` is enabled (default), the reporter collects:
- Commit hash and message
- Branch name
- Author name
- Remote URL

### CI Information

When `collectCiInfo` is enabled (default), the reporter auto-detects:
- **GitHub Actions** — run ID, workflow, actor, repository, ref, SHA
- **Jenkins** — build number, build URL, job name
- **GitLab CI** — pipeline ID/URL, job ID/URL, job name
- **CircleCI** — build number/URL, job name, workflow
- **Travis CI** — build number/URL, job number
- **Azure Pipelines** — build number, build ID/URL, job name

## How It Works

1. When tests start, the reporter creates a run on the server (streaming mode) or collects results locally (batch mode)
2. As tests complete, results are streamed in batches to the server
3. After all tests finish, HTML reports are compressed and uploaded
4. Trace files from test attachments are uploaded
5. Network request and web vitals data (from fixtures) are included per test case
6. The server stores everything and makes it available in the dashboard UI

## Requirements

- Node.js 18 or higher
- Playwright Test 1.40 or higher
- Running Piwi Dashboard server

## Development

This package is written in TypeScript. Source files live in `src/` and compile to `dist/`.

```bash
cd reporter
npm install
npm run reporter:build   # compile TypeScript src/ → dist/
npm run reporter:dev     # watch mode — auto-recompile on changes
```

### Source layout

| File                       | Responsibility                              |
|----------------------------|---------------------------------------------|
| `src/reporter.ts`          | Orchestrator — Playwright hooks + fallback  |
| `src/config.ts`            | Options interface + defaults                |
| `src/http-client.ts`       | HTTP transport layer                        |
| `src/uploader.ts`          | Upload strategies (JSON, multipart)         |
| `src/stream-buffer.ts`     | Persistent JSONL buffer                     |
| `src/crash-recovery.ts`    | Recovery data management                    |
| `src/file-handler.ts`      | Report/trace/attachment file operations     |
| `src/metadata-collector.ts`| CI, SCM, Playwright config metadata         |
| `src/step-analyzer.ts`     | Step categorization + performance analysis  |
| `src/helpers.ts`           | Pure utility functions                      |
| `src/compression.ts`       | Directory gzip archiver                     |
| `src/fixtures.ts`          | Playwright fixtures                         |
| `src/index.ts`             | Package entry point                         |

The `package.json` `exports` field maps the main entry and `./fixtures` to their `dist/` counterparts.

## Troubleshooting

### Reporter not uploading files

- Ensure an HTML reporter is configured: `['html', { outputFolder: 'playwright-report' }]`
- Ensure traces are enabled: `use: { trace: 'retain-on-failure' }`
- Check the dashboard server is running and accessible at `serverUrl`

### Network/Web Vitals not appearing

- Import `test` from `@phenx/piwi-dashboard-reporter/fixtures` (or extend with `dashboardFixtures`)
- Verify `collectPerformanceMetrics` is not set to `false`
- Ensure tests navigate to at least one page (`await page.goto(...)`)

### Connection errors

- Check that `serverUrl` is correct and the server is running
- Verify network connectivity and firewall settings

## License

MIT
