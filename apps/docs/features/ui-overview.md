---
title: UI overview
lang: en-US
---

# UI overview

This page is a **map of the dashboard** — where each view lives and what it's for. For the concepts behind a feature, follow the links to the dedicated pages ([Core concepts](/guide/concepts), [Flaky tests](./flaky-tests), [AI diagnosis & clustering](./ai-diagnosis), [Reporter](/guide/reporter)).

The dashboard is a single-page app built with [Nuxt UI](https://ui.nuxt.com). It updates itself in real time over Server-Sent Events — pages refresh automatically when runs start or finish, so you never reload manually.

## Inline help

Blocks that aren't self-explanatory carry a small muted help icon (a circled question mark) next to their title. Click it for a short explanation and, where relevant, a **Learn more** link into these docs. The icon is keyboard-focusable and closes with `Esc`. Self-explanatory blocks (counters, search boxes) have no icon, keeping the UI uncluttered.

## Open in IDE

Every source path shown in the dashboard is clickable — hover it to reveal an **open in IDE** control that jumps to that file (and line) in VS Code or JetBrains. See [Open in IDE](/features/ide-integration) for setup and the available methods.

## Navigation

The sidebar gives access to the top-level sections:

| Section | Path | Purpose |
|---------|------|---------|
| Home | `/` | Aggregate stats and activity across all projects |
| Analytics | `/analytics` | Cross-project trends, portfolio health, and insights over a chosen time window (see [Analytics](./analytics)) |
| Projects | `/projects` | Full project listing with search and tag filters |
| Settings | `/settings` | Configuration, in two groups — **Instance** (account, users, notifications, storage) and **Analysis** (AI diagnosis, wasted time, timeout hygiene, tags, pull requests) |
| Setup *(admins)* | `/setup` | Connect the reporter, and a checklist of which optional capabilities are actually active on this instance |
| API docs | `/docs` | Self-contained OpenAPI 3.1 reference (no external CDN) — browse endpoints and schemas, try requests live, copy cURL / fetch snippets |
| MCP server | `/mcp` | Setup guide for connecting AI clients (see [MCP server](/features/mcp)) |

Everything else is reached by drilling into a project, run, or test case:

| Page | Path |
|------|------|
| Project detail | `/projects/:id` |
| Project edit | `/projects/:id/edit` |
| Test cases (project) | `/projects/:id/test-cases` |
| Failure cluster | `/failure-clusters/:id` |
| Test run | `/test-runs/:id` |
| Test case | `/test-cases/:id` |

## Setup

Reachable from the sidebar at any time — not just before your first run. **Administrators only**, since it governs how results reach the instance and, in the desktop build, shows the local access token; when authentication is disabled every visitor is a virtual administrator, so it stays available on a default install. It carries the reporter setup steps (install, configure, run, plus `wrapConfig` and the capture fixtures under **Go further**) and a **capability checklist**: for each optional feature, whether this instance shows evidence of actually using it.

The checklist is deliberately evidence-based rather than config-based, so it answers the question an empty panel raises — *is this blank because it's broken, or because I never switched it on?* In the desktop build the page also carries the local instance's reporter URL and token, its MCP client configuration, the data location, and background-service control.

## Home

A quick health check across all projects: a **stat strip** whose every number is a link (projects, failing now, flaky, average pass rate, runs today), an **Open failures** card, a **Project health** table (per-project run-history bars and a tendency badge), and **recent activity**. New instances show a getting-started wizard instead until the first run arrives.

**Open failures** lists the failure clusters still open across the projects you can see, newest first by when they were last seen — each row shows the cluster name, its project, the number of affected tests, its age, the owner when known, its triage status and any pinned known-issue link. The row opens the cluster; reporters and admins can triage without leaving Home: `j` / `k` move the selection, `o` opens it, `r` resolves and `i` ignores.

## Analytics

A cross-project decision view — where Home answers *"what's happening now"*, Analytics answers *"across projects, over time"*. A **scope bar** at the top sets the period (last 7 / 30 / 90 days, last year, or all time) and the projects, then the same **filter bar** Home and each project use — environments and branches (multi-select) and a full-runs-only toggle; every widget re-aggregates against that scope.

Widgets are grouped into four bands, in reading order:

- **Where things stand** — portfolio health, the insights feed, the pass-rate heatmap.
- **Where the pain is** — open failure clusters, the flakiest-tests leaderboard, wasted CI time.
- **Which way it is going** — regression velocity, CI time.
- **Detail** — the browser matrix, cross-project slow endpoints.

[Timeline markers](./timeline-markers) overlay your deploys and infrastructure changes on the trend charts.

See [Analytics](./analytics) for what each widget answers and how the periods are compared.

## Projects

The primary hub: instant **text search**, **tag filters**, and a table showing each project's run count, last-run date, duration, status, test pass/fail bar, report links, and actions. Create a project manually with **New project** (it's also created automatically on first result submission).

