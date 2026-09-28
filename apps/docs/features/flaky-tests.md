---
title: Flaky tests & quarantine
description: "How Piwi scores and classifies flaky tests from their history, ranks them by the CI time they waste, and quarantines them with a way out."
lang: en-US
---

# Flaky tests & quarantine

<Needs reporter />

A single run tells you what failed; a few dozen tell you what's *unreliable*. This page covers what Piwi computes
for one project once it has history: flaky scoring, suspects, regression signals and spec health.

For the same signals aggregated across every project, see [Analytics](./analytics).

## Flaky test detection

A test is flaky when its result isn't deterministic. Piwi computes a **composite flakiness score** per test from three signals:

- **Retry passes** — failed on the first attempt, passed on retry.
- **Status alternation** — flips between pass and fail across runs.
- **Failure rate** — overall proportion of failures.

The project's **Failures** tab has a **Flaky** view with a **configurable lookback window** so you can focus on recent behavior or a longer baseline. Each flaky test links to its history and carries a **Quarantine** action.

**Per-environment scoping** — select a single environment in the project's filter bar and the flaky analysis is scoped to runs from that environment, so you can compare stability across `staging`, `production`, and `development` instead of blending them. (Set the environment via the reporter's `environment` option / `PIWI_ENVIRONMENT`; see the [reporter](/guide/reporter) docs.)

<figure>
  <img src="/screenshots/flaky-detection.png" alt="Flaky tests tab listing tests with composite score, failure rate, retry passes, and flip counts">
  <figcaption>The Flaky view of a project's Failures tab — each intermittent test scored by retry passes, status flips, and failure rate, ranked by impact and filterable by root-cause category.</figcaption>
</figure>

### Root-cause classification

Every flaky test is automatically tagged with one of five categories, using keyword and distribution heuristics over its errors, steps, and browser spread, sharpened by the failed requests actually captured and by the attempt diff. It reads the test's last 100 failed attempts and its last 100 passes from any run, green or red, so the failed attempt of a test that passed on retry counts, and a rare flake keeps its failures however many passes came since:

| Category | Typical signals |
|----------|-----------------|
| `timing` | Timeouts, "to be visible", `waitFor`, element-not-found-within |
| `network` | `net::` / `ERR_` errors, 5xx responses, `ECONNREFUSED`, `waitForResponse` — plus the count of failed and 5xx requests captured on the failing attempts, and any request that failed on the failing attempt but not the passing one |
| `assertion` | `expect(...)`, "Expected:", snapshot/screenshot comparison — with no timing/network noise |
| `environment` | Fails at least 3 times on exactly one browser while another browser passed at least 3 times without failing |
| `other` | No clear signal |

