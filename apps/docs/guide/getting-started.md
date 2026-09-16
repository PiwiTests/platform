---
title: Getting started
lang: en-US
---

# Getting started

## What is Piwi Dashboard?

Piwi Dashboard is a self-hosted home for [Playwright](https://playwright.dev) test results. Your CI
deletes its HTML report on every build; Piwi keeps every run — with its traces, reports, and metadata —
and then does the things a permanent history makes possible: grouping failures by root cause, scoring
flaky tests, tracking performance, streaming runs live, and (optionally) diagnosing failures with an
LLM you configure.

It is a **server plus a Playwright reporter**. The reporter runs inside `npx playwright test` and pushes
results to the server; the server stores them and renders the dashboard. Two moving parts, and the rest
of this page sets both of them up.

New to the vocabulary — *run* vs *test case* vs *execution* vs *cluster*? [Core concepts](./concepts) is
a five-minute read that makes the rest of the docs (and the UI) click.

## Pick a path

The dashboard is one Node process, and there are five ways to get one running:

| Path | Best for | Notes |
|---|---|---|
| [Live demo](https://piwitests.dev/demo/) | Looking around before installing anything | Seeded data, runs in your browser, no backend |
| [Desktop app](/features/desktop) | A single developer running Playwright locally | No Docker or Node needed; Windows x64 and Apple-silicon macOS only, and the installers are not yet signed |
| Docker *(below)* | A shared instance for a team | The recommended path for anything long-lived |
| [`npx @piwitests/server`](/operate/deployment#npm-npx-quick-local-run) | A quick local run with Node 22+ already installed | Same server, no container |
| [One-click deploy](/operate/deployment#one-click-deploy) | A shared instance with no server of your own | Railway, Render, Fly.io, Koyeb, Coolify or Dokploy — a button, plus whatever the host charges |

If you only want your own history, flaky scores and locator healing on a laptop, the
[desktop app](/features/desktop) is the least setup: install it, copy its access token from **Settings →
Storage**, and skip to [the reporter](#using-the-piwi-dashboard-reporter). Everything below about the
reporter, CI and fixtures applies identically whichever path you pick.

### Requirements

Only the dashboard side has requirements — and only for some paths:

| | Needs |
|---|---|
| Desktop app | Nothing; the runtime is bundled |
| Docker | Docker; ~300 MB RAM, 1 vCPU, `linux/amd64` or `linux/arm64` |
| `npx` / from source | **Node.js 22+** and npm |
| PostgreSQL backend *(optional)* | PostgreSQL 14+ — otherwise SQLite is built in and needs no setup |

Your **test project** is unaffected by all of this: it just needs a Node version Playwright supports.
Node 22 is the dashboard's requirement, not your suite's.

## Quick start with Docker

The fastest way to get started is with the pre-built container image:

::: code-group

<<< @/snippets/docker-run.sh [Linux / macOS]

<<< @/snippets/docker-run.ps1 [Windows (PowerShell)]

:::

Visit `http://localhost:3000` to access the dashboard.

> **Linux hosts:** the container runs as non-root UID 1001, so without the `chown` above, Docker auto-creates `.data` owned by `root` and the container can't write to it. Windows and macOS (Docker Desktop) don't need this step. See [Permission issues with volumes](/operate/deployment#permission-issues-with-volumes) if you hit a permission error.

See [Deployment](/operate/deployment) for detailed Docker, Docker Compose, PostgreSQL, and Kubernetes options.

## Running from source

```bash
# Clone the repository
git clone https://github.com/PiwiTests/platform.git
cd platform/apps/application

# Install dependencies
npm install

# Start the development server
npm run app:dev
```

The dashboard will be available at `http://localhost:3000`.  
The SQLite database is automatically created on the first API call.

> The repository is an npm-workspaces monorepo, so the application scripts are prefixed `app:` (e.g. `app:dev`, `app:build`). Run them from the `apps/application/` directory.

## Using the Piwi Dashboard reporter

The recommended way to integrate is via the custom reporter package — it handles uploading results, HTML reports, and trace files automatically.

### Fast path: one command

From your Playwright project, one command installs the reporter, wraps your `playwright.config`, creates the capture-fixtures file, and records the connection in `.env.example`:

```bash
npx @piwitests/reporter init --server-url http://localhost:3000 --project my-project
```

Every step is idempotent, so it is safe to re-run. If it finds a config shape it will not rewrite (or a fixtures file that already exists), it reports that step as `manual` with the exact change to make instead of touching the file. Pass `--dry-run` to preview, or `--json` to get a machine-readable plan — the latter is what lets a coding agent run the setup for you and finish anything left manual. `init` also drops the [Piwi agent skills](/features/mcp#agent-skills) into the project so your agent can investigate failures, heal locators, and stabilize flaky tests. See `npx @piwitests/reporter init --help` for all options.

> The reporter is published as `@piwitests/reporter`; its command is `piwi`. Invoke it through the package name — `npx @piwitests/reporter <command>` — so npx always resolves *this* package. (`npx piwi` would fetch an unrelated `piwi` package from npm.) Once the reporter is a dependency of your project, a plain `npx piwi <command>` also works, since it resolves the local binary first.

Prefer to wire it up by hand? The manual steps are below.

### Try it without editing your config

On **Playwright 1.63 or later** you can send one run to a dashboard without editing your config or installing anything. Playwright's `--add-reporter` _appends_ a reporter to the ones your config already lists (unlike `--reporter`, which replaces them), and every reporter option has a `PIWI_*` environment-variable equivalent — so point it at your dashboard with env vars and run:

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

This is a trial path, not a full setup. You get the run with its results, traces and screenshots, but **not** the [capture fixtures](#recommended-capture-fixtures) (network timing, Web Vitals, console capture, locator healing) and **not** [`wrapConfig`](./reporter#installing-via-wrapconfig)'s failure-evidence capture defaults — for those, run the [fast path](#fast-path-one-command) or wire the reporter in by hand. On older Playwright (before 1.63) `--add-reporter` does not exist; use the manual setup below. `piwi run` makes the same append for you automatically when your config has no Piwi reporter — see the [CLI reference](/reference/cli#select-run).

### Manual setup

Install it:

```bash
npm install --save-dev @piwitests/reporter
```

Then add it to your `playwright.config.ts`:

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
  },
})
```

Both `use` options are Playwright's own: `trace` records the trace the dashboard's deep views read, and `screenshot` records the failure screenshot shown as evidence. Neither is on by default in Playwright, so without them a failing test uploads its error and steps but no trace or screenshot. The [fast path](#fast-path-one-command) wraps your config with [`wrapConfig`](./reporter#installing-via-wrapconfig), which fills in both of these for you when they are unset — so if you set them by hand here you are matching what `init` would have done. Opt out of the auto-defaults with `defaultCapture: false`.

Run your tests and results will appear in the dashboard:

```bash
npx playwright test
```

See the [Reporter](./reporter) page for the full configuration reference, including live streaming, multiple report types, performance metrics, and authentication.

### Recommended: capture fixtures

One small file unlocks the dashboard's richest features — locator healing, the slow-endpoints table, Web Vitals, console capture, and failure-time ARIA snapshots:

<<< @/snippets/fixtures.ts{ts}

Then import `test` from this file in your specs instead of `@playwright/test`:

```typescript
import { test, expect } from './fixtures'
```

The reporter works fine without this — see the [capture fixtures guide](./capture-fixtures) for exactly what the fixtures add, composition patterns, and troubleshooting.

Prefer starting from something runnable? [`examples/playwright-fixtures`](https://github.com/PiwiTests/platform/tree/main/examples/playwright-fixtures) is a complete working project — a small instrumented Nitro app plus a Playwright suite exercising every capture path, including [backend logs](./backend-logs) and an intentional failure that lights up locator healing.

## Submitting via the REST API (optional)

Not using Playwright, or piping results in from another tool? Submit runs directly over HTTP — this is what the reporter itself does under the hood.

::: code-group

```bash [Linux / macOS]
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{
    "projectName": "my-project",
    "status": "passed",
    "startTime": "2024-01-01T12:00:00Z",
    "duration": 120000,
    "totalTests": 2,
    "passedTests": 1,
    "failedTests": 1,
    "skippedTests": 0,
    "testCases": [
      {
        "title": "should login successfully",
        "status": "passed",
        "duration": 1500,
        "location": "tests/login.spec.ts:10:5",
        "retries": 0
      },
      {
        "title": "should handle errors",
        "status": "failed",
        "duration": 2300,
        "location": "tests/errors.spec.ts:5:5",
        "error": "Expected true but got false",
        "retries": 1
      }
    ]
  }'
```

```powershell [Windows (PowerShell)]
$body = @{
  projectName  = 'my-project'
  status       = 'passed'
  startTime    = '2024-01-01T12:00:00Z'
  duration     = 120000
  totalTests   = 2
  passedTests  = 1
  failedTests  = 1
  skippedTests = 0
  testCases    = @(
    @{ title = 'should login successfully'; status = 'passed'; duration = 1500; location = 'tests/login.spec.ts:10:5'; retries = 0 }
    @{ title = 'should handle errors'; status = 'failed'; duration = 2300; location = 'tests/errors.spec.ts:5:5'; error = 'Expected true but got false'; retries = 1 }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/test-runs/submit `
  -ContentType 'application/json' -Body $body
```

:::

The project `my-project` is created automatically if it doesn't exist yet. See the [API docs](https://piwitests.dev/demo/docs) for the full endpoint reference (or `/docs` on your own instance).

## Running in CI

Nothing Piwi-specific is required in CI — the same reporter runs inside `npx playwright test`. Point it
at your deployed instance and pass an API key if [authentication](/operate/authentication) is enabled:

```yaml
env:
  PIWI_DASHBOARD_URL: https://piwi.example.com
  PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}
```

Branch, commit, workflow, build URL and `--shard` merging are all detected automatically on GitHub
Actions, GitLab CI, Jenkins, CircleCI, Azure DevOps and more. Full examples, sharding, and how to get
the run URL back out into a later pipeline step: [CI & sharding](./ci).

## Dashboard navigation

After submitting results, the dashboard provides:

| Page | Purpose |
|------|---------|
| **Home** (`/`) | Overview stats, test trend chart, and quick access to recent projects |
| **Projects** (`/projects`) | Searchable table of all projects with status, duration, and tag filters |
| **Project detail** (`/projects/:id`) | Run history for a project, with Runs, Tests, Failures, Performance and Settings tabs |
| **Test run** (`/test-runs/:id`) | Executions grouped by failure cluster, a changes tab against a baseline, and a worker timeline |
| **Test history** (`/test-cases/:id`) | One test's behavior over time — pass rate, duration trend, and every execution |
| **API Docs** (`/docs`) | Interactive API reference with endpoint documentation, schemas, and try-it console (auto-generated) |
| **Settings** (`/settings`) | Account, users, storage, tags, wasted-time patterns, AI diagnosis, and notifications |

See the [UI overview](/features/ui-overview) for a full map of every page and tab.

## Next steps

- [Core concepts](./concepts) — the vocabulary the dashboard and these docs use
- [Reporter](./reporter) — every option, streaming, sharding, and locator healing
- [UI overview](/features/ui-overview) — a map of every page and tab
- [Deployment](/operate/deployment) — running it properly for a team
- [Desktop app](/features/desktop) — the same dashboard as a local app, if you skipped it above
- [Upgrading](/operate/upgrading) — what a version bump does before you pull a new tag
- [Contributing](https://github.com/PiwiTests/platform/blob/main/CONTRIBUTING.md) — dev setup, tests, and commit conventions if you want to hack on Piwi itself
