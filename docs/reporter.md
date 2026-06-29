---
title: Reporter
lang: en-US
---

# Piwi Dashboard reporter

The `@piwitests/reporter` package is a custom Playwright reporter that automatically uploads test results, HTML reports, and trace files to the dashboard after each run.

## Installation

```bash
npm install --save-dev @piwitests/reporter
```

## Basic configuration

Add the reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['list'],
    ['@piwitests/reporter', {
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

| Option                      | Type     | Default                   | Description                                                                                 |
|-----------------------------|----------|---------------------------|---------------------------------------------------------------------------------------------|
| `serverUrl`                 | string   | `'http://localhost:3000'` | URL of the Piwi Dashboard server                                                            |
| `projectName`               | string   | `'default-project'`       | Name of the project to report results under                                                 |
| `uploadTraces`              | boolean  | `true`                    | Upload trace files to the dashboard                                                         |
| `uploadReport`              | boolean  | `true`                    | Upload the Playwright HTML report                                                           |
| `reports`                   | array    | —                         | Additional report types to upload (see [Multiple reports](#multiple-reports))               |
| `streaming`                 | boolean  | `true`                    | Enable live streaming of results (falls back to batch if unsupported)                       |
| `streamingBatchSize`        | number   | `5`                       | Number of test results to batch before sending                                              |
| `streamingBatchDelay`       | number   | `2000`                    | Max delay (ms) before flushing pending events                                               |
| `liveFileUploads`           | boolean  | `true`                    | Upload each test's trace and attachments as soon as the test finishes (streaming mode only) |
| `projectDescription`        | string   | —                         | Description of the project                                                                  |
| `environment`               | string   | —                         | Deployment environment for this run, e.g. `"production"`, `"staging"`, `"integration"`      |
| `relatedIssue`              | string   | —                         | Related issue reference, e.g. `"JIRA-123"`                                                  |
| `ciInfo`                    | string   | —                         | CI job information                                                                          |
| `tags`                      | string[] | —                         | Tags to categorize the test run                                                             |
| `customData`                | object   | —                         | Additional custom metadata as key-value pairs                                               |
| `collectScmInfo`            | boolean  | `true`                    | Auto-collect git commit, branch, author                                                     |
| `collectCiInfo`             | boolean  | `true`                    | Auto-collect CI environment info                                                            |
| `collectPerformanceMetrics` | boolean  | `true`                    | Collect step timings, network requests and web vitals                                       |
| `captureLocators`           | boolean  | `true`                    | Capture per-action element snapshots that power [locator healing](#locator-healing). Auto-disabled when `collectPerformanceMetrics` is `false` |
| `username`                  | string   | —                         | Username for dashboard login (use `apiKey` instead when possible)                           |
| `password`                  | string   | —                         | Password for dashboard login (used with `username`)                                         |
| `apiKey`                    | string   | —                         | API key for authentication (preferred over `username`/`password` for CI)                    |
| `runLabel`                  | string   | auto-detected from CI     | Stable label tying shards together (e.g. CI run ID). Auto-detected from CI env; override if needed |
| `verbose`                   | boolean  | `false`                   | Enable verbose logging for debugging                                                        |

### Environment variables

Every option above can also be set via a `PIWI_*` environment variable. Env vars are fallbacks — an option passed in the reporter config takes precedence. The one exception is `PIWI_VERBOSE`, which wins over both the default and an explicit option (useful for toggling debug output without editing the config). The mapping is centralized in `src/config.ts` (`PIWI_ENV_KEYS`):

| Env var                         | Option                  | Format          |
|---------------------------------|-------------------------|-----------------|
| `PIWI_DASHBOARD_URL`            | `serverUrl`             | string          |
| `PIWI_PROJECT_NAME`             | `projectName`           | string          |
| `PIWI_API_KEY`                  | `apiKey`                | string (`pd_…`) |
| `PIWI_USERNAME`                 | `username`              | string          |
| `PIWI_PASSWORD`                 | `password`              | string          |
| `PIWI_ENVIRONMENT`              | `environment`           | string          |
| `PIWI_LABEL`                    | `label`                 | string          |
| `PIWI_RUN_LABEL`                | `runLabel`              | string          |
| `PIWI_STREAMING`                | `streaming`             | `true`/`false`  |
| `PIWI_STREAMING_BATCH_SIZE`     | `streamingBatchSize`    | number          |
| `PIWI_STREAMING_BATCH_DELAY`    | `streamingBatchDelay`   | number          |
| `PIWI_LIVE_FILE_UPLOADS`        | `liveFileUploads`       | `true`/`false`  |
| `PIWI_UPLOAD_TRACES`            | `uploadTraces`          | `true`/`false`  |
| `PIWI_UPLOAD_REPORT`            | `uploadReport`          | `true`/`false`  |
| `PIWI_CAPTURE_LOCATORS`         | `captureLocators`       | `true`/`false`  |
| `PIWI_VERBOSE`                  | `verbose`               | `true`/`false`  |

`wrapConfig` forwards the same `PIWI_*` vars into the isolated `global-setup` process so the run registration step shares the reporter's server/auth config.

## Sharding

When using Playwright's built-in test execution sharding (`--shard=1/3`), the reporter automatically groups
all shards into a single logical test run on the dashboard.

### How it works

1. Each shard detects the **run label** — a stable CI pipeline/workflow identifier — from environment
   variables (`GITHUB_RUN_ID`, `CI_PIPELINE_ID`, `CIRCLE_WORKFLOW_ID`, `TRAVIS_BUILD_ID`,
   `BUILD_BUILDID`, `BUILD_ID`, `BUILDKITE_BUILD_ID`, `TEAMCITY_BUILD_ID`, `BITBUCKET_BUILD_NUMBER`,
   `SEMAPHORE_WORKFLOW_ID`, `APPVEYOR_BUILD_ID`, `DRONE_BUILD_NUMBER`).

2. All shards on the same CI run produce the same `instanceId` (derived from `runLabel + projectName`),
   so the server groups them into one run.

3. Each shard gets an independent stream token. The server keeps the run in `running` status
   until **all** shards have called `/finish`.

4. Counters (passed, failed, skipped, total) are **accumulated** across shards. The final status is
   `failed` if any shard reported failures, otherwise `passed`.

5. The dashboard shows a shard progress badge (e.g. `2/3`) on the run detail page while shards are
   still running.

### Zero-config CI

For most CI platforms, no configuration is needed — the run label is auto-detected from environment
variables. Ensure all shards use the same `projectName`.

### Manual override

If auto-detection doesn't work for your CI setup, set `runLabel` manually to a value common to all shards:

```typescript
['@piwitests/reporter', {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  runLabel: process.env.BUILD_TAG || 'my-custom-label',
}]
```

### Playwright shard config

The reporter reads `config.shard` (set by `--shard=1/3`) automatically — no extra config needed.
All batch (`submit`/`upload`) and streaming paths support sharding.

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
['@piwitests/reporter', {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  streaming: false,
}]
```

### Tuning batch parameters

Control how frequently results are sent during streaming:

```typescript
['@piwitests/reporter', {
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
import { createGlobalSetup } from '@piwitests/reporter'

const dashboard = {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  apiKey: process.env.PIWI_API_KEY,
}

export default defineConfig({
  globalSetup: createGlobalSetup(dashboard),
  reporter: [
    ['list'],
    ['@piwitests/reporter', dashboard],
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
    ['@piwitests/reporter', {
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
import { dashboardFixtures } from '@piwitests/reporter'

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

**Option B – one-line extend with `extendDashboardFixtures`:**

```typescript
import { test as base } from '@playwright/test'
import { extendDashboardFixtures } from '@piwitests/reporter'

export const test = extendDashboardFixtures(base)
export { expect } from '@playwright/test'
```

### What gets captured

- **Network requests** — method, URL, status code, duration, resource type. Aggregated on the dashboard into a *Slow API endpoints* table grouped by `METHOD + normalized route` (e.g. `/api/users/:id`).
- **Browser Web Vitals** — TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint — displayed with color-coded thresholds.
- **ARIA snapshot** — Captured automatically on failed/timed-out tests via `page.locator(':root').ariaSnapshot()`. Included in both the debug prompt (`/test-cases/:id`) and the cluster AI diagnosis context.
- **Locator snapshots** — For each acted-on element (click, fill, etc.) the fixtures record the element's attributes and a ranked list of alternative locators, stamped with the call site. These power [locator healing](#locator-healing) when a locator later breaks. Gated by `captureLocators` (default on).

These are only collected when `collectPerformanceMetrics` is `true` (the default). If the ARIA snapshot does not appear in the dashboard, the most likely cause is that your test files do not import `test` from the package's fixtures subpath (see options A/B above).

## Locator healing

When a locator stops matching — a button was renamed, an element moved, a hashed class changed — Piwi suggests concrete, ranked replacements instead of leaving you to guess.

While tests run, the fixtures wrap Playwright's locator methods (`getByRole`, `getByTestId`, `locator`, …) and, after each successful action, record the target element's attributes plus a list of alternative locators ranked by a stability score (`data-testid` = 100, role + accessible name ≈ 90, semantic CSS ≈ 35–40, hash-suffixed ≈ 10). One row per call site is upserted into the `locator_snapshots` table, so the latest known-good snapshot for every locator is always available.

When a locator later fails, the server resolves replacements through a ladder, most-trustworthy first:

1. **Prior run** — the exact call site (`file:line:col`) had a passing snapshot; its pre-captured alternatives are reused.
2. **Element match** — the old element appears renamed or moved (its identity is gone from the failing page's ARIA snapshot), so *fresh* locators are generated for the element it most likely became.
3. **Fingerprint** — the call site shifted lines, but a locator-signature match finds the prior snapshot anyway.
4. **ARIA fallback** — no prior snapshot exists; limited suggestions are derived from the failure-time ARIA snapshot (no HTML attributes).

The result is shown as an **Alternative locators** panel on the test-case and failure-cluster pages, and folded into the AI diagnosis context so the model recommends a grounded fix (see [AI diagnosis](./ai-diagnosis#locator-healing)). A single **recommended fix** is highlighted — it keeps your original locator *style* where that style is stable enough (a minimal, idiomatic edit), and escalates to the sturdiest alternative (or advises adding a `data-testid`) only when the original style has nothing stable to fall back on.

Capture adds a small per-action cost (one DOM read, sometimes an extra ARIA snapshot) in the test worker. Turn it off with `captureLocators: false` or `PIWI_CAPTURE_LOCATORS=false`; it is also disabled automatically whenever `collectPerformanceMetrics` is `false`.

> Healing is read-only — it never rewrites your test. It surfaces the replacement so you can apply it yourself.

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

### Suite hierarchy (describe blocks)

The reporter traverses the test's parent chain (`test.parent`) to build a `suitePath` array — the list of describe-block names from the root to the test's immediate parent. Each level's `suiteConfig` (mode: `parallel` | `serial` | `default`, plus any suite-level `annotations`) is captured alongside the path. This data is sent in both streaming and batch submission payloads and stored in the `test_suites` and `test_cases` tables.

In the dashboard UI, the test run detail page offers a **Tree** view that groups test cases by their suite hierarchy, with expandable/collapsible describe nodes showing mode badges and annotation counts.

### Test annotations (Playwright marks)

The reporter captures Playwright test marks set via `test.info().annotations` (e.g. `@fixme`, `@slow`, `@skip`) and sends them as `testAnnotations` in every test case payload. These are stored per-run on the `test_runs_cases` table and rendered as badges on the test case row and test case detail page.

### Skipped vs "didn't run"

The reporter distinguishes two outcomes that Playwright both reports as `skipped`:

- **`skipped`** — an intentional skip via `test.skip()` / `test.fixme()` (static, conditional, or runtime). These always carry a `skip`/`fixme` annotation, so the skip reason (when provided) is preserved in `testAnnotations` and shown on the test case.
- **`didnotrun`** — a test that never actually executed. This covers two cases:
  - a test skipped as a side effect of an **earlier failure in a `describe.serial` group** (Playwright reports it as `skipped` with no annotation; the reporter reclassifies it);
  - a test that Playwright **never started because `maxFailures` cut the run short** (no `onTestEnd` fires for these — the reporter materializes them from the planned test list so they still appear, with zero duration and no error).

The run-level counter `didNotRunTests` aggregates these, and the dashboard renders them as a distinct "Didn't run" segment/badge separate from skipped.

## With custom metadata

```typescript
export default defineConfig({
  reporter: [
    ['@piwitests/reporter', {
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
    ['@piwitests/reporter', {
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

- Extend your `test` with `dashboardFixtures` / `extendDashboardFixtures` from `@piwitests/reporter`
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
    ['@piwitests/reporter', {
      serverUrl: 'http://your-dashboard.example.com',
      projectName: 'my-project',
      apiKey: process.env.PIWI_API_KEY,
    }],
  ],
})
```

The key is sent as an `Authorization: Bearer <key>` header. Store it in a CI secret — never hard-code it.

### Alternative: username/password

```typescript
export default defineConfig({
  reporter: [
    ['@piwitests/reporter', {
      serverUrl: 'http://your-dashboard.example.com',
      projectName: 'my-project',
      username: process.env.PIWI_USERNAME,
      password: process.env.PIWI_PASSWORD,
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

This produces one `.js` + one `.d.ts` per `.ts` source, mirroring the `src/` folder structure under `dist/`.

The compiled output is what Playwright loads at runtime. The package has a single entry point (`@piwitests/reporter`) — the reporter, the config helpers, and the capture fixtures are all imported from it.

### Source layout

The package separates its **public API** (`src/index.ts`, `src/fixtures.ts`, and `src/public/`) from internal plumbing (`src/internal/<domain>/` — `submit`, `transport`, `streaming`, `collect`, `files`, `capture`, `config`, `support`) and the type model (`src/types/`, where `wire.ts` is the server contract and `collected.ts` the in-process model).

See **`reporter/ARCHITECTURE.md`** in the repository for the full map: the public/internal split, the two-process collect-and-submit data flow, the fallback ladder, and the package conventions.

### Shared types

Wire contract types are defined in `application/shared/types.ts` and used by the server for request validation. The reporter does not import them directly — it keeps its own structurally-compatible interfaces in `src/types.ts` (`CollectedTestCase`, `WireTestCase`, `StreamEvent`) so the monorepo path isn't leaked into the published `.d.ts`. When making changes, keep the two sides consistent: the reporter's wire shapes must match the server's `TestCasePayload`, `StreamEventPayload`, and `TestRunFinishPayload`.
