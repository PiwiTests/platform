---
title: Analytics widgets
lang: en-US
---

# Analytics widgets

<Needs reporter />

Every widget of the [Analytics](./analytics) page and of the [dashboards](./dashboards) you save, with
what it counts. Each one follows the scope bar; a widget that cannot follow a test filter says so under
its title.

## Where things stand

**Headline numbers** — six tiles across every project in scope (test pass rate, run success rate,
flaky tests, wasted CI minutes, open failure causes, median time to fix), each with its change against
the comparison. With [targets](./analytics#targets) set, a tile says whether its target is met. **Pass
rate over time** draws the comparison period as a faint line, with markers and, for one project, its
target.

**Portfolio health** — one sortable row per project: pass rate and its change vs the previous period,
flaky volume, open failure clusters, average run duration, and latest run. Worst health sorts first.

**Insights** — a severity-ranked feed of what changed: missed targets, pass-rate drops, failing streaks,
stale failure clusters, wasted CI time, oversized timeouts and stale `test.slow()` marks, regression
surges, slow shared endpoints, a median time to fix half again as long, a suite that lost tests, a
growing quarantine, and one owner holding more than half the open failure causes. Each entry links to
what is behind it.

**Pass rate heatmap** — projects × time, colored by the pass rate of each UTC day (or wider bucket, over
longer periods).
This is the fastest way to answer *when* something started degrading.

Every pass rate in the dashboard is colored on the same scale: green at 90% or more, amber from 50%, red
below 50%. The heatmap and the browser matrix split the green and amber bands into two shades each, so a
perfect period and a nearly failing one stand out.

## Where the pain is

**Failure clusters** — open root causes across all projects by age, occurrences, and error-type mix,
with the oldest unresolved cluster highlighted.

**Flakiest tests** — the global flaky leaderboard, using the same [scoring and impact
ranking](./flaky-tests#impact-ranking) as each project's Flaky tests tab.

**CI time** and **Wasted CI time** — total minutes your runs consumed, and how many of those produced
no signal: time spent inside wait steps plus time spent executing attempts that ended failed or timed
out. Because a timed-out test burns its entire (often oversized) budget, the widget also calls out how
much is reclaimable by tightening timeouts and removing stale `test.slow()` marks. With a [cost of a CI
minute](./quality-reports#cost-of-a-ci-minute) set, it shows the money too.

**Time to fix** — how fast you react: failure causes opened and fixed per bucket, the median and p90
time from first failure to fix over the causes fixed in the period, the share of those fixes that held,
and the open causes by age. Failure clusters outlive run retention, so this reaches back as far as they
do.

**Ownership** — one row per owner: the open failure causes assigned to them, the flaky tests and wasted
CI minutes of the tests they own (their `piwi:owner` annotation), and the median time to fix of the causes
they fixed, with an **Unowned** row for everything nobody holds. It answers "which team", and pairs with
the owner test filter of the Team quality report.

## Which way it is going

**Regression velocity** — new regressions and newly-flaky tests introduced per period, stacked, with
the change vs the previous period.

**Suite growth** — how many tests the suite has over time (the highest test count one run reported in
each bucket), its change against the comparison period, and the share of tests skipped or not run. A
suite that grows while its skipped share grows too is adding tests nobody runs.

**Flaky debt** — whether flakiness is going down since you started fixing it: flaky occurrences per run
in each bucket, the distinct flaky tests of each bucket (from the stored runs, so as far back as
retention keeps them) and the tests in quarantine at the end of each bucket.

## Detail

**Browser matrix** — pass rate per project × browser, so a suite that's green on Chromium and failing
on WebKit stands out.

**Slow endpoints** — backend calls captured during tests, aggregated across all projects by normalized
route: p50/p90 latency, error rate, and how many projects hit each one. A shared endpoint regressing
shows up here before it's obvious in any single suite. Requires the
[capture fixtures](/guide/capture-fixtures).

**Environment comparison** — test pass rate and run success per environment, side by side with their
change against the comparison period, and each environment's pass rate over time: "staging is green and
production is not".

**Movers** — the test-level "what changed": tests that became flaky or stopped being flaky, and tests
whose average passing duration grew or shrank by more than 25 %, against the comparison period. It reads
the stored runs, so both periods reach back only as far as retention keeps them, and each direction lists
its top tests, at most 25.

## See also

- [Analytics](./analytics): the scope, periods, targets and chart export
- [Dashboards](./dashboards): arranging these widgets into views of your own
- [Quality reports](./quality-reports): any dashboard as a document
