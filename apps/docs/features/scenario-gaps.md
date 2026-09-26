---
title: Scenario gaps
lang: en-US
---

# Scenario gaps

<Needs reporter />

The catalog lists the tests you have. **Scenario gaps** describe the ones you don't — the routes no test requests, the pages nothing visits, the changed file no test reaches. Each gap is a suggestion with its evidence and a next step, never a verdict.

Everything here is built from what the reporter already captures, joined into **one graph per project**. With history and an SCM token, it works with zero setup.

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

"No test in this run" is always paired with the count from recent history, so a run narrowed by a [selection](/guide/test-selection) is never mistaken for a gap. With no SCM token or no diff, the section does not appear. Tickets come from the commit messages and the pull request. Change coverage is also available on demand:

- **API** — `GET /api/projects/{id}/gaps/change-coverage?run={runId}`, or `?base={sha}&head={sha}` for an explicit range.
- **MCP** — [`get_change_coverage`](/features/mcp) reads what a branch left untested, [`list_scenario_gaps`](/features/mcp) lists the ranked gaps (by class, feature, score or PR) and [`draft_scenario`](/features/mcp) turns one into a deterministic skeleton. The **write-the-missing-test** skill drives the loop for an agent.

## The detectors

Beyond change time, detectors read the graph and history, each naming its evidence and a next step:

| Detector | Finds | Example evidence |
|---|---|---|
| **Changed, unreached** | a changed source file no test reaches | `+41 −3 · no test in run #812 · 0 in 30 runs` |
| **Success only** | a route observed only with 2xx/3xx — its error paths never exercised | `Observed 412 times, always 200` |
| **Single covering test** | a node exactly one test reaches — one flaky test from no coverage | `Only checkout › coupon reaches this` |
| **Surface drift** | a route or page first seen in the latest run — surface the suite may not exercise yet | `/billing/plans appeared in run #830` |
| **Control nobody exercises** | a control on a page no locator ever targets | `On 12 pages · no locator targets it` |
| **Reachable, unvisited** | a linked page no test navigates to | `Linked from 7 pages · never navigated to` |
| **API-only route** | a route only request fixtures reach — no control triggers it, no page loads it | `reached only by request fixtures` |
| **Not noticed** | a route a probe broke while every test passed — the most dangerous class | `Passes with 500 on POST /api/orders` |
| **Orphan test** | a test whose every reached node vanished from recent runs | `3 pages it reaches disappeared 40 days ago` |
| **Fix did not hold** | a failure cluster whose fix later regressed | `Fixed in a1b2c3d · regressed 6 days later` |

More detectors — phantom coverage, passed-with-errors, an uncalled method, assertion-light pages, change-time ones — are implemented but **not yet wired**. Each gap names its class: **blind-spot** (nothing reaches it), **false-comfort** (a probe found it unnoticed) or **fragile** (one flaky or skipped test).

## The whole suite, not just its routes

The graph also holds the **controls** and **links** each page exposes (templated names, at most 200 per page, from the **page inventory** the reporter records on passing runs — `capturePageInventory`, **off by default**, names and hrefs only) and the **handler** and **dependency** each route reaches, from the server spans instrumentation forwards. Control and link nodes, and the detectors that read them, appear only once `capturePageInventory` is enabled.

## Declared surface

Beyond what tests observe, Piwi can hold what the application *declares* it exposes, so a route or page nothing reaches is named a **declared, never hit** blind spot instead of staying invisible. Three independent ramps feed graph nodes with origin `manifest` or `openapi`:

- **Instrumentation.** The Nitro and ASP.NET Core packages serve a route manifest at `/__piwi/manifest` outside production. The reporter's global setup fetches it once a base URL is configured and the app's first response carries an instrumentation header, and uploads it with the run.
- **A committed manifest.** A `piwi.manifest.json` next to your Playwright config (`{ routes: [...], pages: [...] }`) is uploaded whenever present.
- **An OpenAPI URL.** Set one per project; Piwi fetches it server-side and records each route's documented response codes, so **success only** can name the error codes a route documents but never returned.

## Probing what a test would notice

Reach says a test touched a route, not that it would fail if the route returned garbage — many passing tests would not. `piwi probe` replays a passing test with a fault at the Playwright boundary (a 500, an empty body, a dropped field, a stale value, a slow response) and records whether it noticed:

```bash
npx @piwitests/reporter probe --project my-project
```

It fetches the exposure-ranked plan — never-probed pairs first, one fault per test, a budget — applies the faults and posts the outcomes. A probe run never counts as a real run; a route that stays green under a fault becomes a **not noticed** gap.

