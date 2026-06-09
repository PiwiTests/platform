# Piwi Dashboard

> **Disclaimer:** Piwi Dashboard is **not affiliated with, endorsed by, or connected to Microsoft Corporation** in any way.  
> The name "Piwi" is a playful, unrelated name with no connection to any existing product or brand.  
> This project was originally called "Playwright Dashboard" and was renamed to avoid any confusion with Microsoft's Playwright testing framework.

[![Nuxt UI](https://img.shields.io/badge/Made%20with-Nuxt%20UI-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)
[![Docker](https://img.shields.io/badge/Docker-Available-2496ED?logo=docker&labelColor=020420)](https://github.com/PhenX/piwi-dashboard/pkgs/container/piwi-dashboard)

**Piwi Dashboard** is a self-hosted web application for collecting, storing, and visualizing [Playwright](https://playwright.dev) end-to-end test results over time. It gives your team a central place to monitor test health, investigate failures, track performance regressions, and share reports — without relying on external SaaS services.

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

</details>

## Why Piwi Dashboard?

Running Playwright tests in CI produces HTML reports that are ephemeral — once a new build runs, the old report is gone. Piwi Dashboard solves this by:

1. **Persisting every test run** — results, traces, and reports are stored permanently and browsable at any time.
2. **Showing trends** — spot flaky tests, performance regressions, and failure patterns across dozens or hundreds of runs.
3. **Streaming results live** — watch test progress in real time as CI executes, without waiting for the full run to finish.
4. **Zero vendor lock-in** — deploy on your own infrastructure with Docker; data stays in your SQLite/PostgreSQL database and local/S3 storage.

## Features

- 📊 **Test results storage** — store complete Playwright test run data (status, duration, retries, errors, flaky detection)
- 🎯 **Project organization** — tests organized by project with tags, labels, and descriptions; auto-created on first submit
- 🌍 **Environment tracking** — tag runs with a deployment environment (e.g. `production`, `staging`, `integration`) and filter by it in the run list
- 📈 **Performance tracking** — step-level timing, avg/P90 duration trends, slowest-tests analysis
- 🌐 **Network request analysis** — find slow API endpoints grouped by method + normalized route
- 🔬 **Browser Web Vitals** — TTFB, DOMContentLoaded, FCP and more via the Performance API
- 📊 **Run comparison** — side-by-side delta view with improved/regressed/unchanged summary
- 🔌 **Playwright reporter** — drop-in custom reporter for automatic result submission, with HTML report and trace uploads
- ⚡ **Real-time streaming** — live dashboard via Server-Sent Events; pages refresh instantly when a run starts or finishes, with no polling
- 🔐 **Authentication** — optional role-based access control (administrator, reporter, user) with API key support for CI and OAuth (Google, GitHub)
- ☁️ **Flexible storage** — SQLite or PostgreSQL database; local file system or S3-compatible object storage for artifacts
- 🐳 **Docker support** — pre-built multi-platform container images (~200 MB) on GitHub Container Registry

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
| **Project detail** | Full run history for a single project with status badges, test breakdowns, and environment filter |
| **Performance** | Avg/P90 duration trend chart, top 20 slowest tests, side-by-side run comparison |
| **Test cases** | Per-project view of all unique test cases with pass/fail history |
| **Test run detail** | Every test case in a run with status, duration, location, error messages, traces, and reports |
| **Settings › Users** | User management and API key generation (when authentication is enabled) |
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
npm run dev
```

### Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm test` | Run Playwright functional tests |
| `npm run db:generate` | Generate SQLite migration from schema changes |
| `npm run db:generate:pg` | Generate PostgreSQL migration from schema changes |
| `npm run db:studio` | Open Drizzle Studio (SQLite) |
| `npm run db:studio:pg` | Open Drizzle Studio (PostgreSQL) |
| `npm run seed:demo` | Regenerate demo seed data |

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
| `config.ts`          | Interface + function | `DashboardReporterOptions` + defaults merger |
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
| Authentication | [phenx.github.io/piwi-dashboard/authentication](https://phenx.github.io/piwi-dashboard/authentication) |
| Storage configuration | [phenx.github.io/piwi-dashboard/storage](https://phenx.github.io/piwi-dashboard/storage) |
| Deployment | [phenx.github.io/piwi-dashboard/deployment](https://phenx.github.io/piwi-dashboard/deployment) |

## Contributing

See [AGENTS.md](AGENTS.md) for detailed development guidelines and architecture information.

## License

MIT
