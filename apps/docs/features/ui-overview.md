---
title: UI overview
description: "A map of the dashboard: every page and tab, what it is for, and the page of these docs that explains it."
lang: en-US
---

# UI overview

This page is a **map of the dashboard**: where each view lives and which page of these docs explains it.

Pages refresh on their own when runs start or finish. Blocks that need it carry a help icon with a short explanation
and a **Learn more** link into these docs, and every source path [opens in your IDE](./ide-integration).

## Home

`/`: a health check across all projects. A **stat strip** whose every number is a link, the **failure inbox** of open clusters, triaged from the row or the keyboard
([Failure clusters & the inbox](./failure-clusters#the-failure-inbox)), a **Project health** table with run-history
bars and a tendency badge, and recent activity.

## Analytics

`/analytics`: trends across projects and over time, where Home shows what is happening now. The filters at the top
scope every widget; the widgets are listed on [Analytics widgets](/reference/analytics-widgets), and the filters and
period comparisons on [Analytics](./analytics). The page is the built-in *Overview* [dashboard](./dashboards), and the
header switcher opens the others. [Timeline markers](./timeline-markers) overlay deploys and infrastructure changes on
the trend charts.

## Quality reports

`/reports`: the report snapshots kept and the schedules that send them; `/reports/:id` opens one snapshot. See
[Quality reports](./quality-reports).

## Projects

`/projects`: every project with search, tag filters, its last run and pass/fail bar. A project is created on its
first result, or with **New project**.

## Project detail

`/projects/:id`: one project's history. A **status line** gives the latest run, the pass rate over the last 20 runs and
the open clusters, flaky and quarantined counts, and one **filter bar** (environment, branch,
full runs only) scopes every list. The **More** menu holds Edit, [Test functions](./test-functions),
[Selections](./test-selection), [Import](/guide/importing-runs) and Delete. The tabs:

- **Runs**: the run trend chart, with its [timeline markers](./timeline-markers), over every run; select two runs and
  **Compare** to see [what changed](./run-changes) between them, or select any number and
  [delete them](/operate/storage#storage-management).
- **Tests**: every test case with its pass rate and last run, filterable by status, tag, lock, owner and priority, and
  groupable by spec file ([test metadata](/reference/test-metadata)).
- **Failures**: the [failure clusters](./failure-clusters), the [flaky tests](./flaky-tests#flaky-test-detection) and the
  [quarantine](./flaky-tests#quarantine-with-a-way-out) list.
- **Gaps**: the tests the suite does not have yet, proposed from the Test Map, with the feature map and the graph view
  ([Scenario gaps & the Test Map](./scenario-gaps)). Hidden when the Test Map is switched off.
- **Performance**: duration trends, the slowest tests, timeout opportunities and the slow endpoints
  ([Slow tests & wasted time](./slow-tests)).
- **Settings**: project [access](/operate/project-access), the default branch, a per-project
  [SCM token](/guide/source-control) and [AI instructions](./ai-diagnosis#custom-instructions).

## Locators

`/projects/:id/locators`: check pasted locators against the ones the project's tests use, and browse every locator
chain in the locator index, per branch. See [Who uses a locator](./locator-usage#the-locators-page).

## Test run detail

`/test-runs/:id`: one run. The header carries the status, the primary action (**Copy retry command** on a red run,
the HTML report on a green one) and one facts line, and a **count bar** filters the tests by status. While it runs,
results stream in live. The tabs:

- **Tests**: every execution with its failure headline, grouped by cluster (the default on a red run), file, describe
  block or [lock](/reference/test-metadata#test-locks), with bulk triage.
- **Changes**: what differs against one baseline run. See [What changed in a run](./run-changes).
- **Timeline**: each worker's tests on one time axis, with hooks, waits and locks, the slowest tests and the worker
  distribution ([Slow tests & wasted time](./slow-tests)).
  - **Hooks**: hook time is hatched over each test's bar: setup (`beforeAll`, `beforeEach`, fixtures) at the start,
    teardown (`afterEach`, `afterAll`, worker cleanup) at the end. A failed hook is drawn in dark red and counted in
    the header, even with **Show hooks** off; hover it for the hooks that section ran, their times and the error, and
    click it to open the test's steps on that hook. Playwright leaves `beforeAll` / `afterAll` hooks and worker
    fixtures out of a test's duration; the bar spans them anyway, and its tooltip gives the duration Playwright
    reported. Runs sent by an older reporter show the sections without their hook list.
  - **Gaps**: a lane is one worker. Playwright replaces a worker process after a failed test (and starts one for
    tests that need another project or different worker options), so a lane can hold several processes one after
    another: **↻** marks where a new one took over, and the stretch before it is the old process shutting down and
    the new one starting. A dashed line is time the worker ran no test — before its first test, between two tests,
    or after its last one while the others finished. Hover either to see which it was.

## Test case detail

Two pages: an **execution** (`/test-run-cases/:id`) answers *"why did this attempt fail?"*, and a **test case**
(`/test-cases/:id`) answers *"how has this test behaved over time?"*. A failing execution opens on the situation block
([Your first failure, explained](/guide/first-failure)), then the evidence card and the **More ways to fix** toolbox
([Failure evidence](./evidence)). The test case page shows the test's history
([The test case page](./evidence#the-test-case-page)). Both can be exported as a file with
[Offline export](./offline-export).

## Failure cluster detail

`/failure-clusters/:id`: every test that failed for one cause. It opens on the same situation block, with the
occurrence sparkline, what changed and the state line, then the affected tests and their evidence
([Failure clusters & the inbox](./failure-clusters#the-cluster-page)). The **More ways to fix** toolbox holds the
[AI diagnosis](./ai-diagnosis), the [locator fix](./locator-healing) and the [fix plan](./fix-plans).

## Setup

`/setup`, administrators only: the reporter setup steps and a checklist of which optional capabilities this instance
actually uses, judged from the data it holds ([Choose what you use](/operate/capabilities)).

## Settings

`/settings`: your **Account** and connected accounts ([OAuth](/operate/authentication#oauth-google-github)),
**Users** ([Authentication](/operate/authentication), [API keys](/operate/api-keys)) and **Permissions**
([Permission grid](/operate/project-access#permission-grid)), **Storage**
([Storage](/operate/storage#storage-management)), **Tags**, **Pull requests** ([Pull-request feedback](./pr-feedback)),
**Auto-heal** ([Auto-heal PRs](./auto-heal)), **Integrations** ([Integrations](/operate/integrations)),
**Performance** (wasted-time patterns and timeout hygiene), **AI** ([AI provider](/guide/ai-provider)),
**Notifications** ([Notifications & alerts](./notifications)) and **Localization**
([Localization](/operate/localization)). A setting backed by an environment variable is shown read-only with the
variable's name ([Configuration reference](/reference/configuration)).

The sidebar also links the **MCP server** setup page, `/mcp` ([MCP server](./mcp)), and the **API docs**, `/docs`, the
instance's own OpenAPI reference.

## Live demo

The [live demo](https://piwitests.dev/demo/) runs entirely in your browser and adds two controls. **Simulate a test
run** replays a reporter's stream, so you can watch a run arrive. **Acting as** switches between seeded identities to
show how [project access](/operate/project-access) changes what each one sees, including changes made on
the [permission grid](/operate/project-access#permission-grid).

## Related

- [Core concepts](/guide/concepts): the words this map uses
- [Your first failure, explained](/guide/first-failure): the page you open most, read top to bottom
- [All features](/reference/features): every feature and where it lives
- [Keyboard shortcuts](/reference/keyboard-shortcuts): the command palette and the go-to keys
