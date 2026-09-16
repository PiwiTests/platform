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

Or let `npx @piwitests/reporter init` do the install and wiring for you — see the [one-command setup](./getting-started#fast-path-one-command) in Getting started. The rest of this page is the full manual reference.

### Try it without editing your config

On **Playwright 1.63 or later**, `--add-reporter` appends this reporter to whatever your config already uses (unlike `--reporter`, which replaces them), so you can send one run to a dashboard with no install and no config edit. Every reporter option has a `PIWI_*` [environment variable](#environment-variables), so point it at your dashboard that way:

::: code-group

```bash [Linux / macOS]
PIWI_DASHBOARD_URL=http://localhost:3000 \
PIWI_API_KEY=your-api-key \
PIWI_PROJECT_NAME=my-project \
npx playwright test --add-reporter @piwitests/reporter
```

```powershell [Windows (PowerShell)]
$env:PIWI_DASHBOARD_URL='http://localhost:3000'; $env:PIWI_API_KEY='your-api-key'; $env:PIWI_PROJECT_NAME='my-project'; npx playwright test --add-reporter @piwitests/reporter
```

:::

This is a trial path: you get results, traces and screenshots, but not the [capture fixtures](#capture-fixtures) or [`wrapConfig`](#installing-via-wrapconfig)'s capture defaults. On Playwright before 1.63 the flag does not exist — configure the reporter normally instead. [`piwi run`](/reference/cli#select-run) makes the same append automatically when the config has no Piwi reporter.

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
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
```

The `use` block is Playwright's, not Piwi's: `trace`, `screenshot` and `video` decide what Playwright records, and the reporter uploads whatever exists. Leave `screenshot` at its default (`'off'`) and the failure evidence has no screenshot to show.

When you install via [`wrapConfig`](#installing-via-wrapconfig) (what `init` does), the reporter fills in `screenshot: 'only-on-failure'` and `trace: 'retain-on-failure'` for you whenever the top-level `use` leaves them unset — the trace alone gives the dashboard the DOM snapshot, full call stack, full network with bodies and the visual diff without the capture fixtures. On Playwright 1.63 or later the trace default also turns on the per-action **aria tree** (`snapshots: { dom: true, aria: true }`), which feeds the [Screen tab and the page diff](/features/evidence#aria-and-screen-snapshots) at negligible size. The `screen` snapshot kind — a PNG before and after every action, the trace's biggest cost — stays opt-in; set it yourself with `trace: { mode: 'retain-on-failure', snapshots: { dom: true, aria: true, screen: true } }`. Any value you set yourself (including `'off'`) is kept, per-project `use` blocks are never touched, and the reporter logs one line at the start of the run naming what it defaulted. Opt out with `defaultCapture: false` or `PIWI_DEFAULT_CAPTURE=false` to let Playwright's own defaults stand.

::: tip You don't also need Playwright's `html` reporter
Piwi rebuilds the run — history, errors, evidence, traces and live streaming — from the data this reporter collects, so the dashboard is complete without Playwright's built-in `html` reporter. Running `html` alongside Piwi only repeats end-of-run work: it regenerates its own static report each run and, run locally, opens a browser on failure by default. Drop it (or set `open: 'never'`) to skip that. If you still want Playwright's standalone report, keep it enabled and Piwi uploads it with the run ([`uploadReport`](#configuration-options)).
:::

## Installing via wrapConfig

`wrapConfig` wraps your whole Playwright config in one call: it injects the reporter, chains Piwi's [global setup](#global-setup-phase), and defaults the failure-evidence capture options. It is what `npx @piwitests/reporter init` writes for you.

```typescript
import { defineConfig } from '@playwright/test'
import { wrapConfig } from '@piwitests/reporter'

export default defineConfig(
  wrapConfig(
    {
      testDir: './tests',
      // no `screenshot` / `trace` needed — wrapConfig fills them in
    },
    { serverUrl: 'http://localhost:3000', projectName: 'my-project' },
  ),
)
```

The first argument is your Playwright config; the second is the [Piwi options](#configuration-options). On top of injecting the reporter, `wrapConfig`:

- Sets `screenshot: 'only-on-failure'` and `trace: 'retain-on-failure'` on the **top-level** `use` block when each is unset. A value you set yourself is kept — including `'off'` — and per-project `use` blocks are left alone. These two options unlock the DOM snapshot, full call stack, full network with bodies and the visual diff **without** the capture fixtures. On Playwright 1.63 or later `trace` becomes the object form `{ mode: 'retain-on-failure', snapshots: { dom: true, aria: true } }`, adding the per-action aria tree; the object is version-gated because an older Playwright rejects it. The `screen` snapshot kind stays opt-in — see [what `screen` adds per action](/operate/storage#trace-snapshots). Opt out with `defaultCapture: false` (or `PIWI_DEFAULT_CAPTURE=false`); the reporter logs one line at the start of the run naming whatever it defaulted.
- Forwards the CI-gate option `failOnFlakyTests` into Playwright's native config so a flaky-only run exits non-zero locally.

<a id="performance-metrics-web-vitals"></a>

## Capture fixtures

The reporter works without any test-code changes, but adding the **capture fixtures** to your test setup unlocks the dashboard's richest features — network timing and the *Slow API endpoints* table, browser Web Vitals, console capture, failure-time ARIA snapshots, and [locator healing](#locator-healing). See the [capture fixtures guide](./capture-fixtures) for the full with/without feature matrix, composition patterns, and troubleshooting.

**Option A – extend your existing fixtures:**

<<< @/snippets/fixtures.ts{ts}

Then import `test` from your fixture file in every test:

```typescript
import { test, expect } from './fixtures'

test('homepage loads', async ({ page }) => {
  await page.goto('/')
  // network requests & web vitals are captured automatically
})
```

**Option B – one-line extend with `extendPiwiFixtures`:**

```typescript
import { test as base } from '@playwright/test'
import { extendPiwiFixtures } from '@piwitests/reporter'

export const test = extendPiwiFixtures(base)
export { expect } from '@playwright/test'
```

### What gets captured

- **Network requests** — method, URL, status code, duration, resource type. Aggregated on the dashboard into a *Slow API endpoints* table grouped by `METHOD + normalized route` (e.g. `/api/users/:id`).
- **Console entries** — `warning`, `error`, and `assert` messages with their source location, shown on the [execution page](/features/evidence#one-execution-diagnosis-first) and included in the AI diagnosis evidence.
- **Browser Web Vitals** — TTFB, DOM Interactive, DOMContentLoaded, Load Complete, First Paint, First Contentful Paint, plus Core Web Vitals (LCP, CLS, INP) — displayed with color-coded thresholds. LCP/CLS/INP come from buffered `PerformanceObserver` entries and are Chromium-only; INP needs at least one interaction, so it is often `n/a` in short tests.
- **ARIA snapshot** — Captured automatically on failed/timed-out tests via `page.locator(':root').ariaSnapshot()`. When the installed Playwright is 1.63 or later the fixtures also capture the JSON aria tree (`ariaSnapshotJSON()`) beside the YAML — the structured source for [locator healing](#locator-healing)'s rename matching and the page diff, while the YAML keeps feeding the ARIA card. Included in the **Copy AI context** bundle on the [execution page](/features/evidence#one-execution-diagnosis-first)'s Diagnosis tab (`/test-run-cases/:id`) and in the cluster AI diagnosis context. Also sampled on *passing* tests to anchor the [page diff](/features/evidence#page-diff) — see [`sampleAriaOnPass`](#green-page-sampling-on-pass) below.
- **Browser dialogs** — On Playwright 1.63+, `alert`/`confirm`/`prompt`/`beforeunload` dialogs are recorded (type, message, close time) through the `dialogclosed` event, which never suppresses Playwright's automatic dismissal. They drive a *dialogs* lane on the [failure timeline](/features/evidence#one-execution-diagnosis-first) and a *dialog was open when the action failed* clue.
- **Locator snapshots** — For each element a test proves resolvable — every successful action (click, fill, etc.) *and* every passing web-first assertion (`expect(locator).toBeVisible()`, `toHaveText()`, …) — the fixtures record the element's attributes and a ranked list of alternative locators, stamped with the call site. These power [locator healing](#locator-healing) when a locator later breaks. Gated by `captureLocators` (default on).
- **Test steps** — each step's title, category and timing, plus its **subtitle** and a curated **params** object. Playwright 1.63 moved the target of a `pw:api`/`expect` step out of the title into the subtitle — `Click` with the subtitle `getByRole('button', { name: 'Pay' })`, or `Navigate` with the page URL — and the dashboard shows the title with the subtitle as a muted second element wherever a step is displayed (composing the two into one string for plain-text uses such as copy actions and the AI context), so an upgrade keeps the target visible. `params` carries the rendered locator, a navigation's URL, an action's arguments, or a `test.step(title, body, { params })` author's own values, and the [step row](/features/evidence#one-execution-diagnosis-first) shows them in an on-demand **Parameters** disclosure (the locator first). It is capped at 20 keys and 200 characters per value, and token-shaped strings (JWTs, long hex blobs, base64 data URIs) are masked; page content, expressions and request bodies are never captured. On Playwright 1.61 the reporter reads the title only, exactly as before.
- **Test locks** — The lock names a test or its `describe` declared (`test('…', { lock: 'database' }, …)`) — the shared resources Playwright serializes holders of. They drive the [Timeline tab's lock lanes](/features/ui-overview#test-run-detail), the lock filter and *Group by lock* on the Tests tabs, and two [clues](/features/evidence#clues). Captured **best effort**: Playwright exposes locks only to an in-process reporter, never through the public API or the blob report, so a run recorded live carries them and one rebuilt from a [blob import](./importing-runs) does not. Nothing to configure.

These are only collected when `collectPerformanceMetrics` is `true` (the default). If fixture data does not appear in the dashboard, the most likely cause is that your test files import `test` from `@playwright/test` directly instead of from your fixtures file (see options A/B above).

Any attachments Playwright records — including **screenshots** (`screenshot: 'only-on-failure'`) and **videos** (`video: 'retain-on-failure'`) — are uploaded automatically and shown as first-class evidence on the [execution](/features/evidence#one-execution-diagnosis-first) and failure-cluster pages, alongside traces. That includes what a test attaches itself: both `testInfo.attach('payload', { path })` and the inline form `testInfo.attach('payload', { body: JSON.stringify(data), contentType: 'application/json' })` reach the dashboard (an inline body is staged as a temp file under the OS temp directory for the upload and removed when the run ends). One attachment above 500 MB — the dashboard's default upload ceiling — is skipped with a warning naming it rather than failing the upload. Screenshots are the evidence most pages on this site count on, and Playwright records none unless the option is set — which is why [`wrapConfig`](#installing-via-wrapconfig) defaults `screenshot: 'only-on-failure'` and `trace: 'retain-on-failure'` for you. Videos can be large, so pair `retain-on-failure` with periodic [storage cleanup](/operate/storage#storage-management).

### Green page sampling on pass

To power the [page diff](/features/evidence#page-diff), the fixtures also sample the ARIA snapshot at the end of a *passing* test — a "last known good" of the page to diff a later failure against. It stays cheap by letting the server decide what to capture:

- At the start of every run `globalSetup` makes **one extra request**, `GET /api/projects/:id/aria-sampling`, which returns the tests whose newest green snapshot is older than 24 hours (or missing). The reporter caches that set for the run's workers.
- A passing test is sampled only when it is in that set, so in steady state — every test sampled within the last day — nothing is captured and the pages cost nothing.
- The server keeps at most one green snapshot per test per day, so many runs a day stay bounded.

The feature degrades safely: an older server without the endpoint, or any failure of that call, leaves the set empty and **nothing is sampled**. Turn it off entirely with `sampleAriaOnPass: false` (or `PIWI_SAMPLE_ARIA_ON_PASS=false`). It rides the capture fixtures — with the fixtures off, no snapshot is taken regardless.

## Configuration options

| Option                      | Type     | Default                   | Description                                                                                 |
|-----------------------------|----------|---------------------------|---------------------------------------------------------------------------------------------|
| `enabled`                   | boolean  | `true` when `serverUrl` is set | Explicitly turn the reporter off without removing it from the config                   |
| `serverUrl`                 | string   | —                         | URL of the Piwi Dashboard server. With none set anywhere, the reporter looks for the [desktop app](#finding-the-desktop-app-automatically), and disables itself when that finds nothing either |
| `projectName`               | string   | `'default-project'`       | Name of the project to report results under                                                 |
| `uploadTraces`              | boolean  | `true`                    | Upload trace files to the dashboard                                                         |
| `uploadReport`              | boolean  | `true`                    | Upload the Playwright HTML report                                                           |
| `reports`                   | array    | —                         | Additional report types to upload (see [Multiple reports](#multiple-reports))               |
| `streaming`                 | boolean  | `true`                    | Enable live streaming of results (falls back to batch if unsupported)                       |
| `streamingBatchSize`        | number   | `5`                       | Number of test results to batch before sending                                              |
| `streamingBatchDelay`       | number   | `2000`                    | Max delay (ms) before flushing pending events                                               |
| `liveFileUploads`           | boolean  | `true`                    | Upload each test's trace and attachments as soon as the test finishes (streaming mode only) |
| `failOnFlakyTests`          | boolean  | `false`                   | Fail the run when any test was flaky (passed only after a retry). Forwarded to Playwright's native `failOnFlakyTests` option (Playwright 1.52+) when installed via `wrapConfig`, so a flaky-only run exits non-zero locally, with no server round-trip |
| `projectDescription`        | string   | —                         | Description of the project                                                                  |
| `environment`               | string   | —                         | Deployment environment for this run, e.g. `"production"`, `"staging"`, `"integration"`      |
| `label`                     | string   | —                         | Display label for this run, e.g. `"v2.3.1 release"`                                         |
| `relatedIssue`              | string   | —                         | Related issue reference, e.g. `"JIRA-123"`                                                  |
| `ciInfo`                    | string   | —                         | CI job information                                                                          |
| `tags`                      | string[] | —                         | Tags to categorize the test run                                                             |
| `customData`                | object   | —                         | Additional custom metadata as key-value pairs                                               |
| `collectScmInfo`            | boolean  | `true`                    | Auto-collect git commit, branch, author                                                     |
| `collectCiInfo`             | boolean  | `true`                    | Auto-collect CI environment info                                                            |
| `collectPerformanceMetrics` | boolean  | `true`                    | Collect step timings, network requests and web vitals                                       |
| `captureLocators`           | boolean  | `true`                    | Capture element snapshots from successful actions and passing assertions — these power [locator healing](#locator-healing). Auto-disabled when `collectPerformanceMetrics` is `false` |
| `capturePageState`          | boolean  | `true`                    | Record the page's state at test end: URL, history state, storage **key names** and value *lengths*, cookie names and flags. Values are never captured. Auto-disabled when `collectPerformanceMetrics` is `false` |
| `captureServerTraces`       | boolean  | `true`                    | Read server-side spans from the `X-Piwi-Trace` response header emitted by a Piwi [instrumentation plugin](./backend-logs), and show them next to the network request. Free when no instrumentation is present. Auto-disabled when `collectPerformanceMetrics` is `false` |
| `sampleAriaOnPass`          | boolean  | `true`                    | Sample the ARIA snapshot at the end of a passing test so a later failure can be diffed against the [page as it last looked green](/features/evidence#page-diff). Rate-limited server-side (see [Green page sampling on pass](#green-page-sampling-on-pass)); rides the capture fixtures, so nothing is captured without them |
| `defaultCapture`            | boolean  | `true`                    | When installed via [`wrapConfig`](#installing-via-wrapconfig), default the top-level `use.screenshot` to `'only-on-failure'` and `use.trace` to `'retain-on-failure'` when unset, so failure evidence is captured without the fixtures. On Playwright 1.63+ the trace default also turns on the per-action aria tree (`snapshots: { dom: true, aria: true }`); `screen` stays opt-in. Explicit values (including `'off'`) and per-project `use` blocks are untouched. Set `false` to opt out |
| `inspectOnFailure`          | boolean  | `false`                   | Open Piwi's own inspector overlay on the failing page after a local headed failure — inspect any element and pick a locator for it (see [Inspect the failing page live](/features/locator-healing#inspect-the-failing-page-live-local-runs)). Never activates under CI |
| `pickLocatorOnFailure`      | boolean  | `false`                   | Open Piwi's locator picker on the failing page after a local headed locator failure (see [Pick a replacement locator](/features/locator-healing#pick-a-replacement-locator-on-the-failing-page-local-runs)). Never activates under CI |
| `username`                  | string   | —                         | Username for dashboard login (use `apiKey` instead when possible)                           |
| `password`                  | string   | —                         | Password for dashboard login (used with `username`)                                         |
| `apiKey`                    | string   | —                         | API key for authentication (preferred over `username`/`password` for CI)                    |
| `runLabel`                  | string   | auto-detected from CI     | Stable label tying shards together (e.g. CI run ID). Auto-detected from CI env; override if needed |
| `outputFile`                | string   | —                         | Write a JSON file with the submitted run's dashboard URL, id, project id and status, for a later CI step to consume (see [CI → Getting the run URL back out](./ci#getting-the-run-url-back-out-of-ci)) |
| `verbose`                   | boolean  | `false`                   | Enable verbose logging for debugging                                                        |

### Environment variables

The options in the table below can also be set via a `PIWI_*` environment variable. Env vars are fallbacks — an option passed in the reporter config takes precedence. The one exception is `PIWI_VERBOSE`, which wins over both the default and an explicit option (useful for toggling debug output without editing the config). The mapping is centralized in `src/internal/config/env.ts` (`PIWI_ENV_KEYS`). The remaining options — `enabled`, `reports`, `projectDescription`, `relatedIssue`, `ciInfo`, `tags`, `customData`, `collectScmInfo`, `collectCiInfo` and `collectPerformanceMetrics` — are config-only:

| Env var                         | Option                  | Format          |
|---------------------------------|-------------------------|-----------------|
| `PIWI_DASHBOARD_URL`            | `serverUrl`             | string          |
| `PIWI_PROJECT_NAME`             | `projectName`           | string          |
| `PIWI_SAMPLE_ARIA_ON_PASS`      | `sampleAriaOnPass`      | boolean         |
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
| `PIWI_FAIL_ON_FLAKY_TESTS`      | `failOnFlakyTests`      | `true`/`false`  |
| `PIWI_UPLOAD_TRACES`            | `uploadTraces`          | `true`/`false`  |
| `PIWI_UPLOAD_REPORT`            | `uploadReport`          | `true`/`false`  |
| `PIWI_CAPTURE_LOCATORS`         | `captureLocators`       | `true`/`false`  |
| `PIWI_CAPTURE_PAGE_STATE`       | `capturePageState`      | `true`/`false`  |
| `PIWI_CAPTURE_SERVER_TRACES`    | `captureServerTraces`   | `true`/`false`  |
| `PIWI_DEFAULT_CAPTURE`          | `defaultCapture`        | `true`/`false`  |
| `PIWI_OUTPUT_FILE`              | `outputFile`            | string (path)   |
| `PIWI_INSPECT_ON_FAIL`          | `inspectOnFailure`      | `true`/`false`  |
| `PIWI_PICK_LOCATOR_ON_FAIL`     | `pickLocatorOnFailure`  | `true`/`false`  |
| `PIWI_VERBOSE`                  | `verbose`               | `true`/`false`  |

`wrapConfig` forwards the same `PIWI_*` vars into the isolated `global-setup` process so the run registration step shares the reporter's server/auth config.

### Finding the desktop app automatically

If nothing sets a server at all — no `serverUrl`, no `apiKey`, and neither `PIWI_DASHBOARD_URL` nor `PIWI_API_KEY` in the environment — the reporter looks for a running [desktop app](/features/desktop) on the same machine and uploads there:

```typescript
reporter: [
  ['@piwitests/reporter', { projectName: 'my-project' }],
],
```

While it runs, the desktop app publishes its loopback URL and access token to `~/.piwi/desktop.json` (`%USERPROFILE%\.piwi\desktop.json` on Windows), owner-readable only. It rewrites the file on every launch — the port can change — and deletes it on quit, so results only go there while the app is actually up. The reporter prints the address it picked at the start of the run.

This is the **lowest** precedence step, below every option and env var, and the URL and token are only ever adopted together. A project pointed at a hosted dashboard, or a CI job with `PIWI_API_KEY` set, is never redirected at a local app. It also means CI is unaffected: the file does not exist there. To opt out on a machine that does run the app, set `enabled: false` (or point `serverUrl` where you want the results).

`PIWI_DESKTOP_CONFIG` overrides the path the reporter reads.

## Sharding

Playwright's `--shard` jobs are merged back into a single dashboard run automatically — no
configuration beyond every shard using the same `projectName`. The `runLabel` option below is the
manual override when your CI isn't auto-detected. Full detail, including the CI examples and how the
merge works, is in [CI & sharding](./ci#sharding).

## Live streaming

By default, the reporter streams test results to the dashboard in real-time as tests complete. This allows you to monitor test progress live in the dashboard UI.

### How it works

1. When tests start, the reporter creates a run on the server with `running` status
2. As each test completes, results are sent in batches to the server
3. With `liveFileUploads` (the default), each test's trace and attachments are uploaded right after the test finishes, so they are viewable on the [execution page](/features/evidence#one-execution-diagnosis-first) while the run is still in progress
4. The dashboard UI shows a live progress bar and test results as they arrive
5. While a test runs, the steps it is executing (Playwright `pw:api` actions, `pw:expect` assertions, and hook/fixture steps) stream to the run page as they happen — each running test's row shows the step it is on right now. The polling attempts of `pw:assert` steps are deliberately not streamed; the persisted step events on a completed test still carry everything
6. When a test's final attempt fails, the reporter prints `[Piwi Dashboard] ✗ <title> — <headline> → <url>` right away — the headline is the same one-line explanation the dashboard shows (`getByLabel('Email address') was not found on the page — fill timed out after 10 s`), and the link opens that execution on the dashboard, so you can start reading the failure while the rest of the suite is still running. In batch mode the same lines print after the upload
7. When tests finish, the reporter finalizes the run with the overall status and prints `View run: <url>` (see [CI → Getting the run URL back out](./ci#getting-the-run-url-back-out-of-ci) for the step outputs and job summary that go with it)

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

By default a run appears on the dashboard as soon as the first test starts. If your Playwright config has a `globalSetup` step (seeding a database, authenticating, building the app under test, etc.), you can register the run *before* `globalSetup` runs so the dashboard shows an animated **initializing** state during setup.

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

In Playwright's **UI mode** (`playwright test --ui`) registration is skipped entirely. UI mode keeps one long-lived process and re-runs `globalSetup` every time you press play, but swaps the reporter out for its own internal one — so a run registered from `globalSetup` would never be finished, leaving orphaned "initializing" runs (one at launch, one per manual run). A chained `userSetup` still runs, so your own setup logic is unaffected.

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

## Locator healing

The capture fixtures record ranked, uniqueness-checked **locator snapshots** while your tests pass (see [Capture fixtures → Locator snapshots](./capture-fixtures)). When a locator later breaks, Piwi resolves replacements from those snapshots through a most-trustworthy-first ladder and surfaces a single recommended fix — plus an optional failure-time inspector overlay and locator picker for local runs (`inspectOnFailure` / `pickLocatorOnFailure`). The full explanation, the resolution ladder, and those local-run aids are on [Locator healing](/features/locator-healing).

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

These six platforms get rich per-provider fields. The stable **run label** that ties sharded runs together is auto-detected for a broader set of providers (GitHub Actions, GitLab, CircleCI, Travis, Azure, Jenkins, Buildkite, TeamCity, Bitbucket, Semaphore, AppVeyor and Drone) — see [CI & sharding → What gets detected](./ci#what-gets-detected).

### Playwright configuration

The reporter also records browser project configs, worker count, test timeout, and parallel settings.

### Browser configuration per test case

The reporter automatically captures each test case's Playwright project configuration — `projectName`, `browserName`, `channel`, `viewport`, and the rendering options `colorScheme`, `reducedMotion`, `forcedColors` and `contrast` (Playwright 1.63's standalone contrast option) — via `test.parent.project()`. This is stored in the `browser` field of every test case result and feeds the [environment diff](/features/evidence#one-execution-diagnosis-first) that compares a failing execution against its last passing one.

In the dashboard UI, the test run detail page shows a browser icon and project name as the first column of the test cases table, and you can filter by browser using the dropdown above the table.

### Suite hierarchy (describe blocks)

The reporter traverses the test's parent chain (`test.parent`) to build a `suitePath` array — the list of describe-block names from the root to the test's immediate parent. Each level's `suiteConfig` (mode: `parallel` | `serial` | `default`, plus any suite-level `annotations`) is captured alongside the path. This data is sent in both streaming and batch submission payloads and stored in the `test_suites` and `test_cases` tables.

In the dashboard UI, the test run detail page offers a **Tree** view that groups test cases by their suite hierarchy, with expandable/collapsible describe nodes showing mode badges and annotation counts.

### Test annotations (Playwright marks)

The reporter captures Playwright test marks set via `test.info().annotations` (e.g. `@fixme`, `@slow`, `@skip`) and sends them as `testAnnotations` in every test case payload. These are stored per-run on the `test_runs_cases` table and rendered as badges on the test case row and test case detail page. A `@slow` mark combined with a test's duration history powers the **stale `test.slow()`** detection in [Timeout opportunities](/features/slow-tests#timeout-opportunities).

### Test tags

The reporter reads each test's tags (`TestCase.tags`) and sends them as `tags`. Playwright already folds together both
ways of declaring one, so either works:

```typescript
test('checkout applies the discount @smoke', async ({ page }) => { /* … */ })

test('checkout applies the discount', { tag: ['@smoke', '@critical'] }, async ({ page }) => { /* … */ })
```

Tags are stored twice: on the execution (`test_runs_cases.tags`, what that run saw) and on the test case
(`test_cases.tags`, the latest declaration). The leading `@` is stripped on the way in, so a tag reads the same however
it was written — filter for `smoke` or `@smoke` and you get the same rows. Removing a tag from a spec clears it on the
next run that reports the test.

Tags drive the tag filter on a project's **Test cases** tab, the same filter on the flaky leaderboard, and the
`requireTags` rule of the [CI gate](./ci#blocking-a-merge).

### Test locks

Playwright 1.63 lets a test or a `describe` declare a **lock** — a named shared resource the runner never lets two
holders run at once:

```typescript
test('writes an order', { lock: 'database' }, async ({ page }) => { /* … */ })

test.describe('payments', { lock: ['database', 'external-api'] }, () => { /* every test inside inherits both */ })
```

The reporter reads the lock names and sends them as `locks`, stored on the execution (`test_runs_cases.locks`) and
denormalized onto the test case (`test_cases.locks`, the latest declaration) — the same treatment as tags. They power
the [Timeline tab's lock lanes and *Locks* table](/features/ui-overview#test-run-detail), the lock filter and *Group by lock*
on the Tests tabs, lock badges on every test row, and two [clues](/features/evidence#clues) (a lock's previous holder failed;
a lock was held on two shards at once).

Capture is **best effort**. Playwright exposes locks only to an in-process reporter — there is no public API property,
and the tele protocol that backs blob reports and `merge-reports` carries none — so a run recorded live has its locks
and a run [rebuilt from a blob import](./importing-runs) has none. Locks also serialize only within one
`npx playwright test` process: two `--shard` runs are separate processes and can hold the same lock at the same time,
which the cross-shard clue points out.

### Ownership metadata (`piwi:` annotations)

Four `piwi:`-prefixed annotations attach ownership to a test. They are ordinary Playwright annotations, so no new API is
involved:

```typescript
test(
  'checkout applies the discount',
  {
    tag: '@critical',
    annotation: [
      { type: 'piwi:owner', description: '@checkout-team' },
      { type: 'piwi:priority', description: 'critical' },
      { type: 'piwi:feature', description: 'Checkout' },
      { type: 'piwi:link', description: 'https://issues.example.com/PROJ-412' },
    ],
  },
  async ({ page }) => {
    /* … */
  },
)
```

| Field | Accepts |
|---|---|
| `piwi:owner` | Any text — a team handle, a squad name, an email |
| `piwi:priority` | `critical`, `high`, `medium` or `low` (anything else is ignored) |
| `piwi:feature` | Any text — the product area, for grouping across spec files |
| `piwi:link` | An absolute `http(s)` URL; other schemes are dropped rather than stored |

Metadata shows as badges next to the test wherever it is listed, is filterable by owner and priority on the **Test
cases** tab, and is carried into [pull-request feedback](./ci#pull-request-feedback) so a failure comment names the team
that owns it. Unknown `piwi:` fields and unparseable values are ignored — a typo costs you the field, not the run.

The values are also re-validated server-side, because a payload can reach the ingest API without passing through the
reporter.

### Per-test timeout

The reporter records each test's effective per-test timeout (`TestCase.timeout`) and sends it as `timeout` (milliseconds) on every test case payload, stored on `test_runs_cases.timeout`. `0` means the test has no timeout (unbounded); runs reported by an older reporter that predates this field store `null`.

Together with the test's duration history this drives the **Timeout opportunities** analysis (see [Slow tests & wasted time](/features/slow-tests#timeout-opportunities)), which flags tests whose timeout far exceeds their real p95 duration so failures and hangs stop wasting time waiting.

### Skipped vs "didn't run"

The reporter distinguishes two outcomes that Playwright both reports as `skipped`:

- **`skipped`** — an intentional skip via `test.skip()` / `test.fixme()` (static, conditional, or runtime). These always carry a `skip`/`fixme` annotation, so the skip reason (when provided) is preserved in `testAnnotations` and shown on the test case.
- **`didnotrun`** — a test that never actually executed. This covers two cases:
  - a test skipped as a side effect of an **earlier failure in a `describe.serial` group** (Playwright reports it as `skipped` with no annotation; the reporter reclassifies it);
  - a test that Playwright **never started because the run was cut short** (no `onTestEnd` fires for these — the reporter materializes them from the planned test list so they still appear, with zero duration and no error).

Each `didnotrun` case also carries **`didNotRunReason`**, so the dashboard can say _why_ a test never ran rather than just that it didn't:

- `previous-failure` — skipped because an earlier test (or hook) in its serial group failed. The reporter also records **`blockedBy`**, the location of the failing test that blocked it — so the did-not-run case links to its cause, and the failing test lists the downstream tests it stopped from running.
- `global-timeout` — the run's `globalTimeout` elapsed before the test could start.
- `max-failures` — the run reached its configured `maxFailures` budget.
- `interrupted` — the run was otherwise cut short (a worker crash or a cancellation).

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
5. If the [capture fixtures](./capture-fixtures) are active, network requests, console entries, Web Vitals, failure-time ARIA snapshots, and locator snapshots are included per test case.
6. The server decompresses the report and makes it available for viewing, with fully functional HTML reports.

Uploaded traces open in the dashboard's **built-in, self-hosted trace viewer** — the bytes never leave your server. See [Trace viewer](/features/evidence#trace-viewer).

## Troubleshooting

### Reporter not uploading files

- Playwright's own HTML report uploads only when its `html` reporter is configured (`['html', { outputFolder: 'playwright-report' }]`) — but the dashboard reconstructs the run without it, and traces and screenshots upload either way
- Make sure traces are enabled: `use: { trace: 'retain-on-failure' }`
- Make sure screenshots are enabled: `use: { screenshot: 'only-on-failure' }` — Playwright's default is `'off'`, so an unset option means no screenshot to upload
- Check the dashboard server is running and accessible at `serverUrl`

### Fixture data not appearing (network, Web Vitals, console, ARIA snapshot, locator healing)

- Extend your `test` with `piwiFixtures` / `extendPiwiFixtures` from `@piwitests/reporter`, and make sure every spec imports `test` from your fixtures file — not from `@playwright/test` directly
- Verify `collectPerformanceMetrics` is not set to `false` (and `captureLocators` for locator healing)
- Ensure tests navigate to at least one page (`await page.goto(...)`)
- See the [capture fixtures guide](./capture-fixtures) for details

### Connection errors

- Verify `serverUrl` is correct and the server is running
- Check network connectivity and firewall settings
- A run the reporter could not deliver — dashboard down, or a 401 because no
  credential was configured — is not lost: a recovery copy of the results is
  saved locally and submitted automatically on the next run for the same
  project, in streaming and batch mode alike. The recovery copy carries the
  results only, not traces, reports or attachments.
- When live streaming is interrupted mid-run, the reporter warns once, buffers
  the events, and keeps retrying; delivery retries at the end of the run can
  add a few minutes of teardown while the dashboard stays unreachable, after
  which the run falls back to the batch submit.

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

See [Authentication](/operate/authentication) for details on enabling auth, creating users, and managing API keys.
