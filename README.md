<p align="center">
  <img src="./docs/public/logo-wide.svg" alt="Piwi Dashboard" height="64">
</p>

> **Disclaimer:** Piwi Dashboard is **not affiliated with, endorsed by, or connected to Microsoft Corporation** in any way.  

[![npm](https://img.shields.io/npm/v/@phenx/piwi-dashboard-reporter?logo=npm&labelColor=020420&color=CB3837)](https://www.npmjs.com/package/@phenx/piwi-dashboard-reporter)
[![Docker](https://img.shields.io/docker/v/phenx/piwi-dashboard?logo=docker&labelColor=020420&color=2496ED)](https://hub.docker.com/r/phenx/piwi-dashboard)

**Piwi Dashboard** is a self-hosted observability platform for [Playwright](https://playwright.dev) end-to-end tests. It turns ephemeral CI reports into a permanent, searchable history — with live streaming, failure clustering, AI diagnosis, and cross-run analytics. Your team gets a central hub for test health without relying on external SaaS services.

📖 **[Full documentation](https://phenx.github.io/piwi-dashboard)** · 🎮 **[Live demo](https://phenx.github.io/piwi-dashboard/demo/)**

![Dashboard home — overview stats and test results trend](docs/public/screenshots/home.png)

<details>
<summary>More screenshots</summary>

**Projects list** — all projects with last-run status and test ratio at a glance:

![Projects list](docs/public/screenshots/projects.png)

**Project detail** — full run history with pass/fail breakdown:

![Project detail](docs/public/screenshots/project-detail.png)

**Performance** — duration trend, slowest tests, and side-by-side run comparison:

![Performance](docs/public/screenshots/performance.png)

**Test run detail** — every test case with status, duration, and error details:

![Test run detail](docs/public/screenshots/test-run.png)

**Failure clusters** — error fingerprinting groups tests sharing the same root cause:

![Failure clusters](docs/public/screenshots/failure-clusters-tab.png)

**Flaky tests** — composite flakiness score with retry-pass and alternation breakdown:

![Flaky tests](docs/public/screenshots/flaky-tests.png)

**Cluster triage** — set status, write triage notes, and track resolution:

![Cluster triage](docs/public/screenshots/failure-cluster-triage.png)

</details>

## Why Piwi Dashboard?

Running Playwright tests in CI produces HTML reports that are ephemeral — once a new build runs, the old report is gone. Piwi makes test results permanent, connected, and actionable.

```
Playwright run  →  Reporter uploads results  →  Live streaming (real-time CI)
                                                    ↓
  AI diagnosis  ←  Failure clustering (auto-group)  ←  Historical analysis & trends
       ↓
  Triage workflow  →  Team notifications  →  Fix & deploy  →  Back to Playwright run
```

Piwi solves what standalone HTML reports cannot:

1. **Persistent test intelligence** — every run, trace, and report is stored permanently and browsable across history. Compare runs side by side, track flakiness over time, and never lose a CI result again.
2. **Live streaming** — watch test progress in real time as CI executes. Investigate failures while the suite is still running, without waiting for completion.
3. **Failure clustering** — tests sharing the same root cause are grouped automatically via error fingerprinting. "10 failures, 2 root causes" replaces scrolling through unrelated errors.
4. **AI diagnosis** — contextual LLM analysis of failure clusters using SCM diff, selected commits, and run metadata. Not a generic AI button — a diagnosis grounded in your actual code changes.
5. **Performance regression tracking** — step-level timing, avg/P90 duration trends, slowest-tests analysis, and side-by-side run comparison.
6. **Zero vendor lock-in** — self-hosted with Docker; your data stays in your SQLite/PostgreSQL database and local/S3 storage.

## Features

- 📊 **Test results storage** — store complete Playwright test run data (status, duration, retries, errors, flaky detection)
- 🎯 **Project organization** — tests organized by project with tags, labels, and descriptions; auto-created on first submit
- 🌍 **Environment tracking** — tag runs with a deployment environment (e.g. `production`, `staging`, `integration`) and filter by it in the run list
- 📈 **Performance tracking** — step-level timing, avg/P90 duration trends, slowest-tests analysis
- 🌐 **Network request analysis** — find slow API endpoints grouped by method + normalized route
- 🔬 **Browser Web Vitals** — TTFB, DOMContentLoaded, FCP and more via the Performance API
- 🌐 **Multi-browser support** — every test case records its browser config (project name, browser, channel, viewport); filter and sort by browser in the test run detail page
- 📊 **Run comparison** — side-by-side delta view with improved/regressed/unchanged summary
- 🔗 **Failure clustering** — failed tests sharing the same root cause are grouped automatically via error fingerprinting; run page shows failure groups with flaky and worker-correlation heuristics; each cluster has its own detail page with triage tools
- 🤖 **AI diagnosis** — LLM analysis of any failure cluster (Anthropic, OpenAI-compatible, Ollama, etc.); pin a baseline commit so the diagnosis includes the relevant SCM diff; browse and cherry-pick specific commits to add their full diffs to the context; diagnosis includes category, confidence, root cause, evidence, suggested fix, and prevention tips; auto-diagnose new clusters on run completion; supports global and per-project custom instructions to tailor analysis to your stack
- 🔀 **Flaky test detection** — composite flakiness score based on retry passes, status alternations, and failure rate; dedicated project tab with configurable lookback window
- 🏷️ **Flaky root cause classification** — automatic 5-category classification (timing, network, assertion, environment, other) using keyword heuristics; filterable by root cause in the flaky tests table
- 📊 **Impact-ranked flaky list** — flaky tests sorted by wasted CI minutes and pipeline-block impact; color-coded impact dots (green < 5 min, amber < 30 min, red ≥ 30 min)
- 📈 **Per-test stability trend** — time-series of pass rate, flaky rate, and average duration for each test case; returns bucketed trend data via API
- 🔍 **Run insights tab** — compares current run against its last passing baseline; highlights new regressions, recurring failures, fixed tests, new flaky tests, performance changes (most regressed/improved), worker imbalance, and new failure clusters
- 🏷️ **Regression signals** — `NEW` (red) and `FLAKY` (purple) badges on individual test cases in run detail; filter toggles for "New regressions" and "New flaky"
- 📋 **Spec health heatmap** — project-level spec-file overview with pass-rate colored indicators; clickable cells link to filtered test-case lists
- 🔌 **Playwright reporter** — drop-in custom reporter for automatic result submission, with HTML report and trace uploads
- 🔌 **MCP server** — built-in Model Context Protocol server at `/mcp`; connect Claude Code, Cursor, VS Code Copilot, Claude Desktop, Gemini CLI, and others directly to your test data; 11 tools covering projects, runs, failures, flaky tests, clusters, AI diagnoses, and raw SCM-grounded evidence context
- 📖 **Interactive API docs** — auto-generated OpenAPI 3.1 specification with Scalar UI at `/docs`; all endpoints annotated with `defineRouteMeta()`
- ⚡ **Real-time streaming** — live dashboard via Server-Sent Events; pages refresh instantly when a run starts or finishes, with no polling
- 🔐 **Authentication** — optional role-based access control (administrator, reporter, user) with API key support for CI and OAuth (Google, GitHub)
- 🔔 **Notifications** — subscribe to run events (`run.finished`, `run.failed`, `run.failed.default_branch`, `cluster.new`, `flakiness.spike`, `perf.regression`) via email, Slack webhooks, or HTTP webhooks; realtime or daily digest; per-project subscribe bell; mute, filter by branch/status/threshold
- 📧 **Account management** — user email verification, forgot/reset password, admin invite-by-email flow; change password from account settings
- ☁️ **Flexible storage** — SQLite or PostgreSQL database; local file system or S3-compatible object storage for artifacts
- 🐳 **Docker support** — pre-built multi-platform container images (~200 MB) on GitHub Container Registry

### Beyond HTML reports

Native Playwright HTML reports are great for local debugging — they include a built-in trace viewer, video playback, step annotations, screenshots, and full-text search. But they're ephemeral: once the next CI run completes, the old report is gone.

Piwi keeps what works and adds what HTML reports cannot do alone:

| Capability                                           | HTML report | Piwi Dashboard |
|------------------------------------------------------|-------------|----------------|
| Full trace viewer (steps, network, console)          | ✅           | ✅              |
| Screenshot & video playback                          | ✅           | ✅              |
| Retry comparison                                     | ✅           | ✅              |
| Search & filter tests                                | ✅           | ✅              |
| **Permanent history across CI runs**                 | ❌           | ✅              |
| **Cross-run trends & flakiness tracking**            | ❌           | ✅              |
| **Live streaming from CI**                           | ❌           | ✅              |
| **Failure clustering (auto-grouped root causes)**    | ❌           | ✅              |
| **AI diagnosis with SCM context**                    | ❌           | ✅              |
| **Multi-project hub**                                | ❌           | ✅              |
| **Team triage workflow (status, notes, assignment)** | ❌           | ✅              |
| **Side-by-side run comparison**                      | ❌           | ✅              |
| **REST API for automation & integration**            | ❌           | ✅              |
| **MCP server for AI agent access**                   | ❌           | ✅              |
| No server required — open HTML file directly         | ✅           | ❌              |
| Self-hosted (your infra, your data)                  | ✅           | ✅              |

## Quick start

### 1. Start the dashboard

```bash
docker pull ghcr.io/phenx/piwi-dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

Visit `http://localhost:3000`.

### 2. Install the reporter in your test project

```bash
npm install --save-dev @phenx/piwi-dashboard-reporter
```

### 3. Configure Playwright

```typescript
// playwright.config.ts
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

### 4. Run your tests

```bash
npx playwright test
```

Results appear automatically in the dashboard. The project is created on first submission.

## Dashboard UI overview

| Page | What it shows |
|------|---------------|
| **Home** | Aggregate stats (total projects, runs, passing rate, flaky count), test results trend chart, recent projects |
| **Projects** | Searchable/filterable table of all projects with last-run status, duration, test ratio, and report links |
| **Project detail** | Run history, failure clusters, flaky tests with root cause classification, trends, test cases, spec health heatmap, and run comparison — all in one tabbed view |
| **Performance** | Avg/P90 duration trend chart, top 20 slowest tests, side-by-side run comparison, stability trend per test case |
| **Test cases** | Per-project view of all unique test cases with pass rate, result breakdown, stability trend, and link to each test's history |
| **Test run detail** | Every test case in a run with browser icon, status, duration, location, error messages, traces, and reports; filter by browser; regression signal badges (NEW/FLAKY); failure groups with AI diagnosis; run insights tab |
| **Flaky tests** | Impact-ranked list with root cause classification badges, color-coded wasted CI minutes, filterable by root cause category |
| **Failure cluster** | Cluster detail with affected tests, triage tools (status + note), and LLM diagnosis with SCM diff context (baseline commit picker, commit browser for targeted context selection) |
| **API Docs** (`/docs`) | Auto-generated interactive API reference powered by Scalar with all endpoints, request/response schemas, and try-it console |
| **Settings › Account** | Email address, verification status, change password, OAuth info (when authentication is enabled) |
| **Settings › Notifications** | SMTP status, notification channels (email/Slack/webhook), subscription management with mute/edit/delete |
| **Settings › AI** | Configure AI provider, auto-diagnose, and global analysis instructions |
| **Settings › Users** | User management with email, invite-by-email, and API key generation (when authentication is enabled) |
| **Settings › Storage** | Storage statistics and cleanup tools for old runs |
| **Settings › Tags** | Tag management for organizing projects |

## Development

### Requirements

- **Node.js 24+** (the version used by CI and the Docker image)
- **npm**

### Running locally

```bash
cd application
npm install
npm run app:dev
```

### Available scripts

| Command                  | Description |
|--------------------------|-------------|
| `npm run app:dev`        | Start development server with hot reload |
| `npm run app:build`      | Build for production |
| `npm run app:preview`    | Preview production build locally |
| `npm run app:typecheck`  | TypeScript type checking |
| `npm run app:lint`       | Run ESLint |
| `npm run app:test`       | Run Playwright functional tests |
| `npm run db:generate`    | Generate SQLite migration from schema changes |
| `npm run db:generate:pg` | Generate PostgreSQL migration from schema changes |
| `npm run db:studio`      | Open Drizzle Studio (SQLite) |
| `npm run db:studio:pg`   | Open Drizzle Studio (PostgreSQL) |
| `npm run seed:demo`      | Regenerate demo seed data |

### Project structure

```
piwi-dashboard/
├── application/          # Nuxt 4 web application
│   ├── app/              # Frontend (Vue components, pages, composables)
│   ├── server/           # Backend (API routes, database, storage)
│   ├── shared/           # Types & utilities shared between server and reporter
│   ├── public/           # Static assets
│   └── Dockerfile        # Production container image
├── reporter/             # @phenx/piwi-dashboard-reporter npm package
├── docs/                 # VitePress documentation site
├── DOCKER.md             # Docker deployment guide
└── README.md             # This file
```

### Reporter development

The reporter (`reporter/`) is written in TypeScript. Source files are in `src/`; compiled output goes to `dist/`.

```bash
cd reporter
npm install
npm run reporter:build         # compile TypeScript to dist/
npm run reporter:dev           # watch mode — auto-recompile on changes
```

The build produces `.js` + `.d.ts` files in `dist/`. The `package.json` `exports` field maps `@phenx/piwi-dashboard-reporter` and `@phenx/piwi-dashboard-reporter/fixtures` to their `dist/` counterparts.

Source layout (13 modules):

| Module               | Kind     | Purpose                                      |
|----------------------|----------|----------------------------------------------|
| `config.ts`          | Interface + function | `PiwiDashboardOptions` + defaults merger |
| `reporter.ts`        | Class    | Main orchestrator (Playwright hooks, streaming, upload fallback) |
| `http-client.ts`     | Class    | HTTP/HTTPS transport (login, JSON, FormData) |
| `uploader.ts`        | Class    | Upload strategies (JSON, multipart, streaming files) |
| `stream-buffer.ts`   | Class    | Persistent JSONL event buffer                |
| `crash-recovery.ts`  | Class    | Recovery data save/load/retry                |
| `file-handler.ts`    | Class    | Report directory, trace/attachment file ops  |
| `metadata-collector.ts` | Class | CI, SCM, Playwright config metadata          |
| `step-analyzer.ts`   | Functions | Step categorization, flattening, performance |
| `helpers.ts`         | Functions | `getSetupFilePath`, `computeInstanceId`, `createGlobalSetup` |
| `compression.ts`     | Function  | Directory gzip archiver                      |
| `fixtures.ts`        | Fixtures  | Playwright network/web-vitals/console fixtures |
| `index.ts`           | Entry     | Re-exports class + `createGlobalSetup`       |

**Important:** Do not use `import type` from `../application/shared/` in reporter method signatures — it would leak the monorepo path into published `.d.ts` files. The shared types define the wire contract; the reporter stays loosely typed (`any`) since it handles Playwright internals.

## Documentation

| Topic | Link |
|-------|------|
| Getting started | [phenx.github.io/piwi-dashboard/getting-started](https://phenx.github.io/piwi-dashboard/getting-started) |
| Playwright reporter | [phenx.github.io/piwi-dashboard/reporter](https://phenx.github.io/piwi-dashboard/reporter) |
| API reference | [phenx.github.io/piwi-dashboard/api](https://phenx.github.io/piwi-dashboard/api) |
| Interactive API docs | Served at `/docs` when running the dashboard (Scalar UI, auto-generated from OpenAPI spec) |
| Authentication | [phenx.github.io/piwi-dashboard/authentication](https://phenx.github.io/piwi-dashboard/authentication) |
| Storage configuration | [phenx.github.io/piwi-dashboard/storage](https://phenx.github.io/piwi-dashboard/storage) |
| Deployment | [phenx.github.io/piwi-dashboard/deployment](https://phenx.github.io/piwi-dashboard/deployment) |

## Contributing

See [AGENTS.md](AGENTS.md) for detailed development guidelines and architecture information.

## License

MIT
