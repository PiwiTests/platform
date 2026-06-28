---
title: UI overview
lang: en-US
---

# UI overview

The Piwi Dashboard is a single-page application built with [Nuxt UI](https://ui.nuxt.com). It uses a sidebar navigation layout with real-time updates via Server-Sent Events — pages refresh automatically when test runs start or finish, without requiring manual reload.

## Inline help

Throughout the dashboard, blocks that aren't self-explanatory carry a small muted help icon (a circled question mark) next to their title. Click it for a short explanation of the feature and, where available, a **Learn more** link to the relevant documentation page. The icon is keyboard-focusable and the popover closes with `Esc`. Self-explanatory blocks (counters, search boxes, basic forms) intentionally have no icon, keeping the interface uncluttered.

## Navigation structure

The dashboard sidebar provides access to the main sections:

| Section | Path | Description |
|---------|------|-------------|
| Home | `/` | Landing page with aggregate statistics and activity overview |
| Projects | `/projects` | Full project listing with search, filters, and actions |
| Settings | `/settings` | Application configuration (general, users, storage, tags) |
| API Docs | `/docs` | Interactive API reference auto-generated from the OpenAPI 3.1 spec — browse all endpoints, request/response schemas, and run live requests |

Project-level pages are accessed by clicking into a specific project:

| Page | Path | Description |
|------|------|-------------|
| Project detail | `/projects/:id` | Run history, failure clusters, flaky tests, trends, test cases, run comparison |
| Project edit | `/projects/:id/edit` | Edit project label, description, tags, and AI diagnosis instructions |
| Performance | `/projects/:id/performance` | Duration trends, slowest tests, run comparison |
| Test cases | `/projects/:id/test-cases` | All unique test cases with per-case history |
| Failure cluster | `/failure-clusters/:id` | Cluster details, affected tests, AI diagnosis, and triage |

Individual run and test case pages:

| Page | Path | Description |
|------|------|-------------|
| Test run | `/test-runs/:id` | Full detail of a single run — test list, errors, reports, traces |
| Test case | `/test-cases/:id` | Single test details — steps, web vitals, network requests |

## Home page

The home page provides a quick health check across all projects:

- **Stats cards** — total projects, total runs, active projects, passing projects, flaky test count, and slowest project
- **Test results trend chart** — stacked area chart showing pass/fail/skip/flaky distribution over time
- **Recent projects** — quick links to the most recently active projects with their current status
- **Getting started** — API usage example for teams that haven't configured the reporter yet

## Projects page

The projects page is the primary navigation hub:

- **Search** — filter projects by name with an instant text search
- **Tag filters** — click tag badges to show only projects with specific tags
- **Table columns** — project name (with tags), run count, last run date, duration, status badge, test status bar, report links, and action buttons
- **New project** — create a project manually with name, label, description, and tags
- **Refresh** — manually trigger a data refresh (also happens automatically via SSE)

## Project detail

Shows the complete run history for a single project, with six tabs:

- **Test runs** — each row shows run status, start time, duration, test counts, browser badges, and links to reports/traces; select two runs to compare them
- **Failure clusters** — all unique failure signatures across all runs, with status, error type, occurrence count, AI diagnosis badge, and a link to the cluster detail page
- **Flaky tests** — tests that fail intermittently, scored by a composite flakiness metric; shows failure rate, retry passes, status alternation count, root cause classification, and impact score (wasted CI minutes); sortable and filterable by root cause
- **Trends** — duration trend chart with date filter, and a slowest-tests table
- **Test cases** — all unique test cases with status, pass rate, result breakdown (with icons), average duration, and last run date
- **Compare** — side-by-side delta view between two selected runs (new failures, recovered, duration changes)

## Performance page

Provides insights into test execution speed:

- **Duration trend chart** — line chart showing average and P90 run durations over time
- **Slowest tests table** — top 20 test cases ranked by average duration, with min/max and occurrence count
- **Run comparison** — select two runs to see a side-by-side delta view showing which tests improved, regressed, or stayed unchanged

## Test run detail

Deep dive into a single test execution:

- **Summary header** — status, duration, start time, test counts, duration metrics (Avg P90), and metadata blocks (CI/Environment, Source control, Tags/Other) in a responsive card grid
- **Live progress** — if the run is still in progress (`running` status), a live progress bar and streaming test results appear in real time
- **Reports** — buttons to open attached HTML reports (Playwright, Monocart) in a new tab or download blob archives
- **Tabbed right panel** with five tabs:
  - **Test cases** — every test with browser icon (first column), status, duration, file location, error messages, annotation badges, traces; scrollable table with sticky header, searchable, filterable by status and browser, and paginated
- **Tree** — tests grouped by suite hierarchy (describe blocks), with expandable/collapsible nodes that show suite mode badges, annotation counts, and per-suite aggregate statistics
  - **Workers** — horizontal timeline showing worker assignment per test case; click a bar to jump to that test case in the table
  - **Compare** — select a baseline run for side-by-side delta view showing new failures, recovered tests, and duration changes (improved/regressed/unchanged)
  - **Slow endpoints** — aggregated network request table showing slow API calls grouped by method + normalized route, with avg/p90/max duration and error rate
  - **Failure groups** — failures grouped by root cause via error fingerprinting; each group shows signature, error type, count, flaky/worker-correlation signals, known-since run, and actions: filter the test list, trigger AI diagnosis (opens a modal), or navigate to the cluster detail page
- **Delete** — administrators can delete the entire run and associated files

## Test case detail

Shows everything about a single test execution:

- **Status card** — test ID, title, location (copyable), duration, worker index, retries, slowest step, and duration vs historical average comparison
- **Run context** — environment, CI provider, build number, branch, commit, author, browser, viewport — all from the parent test run's metadata
- **HTML report** — direct link to the specific test in the full HTML report (with screenshots, video, and interactive trace viewer)
- **Traces** — attached trace files with "View trace" buttons that open them in the Playwright trace viewer (trace.playwright.dev), plus download buttons; while the parent run is still in progress, traces and attachments appear live as soon as each test uploads them
- **Error details** — full error message with copy button and expandable view for long errors; if the test belongs to a failure cluster, a context row shows how many other tests in the same run share the same root cause
- **Alternative locators** — when the failure is a broken locator, ranked replacement locators with stability scores and a highlighted recommended fix (see [locator healing](./reporter#locator-healing)); shown only when prior-run or ARIA-snapshot data is available
- **Performance hints** — actionable suggestions for slow navigations, flaky tests, slow assertions, and long step sequences
- **Steps** — execution steps with category badges and individual timing
- **Web Vitals** — TTFB, FCP, DOMContentLoaded, etc. with color-coded thresholds (green/amber/red)
- **Network requests** — all HTTP requests grouped by method + normalized route with count and avg duration; backend server logs (captured via the `X-Piwi-Logs` header by ASP.NET Core or Nitro integrations) are shown inline under each request
- **History** — line chart and table showing this test case's status and duration across all previous runs

## Settings pages

### General settings

Basic application configuration. In demo mode, includes a "Reset Demo" button to restore seed data.

### Users (`/settings/users`)

Available when authentication is enabled (or shown with an informational message when disabled):

- **User table** — username, display name, role, and creation date
- **Add user** — create accounts with username, password, role (administrator/reporter/user), and display name
- **API keys** — generate and manage API keys for CI authentication; keys are shown once at creation and stored hashed

### Storage (`/settings/storage`)

Storage statistics and maintenance tools:

- **Stats** — total projects, test runs, test cases, traces, stored reports, aggregate report size, and on-disk storage size
- **Cleanup** — bulk-delete test runs older than a configurable period (7 to 365 days) with a confirmation dialog

### Tags (`/settings/tags`)

Manage tags used to organize projects:

- **Tag table** — tag text, color, and creation date
- **Add tag** — create new tags with custom names and colors
- **Edit/Delete** — modify or remove existing tags (administrator only)

### AI diagnosis (`/settings/ai`)

Configure LLM-based failure analysis:

- **Provider** — choose Anthropic API or an OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, Groq, Together AI, Mistral AI, or any custom URL)
- **API key / model / base URL** — provider credentials and model selection; keys are stored in the database (admin-only) or via `PIWI_AI_*` environment variables
- **Auto-diagnose** — automatically run AI diagnosis on new failure clusters when a run finishes (max 3 per run)
- **Global analysis instructions** — persistent text appended to the system prompt for every diagnosis across all projects; use this for general preferences, output format requirements, or team conventions (e.g. "always recommend checking retry counts before concluding flakiness")
- **Diagnosis context limits** — caps on how much evidence is packed into each diagnosis (error text, SCM patch budget, affected tests, steps, console entries, network requests, ARIA snapshot, test source), letting you trade detail against token cost. Leave a field empty to use its default. Any limit can instead be pinned via a `PIWI_AI_MAX_*` environment variable, in which case it takes precedence and shows read-only.
- **Environment variables** — copy-to-clipboard snippet for `PIWI_AI_*` env vars when credentials should not be stored in the database

## Failure cluster detail

Each failure cluster has a dedicated page (`/failure-clusters/:id`) with three tabs:

- **Overview** — signature, error type, selector, occurrence count, first/last seen runs, sample raw error, list of affected test cases with their latest run status, and — for broken-locator failures — an **Alternative locators** panel with ranked replacements and a recommended fix (see [locator healing](./reporter#locator-healing))
- **Triage** — set cluster status (open / resolved / ignored) and write an internal triage note
- **AI diagnosis** — run an LLM diagnosis of the cluster with full control over the context sent to the LLM:
  - **Baseline commit picker** — select the commit to compare against so the diagnosis includes the relevant SCM diff; pin a commit to persist it for all future diagnoses of this cluster
  - **Commit browser** — "Browse commits" opens a split modal where you can check specific commits to include their full diffs in the LLM context, regardless of the baseline; useful when the relevant change isn't the most recent one; the modal shows file-level diffs with syntax-colored patch lines and aggregates stats (files changed, lines added/removed) for your selection
  - **Diagnosis result** — category, confidence, summary, root cause, evidence list, suggested fix, and prevention tips; re-run at any time to refresh after new occurrences

### Per-project AI instructions

In the project edit page (`/projects/:id/edit`), an **AI diagnosis instructions** field lets you provide project-specific context that is combined with the global instructions for every diagnosis of that project's clusters. Use this to describe the system under test, known failure patterns, or domain-specific remediation guidance.

## Real-time updates

The dashboard uses Server-Sent Events (SSE) for live updates:

1. **Global stream** (`/api/stream`) — notifies all connected clients when a run starts, finishes, or is submitted. Pages automatically refresh their data.
2. **Per-run stream** (`/api/test-runs/:id/stream`) — used on the test run detail page to show live progress as tests complete during a streaming run.

This means you never need to manually refresh the dashboard — it updates itself whenever CI submits new results.

## Demo run simulator

The [live demo](https://piwitests.github.io/demo/) includes a **Simulate a test run** menu in the demo banner. It replays the exact streaming protocol a Piwi reporter speaks during a real Playwright run — entirely in your browser — so you can watch a run arrive live. Available scenarios:

- **Passing run** — all tests pass across 4 parallel workers
- **Run with failures** — failures joining a known failure cluster, plus a brand-new cluster
- **Flaky retries** — tests that fail and then pass on retry
- **Performance regression** — a green run that is ~2× slower, with degraded endpoints
- **Interrupted run** — a CI job killed partway through the suite
- **Cross-browser run** — tests distributed across Chromium, Firefox, and WebKit to showcase the browser column and filter

Each simulation creates a real run in the in-browser database: initialization status, live per-test updates, worker timeline, failure groups, regression context, and history-based comparisons all behave exactly as they would against a real server.

## Demo user switcher (act as)

The demo runs with authentication conceptually **enabled** so the role-based and project-affectation features are fully explorable. Use the **Acting as** picker in the demo banner to switch between several pre-seeded identities:

- **Avery (Admin)** — full access to every project; sees the user management and project members screens
- **Robin (CI Reporter)** — global access; can submit/triage but not manage users
- **Sam (Checkout team)** — a `user` scoped to a single project
- **Priya (API & UI team)** — a `user` scoped to two projects
- **Noah (No projects yet)** — a `user` with no affectations (sees an empty dashboard until assigned)

Switching identity reloads the dashboard under the new user, so the project list, sidebar menu, dashboard overview, recent runs, and search all reflect that user's **project affectations**. Acting as the admin, you can change affectations live — from **Settings → User management → Project access** (per user) or a project's **Members** tab (per project) — then switch to that user to see the effect. All of this happens entirely in your browser.

## Responsive design

The dashboard is fully responsive:

- **Desktop** — sidebar navigation with full table views
- **Tablet** — collapsible sidebar, tables scroll horizontally
- **Mobile** — compact layout with stacked cards and hamburger menu

## Dark mode

The dashboard supports light and dark themes, following the system preference by default. Toggle manually via the theme switcher in the sidebar.
