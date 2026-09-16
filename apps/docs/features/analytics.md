---
title: Analytics
lang: en-US
---

# Analytics

<Needs reporter />

Every other view in Piwi answers a question about one project, one run, or one test. The **Analytics**
page (`/analytics`) is the one that steps back: it aggregates every project over a time window you
choose, so you can see where the suite as a whole is drifting — and hand a number to someone who
doesn't read stack traces.

## Scope

A scope bar at the top sets:

- **Period** — last 7 / 30 / 90 days, last year, or all time.
- **Projects** — optional; restrict to the projects you pick (intersected with the ones you can see).
- **Environments** and **branches** — optional multi-select; restrict to runs labeled `production`,
  `staging`, … or reported on the chosen branches (see [Environment](/guide/concepts#environment)). These
  and the full-runs toggle are the same **filter bar** Home and each project page use.
- **Full runs only** — exclude partial and interrupted runs, which otherwise skew pass rates.

Every widget re-aggregates against that scope, and each period is compared against the *preceding*
period of the same length, which is where the "vs previous" deltas come from.

## Widgets

**Insights** — an auto-generated, severity-ranked feed of what actually changed: pass-rate drops,
failing streaks, stale failure clusters, wasted CI time, oversized timeouts and stale `test.slow()`
marks, regression surges, and slow shared endpoints. Each entry links to the project, run, cluster, or
test case behind it. Start here; the rest of the page is the evidence.

**Portfolio health** — one sortable row per project: pass rate and its change vs the previous period,
flaky volume, open failure clusters, average run duration, and latest run. Worst health sorts first.

**Pass rate heatmap** — projects × time, colored by daily (or weekly, over longer periods) pass rate.
This is the fastest way to answer *when* something started degrading.

**CI time** and **Wasted CI time** — total minutes your runs consumed, and how many of those produced
no signal: time spent inside wait steps plus time spent executing attempts that ended failed or timed
out. Because a timed-out test burns its entire (often oversized) budget, the widget also calls out how
much is reclaimable by tightening timeouts and removing stale `test.slow()` marks.

**Flakiest tests** — the global flaky leaderboard, using the same [scoring and impact
ranking](./flaky-tests#impact-ranking) as each project's Flaky tests tab.

**Failure clusters** — open root causes across all projects by age, occurrences, and error-type mix,
with the oldest unresolved cluster highlighted.

**Regression velocity** — new regressions and newly-flaky tests introduced per period, stacked, with
the change vs the previous period. Rising bars mean quality debt is accumulating faster than it's paid
down.

**Browser matrix** — pass rate per project × browser, so a suite that's green on Chromium and failing
on WebKit stands out without opening a single run.

**Slow endpoints** — backend calls captured during tests, aggregated across all projects by normalized
route: p50/p90 latency, error rate, and how many projects hit each one. A shared endpoint regressing
shows up here before it's obvious in any single suite. Requires the
[capture fixtures](/guide/capture-fixtures).

## Marking what you changed

Trends are only actionable when you can line them up against events. [Timeline markers](./timeline-markers)
let you record a deploy, a CI-runner migration, or a dependency bump against a project and see it drawn
as a vertical line across the trend charts — so "the slowdown started the day we switched runners"
becomes something you can see rather than remember.

## See also

- [Flaky tests](./flaky-tests) — the per-project analysis these widgets aggregate
- [Timeline markers](./timeline-markers) — annotate the trends with real-world events
- [UI overview](./ui-overview#analytics) — where this sits in the navigation