### Server probes (level two)

**Experimental and unreleased.** The entry condition below is not yet measured, so this level stays off by default.

A client probe rewrites the response in the browser, so the server never runs its error path. A **server probe** signs a fault onto one request (`X-Piwi-Probe`, HMAC-signed with `PIWI_PROBE_SECRET`) and the instrumentation applies it inside the server — a thrown error, a status, a delay, a mutated response, or a failed dependency call — reporting the fault it applied, so an un-honored probe records as *inconclusive*, never a pass. Two signals come back: whether the test noticed (a `checks` edge) and whether the application degraded — a **resilience finding** (class `unhandled` or `degraded`, ranked by exposure × severity), plus the **unprobed dependency** and **not handled** detectors.

The level stays behind a per-project flag, honored only outside production, with fault classes and routes allow-listed and dependency faults on state-changing routes off by default. Turn it on once client probes report *not noticed* on one in ten probed pairs — the sign of false comfort the network boundary cannot reveal.

## Exposure ranking

Gaps are ranked by an explicit **exposure** score, not a raw count — a percentage over an observed surface looks complete exactly when the surface is sparse. Four factors, each in `[0.1, 1]` so a missing input never zeroes a row, all shown on the gap: **churn** (commits in the last 90 days), **age** (older components weigh *up*, where escaped defects concentrate), **escape history** (the file is in a cluster's fixing commit) and **priority**. The score is the geometric mean of the factors, times the detector's confidence.

## What the graph includes

The graph stays proportional to the application's surface, not its data volume:

- **Your own origin only.** Route nodes come from requests to the run's Playwright `baseURL` — analytics beacons and CDN assets never become nodes.
- **Pages are path patterns.** `/orders/123` and `/orders/456` are one node, as is the same path from staging and production.
- **Branches stay separate.** A default-branch run writes the canonical graph; any other branch writes rows tagged with it, so a route added on a pull request never shows as drift on the default branch. Those rows drop when the pull request closes.

## The Gaps tab and the graph view

The project page has a **Gaps** tab: gaps and findings grouped by feature and ranked, each with its class, score factors and evidence, and the inbox verbs — **accept** (copies a draft skeleton to your clipboard), **snooze** (a day, a week, or until the node changes), **dismiss** with a reason (*not worth testing*, *covered elsewhere* — recording the covering test as a manual reaches edge — or *wrong*), and **covered by** without dismissing. Home lists accepted-but-unwritten gaps older than a week. The Test Map and its server probes are optional: [decline](/guide/getting-started#declining-a-capability) either per project or instance-wide and these surfaces disappear.

The tab opens on the **feature map**: one circle per feature (from the `piwi:feature` tag), sized by the routes, pages and controls it groups, colored by its worst open gap, linked to the features it shares nodes with. The ranked list beside it carries every feature, however many. API: `GET /api/projects/{id}/feature-map`.

A feature or a gap's node opens in the **feature graph**: the node in the middle, what leads into it on the left, what it leads to on the right, nodes colored by class, edges by kind. The picture shows each kind's most severe few; the **inspector** under it lists every neighbor with its relation, worst gap and reaching tests. Click to recenter. API: `GET /api/projects/{id}/graph?node=route:POST /api/orders&depth=2` or the [`get_feature_graph`](/features/mcp) MCP tool.

## Precision, muting and the digest

Every triage verdict is a labeled example: accepted and covered-by count *for* a detector, dismissed-as-wrong *against*. A detector below 60% precision on a project with twenty or more verdicts **mutes itself** there — its rows drop out of the pull-request comment first, and the Gaps tab and the admin **About** page say so. The weekly **digest** of the top new gaps per project is the **Gaps digest** [quality report](/features/quality-reports#what-a-report-contains): [schedule it](/features/quality-reports#report-schedules) to your channels.

## Triage

Gaps persist so triage survives recomputation: a dismissed gap keeps its verdict, and a gap **closes itself** when its node gains a trusted test — so "closed this month" is real. List them at `GET /api/projects/{id}/gaps`, triage at `POST /api/projects/{id}/gaps/{gapId}/triage`, recompute at `POST /api/projects/{id}/gaps/recompute`.

## What this is not

- **Not coverage.** Every surface says *observed reach*.
- **Not a test generator.** A gap proposes a scenario; the assertion is yours.
- **Not a gate.** The `maxUncoveredChanges` gate policy is off by default and warn-only — it reports uncovered changed files without changing the verdict.
- **Not a percentage.** Counts per class, ranked by exposure.