## Project detail

The complete history for one project. The header states the project's condition on entry — a **status line** with the latest run and its age, the pass rate over the last 20 runs, and the open clusters, flaky and quarantined counts, each a link to the tab that holds it. One **filter bar** (environment, branch, full-runs-only) scopes every list on the page and is remembered per project. The navbar keeps the notification bell and **Import** (admins); **Edit**, **Test functions**, **Selections**, **Delete** and **Refresh** live in a **More** menu.

Five tabs:

- **Runs** — the run trend chart (timeline **Markers** open in a slide-over from the chart header, where they can be added, edited and deleted) over a table of every run with status, start time, duration, test counts, and browser badges. A row opens the run; selecting two runs and clicking **Compare** opens the newer run's **Changes** tab with the older as its baseline.
- **Tests** — every unique test with status, executed-only pass rate, result breakdown, average duration, and last run; searchable, filterable by status, [tag](/guide/reporter#test-tags), [lock](/guide/reporter#test-locks), owner, priority and last-run age (stale cases hidden by default). **Group by File** groups the tests under each spec file and carries that file's pass rate, flaky rate, failure count, test count and average time in the group header. A row opens the test's full history.
- **Failures** — one place for everything broken, switched with a segmented control: the **Failure clusters** (executions that failed the same way — see [AI diagnosis & clustering](./ai-diagnosis)), the **Flaky** tests scored by a composite flakiness metric with root-cause classification and impact ranking (see [Flaky tests](./flaky-tests#flaky-test-detection)), each with a **Quarantine** action, and the **Quarantine** list — tests excluded from the [CI gate](/guide/ci#blocking-a-merge)'s verdict while still running, each with its passing streak and whether it has earned a release. See [Quarantine](./flaky-tests#quarantine-with-a-way-out).
- **Performance** — average/P90 duration trends, a slowest-tests table, timeout opportunities, and the [slow endpoints](./slow-tests) for a selected run; the AI-step coverage card appears when the project replays committed [AI-step artifacts](/guide/ai-steps).
- **Settings** *(admins when auth is enabled, otherwise everyone)* — project [access](/operate/authentication#project-access) (members) and the edit form: label, description, tags, default branch, per-project SCM token, and **AI diagnosis instructions** (project-specific context combined with the global instructions for every diagnosis).

Project **import** (`/projects/:id/import`, admins only) backfills runs recorded before you adopted Piwi from Playwright blob reports, checking each archive against the server's size limit and the project's existing imports before uploading anything. See [Importing past runs](/guide/importing-runs).

## Test run detail

A deep dive into a single run. The **header** shows status, `Run #N`, the run label and marker on the first
line with the primary action (**Copy retry command** on a red run, the **HTML report** on a green one), then
one facts line — started, duration, branch, commit, author, environment, CI build — with a **Details** popover
holding the rest (shards, Playwright and Piwi versions, avg/P90 durations, wasted time, storage and every
report, tags, links, custom data). Below it, **one count bar** carries the numbers on its segments
(*N passed · N failed · N passed on retry · N skipped · N didn't run*, zero segments hidden); clicking a
segment filters the Tests tab and switches to it. While a run is still `running`, a **live progress bar** and
streaming results appear in real time, and each still-running row shows the **step its worker is on right now**,
inline under the test title.

The right panel is tabbed:

- **Tests** — every execution as one row (status, title, exceptional badges with a `+N` overflow, the failure
  headline and source path, duration, browser, retries, wasted time and its cluster). **Group by** *Cluster*
  (the default on a red run — each group header names the cluster, its test count and triage status, with an
  *Open cluster* link, and passing tests fold into a collapsed *Passed* group), *File* (with per-file tallies),
  *File + Describe* (the file nested by its describe blocks), *Lock* (each [lock](/guide/reporter#test-locks) the run
  declared, holders grouped under it, when the run has locks) or *None*. Search matches the title, path **and**
  error text; filter by status, browser, lock, new regressions and
  newly flaky. Select failing rows for bulk triage (quarantine, or set the cluster status) in any grouping.
- **Changes** — what differs against **one baseline** (the last passing run on the same branch by default, or the
  run you pick — deep-linkable as `?baseline=<runId>`): new failures, fixed, still failing, newly flaky / passed on
  retry, the slower / faster tests, the commits landed since the baseline, and the environment fields that moved. The
  "new failures" count is computed once against that baseline. Disabled until the run finishes. See
  [What changed in a run](./run-changes).
- **Timeline** — a horizontal per-worker timeline of test execution, with a *Show hooks and waits* toggle to reveal
  setup, hook, fixture and wasted-wait spans and, when the run declared [locks](/guide/reporter#test-locks), a *Show locks*
  toggle that colors each holder's bar by the lock it held (one color per lock, legend above, and the bar tooltip lists
  a test's locks); click a bar to jump to that test. Beneath it, the **slowest tests**, a **Locks** table (per lock:
  its tests, how long it was held, its share of the run's wall time, and an estimate of the time that ran serialized
  behind another holder) with a note when a lock's holders run one at a time into the tail of the run, and the
  **worker distribution** for the run.

Administrators can **delete** the entire run and its files from the header's More menu, which also copies a
run summary and refreshes.

## Test case detail

Two pages live under this heading, and [Core concepts](/guide/concepts#execution) draws the line between
them: an **execution** (`/test-run-cases/:id`) answers *"why did this attempt fail?"*, and a **test
case** (`/test-cases/:id`) answers *"how has this test behaved over time?"*. Most links from a run land
on an execution; the test's title links to the test case above it.

A failing execution reads top to bottom in one column: a **header** (status, title, the exceptional
badges, the failing file and line, and Copy retry command, with a Details popover for the rest), the
one-line **headline** (with the raw **error** one click away behind *Show raw error*), the **other
clues**, then one **evidence** card whose content-level tabs — Timeline, Screen, Source, Network,
Console, State, Performance — hold everything captured, deeper still when a trace is attached. A
Playwright 1.63 trace with [aria and screen snapshots](./evidence#aria-and-screen-snapshots) adds a
filmstrip of the page before each step to the Timeline tab, and the before/at-failure screenshots plus
an in-execution page diff to the Screen tab. Below the
evidence, the **Fix** card gathers what to do (the locator fix, a fix-plan pointer, the diagnosis, how
to verify, and the tests this failure blocked) and a **history** block strips this test's recent
executions with its failing streak. All of it, plus the bundled trace viewer, is described in
[Failure evidence](./evidence). The header's facts line shows the **attempts** as linked chips when a
test retried, so "how did this execution get here" is answerable at a glance; every attempt is its own
execution, and each chip links to that attempt's page while the one you are viewing is ringed.

The **test history** page (`/test-cases/:id`) opens on a single facts line under the title — how many
runs, the pass rate, how many failed, the average duration, the flaky-run count and when it last ran —
with **Latest execution →** and, in the desktop shell, **Reproduce locally** on the right. A **duration
trend** chart plots each run coloured by status, and its footer is a strip of the recent executions where
every square links to that execution. Below it, **Recent executions** lists each attempt as a row that
opens the execution, and the **failure clusters** the test belongs to and its **links** follow.

## Failure cluster detail

Each cluster (`/failure-clusters/:id`) reads top to bottom in one column. The **header** states the cluster name and one facts line — error kind, occurrences, affected tests, the first- and last-seen runs, the owner and the known-issue link — with **Re-run in CI** (or Copy retry command) as its one action and the rest in a More menu (quarantine all affected tests, show diagnosis context, copy prompt, copy summary). Under it sits the **triage control**: a segmented *Open / Resolved / Ignored* that saves on click, a note, and — once a fix has landed — the **fix verification** badge with its one sentence (which verdict the runs support, the run and commit it landed in, how long the cluster stayed open) and, when triage and fix verification disagree, a one-click reconcile action. See [Did the fix work?](./ai-diagnosis#did-the-fix-work).

Below the header the failure reads as a one-line **headline** built from the cluster's latest occurrence (falling back to its stored sample error), with a **Show raw error** disclosure for the verbatim error and signature, then the deterministic **clues**. The **evidence** is one card whose content-level tabs — Timeline, Screen, Source, Network, Console, State, Performance — hold everything captured for the affected execution you select from the *from:* row on top; **Open execution** links through to that test-run case. Then one **More ways to fix** toolbox folds together what to do about the cluster, each section a single line until you open it (or until the next step opens it for you): the **AI diagnosis** (an SCM-grounded LLM analysis whose cited evidence links back to the matching evidence tab, with a **History** control for its previous versions and a staleness banner that fires only while the failure is still live) — its stored result stays visible even with no provider configured — the **locator fix** for a broken locator (recommendation, provenance and alternatives, shown once), the **verify** command, and the whole **fix plan** as Markdown for a ticket or an agent (see [Fix plans, reproduce & bisect](./fix-plans)). Below the toolbox come **what changed** (the SCM diff since the last green run, with a baseline-commit picker and commit browser), the **affected tests** (a selectable list whose bulk bar moves tests to a new cluster or quarantines them; each row links to its latest execution), and a **history** block with the cluster's occurrences, diagnosis-version count and fix-verification date. Full detail: [AI diagnosis & clustering](./ai-diagnosis).

## Offline export

An **Export** button on a test-case execution (`/test-run-cases/:id`) and on a failure cluster
(`/failure-clusters/:id`) writes the investigation to an HTML, ZIP, PDF, Markdown or JSON file that
opens with no network and no Piwi server. See [Offline export](./offline-export).

## Settings

| Page | Path | What it does |
|------|------|--------------|
| General | `/settings` | Basic app configuration; a **Reset Demo** button in demo mode |
| Account | `/settings/account` | Your display name, email, password, and **connected accounts** (link/unlink Google or GitHub — see [OAuth](/operate/authentication#oauth-google-github)) |
| Users | `/settings/users` | User accounts, roles, project access, and API keys (shown once, stored hashed) — see [Authentication](/operate/authentication) |
| Storage | `/settings/storage` | Storage stats and cleanup (bulk-delete runs older than N days) — see [Storage](/operate/storage#storage-management) |
| Tags | `/settings/tags` | Create, color, edit, and delete the tags used to organize projects |
| Pull requests | `/settings/pr-feedback` | What Piwi posts back to a pull request when a run finishes — see [Pull-request feedback](/guide/ci#pull-request-feedback) |
| Performance | `/settings/performance` | Wasted-time patterns (which Playwright waits count as "wasted time") and timeout-hygiene thresholds (oversized per-test timeouts, stale `test.slow()` marks) — see [Configuration](/reference/configuration#wasted-time) |
| AI | `/settings/ai` | Provider/model roles, auto-diagnose, global instructions, and context limits — see [AI diagnosis](./ai-diagnosis#enabling-ai-diagnosis) |
| Notifications | `/settings/notifications` | Channels, subscriptions, and SMTP — see [Notifications & alerts](./notifications) |

Where an environment variable backs a setting, the field is shown read-only with a lock badge and the env var name (see [Configuration](/reference/configuration)).

## Real-time updates

The dashboard uses Server-Sent Events so it never needs a manual refresh:

- **Global stream** (`/api/stream`) — tells every connected client when a run starts, finishes, or is submitted; pages re-fetch their data.
- **Per-run stream** (`/api/test-runs/:id/stream`) — drives the live progress on the run detail page during a streaming run.

## Live demo

The [live demo](https://piwitests.dev/demo/) runs entirely in your browser (in-memory SQLite) and adds two things the real app doesn't need:

**Simulate a test run** — the demo banner replays the exact streaming protocol a Piwi reporter speaks during a real run, so you can watch one arrive live. Scenarios: a passing run, a run with failures (joining a known cluster plus a brand-new one), flaky retries, a performance regression, an interrupted run, and a cross-browser run. Each creates a real run in the in-browser database, so worker timeline, failure clusters, and history comparisons all behave exactly as they would against a server.

**Acting as** — the demo runs with authentication conceptually enabled. Switch between pre-seeded identities (an admin, a CI reporter, and several project-scoped users) to see how [project access](/operate/authentication#project-access) changes what each user sees. Acting as the admin, you can change affectations live and then switch users to see the effect.

## Responsive & dark mode

The dashboard is fully responsive — sidebar navigation on desktop, collapsible sidebar and horizontally scrolling tables on tablet, and a stacked/hamburger layout on mobile. It supports light and dark themes, following the system preference by default, with a manual toggle in the sidebar.
