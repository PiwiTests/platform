# Playwright Dashboard

[![Nuxt UI](https://img.shields.io/badge/Made%20with-Nuxt%20UI-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)
[![Docker](https://img.shields.io/badge/Docker-Available-2496ED?logo=docker&labelColor=020420)](https://github.com/PhenX/playwright-dashboard/pkgs/container/playwright-dashboard)

A modern dashboard for storing and visualising Playwright test results, built with Nuxt 4 and powered by [Nuxt UI](https://ui.nuxt.com).

📖 **[Full documentation at phenx.github.io/playwright-dashboard](https://phenx.github.io/playwright-dashboard)**

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

## Features

- 📊 **Test results storage** — store complete Playwright test run data
- 🎯 **Project organisation** — tests organised by project, auto-created on first submit
- 📈 **Performance tracking** — step-level timing, avg/P90 trends, slowest-tests analysis
- 🌐 **Network request analysis** — find slow API endpoints grouped by method + normalised route
- 🔬 **Browser Web Vitals** — TTFB, DOMContentLoaded, FCP and more via the Performance API
- 📊 **Run comparison** — side-by-side delta view with improved/regressed/unchanged summary
- 🔌 **Playwright reporter** — custom reporter for automatic result submission
- ⚡ **Real-time updates** — live dashboard via Server-Sent Events; pages refresh instantly when a run starts or finishes, with no polling
- 🔐 **Authentication** — optional role-based access control (administrator, reporter, user)
- ☁️ **Flexible storage** — local file system or S3-compatible storage
- 🐳 **Docker support** — pre-built multi-platform container images (~200 MB)

## Quick start

```bash
docker pull ghcr.io/phenx/playwright-dashboard:latest
docker run -p 3000:3000 -v $(pwd)/.data:/app/.data ghcr.io/phenx/playwright-dashboard:latest
```

Visit `http://localhost:3000`.

## Documentation

| Topic | Link |
|-------|------|
| Getting started | [phenx.github.io/playwright-dashboard/getting-started](https://phenx.github.io/playwright-dashboard/getting-started) |
| Playwright reporter | [phenx.github.io/playwright-dashboard/reporter](https://phenx.github.io/playwright-dashboard/reporter) |
| API reference | [phenx.github.io/playwright-dashboard/api](https://phenx.github.io/playwright-dashboard/api) |
| Authentication | [phenx.github.io/playwright-dashboard/authentication](https://phenx.github.io/playwright-dashboard/authentication) |
| Storage configuration | [phenx.github.io/playwright-dashboard/storage](https://phenx.github.io/playwright-dashboard/storage) |
| Deployment | [phenx.github.io/playwright-dashboard/deployment](https://phenx.github.io/playwright-dashboard/deployment) |

## Contributing

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for detailed development guidelines and architecture information.
