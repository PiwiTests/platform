---
title: UI overview
lang: en-US
---

# UI overview

This page is a **map of the dashboard** — where each view lives and what it's for. For the concepts behind a feature, follow the links to the dedicated pages ([Flaky tests & analytics](./flaky-tests), [AI diagnosis & clustering](./ai-diagnosis), [Reporter](./reporter)).

The dashboard is a single-page app built with [Nuxt UI](https://ui.nuxt.com). It updates itself in real time over Server-Sent Events — pages refresh automatically when runs start or finish, so you never reload manually.

## Inline help

Blocks that aren't self-explanatory carry a small muted help icon (a circled question mark) next to their title. Click it for a short explanation and, where relevant, a **Learn more** link into these docs. The icon is keyboard-focusable and closes with `Esc`. Self-explanatory blocks (counters, search boxes) have no icon, keeping the UI uncluttered.

## Navigation

The sidebar gives access to the top-level sections:

| Section | Path | Purpose |
|---------|------|---------|
| Home | `/` | Aggregate stats and activity across all projects |
| Projects | `/projects` | Full project listing with search and tag filters |
| Settings | `/settings` | Configuration — general, account, users, storage, tags, wasted time, AI, notifications |
| API docs | `/docs` | Interactive OpenAPI 3.1 reference (Scalar) — browse schemas and run live requests |
| MCP server | `/mcp` | Setup guide for connecting AI clients (see [MCP server](./mcp)) |

Everything else is reached by drilling into a project, run, or test case:

| Page | Path |
|------|------|
| Project detail | `/projects/:id` |
| Project edit | `/projects/:id/edit` |
| Test cases (project) | `/projects/:id/test-cases` |
| Failure cluster | `/failure-clusters/:id` |
| Test run | `/test-runs/:id` |
| Test case | `/test-cases/:id` |

## Home

A quick health check across all projects: **stats cards** (projects, runs, active/passing projects, flaky count, slowest project), a **test-results trend chart** (pass/fail/skip/flaky over time), **recent projects**, and a getting-started snippet for teams that haven't wired up the reporter yet.

## Projects

The primary hub: instant **text search**, **tag filters**, and a table showing each project's run count, last-run date, duration, status, test pass/fail bar, report links, and actions. Create a project manually with **New project** (it's also created automatically on first result submission).

## Project detail

The complete history for one project, organized into tabs:

