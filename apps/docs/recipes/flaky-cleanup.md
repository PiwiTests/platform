---
title: Cut the flakiness that costs the most
lang: en-US
---

# Our suite is unreliable and I have one afternoon

Flaky-test cleanup usually stalls for the same reason: the list is long, every entry looks equally
annoying, and there's no obvious first move. Ranking by flakiness score doesn't help much either — a
test that flakes constantly but finishes in 200 ms costs almost nothing.

Rank by what it *costs* instead, fix three, and leave the rest running.

## 1. Sort by impact, not by score

The **Flaky tests** tab scores each test from three signals — retry passes, status alternation, and
overall failure rate — then ranks by **impact**: wasted CI minutes (retries × average failed duration)
and pipeline-block effect.

<figure>
  <img src="/screenshots/flaky-detection.png" alt="Flaky tests tab listing tests with impact, composite score, failure rate, retry passes, flip counts and root cause, above root-cause filter chips and a lookback selector">
  <figcaption>The Flaky tests tab — sortable by impact or score, filterable by root cause, over a lookback window you choose.</figcaption>
</figure>

Sort by **Impact** and work down. The column carries a color-coded dot for wasted CI minutes — green
under 5, amber under 30, red at 30 or more — and in a suite carrying real flake debt a few red rows
usually account for most of the total.

## 2. Filter by root cause and fix a class at once

Every flaky test is tagged with one of five categories from heuristics over its errors, steps, and
browser spread:

| Category | Typical signals | Usually fixed by |
|---|---|---|
| `timing` | Timeouts, "to be visible", `waitFor` | Replacing a sleep with a real wait condition |
| `network` | `net::` / `ERR_` errors, 5xx, `ECONNREFUSED` | Stubbing, or a retry on the fixture rather than the test |
| `assertion` | `expect(...)`, snapshot comparison, no timing noise | A tolerance, or a genuinely wrong expectation |
| `environment` | Fails on exactly one browser while others pass | A browser-specific guard or a real compatibility bug |
| `other` | No clear signal | Reading it |

Filtering by category is the trick that makes an afternoon enough: eight `timing` flakes usually share
one bad wait helper.

## 3. Narrow the window before you conclude anything

Two filters change the answer, and both are worth setting deliberately:

- **Lookback window** — recent behavior or a longer baseline. A test fixed last week still looks awful
  over 90 days.
- **Environment** — select one environment and the analysis is scoped to its runs, so `staging` noise
  doesn't inflate a test that's stable in `production`. Set it via the reporter's `environment` option
  or `PIWI_ENVIRONMENT`.

## 4. Quarantine the rest — with an exit

You will not fix them all today, and disabling them is how suites rot. The usual
`--grep-invert @quarantine` approach stops the test running, so nothing ever proves it recovered and the
list only grows.

[Quarantine in Piwi](/features/flaky-tests#quarantine-with-a-way-out) keeps the test running and reporting. It
is excluded from the [CI gate](/guide/ci#blocking-a-merge)'s verdict and nothing else:

- Passing runs accumulate as a **streak**; one failure resets it.
- After five consecutive passes the test is flagged **ready to release** — you're told, not asked.
- **Candidates** are proposed from the flaky analysis, ranked by wasted CI minutes.
- **Debt** is reported in aggregate: how many are in, how many are ready to leave, how long the oldest
  has been there.

The gate always states how many failures quarantine excluded, and `--max-quarantined` caps the list so
it can't grow unbounded.

## 5. Check the fix held

A flaky fix is easy to believe and hard to confirm. Each test case has a **stability trend** — pass
rate, flaky rate, and average duration bucketed over time — which is the honest answer to "did that
help?". If the suite-wide picture is what you need, [Analytics](/features/analytics) lifts the same signals
across every project, including wasted CI minutes and a global flaky leaderboard.

## Other ways in

**Ask your agent.** `list_flaky_tests` over the [MCP server](/features/mcp) returns the scores, impact ranking,
and root-cause category; `get_test_stability_trend` answers whether one test is getting worse. Useful
for "what should I fix this sprint?" without opening a browser.

**Script it.** Quarantine is a REST resource — `GET`/`POST /api/projects/:id/quarantine` and
`DELETE /api/projects/:id/quarantine/:testCaseId` — so promoting candidates or releasing ready tests can
be a scheduled job. Shapes are in the [API docs](https://piwitests.dev/demo/docs).

**No server at all.** If this is your own laptop suite rather than a team's, the
[desktop app](/features/desktop) runs the same analysis with no Docker and no Node — Windows x64 and
Apple-silicon macOS only, and the installers aren't signed yet.

## See also

- [Flaky tests](/features/flaky-tests) — the full scoring, quarantine, and performance reference
- [Analytics](/features/analytics) — the same signals across every project
- [Regression or flake?](./regression-or-flaky) — deciding whether one red test belongs on this list
