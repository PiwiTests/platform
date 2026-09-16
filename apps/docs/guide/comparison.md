---
title: Why Piwi? — Comparison & FAQ
lang: en-US
---

# Why Piwi?

Piwi Dashboard gives your Playwright results a permanent, self-hosted home — with live streaming, failure clustering, flaky-test analytics, and optional AI diagnosis on top. This page explains how it relates to tools you may already use, and answers the questions we hear most.

## The landscape

Every tool below is good at what it targets. The honest differences:

- **Playwright HTML report** — excellent for debugging a single run locally. But it's per-run and ephemeral: once the next CI build uploads its artifact, yesterday's context is gone, and there's no cross-run view (trends, flakiness, clustering) at all. Piwi doesn't replace it for local work — it replaces the *"download the artifact zip from CI"* workflow.
- **Allure Report** — a mature, multi-framework report generator producing a rich static report. History across builds requires wiring previous results into each build, and there's no server, live view, or cross-run analytics in the open-source generator (that's the commercial TestOps product).
- **ReportPortal** — a mature, framework-agnostic, self-hosted test-ops platform with ML-based failure triage. It's built for organizations aggregating many frameworks, and its self-hosted footprint matches that ambition: a multi-service stack (API services, PostgreSQL, RabbitMQ, OpenSearch). Piwi trades that breadth for Playwright-native depth in a single container.
- **Currents** — a polished commercial SaaS for Playwright and Cypress: run history, flake detection, CI orchestration. It's managed and maintained for you; in exchange it's paid and your test data lives on their infrastructure.
- **Fault0** — the closest peer to Piwi: a newer, free, self-hosted, Playwright-only results dashboard with a one-line reporter, centralized run history, trace/screenshot/video debugging, notifications, and flaky-test trends. It targets the same "give your Playwright results a home" job. Where Piwi differs today is the depth of the analysis layer on top of that shared core — failure clustering, flaky **scoring** with CI-cost impact, locator healing, an MCP server for AI agents, and optional git-grounded AI diagnosis — so the honest split is *seeing* failures (both) versus *resolving* them (Piwi's focus). We've based this on Fault0's public docs and homepage; corrections welcome.

## Feature comparison

| | **Piwi** | Playwright HTML report | Allure Report | ReportPortal | Currents | Fault0 |
|---|---|---|---|---|---|---|
| Run history across builds | ✅ | ❌ per-run | ➖ manual wiring | ✅ | ✅ | ✅ |
| Self-hosted | ✅ single container | — | ➖ static files | ✅ multi-service stack | ❌ SaaS | ✅ |
| Live run streaming | ✅ SSE, per-test | ❌ | ❌ | ➖ | ✅ | ➖ real-time status |
| Playwright traces, first-class | ✅ stored + viewer links | ✅ | ➖ attachments | ➖ attachments | ✅ | ✅ |
| Flaky detection & scoring | ✅ composite score, root-cause classes, CI-cost impact | ❌ | ❌ | ✅ | ✅ | ➖ detection |
| Failure clustering | ✅ error fingerprinting | ❌ | ❌ | ✅ ML-based | ✅ | ➖ |
| AI failure diagnosis | ✅ optional, grounded in your git diff, patches validated server-side | ❌ | ❌ | ➖ ML triage | ➖ | ➖ |
| Locator healing suggestions | ✅ from prior passing runs | ❌ | ❌ | ❌ | ❌ | ➖ |
| Plain-English steps, compiled | ✅ [AI steps](./ai-steps) — resolved once, replayed with zero model calls | ❌ | ❌ | ❌ | ❌ | ❌ |
| Web vitals & network capture | ✅ | ➖ in traces | ❌ | ❌ | ✅ | ➖ |
| MCP server for AI agents | ✅ 46 tools | ❌ | ❌ | ❌ | ✅ | ➖ |
| Framework support | Playwright only (by design) | Playwright | Many | Many | Playwright, Cypress, Jest… | Playwright only |
| Price | Free, MIT | Free | Free | Free (self-host) / paid SaaS | Paid | Free, OSS |

In the **Fault0** column, ➖ marks a capability we did not find in its public docs at the time of writing (not necessarily a confirmed absence) — the two products share the core results-dashboard experience and differ mainly in Piwi's analysis depth. Corrections welcome.

## When Piwi is *not* the right choice

- **You aggregate many test frameworks** (JUnit, pytest, Cypress, …) into one place → ReportPortal or Allure fit better. Piwi is deliberately Playwright-only: that's what makes traces, locator healing, and step-level analytics first-class.
- **You want a managed service with CI orchestration** and someone else on the pager → Currents.
- **You only debug locally** and never look back at CI history → the built-in HTML report is already great.

## FAQ

### Is my data safe? Does Piwi phone home?

**Zero telemetry.** The full inventory is in [Privacy & data flow](./privacy). Piwi makes no outbound calls except the ones you explicitly configure: your AI provider (if you enable diagnosis), your SMTP server, your S3 endpoint, your Slack/webhook URLs, and your git host (if you connect a repository). No analytics, no update pings, no crash reporting. Your test results live in your SQLite file or PostgreSQL database, on your infrastructure.

### Does AI diagnosis send my code to a third party?

Only if you turn it on, and only to the provider *you* configure. The diagnosis context (error messages, failing steps, the relevant git diff, screenshots) is sent to your configured endpoint — Anthropic, OpenAI, or any OpenAI-compatible URL, including a fully local model via Ollama/vLLM. You can preview the exact context before it's sent, and cap its size in Settings. With no provider configured, the feature stays off and nothing leaves your server.

### SQLite or PostgreSQL?

Start with SQLite — it's zero-config and easily handles a team's test volume. Switch to PostgreSQL (`PIWI_DATABASE_URL`) when you want concurrent write headroom, an existing backup story, or your ops standard is Postgres. Both backends are exercised by the project's CI on every commit.

### Which Node version does the dashboard need?

**Node 22 or newer**, and only for the `npx` / from-source paths — the Docker image and the desktop app bundle their own runtime. CI runs the E2E suite on Node 22 against the published build, so the floor is tested, not aspirational. The **reporter** that runs inside your test project is much less demanding — Node 20+, the version it is built for and declares in its `engines` — so your test suite's runtime almost certainly doesn't need to change.

### Can I use it with Cypress / Jest / other frameworks?

No — Piwi is Playwright-only by design. The ingest API, trace handling, step analytics, and locator healing are all built around Playwright's model. Breadth is what ReportPortal and Allure are for.

### Is it production-ready?

Piwi is a young project under active development (pre-1.0, semver). It's exercised by a CI matrix across SQLite/PostgreSQL × local/S3 storage with a large Playwright E2E suite, and upgrades run database migrations automatically. Pin a version tag, keep backups of `.data/` ([deployment guide](/operate/deployment)), and expect occasional breaking changes between minor versions until 1.0.

### How much disk/RAM does it need?

Modest — see [resource requirements](/operate/deployment#resource-requirements). Disk is the real variable: traces and HTML reports dominate, and you can prune old runs from Settings → Storage.

### Where do I ask questions or propose features?

[GitHub Discussions](https://github.com/PiwiTests/platform/discussions) for questions and ideas, [issues](https://github.com/PiwiTests/platform/issues) for bugs, and [ROADMAP.md](https://github.com/PiwiTests/platform/blob/main/ROADMAP.md) for direction.

---

<sub>Product names are used for identification only. Piwi Dashboard is an independent project, not affiliated with, endorsed by, or connected to Microsoft Corporation (Playwright), Qameta Software (Allure), EPAM Systems (ReportPortal), Currents Software, or Fault0. Details about third-party products reflect their publicly documented open-source/free tiers and may change — corrections welcome.</sub>
