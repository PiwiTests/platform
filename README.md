<p align="center">
  <img src="./docs/public/logo-wide.svg" alt="Piwi Dashboard" height="64">
</p>

<p align="center">
  <b>A permanent home for your Playwright test results.</b><br>
  CI reports vanish on every build. Piwi keeps them — and turns them into live dashboards,
  failure clusters, AI diagnosis, and cross-run analytics. Self-hosted, no SaaS.
</p>

<p align="center">
  <a href="https://phenx.github.io/piwi-dashboard/demo/"><img src="https://img.shields.io/badge/▶_Live_demo-try_it_now-2496ED?style=for-the-badge" alt="Live demo"></a>
  <a href="https://phenx.github.io/piwi-dashboard"><img src="https://img.shields.io/badge/📖_Documentation-read_the_docs-020420?style=for-the-badge" alt="Documentation"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@phenx/piwi-dashboard-reporter"><img src="https://img.shields.io/npm/v/@phenx/piwi-dashboard-reporter?logo=npm&labelColor=020420&color=CB3837" alt="npm"></a>
  <a href="https://hub.docker.com/r/phenx/piwi-dashboard"><img src="https://img.shields.io/docker/v/phenx/piwi-dashboard?logo=docker&labelColor=020420&color=2496ED" alt="Docker"></a>
</p>

![Dashboard home — overview stats and test results trend](docs/public/screenshots/home.png)

## Why Piwi?

Native Playwright HTML reports are great for local debugging — but they're ephemeral. Once the next CI run completes, the old report is gone. Piwi keeps every run and makes them connected, searchable, and actionable:

- 🗄️ **Permanent history** — every run, trace, and report stored and browsable across time.
- ⚡ **Live streaming** — watch runs in real time as CI executes; no polling, no waiting.
- 🔗 **Failure clustering** — failures sharing a root cause are auto-grouped by error fingerprint.
- 🤖 **AI diagnosis** — LLM analysis of a failure cluster, grounded in your actual SCM diff.
- 📈 **Performance & flaky tracking** — P90 duration trends, slowest tests, composite flakiness scores.
- 🔌 **Built for automation** — drop-in reporter, REST API, OpenAPI docs, and an MCP server for AI agents.
- ☁️ **Zero lock-in** — self-hosted with Docker; your data in SQLite/PostgreSQL and local/S3 storage.

👉 **[Explore the live demo](https://phenx.github.io/piwi-dashboard/demo/)** — no install required.

## Quick start

**1. Start the dashboard**

```bash
# Linux / macOS
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

```powershell
# Windows (PowerShell)
docker run -p 3000:3000 -v ${PWD}/.data:/app/.data ghcr.io/phenx/piwi-dashboard:latest
```

Visit `http://localhost:3000`.

**2. Add the reporter to your test project**

```bash
npm install --save-dev @phenx/piwi-dashboard-reporter
```

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
  use: { trace: 'retain-on-failure' },
})
```

**3. Run your tests** — `npx playwright test`. Results appear automatically; the project is created on first submission.

➡️ Full setup, configuration, and CI integration in the **[Getting started guide](https://phenx.github.io/piwi-dashboard/getting-started)**.

## Documentation

| Topic | Link |
|-------|------|
| Getting started | [phenx.github.io/piwi-dashboard/getting-started](https://phenx.github.io/piwi-dashboard/getting-started) |
| Playwright reporter | [phenx.github.io/piwi-dashboard/reporter](https://phenx.github.io/piwi-dashboard/reporter) |
| UI overview | [phenx.github.io/piwi-dashboard/ui-overview](https://phenx.github.io/piwi-dashboard/ui-overview) |
| AI diagnosis & clustering | [phenx.github.io/piwi-dashboard/ai-diagnosis](https://phenx.github.io/piwi-dashboard/ai-diagnosis) |
| Flaky tests & analytics | [phenx.github.io/piwi-dashboard/flaky-tests](https://phenx.github.io/piwi-dashboard/flaky-tests) |
| Notifications & alerts | [phenx.github.io/piwi-dashboard/notifications](https://phenx.github.io/piwi-dashboard/notifications) |
| Configuration reference | [phenx.github.io/piwi-dashboard/configuration](https://phenx.github.io/piwi-dashboard/configuration) |
| API reference | [phenx.github.io/piwi-dashboard/api](https://phenx.github.io/piwi-dashboard/api) |
| MCP server | [phenx.github.io/piwi-dashboard/mcp](https://phenx.github.io/piwi-dashboard/mcp) |
| Authentication | [phenx.github.io/piwi-dashboard/authentication](https://phenx.github.io/piwi-dashboard/authentication) |
| Storage configuration | [phenx.github.io/piwi-dashboard/storage](https://phenx.github.io/piwi-dashboard/storage) |
| Deployment | [phenx.github.io/piwi-dashboard/deployment](https://phenx.github.io/piwi-dashboard/deployment) |

The running dashboard also serves interactive API docs (Scalar) at `/docs`.

## Contributing

```bash
cd application && npm install && npm run app:dev   # http://localhost:3000
```

See **[AGENTS.md](AGENTS.md)** for architecture, conventions, and the full development guide.

## License

MIT

---

<sub>**Disclaimer:** Piwi Dashboard is **not affiliated with, endorsed by, or connected to Microsoft Corporation** in any way. "Piwi" is a playful, unrelated name with no connection to any existing product or brand.</sub>