- **Test runs** — every run with status, start time, duration, test counts, and browser badges; select two runs to compare. Runs with a shared failure signature roll up into **Failure clusters** here (see [AI diagnosis & clustering](./ai-diagnosis)).
- **Flaky tests** — intermittent tests scored by a composite flakiness metric, with root-cause classification and impact ranking. See [Flaky tests & analytics](./flaky-tests#flaky-test-detection).
- **Performance** — average/P90 duration trends and a slowest-tests table. See [Performance](./flaky-tests#performance).
- **Test cases** — every unique test with pass rate, result breakdown, average duration, and last-run date.
- **Compare** — side-by-side delta between two runs (new failures, recovered, duration changes).
- **Spec health** — a heatmap grouping test cases by spec file and coloring each by pass rate, so an unhealthy area of the suite jumps out. See [Spec health heatmap](./flaky-tests#spec-health-heatmap).
- **Members** *(admins, when auth is enabled)* — grant or scope project access per user. See [Project access](./authentication#project-access).

Project **edit** (`/projects/:id/edit`) sets the label, description, tags, per-project SCM token, and **AI diagnosis instructions** (project-specific context combined with the global instructions for every diagnosis).

## Test run detail

A deep dive into a single run. The **summary header** shows status, duration, test counts, duration metrics (avg/P90), and metadata cards (CI/environment, source control, tags). While a run is still `running`, a **live progress bar** and streaming results appear in real time. **Reports** buttons open or download the attached HTML reports (Playwright, Monocart).

The right panel is tabbed:

- **Test cases** — every test with browser icon, status, duration, location, errors, annotations, and traces; searchable, filterable by status/browser, and grouped by suite hierarchy (describe blocks).
- **Insights** — what changed versus the last passing baseline: new regressions, recurring failures, fixed tests, new flaky tests, performance changes, worker imbalance, and new clusters. See [Run insights](./flaky-tests#run-insights).
- **Failure groups** — failures grouped by error fingerprint, each with flaky/worker-correlation signals and actions to filter the list, trigger AI diagnosis, or open the cluster. See [AI diagnosis & clustering](./ai-diagnosis).
- **Regression** *(shown when a baseline exists)* — the regression delta for this run at a glance.
- **Timeline** — a horizontal per-worker timeline of test execution, with a span-type filter to isolate test phases (setup, actual test, wasted waits, teardown); click a bar to jump to that test case.
- **Compare** — pick a baseline run for a side-by-side delta (improved / regressed / unchanged).
- **Slow endpoints** — network requests grouped by method + normalized route, with avg/p90/max duration and error rate.

Administrators can **delete** the entire run and its files from the header.

## Test case detail

Everything about a single test execution: a **status card** (id, title, copyable location, duration, worker, retries, slowest step, duration-vs-average), **run context** (environment, CI, branch, commit, author, browser), a link into the specific test in the HTML report, and attached **traces** (open in the Playwright viewer or download; they stream in live while the parent run is in progress).

Also here: full **error details** with cluster context; **alternative locators** when a locator broke, with ranked replacements and a recommended fix (see [locator healing](./reporter#locator-healing)); **performance hints**; execution **steps**; **Web Vitals** with color-coded thresholds; **network requests** with inline backend server logs (see [Backend logs](./backend-logs)); and a **history** chart of this test's status and duration over time.

<figure>
  <img src="/screenshots/test-case-detail.png" alt="Test case detail page with summary stats, duration trend, status history, and recent executions">
  <figcaption>The test case detail page — pass rate and duration stats, a duration trend, a status-history strip, and every recent execution of this one test.</figcaption>
</figure>

## Failure cluster detail

Each cluster (`/failure-clusters/:id`) has three tabs — **Overview** (signature, affected tests, and an alternative-locators panel for broken locators), **Triage** (set status open/resolved/ignored and write a note), and **AI diagnosis** (run an SCM-grounded LLM analysis with a baseline-commit picker and commit browser). Full detail: [AI diagnosis & clustering](./ai-diagnosis).

## Settings

| Page | Path | What it does |
|------|------|--------------|
| General | `/settings` | Basic app configuration; a **Reset Demo** button in demo mode |
| Account | `/settings/account` | Your display name, email, password, and **connected accounts** (link/unlink Google or GitHub — see [OAuth](./authentication#oauth-google-github)) |
| Users | `/settings/users` | User accounts, roles, project access, and API keys (shown once, stored hashed) — see [Authentication](./authentication) |
| Storage | `/settings/storage` | Storage stats and cleanup (bulk-delete runs older than N days) — see [Storage](./storage#storage-management) |
| Tags | `/settings/tags` | Create, color, edit, and delete the tags used to organize projects |
| Wasted time | `/settings/wasted-time` | Patterns that classify which Playwright waits count as "wasted time" on the timeline — see [Configuration](./configuration#wasted-time) |
| AI | `/settings/ai` | Provider/model roles, auto-diagnose, global instructions, and context limits — see [AI diagnosis](./ai-diagnosis#enabling-ai-diagnosis) |
| Notifications | `/settings/notifications` | Channels, subscriptions, and SMTP — see [Notifications & alerts](./notifications) |

Where an environment variable backs a setting, the field is shown read-only with a lock badge and the env var name (see [Configuration](./configuration)).

## Real-time updates

The dashboard uses Server-Sent Events so it never needs a manual refresh:

- **Global stream** (`/api/stream`) — tells every connected client when a run starts, finishes, or is submitted; pages re-fetch their data.
- **Per-run stream** (`/api/test-runs/:id/stream`) — drives the live progress on the run detail page during a streaming run.

## Live demo

The [live demo](https://piwitests.github.io/demo/) runs entirely in your browser (in-memory SQLite) and adds two things the real app doesn't need:

**Simulate a test run** — the demo banner replays the exact streaming protocol a Piwi reporter speaks during a real run, so you can watch one arrive live. Scenarios: a passing run, a run with failures (joining a known cluster plus a brand-new one), flaky retries, a performance regression, an interrupted run, and a cross-browser run. Each creates a real run in the in-browser database, so worker timeline, failure groups, and history comparisons all behave exactly as they would against a server.

**Acting as** — the demo runs with authentication conceptually enabled. Switch between pre-seeded identities (an admin, a CI reporter, and several project-scoped users) to see how [project access](./authentication#project-access) changes what each user sees. Acting as the admin, you can change affectations live and then switch users to see the effect.

## Responsive & dark mode

The dashboard is fully responsive — sidebar navigation on desktop, collapsible sidebar and horizontally scrolling tables on tablet, and a stacked/hamburger layout on mobile. It supports light and dark themes, following the system preference by default, with a manual toggle in the sidebar.
