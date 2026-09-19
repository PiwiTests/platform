---
title: Scenario gaps
lang: en-US
---

# Scenario gaps

<Needs reporter />

The catalog lists the tests you have. **Scenario gaps** describe the ones you don't — the routes no test has requested, the pages nothing visits, the file a pull request changed that no test reaches. Each gap is a suggestion with its evidence and a next step, never a verdict.

Everything here is built from what the reporter already captures — the routes tests hit, the pages they end on, the locator call sites they touch — joined into **one graph per project**. There is nothing extra to instrument. On an instance with history and an SCM token, it works with zero setup.

> **Observed reach, not coverage.** A gap says a test *observably reached* something, or that nothing did — measured from real runs, never from instrumented code coverage. Every screen and every comment repeats that qualifier, because "no edge" means "no evidence", not "proof of absence".

## Uncovered changes on a pull request

When a pull-request-stamped run finishes, Piwi diffs the [baseline](/features/run-changes#the-baseline) commit against the run's commit, joins the changed files to the tests that reach them, and adds an **Uncovered changes** section to the [pull-request comment](/guide/ci#pull-request-feedback), grouped by ticket:

```md
#### 🟣 Uncovered changes · 3 of 7 files · 2 tickets
Observed reach, not instrumented coverage. Numbers from this run and the last 30 on `main`.

**PROJ-418**
- `server/api/orders/[id].patch.ts` · changed (+41 −3) · 0 tests in 30 runs
  → *a scenario that exercises [id].patch.ts* · draft

5 files reached. Gate `maxUncoveredChanges`: warn.
```

"No test in this run" is always paired with the count from recent history, so a run narrowed by a [selection](/guide/test-selection) is never mistaken for a gap. A second, informational commit status (`…/change-coverage`) reports the same numbers. The section degrades gracefully: with no SCM token or no diff to read, it simply does not appear.

Tickets are read from the commit messages and the pull request. Change coverage is also available on demand:

- **API** — `GET /api/projects/{id}/gaps/change-coverage?run={runId}`, or `?base={sha}&head={sha}` for an explicit range.
- **MCP** — the [`get_change_coverage`](/features/mcp) tool, so an agent can read what a branch left untested and write the missing test in the same pull request.

## The detectors

Beyond change time, a set of detectors reads the graph and history. Each names its evidence and a next step:

| Detector | Finds | Example evidence |
|---|---|---|
| **Changed, unreached** | a changed source file no test reaches | `+41 −3 · no test in run #812 · 0 in 30 runs` |
| **Success only** | a route whose observed statuses are all 2xx/3xx — its error paths were never exercised | `Observed 412 times, always 200` |
| **Single covering test** | a node reached by exactly one test — one flaky or quarantined test from no coverage | `Only checkout › coupon reaches this` |
| **Surface drift** | a route or page first seen in the latest run — new surface the suite may not yet exercise | `/billing/plans appeared in run #830` |

## Exposure ranking

Gaps are ranked by an explicit **exposure** score, not by a raw count, because a percentage over an observed surface looks complete exactly when the surface is sparse. Four factors, each in `[0.1, 1]` so a missing input can never zero a row, and every one is shown on the gap:

- **Churn** — commits touching the file in the last 90 days.
- **Age** — older components are where escaped defects concentrate, so age weighs *up*.
- **Escape history** — the file appears in a failure cluster's fixing commit.
- **Priority** — the highest `piwi:priority` observed around the subject.

The score is exposure × the detector's confidence. A changed file with real churn and a fix history outranks a bare route gap by construction.

## What the graph includes

The graph stays proportional to your application's surface, not to how much data it has seen:

- **Your own origin only.** Route nodes come from requests to the run's Playwright `baseURL` — analytics beacons and CDN assets never become nodes. Add extra first-party origins (an API subdomain, say) to a project's route-origin allowlist. Runs from reporters that predate the recorded `baseURL` fall back to the origins of their own document (navigation) requests, so their first-party routes are still captured rather than dropped.
- **Pages are path patterns.** `/orders/123` and `/orders/456` are one node, and the same path served from staging and production lands on that one node.
- **Branches stay separate.** A run on the default branch writes the canonical graph; a run on any other branch writes rows tagged with that branch, so a route added on a pull request never shows up as surface drift on the default branch. Those tagged rows are dropped when the pull request closes, and swept after thirty days otherwise.

## Triage

Gaps persist so triage survives recomputation: an open gap stays open, a dismissed one keeps its verdict, and a gap **closes itself** when its node gains a trusted test — so "closed this month" is a real number. List and filter them at `GET /api/projects/{id}/gaps`, or rebuild the graph and recompute with `POST /api/projects/{id}/gaps/recompute`.

## What this is not

- **Not coverage.** Every surface says *observed reach*.
- **Not a test generator.** A gap proposes a scenario; the assertion is yours.
- **Not a gate.** The `maxUncoveredChanges` row is warn-only.
- **Not a percentage.** Counts per class, ranked by exposure.
