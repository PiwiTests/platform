---
title: Analytics
lang: en-US
---

# Analytics

<Needs reporter />

The **Analytics** page (`/analytics`) steps back from single runs and tests: it aggregates every
project over a period you choose, to show where the suite as a whole is drifting.

## Scope

A scope bar at the top sets what every widget counts; the line under it states the resolved dates, the
comparison, and any note (a project without the chosen selection, a deleted marker).

- **Period**, with the comparison and the buckets (below).
- **Projects**: optional, intersected with the ones you can see.
- **Tests**: optional; a selection, test tags or browsers (below).
- **Environments** and **branches**: optional multi-select; restrict to runs labeled `production`,
  `staging`, … or reported on the chosen branches (see [Environment](/guide/concepts#environment)). These
  and the full-runs toggle are the same **filter bar** Home and each project page use.
- **Branch policy**: *Default branch* or *All branches* (below).
- **Full runs only**: exclude partial runs, which otherwise skew pass rates.

Probe runs (the fault-injected replays `piwi probe` produces) are never counted, whatever the filters.

### Periods

- **Rolling**: the last 7 days to 12 months, in whole UTC days, today included.
- **Calendar**: this or last week, month, quarter or year. Boundaries follow your time zone (the one set
  under Settings → Localization, else your browser's); a week starts on your locale's first day.
- **Custom range**: two dates, both included.
- **Since a marker**: from a [timeline marker](./timeline-markers) to now.
- **Release cycle**: between two consecutive `release` markers, the current one or the previous one.
- **Sprint**: a start date and a length, this sprint or the last.
- **All time**: everything still stored.

### Comparison and buckets

Every change on the page is measured against the **comparison**: the previous period of the same length
(the default), the previous calendar unit, release cycle or sprint, the same period a year earlier, or
nothing.

**Buckets** decide how the trends and the heatmap cut the period: automatic (about 31 buckets), daily,
weekly or monthly. Buckets start at UTC midnight, so a heatmap cell is one UTC day.

### Branch policy

By default only runs on each project's **default branch** count, plus runs whose branch is unknown, so
a broken feature branch no longer moves the trends. The default branch is the project's setting, else
the one its latest run reported, else `main`. *All branches* counts every run; branches picked in the
filter bar override both.

### Test filter

The *Tests* filter narrows every number to some tests:

- a **selection**, by key: `smoke` resolves in each project to that project's
  [selection](/guide/test-selection) with that key, so a convention shared across projects works on the
  cross-project page; a project without it is left out and named;
- **test tags**: tests carrying all of them;
- **browsers**: the Playwright projects the executions ran on.

It means the tests that match **today**, with their whole history. The widgets then count from the
stored executions, final attempt per test and browser, so they reach back only as far as retention keeps
runs. A widget that cannot narrow (the failure clusters) says so above its card.

With one project in scope, *Save as selection* stores the tags as a selection you can run with
`piwi run <key>`.

### Sharing a view

The address carries the scope (`?period=last-month&sel=smoke`), so a copied link opens on what its
sender saw; without it, the page opens on the scope you used last in this browser. To keep your own
view, save a [dashboard](./dashboards).

### Where the numbers come from

The pass rates, run counts, durations, CI time, wasted time and regression counts are read from
**daily rollups**, one precomputed row per project, UTC day, environment, branch and run kind, kept at
ingest and checked nightly against the stored runs. When [retention](/operate/storage#data-retention)
deletes old runs, their numbers stay in the rollups, so a one-year pass-rate line survives a 30-day
retention window. Lists of tests and clusters, and anything under a test filter, read the stored runs.

## Widgets

**Headline numbers** — six tiles across every project in scope (test pass rate, run success rate,
flaky tests, wasted CI minutes, open failure causes, median time to fix), each with its change against
the comparison. **Pass rate over time** draws the comparison period as a faint line, with markers.

**Insights** — a severity-ranked feed of what changed: pass-rate drops, failing streaks, stale failure
clusters, wasted CI time, oversized timeouts and stale `test.slow()` marks, regression surges, slow shared
endpoints. Each entry links to what is behind it.

**Portfolio health** — one sortable row per project: pass rate and its change vs the previous period,
flaky volume, open failure clusters, average run duration, and latest run. Worst health sorts first.

**Pass rate heatmap** — projects × time, colored by the pass rate of each UTC day (or wider bucket, over
longer periods).
This is the fastest way to answer *when* something started degrading.

Every pass rate in the dashboard is colored on the same scale: green at 90% or more, amber from 50%, red
below 50%. The heatmap and the browser matrix split the green and amber bands into two shades each, so a
perfect period and a nearly failing one stand out.

**CI time** and **Wasted CI time** — total minutes your runs consumed, and how many of those produced
no signal: time spent inside wait steps plus time spent executing attempts that ended failed or timed
out. Because a timed-out test burns its entire (often oversized) budget, the widget also calls out how
much is reclaimable by tightening timeouts and removing stale `test.slow()` marks. With a [cost of a CI
minute](./quality-reports#cost-of-a-ci-minute) set, it shows the money too.

**Suite growth** — how many tests the suite has over time (the highest test count one run reported in
each bucket), its change against the comparison period, and the share of tests skipped or not run. A
suite that grows while its skipped share grows too is adding tests nobody runs.

**Flaky debt** — whether flakiness is going down since you started fixing it: flaky occurrences per run
in each bucket, the distinct flaky tests of each bucket (from the stored runs, so as far back as
retention keeps them) and the tests in quarantine at the end of each bucket.

**Flakiest tests** — the global flaky leaderboard, using the same [scoring and impact
ranking](./flaky-tests#impact-ranking) as each project's Flaky tests tab.

**Failure clusters** — open root causes across all projects by age, occurrences, and error-type mix,
with the oldest unresolved cluster highlighted.

**Regression velocity** — new regressions and newly-flaky tests introduced per period, stacked, with
the change vs the previous period.

**Browser matrix** — pass rate per project × browser, so a suite that's green on Chromium and failing
on WebKit stands out.

**Slow endpoints** — backend calls captured during tests, aggregated across all projects by normalized
route: p50/p90 latency, error rate, and how many projects hit each one. A shared endpoint regressing
shows up here before it's obvious in any single suite. Requires the
[capture fixtures](/guide/capture-fixtures).

## Exporting a chart

Every chart carries a menu in its header. **Copy as PNG** puts the chart, with its title, on the clipboard
as an image, ready to paste into a slide; a browser that cannot copy images downloads the PNG instead.
**Download CSV** saves the numbers behind the chart, one row per bucket or group, with the same
protection against spreadsheet formulas as the [quality report's CSV](./quality-reports). To send a
whole dashboard, export it as a [quality report](./quality-reports) instead.

## Targets

A project can carry **targets**, set in its **Settings** tab: a test pass rate to reach, and limits on
flaky tests, wasted CI minutes per week, the age of the oldest open failure cause and the median time to
fix. Each one is optional. Over the period a dashboard shows, a target is **met** or **missed**:

- the headline tiles mark each number that has a target, met or missed, with one project in scope;
- the portfolio's **Targets** column counts the targets each project meets;
- the insights feed says which target a project missed, and by how much;
- a quality report lists every target, met or missed, and its risks name the missed ones.

A weekly target (wasted CI minutes) is scaled to the length of the period, so a 30-day period is checked
against about four weeks of it.

## Marking what you changed

[Timeline markers](./timeline-markers) record a deploy, a CI-runner migration or a dependency bump
against a project, drawn as a vertical line across the trend charts. On the analytics page, with one project in scope every marker
is drawn; across projects only `release`, `infra` and `incident` markers are, labeled with their project — so "the slowdown started the day we switched runners"
becomes something you can see rather than remember.

## See also

- [Dashboards](./dashboards) — views of your own
- [Quality reports](./quality-reports) — this page as a document, with **Export**

- [Flaky tests](./flaky-tests) — the per-project analysis these widgets aggregate
- [Timeline markers](./timeline-markers) — annotate the trends with real-world events
- [UI overview](./ui-overview#analytics) — where this sits in the navigation
