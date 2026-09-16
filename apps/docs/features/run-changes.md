---
title: What changed in a run
lang: en-US
---

# What changed in a run

<Needs reporter />

The **Changes** tab on a run compares it against **one baseline** and tells you what moved: which tests newly started failing, which got fixed, and what landed between the two. It's the fastest way to answer "did my push break this, or was it already red?"

## The baseline

Every section reads the **same baseline**, so the "new failures" count is computed once and used throughout. The selector at the top says which run it is, which branch and environment that run is on, and **why it was chosen**.

By default the baseline is the last passing full run **in the same environment** — on the same branch, then on the **base branch** the run's branch forked from (the pull request's target branch when the reporter captured one, else the project's default branch), then on any branch — and only when the run's environment has no passing run at all does the same ladder run again across environments (see [Branches](./branches#branch-aware-baselines) and [Core concepts](/guide/concepts#baseline-last-green-run)). The line under the selector spells out the rung that applied, for example _"No passing staging run exists on feature/x; the last passing run on the default branch main in staging."_

Two ways to compare against something else:

- **Base branch** — take the baseline from one branch only: its last passing run, same environment first. The list offers every branch with an earlier passing run, so it appears once the project has one to choose. Deep-linkable as `?baseBranch=<name>`.
- **Run** — compare against one specific run, whatever its branch or environment. Deep-linkable as `?baseline=<runId>`, so a link to a comparison reopens the same two runs. **Previous run** is the shortcut for the run just before this one.

**Automatic** returns to the default choice. The same two options exist on the API (`GET /api/test-runs/{id}/insights?baseBranch=…` / `?baseline=…`) and on the MCP `get_run_insights` tool (`baseBranch`).

## What it shows

- **New failures** — passed in the baseline, failing here.
- **Fixed** — failed in the baseline, passing here.
- **Still failing** — failing in both.
- **Newly flaky / passed on retry** — passed here but needed a retry.
- **Slower / faster** — the ten largest duration changes each way.
- **Commits since the baseline** — the commit range, a copyable `git log` command and, when the SCM host is known, a link to the commits.
- **Environment changes** — the fields that differ, in *This run* / *Baseline* columns.

<figure>
  <img src="/screenshots/run-changes.png" alt="Run Changes tab showing the baseline selector, the tests that newly started failing, the ones that got fixed, and the commits landed since the baseline">
  <figcaption>The Changes tab on a run, read against one baseline — new failures, fixed tests, and the commits landed since.</figcaption>
</figure>

Comparing two runs is also how the [run comparison](./ui-overview#test-run-detail) works: select two runs on the project's Runs tab and the newer one opens on its Changes tab with the older as its baseline.

## Related

- [Branches](./branches#branch-aware-baselines) — why the default baseline is the same-branch run
- [Flaky tests](./flaky-tests) — the per-project flaky, regression and spec-health signals
- [Failure clusters & the inbox](./failure-clusters) — the failures grouped by cause
- [Timeline markers](./timeline-markers) — annotate the trend charts with real-world events
