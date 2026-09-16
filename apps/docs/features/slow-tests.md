---
title: Slow tests & wasted time
lang: en-US
---

# Slow tests & wasted time

<Needs reporter fixtures />

The test list tells you what failed; it doesn't tell you where the **minutes** go. The **Performance** view on a project surfaces the slow tests, the trends behind them, and the time you could reclaim.

## Duration trends

Average and **P90** duration over time, so a few slow outliers don't hide a real regression (a rising P90 with a flat average is a tail getting worse). **Slowest tests** ranks the top offenders by duration.

<figure>
  <img src="/screenshots/performance-trends.png" alt="Performance tab showing the duration trend chart and slowest-tests table">
  <figcaption>The Performance view — average and P90 duration trends over time, followed by a ranked table of the slowest tests.</figcaption>
</figure>

## Timeout opportunities

Tests whose configured per-test timeout dwarfs their real p95 duration — so a hang or failure waits far longer than it needs to — plus tests still carrying a stale `test.slow()` mark they no longer need. Each row suggests a tighter timeout (or removing the mark) and the time reclaimable per failing run, ranked by impact.

This reads the per-test timeout the [reporter captures](/guide/reporter#per-test-timeout); runs reported before that shipped still surface stale `test.slow()` marks from annotations and durations alone. The thresholds are tunable via `PUT /api/settings/timeout-hygiene`.

## Network and Web Vitals

- **Network analysis** — slow API calls grouped by method and normalized route (e.g. `/api/users/:id`), for a run picked from the tab.
- **Browser Web Vitals** — TTFB, DOMContentLoaded, FCP and more, with color-coded thresholds.

Both require the [capture fixtures](/guide/capture-fixtures) in your test setup — without them the reporter has no network timings or Web Vitals to aggregate.

## Related

- [Capture fixtures](/guide/capture-fixtures) — the test-side setup behind network analysis and Web Vitals
- [Flaky tests](./flaky-tests) — flaky scoring costs wasted CI minutes the same way
- [Analytics](./analytics) — wasted CI minutes and slow endpoints across every project
- [Reporter](/guide/reporter#per-test-timeout) — how the per-test timeout is captured
