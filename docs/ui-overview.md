---
title: UI overview
lang: en-US
---

# UI overview

The Piwi Dashboard is a single-page application built with [Nuxt UI](https://ui.nuxt.com). It uses a sidebar navigation layout with real-time updates via Server-Sent Events — pages refresh automatically when test runs start or finish, without requiring manual reload.

## Navigation structure

The dashboard sidebar provides access to the main sections:

| Section | Path | Description |
|---------|------|-------------|
| Home | `/` | Landing page with aggregate statistics and activity overview |
| Projects | `/projects` | Full project listing with search, filters, and actions |
| Settings | `/settings` | Application configuration (general, users, storage, tags) |

Project-level pages are accessed by clicking into a specific project:

| Page | Path | Description |
|------|------|-------------|
| Project detail | `/projects/:id` | Run history table with status, duration, and breakdowns |
| Project edit | `/projects/:id/edit` | Edit project name, label, description, and tags |
| Performance | `/projects/:id/performance` | Duration trends, slowest tests, run comparison |
| Test cases | `/projects/:id/test-cases` | All unique test cases with per-case history |

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

Shows the complete run history for a single project:

- **Run table** — each row shows run status, start time, duration, test counts, and links to reports/traces
- **Delete** — administrators can delete individual runs
- **Navigation** — tabs or links to Performance and Test Cases sub-pages

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
  - **Test cases** — every test with status, duration, file location, error messages, traces; scrollable table with sticky header, searchable, filterable by status, and paginated
  - **Workers** — horizontal timeline showing worker assignment per test case; click a bar to jump to that test case in the table
  - **Compare** — select a baseline run for side-by-side delta view showing new failures, recovered tests, and duration changes (improved/regressed/unchanged)
  - **Slow endpoints** — aggregated network request table showing slow API calls grouped by method + normalized route, with avg/p90/max duration and error rate
  - **Failure groups** — failures grouped by root cause via error fingerprinting; each group shows signature, error type, count, flaky/worker-correlation indicators, and the list of affected test cases with retry info
- **Delete** — administrators can delete the entire run and associated files

## Test case detail

Shows everything about a single test execution:

- **Status card** — test ID, title, location (copyable), duration, worker index, retries, slowest step, and duration vs historical average comparison
- **Run context** — environment, CI provider, build number, branch, commit, author, browser, viewport — all from the parent test run's metadata
- **HTML report** — direct link to the specific test in the full HTML report (with screenshots, video, and interactive trace viewer)
- **Traces** — attached trace files with "Open trace" buttons that launch the Playwright trace viewer
- **Error details** — full error message with copy button and expandable view for long errors
- **Debug prompt for AI** — for failed tests, a pre-generated prompt with all relevant context (error, steps, network failures) ready to paste into an AI assistant for help fixing the issue
- **Performance hints** — actionable suggestions for slow navigations, flaky tests, slow assertions, and long step sequences
- **Steps** — execution steps with category badges and individual timing
- **Web Vitals** — TTFB, FCP, DOMContentLoaded, etc. with color-coded thresholds (green/amber/red)
- **Network requests** — all HTTP requests grouped by method + normalized route with count and avg duration
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

## Real-time updates

The dashboard uses Server-Sent Events (SSE) for live updates:

1. **Global stream** (`/api/stream`) — notifies all connected clients when a run starts, finishes, or is submitted. Pages automatically refresh their data.
2. **Per-run stream** (`/api/test-runs/:id/stream`) — used on the test run detail page to show live progress as tests complete during a streaming run.

This means you never need to manually refresh the dashboard — it updates itself whenever CI submits new results.

## Demo run simulator

The [live demo](https://phenx.github.io/piwi-dashboard/demo/) includes a **Simulate a test run** menu in the demo banner. It replays the exact streaming protocol a Piwi reporter speaks during a real Playwright run — entirely in your browser — so you can watch a run arrive live. Available scenarios:

- **Passing run** — all tests pass across 4 parallel workers
- **Run with failures** — failures joining a known failure cluster, plus a brand-new cluster
- **Flaky retries** — tests that fail and then pass on retry
- **Performance regression** — a green run that is ~2× slower, with degraded endpoints
- **Interrupted run** — a CI job killed partway through the suite

Each simulation creates a real run in the in-browser database: initialization status, live per-test updates, worker timeline, failure groups, regression context, and history-based comparisons all behave exactly as they would against a real server.

## Responsive design

The dashboard is fully responsive:

- **Desktop** — sidebar navigation with full table views
- **Tablet** — collapsible sidebar, tables scroll horizontally
- **Mobile** — compact layout with stacked cards and hamburger menu

## Dark mode

The dashboard supports light and dark themes, following the system preference by default. Toggle manually via the theme switcher in the sidebar.
