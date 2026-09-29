---
title: Triage a run that went mostly red
lang: en-US
---

# Forty tests are red — where do I start?

Almost never with forty bugs. A run that goes broadly red is usually two or three causes wearing forty
costumes: an environment that didn't come up, an auth change, one shared component, one bad worker.
The job is to collapse the list before reading any stack traces.

## 1. Read the clusters, not the tests

Failures sharing an **error fingerprint** are grouped automatically, so the run tells you
*"40 failures, 3 root causes"* before you open anything.

<figure>
  <img src="/screenshots/failure-clusters.png" alt="A red run's Tests tab grouped by cluster: one group per root cause with its test count, triage status and an Open cluster link, and the passing tests folded away">
  <figcaption>A red run's <strong>Tests</strong> tab opens grouped by <strong>Cluster</strong> — one group per root cause, with its triage status and a link to the cluster page.</figcaption>
</figure>

Fingerprinting masks the volatile parts of an error (timeouts and other numbers, UUIDs, URLs, the
expected and received values of an assertion) so the same underlying failure groups across tests, spec
files, and runs. It's always on and needs no configuration.

## 2. Rule out the boring causes first

Before treating any cluster as a product bug, check the two flags on the run's failure groups. They come
from `get_failure_groups` over MCP or `GET /api/test-runs/:id/failure-groups`; the dashboard doesn't show them.

- **Worker correlated** — two or more of the cluster's failures, all on one worker, in a run that used
  several: you're looking at a misbehaving worker, not forty broken tests.
- **Flaky** — a test in the cluster passed on retry in this run: part of the cluster is noise riding on a
  bad run.

An environment that never came up has a signature of its own: everything fails, fast, on a navigation
or connection error. That's one cluster, one fix, and no test code involved.

## 3. Triage each cluster once

A cluster page puts the whole investigation in one column. Its opening block states where the cluster
stands in one sentence, with a **Triage** menu that sets one status — open, resolved, or ignored — plus a
note and an assignee for the entire group, and a **Snooze** menu beside it. Below come what changed since
the baseline, the affected tests, the evidence for the one you pick, and *More ways to fix*. Forty tests,
three decisions.

Clusters stay open across runs, so the next red build attaches to the same row rather than starting the
conversation over.

## 4. Confirm the fix actually landed

When a later run executes every test a cluster covers and they all pass, Piwi records the fix — the run,
the commit, and how long the cluster was open — with three separate verdicts, because they aren't the
same claim. The run doesn't have to be a full one: re-running just the affected tests and seeing them all
pass records the fix too. Only **Diagnosis verified** resolves an open cluster on its own, and
**Regressed** reopens a resolved one; **Stopped failing** leaves the triage status to you.

| Verdict | Means |
|---|---|
| **Stopped failing** | The tests pass again. A flaky test can manage this by accident. |
| **Diagnosis verified** | Commits since the last failing run touched a file the [suggested patch](/features/ai-diagnosis#what-a-diagnosis-contains) named. |
| **Regressed** | A fix was recorded and the cluster is failing again. |

## Optional: let a model do the first pass

With [AI diagnosis](/features/ai-diagnosis) configured, each cluster gets an explanation read against your
actual git diff since the last green run, and any suggested patch is validated against your source
before it's shown. It's off by default and works with a local model — the point is that clustering has
already decided *what* is worth diagnosing, so the model runs a few times per run, not forty.

Configuring an **embedding** role additionally merges clusters that are the same root cause phrased
differently. Without one, clustering stays purely deterministic — still useful, just less aggressive
about collapsing near-duplicates.

## Other ways in

**From your agent.** `get_failure_groups` over the [MCP server](/features/mcp) returns a run's failures grouped
by cluster with the worker correlation included, and `get_test_case_context` pulls the evidence behind a
single failure — steps, console, network, SCM diff. No install; the server is part of the dashboard.

**From a script.** The same grouping is available over the REST API if you'd rather post a summary into
your own channel — see the [API docs](https://piwitests.dev/demo/docs).

**Before anyone opens anything.** Subscribe to the `cluster.new` [notification](/features/notifications) event
instead of `run.failed`: you hear once when a genuinely new root cause appears, not on every red build,
and the payload carries a sample error excerpt and how many tests it affects.

## See also

- [AI diagnosis & failure clustering](/features/ai-diagnosis) — how fingerprints and semantic merging work
- [Regression or flake?](./regression-or-flaky) — when it's one test rather than forty
- [Core concepts](/guide/concepts) — *cluster*, *fingerprint*, *baseline*