The classifier also counts the requests that failed or returned 5xx across recent failing attempts, and weighs most each recent flake whose failing attempt made a request that failed while the passing attempt did not (see the [attempt diff](./evidence#attempts)): it counts for several keyword matches.

Filter the flaky table by category to triage a class of failures at once.

### Suspects

A flaky test's page has a **Flakiness** tab listing its **suspects**: what its failures share and its passes do not,
over its last 30 days (at most 200 attempts, from the runs the flaky list reads).

| Factor | Measured per attempt | Condition a lab would apply |
|--------|----------------------|-----------------------------|
| Slow route | a request's slowest duration, over the threshold that best separates failures from passes | delay it to the failures' median |
| Failed route | a request answering 5xx, or with no response | fail it the same way, or abort it |
| Load | other tests of the same shard running at once, over a threshold | CPU ×4 |
| Alongside | another test overlapping it in time | run both together |
| Before | the test that ran just before on its worker | run that test first |
| Browser | its Playwright project | pin the project |

Each suspect shows its raw counts: `GET /api/cart slower (≥1.6 s)`, 7 of 8 failures, 3 of 44 passes. It needs 3
failures and a lift of at least 2, `(fw + 1)/(f + 2) ÷ (pw + 1)/(p + 2)`; at most 5 are listed, ranked by lift ×
those failures. A neighbor names the paths both tests write, marked approximate when the overlap crosses shards,
whose clocks agree only roughly. First attempts, the UTC hour and other runs on the same environment are context,
without a condition. Nothing is stored.

The flaky list names each test's top suspect, the [Attempts](./evidence#attempts) tab links a request to its suspect,
the clue `known-flake-suspect` marks a failure showing one, and MCP's `get_flake_profile` returns the profile.
Experiments that apply a condition to confirm a suspect are not available yet.

### Impact ranking

Piwi ranks flaky tests by **impact** — derived from wasted CI minutes (retries × average failed duration) and pipeline-block effect — so you fix the ones that hurt most first. A color-coded dot makes it scannable:

- 🟢 green — under 5 wasted minutes
- 🟡 amber — under 30 minutes
- 🔴 red — 30 minutes or more

### Per-test stability trend

The **Trend** tab of a test's page draws its pass rate, flaky rate and average duration over the last
30, 90 or 365 days, one point per UTC day, week or month, with the project's timeline markers, so you can
see whether a fix actually stuck. The same series is the MCP `get_test_stability_trend` tool.

## Quarantine, with a way out

Detecting a flaky test doesn't stop it blocking merges. Quarantine does — without hiding it.

The usual approach is `--grep-invert @quarantine`: the test stops running, nothing ever proves it's fixed, and the
list only grows.

**A quarantined test in Piwi keeps running and keeps reporting.** It is excluded from the [CI gate](/guide/ci#blocking-a-merge)'s
verdict and nothing else. That single difference is what makes the exit possible:

- Passing runs after quarantine accumulate as a **streak**, and one failure resets it.
- After five consecutive passes the test is flagged **ready to release** — the dashboard tells you, rather than waiting
  to be asked.
- **Candidates** are proposed from the flaky analysis, ranked by *wasted CI minutes* rather than flakiness score. A test
  that flakes constantly but finishes in 200 ms costs nothing; one that flakes weekly and burns a four-minute timeout is
  what actually hurts.
- **Debt** is reported in aggregate: how many are quarantined, how many are ready to release, how long the oldest has
  been in, and how many still have no passing streak at all.

The gate always states how many failures quarantine excluded — a green gate that silently ignored failures would be
worthless — and `--max-quarantined` sets a ceiling so the list can't grow unbounded.

Manage it from the **Quarantine** view of the project's **Failures** tab, or over the REST API (see the [API docs](https://piwitests.dev/demo/docs)).

## Regression signals

Individual test cases in a run carry at-a-glance badges:

- **New regression** (red) — the first run in which the test failed
- **Newly flaky** (purple) — the first run in which the test was flaky
- **Passed on retry** (purple) — failed at least once in this run, then passed

Purple is the flaky color everywhere in the dashboard: the flaky segment of every run bar and trend chart, flaky
counts, and the history cells of executions that passed on retry.

Filters on the run's test-case list show only new regressions or new flaky tests.

Opening a failing execution surfaces the same signals (see [Test case detail](./evidence#one-execution-diagnosis-first)): the new-regression / passed-on-retry / newly-flaky badges in the header, the *why* and *since when* facts on the headline, and the failing-streak sentence with a link back to the last green run in the history block.

## Spec health by file

The project's **Tests** tab has a **Group by File** view that groups the tests under each spec file and carries that file's pass rate, flaky rate, failure count, test count and average time in the group header, so an unhealthy area of the suite jumps out.

## Across every project

Everything above is scoped to one project. The **Analytics** page lifts the same signals to your whole
portfolio over a time window you choose — portfolio health, a pass-rate heatmap, wasted CI minutes,
regression velocity, a global flaky leaderboard, and an auto-generated insights feed. See
[Analytics](./analytics).

## Related
- [Regression or flake?](/recipes/regression-or-flaky): is one red test flaky?
- [Cut costly flakiness](/recipes/flaky-cleanup): fix the costliest flaky tests first
- [What changed in a run](./run-changes) — the Changes tab: new failures, fixed tests, commits since a baseline
- [Slow tests & wasted time](./slow-tests) — duration trends, slowest tests, and timeout opportunities
- [Analytics](./analytics) — the same signals across every project
- [UI overview](./ui-overview) — where each of these views lives in the dashboard
- [Reporter](/guide/reporter) — how retries, traces, and run metadata get captured
- [Capture fixtures](/guide/capture-fixtures) — the test-side setup behind network analysis and Web Vitals
- [Failure clusters & the inbox](./failure-clusters): the failures grouped by cause
