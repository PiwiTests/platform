---
title: Flaky tests & analytics
lang: en-US
---

# Flaky tests & analytics

Once Piwi has a few runs of history, it turns them into cross-run intelligence: which tests are flaky, what's regressing, where time is wasted, and how performance trends over time. This page covers the analytics features beyond a single run.

## Flaky test detection

A test is flaky when its result isn't deterministic. Piwi computes a **composite flakiness score** per test from three signals:

- **Retry passes** — failed on the first attempt, passed on retry.
- **Status alternation** — flips between pass and fail across runs.
- **Failure rate** — overall proportion of failures.

Each project has a dedicated **Flaky tests** tab with a **configurable lookback window** so you can focus on recent behavior or a longer baseline.

<figure>
  <img src="/screenshots/flaky-detection.png" alt="Flaky tests tab listing tests with composite score, failure rate, retry passes, and flip counts">
  <figcaption>The Flaky tests tab — each intermittent test scored by retry passes, status flips, and failure rate, ranked by impact and filterable by root-cause category.</figcaption>
</figure>

### Root-cause classification

Every flaky test is automatically tagged with one of five categories, using keyword and distribution heuristics over its errors, steps, and browser spread:

| Category | Typical signals |
|----------|-----------------|
| `timing` | Timeouts, "to be visible", `waitFor`, element-not-found-within |
| `network` | `net::` / `ERR_` errors, 5xx responses, `ECONNREFUSED`, `waitForResponse` |
| `assertion` | `expect(...)`, "Expected:", snapshot/screenshot comparison — with no timing/network noise |
| `environment` | Fails repeatedly on exactly one browser while others pass |
| `other` | No clear signal |

Filter the flaky table by category to triage a class of failures at once.

### Impact ranking

Not all flaky tests are equally expensive. Piwi ranks them by **impact** — derived from wasted CI minutes (retries × average failed duration) and pipeline-block effect — so you fix the ones that hurt most first. A color-coded dot makes it scannable:

- 🟢 green — under 5 wasted minutes
- 🟡 amber — under 30 minutes
- 🔴 red — 30 minutes or more

### Per-test stability trend

Each test case has a **stability trend**: a time series of pass rate, flaky rate, and average duration, bucketed over time — so you can see whether a fix actually stuck.

## Run insights

The **Insights** tab on a run compares it against its last passing baseline and surfaces what changed:

- **New regressions** — tests that newly started failing
- **Recurring failures** — failing again
- **Fixed** — previously failing, now passing
- **New flaky** — newly flaky tests
- **Performance changes** — most regressed / most improved
- **Worker imbalance** — uneven load across workers
- **New failure clusters**

<figure>
  <img src="/screenshots/run-insights.png" alt="Run Insights tab showing pass-rate delta, new regressions, and new flaky tests versus the baseline">
  <figcaption>The Insights tab on a run — pass-rate and duration deltas versus the last passing baseline, with new regressions and newly flaky tests called out.</figcaption>
</figure>

## Regression signals

Individual test cases in a run carry at-a-glance badges:

- **`NEW`** (red) — a new regression
- **`FLAKY`** (purple) — newly flaky

Toggle filters on the run's test-case list to show only new regressions or new flaky tests.

## Performance

- **Duration trends** — average and **P90** over time, so a few slow outliers don't hide a real regression.
- **Slowest tests** — the top offenders ranked by duration.
- **Run comparison** — a side-by-side delta of two runs with improved / regressed / unchanged summaries.
- **Network analysis** — slow API calls grouped by method and normalized route (e.g. `/api/users/:id`).
- **Browser Web Vitals** — TTFB, DOMContentLoaded, FCP and more, with color-coded thresholds.

<figure>
  <img src="/screenshots/performance-trends.png" alt="Performance tab showing the duration trend chart and slowest-tests table">
  <figcaption>The Performance tab — average and P90 duration trends over time, followed by a ranked table of the slowest tests.</figcaption>
</figure>

## Spec health heatmap

A project-level overview groups test cases by spec file and colors each by pass rate, so an unhealthy area of the suite jumps out. Cells link straight to the filtered test-case list.

## See also

- [UI overview](./ui-overview) — where each of these views lives in the dashboard
- [Reporter](./reporter) — how retries, traces, network, and Web Vitals get captured
- [AI diagnosis & failure clustering](./ai-diagnosis) — explain the failures behind the trends
