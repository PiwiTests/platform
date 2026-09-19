---
title: Scenario gaps
lang: en-US
---

# Scenario gaps

<Needs reporter />

The catalog lists the tests you have. **Scenario gaps** describe the ones you don't — the routes no test requests, the pages nothing visits, the changed file no test reaches. Each gap is a suggestion with its evidence and a next step, never a verdict.

Everything here is built from what the reporter already captures — the routes tests hit, the pages they end on, the controls they touch — joined into **one graph per project**. On an instance with history and an SCM token, it works with zero setup.

> **Observed reach, not coverage.** A gap says a test *observably reached* something, or that nothing did — measured from real runs, never from instrumented code coverage. "No edge" means "no evidence", not "proof of absence".

## Uncovered changes on a pull request

When a pull-request-stamped run finishes, Piwi joins the changed files to the tests that reach them and adds an **Uncovered changes** section to the [pull-request comment](/guide/ci#pull-request-feedback), grouped by ticket:

```md
#### 🟣 Uncovered changes · 3 of 7 files · 2 tickets
Observed reach, not instrumented coverage. This run and the last 30 on `main`.

**PROJ-418**
- `server/api/orders/[id].patch.ts` · changed (+41 −3) · 0 tests in 30 runs
  → *a scenario that exercises [id].patch.ts* · draft
```

"No test in this run" is always paired with the count from recent history, so a run narrowed by a [selection](/guide/test-selection) is never mistaken for a gap. With no SCM token or no diff, the section simply does not appear. Tickets are read from the commit messages and the pull request. Change coverage is also available on demand:

- **API** — `GET /api/projects/{id}/gaps/change-coverage?run={runId}`, or `?base={sha}&head={sha}` for an explicit range.
- **MCP** — [`get_change_coverage`](/features/mcp) reads what a branch left untested, [`list_scenario_gaps`](/features/mcp) lists the ranked gaps (by class, feature, score or PR), and [`draft_scenario`](/features/mcp) turns one into a deterministic test skeleton. The **write-the-missing-test** skill drives the loop for an agent.

## The detectors

Beyond change time, detectors read the graph and history, each naming its evidence and a next step:

| Detector | Finds | Example evidence |
|---|---|---|
| **Changed, unreached** | a changed source file no test reaches | `+41 −3 · no test in run #812 · 0 in 30 runs` |
| **Success only** | a route whose observed statuses are all 2xx/3xx — its error paths were never exercised | `Observed 412 times, always 200` |
| **Single covering test** | a node reached by exactly one test — one flaky or quarantined test from no coverage | `Only checkout › coupon reaches this` |
| **Surface drift** | a route or page first seen in the latest run — new surface the suite may not yet exercise | `/billing/plans appeared in run #830` |
| **Control nobody exercises** | a control seen on a page that no locator ever targets | `On 12 pages · no locator targets it` |
| **Reachable, unvisited** | a page linked from other pages that no test navigates to | `Linked from 7 pages · never navigated to` |
| **API-only route** | a route reached only by request fixtures — no control triggers it, no page loads it | `reached only by request fixtures` |
| **Not noticed** | a route a probe broke while every test still passed — the most dangerous class | `Passes with 500 on POST /api/orders` |
| **Orphan test** | a test whose every reached node has vanished from recent runs | `3 pages it reaches disappeared 40 days ago` |
| **Fix did not hold** | a failure cluster whose fix later regressed | `Fixed in a1b2c3d · regressed 6 days later` |

More detectors — phantom coverage, passed-with-errors, an uncalled catalog method, an incidental catch, assertion-light pages, and change-time ones (a new error path or control, an intent with no test) — read the same graph. Each gap names its class: **blind-spot** (nothing reaches it), **false-comfort** (reached, but a probe showed it unnoticed) and **fragile** (a single, flaky or long-skipped test).

## The whole suite, not just its routes

The graph also holds the **controls** and **links** each page exposes and the **handler** and **dependency** each route reaches. Control names are templated — a table of five hundred orders is one control — and a page keeps at most 200. Controls and links come from a **page inventory** the reporter records on passing runs (`capturePageInventory`, on by default, names and hrefs only); handler and dependency breadth comes from server spans instrumentation forwards.

## Declared surface

Beyond what tests observe, Piwi can hold what the application *declares* it exposes, so a route or page nothing reaches is named as a **declared, never hit** blind spot instead of being invisible. Three ramps, each independent, feed graph nodes with origin `manifest` or `openapi`:

- **Instrumentation.** The Nitro and ASP.NET Core packages serve a route manifest at `/__piwi/manifest` outside production. The reporter's global setup fetches it once when a base URL is configured and the app's first response carries an instrumentation header, and uploads it with the run.
- **A committed manifest.** A `piwi.manifest.json` next to your Playwright config (`{ routes: [...], pages: [...] }`) is uploaded whenever present.
- **An OpenAPI URL.** Set one per project; Piwi fetches it server-side and records each route's documented response codes, so **success only** can name the error codes a route documents but never returned under test.

## Probing what a test would notice

Reach says a test touched a route, not that it would fail if the route returned garbage — and many passing tests would not. `piwi probe` replays a passing test with a fault at the Playwright boundary (a 500, an empty body, a dropped field, a stale value or a slow response) and records whether it noticed:

```bash
npx @piwitests/reporter probe --project my-project
```

It fetches the plan the dashboard ranked by exposure — never-probed pairs first, one fault per test, a budget — applies the faults, and posts the outcomes. A probe run never counts as a real run, and a route that stays green under a fault becomes a **not noticed** gap.

### Server probes (level two)

A client probe rewrites the response in the browser, so the server never runs its error path. A **server probe** signs a fault onto one request (`X-Piwi-Probe`, HMAC-signed with `PIWI_PROBE_SECRET`) and the instrumentation applies it inside the server — a thrown error, a status, a delay, a mutated response, or a failed dependency call — reporting the fault it actually applied so an un-honored probe is recorded as *inconclusive*, never a pass. Two signals come back: whether the test noticed (a `checks` edge), and whether the application degraded — a **resilience finding** (class `unhandled` or `degraded`, ranked by exposure × severity), plus the **unprobed dependency** and **not handled** detectors.

The whole level stays behind a per-project flag that defaults **off**, honored only outside production, with fault classes and routes allow-listed per project and dependency faults on state-changing routes off by default. Turn it on once client probes report *not noticed* on at least one in ten probed pairs — the signal the suite has false comfort the network boundary cannot reveal.

## Exposure ranking

Gaps are ranked by an explicit **exposure** score, not a raw count — a percentage over an observed surface looks complete exactly when the surface is sparse. Four factors, each in `[0.1, 1]` so a missing input never zeroes a row, all shown on the gap: **churn** (commits in the last 90 days), **age** (older components weigh *up* — that is where escaped defects concentrate), **escape history** (the file is in a cluster's fixing commit) and **priority**. The score is exposure × the detector's confidence.

## What the graph includes

The graph stays proportional to your application's surface, not its data volume:

- **Your own origin only.** Route nodes come from requests to the run's Playwright `baseURL` — analytics beacons and CDN assets never become nodes. Add extra first-party origins to a project's route-origin allowlist.
- **Pages are path patterns.** `/orders/123` and `/orders/456` are one node, and the same path from staging and production lands on that one node.
- **Branches stay separate.** A default-branch run writes the canonical graph; any other branch writes rows tagged with it, so a route added on a pull request never shows as surface drift on the default branch. Those rows drop when the pull request closes.

## The Gaps tab and the graph view

The project page has a **Gaps** tab: gaps and findings grouped by feature and ranked, each with its class, score factors and evidence, and the inbox verbs — **accept** (copies the draft skeleton to your clipboard), **snooze** (a day, a week, or until the node changes), **dismiss** with a reason (*not worth testing*, *covered elsewhere* — which records the covering test as a manual reaches edge — or *wrong*), and **covered by** without dismissing. The Home page lists accepted-but-unwritten gaps older than a week.

Any node opens in the **feature graph** — a layered picture of tests, pages, controls, routes, handlers and dependencies, nodes colored by class and edges by kind, with a depth control; click a node to reselect it, hover to highlight its paths. Read it over the API with `GET /api/projects/{id}/graph?node=route:POST /api/orders&depth=2` or the [`get_feature_graph`](/features/mcp) MCP tool.

## Precision, muting and the digest

Every triage verdict is a labeled example: accepted and covered-by count *for* a detector, dismissed-as-wrong *against*. A detector below 60% precision on a project with at least twenty verdicts **mutes itself** there — its rows drop out of the pull-request comment first, and the Gaps tab and the admin **About** page say so. A weekly **digest** of the top new gaps per project can be delivered through your [notification channels](/features/notifications); it is off by default.

## Triage

Gaps persist so triage survives recomputation: a dismissed gap keeps its verdict, and a gap **closes itself** when its node gains a trusted test — so "closed this month" is real. List them at `GET /api/projects/{id}/gaps`, triage one at `POST /api/projects/{id}/gaps/{gapId}/triage`, or recompute with `POST /api/projects/{id}/gaps/recompute`.

## What this is not

- **Not coverage.** Every surface says *observed reach*.
- **Not a test generator.** A gap proposes a scenario; the assertion is yours.
- **Not a gate.** The `maxUncoveredChanges` gate policy is off by default and warn-only — it reports a run's uncovered changed files without changing the verdict.
- **Not a percentage.** Counts per class, ranked by exposure.
