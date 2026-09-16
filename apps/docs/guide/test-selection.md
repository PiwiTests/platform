---
title: Test selections
lang: en-US
---

# Test selections

A **selection** is a named, data-driven subset of your suite that Piwi resolves from the run history it already keeps —
then hands back as a command you can run. Instead of maintaining a `@smoke` tag convention and a grep pattern in a CI
file that quietly drift apart, you describe the subset once ("critical tests, under 15 s each, not quarantined") and
`piwi run` turns it into the tests to run, every time, against the current state of the suite.

Selections are resolved on demand, never frozen: a definition is rules over catalog facts, so a renamed file or a newly
flaky test is reflected the next time you resolve, with no edit.

## Run one

```bash
npx @piwitests/reporter run smoke
```

`piwi run <key>` resolves the selection and runs `playwright test` with exactly those tests. Point it at your dashboard
the same way the reporter does — `PIWI_DASHBOARD_URL`, `PIWI_API_KEY` (if auth is on), and `PIWI_PROJECT_NAME`:

```bash
PIWI_DASHBOARD_URL=https://piwi.example.com \
PIWI_PROJECT_NAME=web \
npx @piwitests/reporter run smoke -- --workers=4
```

Anything after `--` is passed straight to Playwright. The run is **stamped** with the selection it came from, so the
dashboard shows `smoke · 42 tests` instead of an anonymous filter, and a [gate](/guide/ci) can re-resolve the same definition
to check nothing was silently dropped.

If the dashboard is unreachable, `piwi run` falls back to the full suite with a warning (and reuses the last good
resolution from `.piwi/selection-cache.json` when it has one) — a reporting problem never breaks the test run. Pass
`--strict` to invert that for CI, where an unresolvable selection should stop the pipeline. Resolving to **zero** tests
is always an error: a smoke job that silently runs nothing is worse than one that fails loudly.

### Print instead of run

`piwi select <key>` resolves and prints the Playwright arguments, for a composable two-step job:

```bash
npx @piwitests/reporter select smoke --format args > .piwi-selected
npx playwright test $(cat .piwi-selected)
```

`--format` picks the shape: `args` (`file:line` tokens, the default), `grep`, `files`, or `json` (the full resolution,
including the matched tests, the estimate and any warnings). `--budget 5m` caps the total time for this resolution.

### Balanced shards

`--shard i/n` keeps only shard _i_ of _n_, split so each shard's summed test duration is even — historically informed
balancing that Playwright's file-count sharding can't do. Because Piwi merges a run's shards into one, the merged run
still covers the whole selection (so a `--require-selection` gate sees all of it):

```bash
npx @piwitests/reporter run smoke --shard 2/4 -- --shard=2/4
```

The split is **lock-aware**: every test that shares a [lock](./reporter#test-locks) is placed in the same shard, then
the shards are balanced by duration. Playwright serializes lock holders inside one `npx playwright test` process only —
two `--shard` runs are separate processes and can hold the same lock at once — so keeping a lock's holders together
restores the guarantee across shards. A lock group larger than a shard's fair share still goes to one shard (the lock
guarantee wins over even balancing); grouping is transitive, so a test declaring two locks binds both groups. The
assignment is deterministic for the same catalog. When a selection's tests share a lock, resolving it (including
`piwi select --format json`) carries a `split-lock` warning, a reminder to shard with `piwi run --shard` rather than
Playwright's own `playwright test --shard`, which would split the lock.

### Fail fast

`--fail-fast` emits the selection worst-first — the least-reliable tests (by pass rate) lead, so a likely failure
surfaces early instead of after the stable bulk of the suite has run:

```bash
npx @piwitests/reporter run smoke --fail-fast
```

It reorders, it never drops: the same tests run, so the resolved hash is unchanged and a `--require-selection` gate
still sees the whole set. Ordering is a hint — Playwright owns worker scheduling, so it influences file order rather
than guaranteeing a strict sequence. It composes with `impact` (`piwi run impact --base origin/main --fail-fast`).

## Built-in selections

Two selections exist for every project with no setup:

| Key | What it resolves to |
|---|---|
| `failed` | Tests whose most recent execution failed or timed out. |
| `quarantine-free` | The whole suite minus tests under an active [quarantine](/features/flaky-tests). |

They also double as worked examples of the definition format below.

## Defining a selection

Save a selection through the dashboard or the API (`POST /api/projects/:id/selections`). The `definition` is declarative
JSON: OR-ed `include` groups, minus OR-ed `exclude` groups, then pins, a budget and a limit — applied in that order.

```jsonc
{
  "include": [
    { "tags": ["smoke"] },
    { "priority": ["critical", "high"], "maxAvgDurationMs": 15000 }
  ],
  "exclude": [{ "quarantined": true }],
  "budget": { "maxTotalDurationMs": 300000, "rankBy": "failureLikelihood" },
  "limit": 200
}
```

Within a group every predicate must hold (AND); a test matches `include` if it matches any group (OR). An empty or
absent `include` starts from the whole suite. The predicates, all optional:

| Predicate | Matches when |
|---|---|
| `tags` / `anyTags` | the test carries all / any of these tags |
| `owner`, `priority`, `feature` | the `piwi:` annotation is one of these |
| `files` | the file path matches one of these globs (`**`, `*`, `?`) |
| `suitePath`, `text` | the describe chain / title (or file) contains this substring |
| `quarantined`, `flaky`, `neverRun` | the test is (or is not) in that state |
| `minPassRate` / `maxPassRate` | pass rate over executed runs is within bounds (0–1) |
| `minAvgDurationMs` / `maxAvgDurationMs` | average duration is within bounds |
| `lastStatus` | the latest execution's status is one of these |
| `failedInLastRuns` | the test failed within its last _N_ executions (N ≤ 25) |

An unknown predicate is a validation error, not a silent no-op — a typo fails loudly rather than resolving to a wider
set than you meant.

### Budgets and pins

`budget` turns a selection into a knapsack: tests are ranked (`failureLikelihood`, `recentFailure`, `priority`,
`slowest` or `fastest`) and taken until their summed average duration hits `maxTotalDurationMs`. "The best five minutes
of this suite" is an empty `include` plus a budget. `pins` force individual tests in (`add`) or out (`remove`) by test-
case id, on top of whatever the predicates matched. `limit` caps the count last.

## From a Playwright config

If you prefer `PIWI_SELECTION=smoke playwright test` over `piwi run`, resolve the selection in an ESM config with the
`resolveSelection` helper (it needs top-level `await`, which `defineConfig` in an ESM config allows):

```ts
import { defineConfig } from '@playwright/test';
import { wrapConfig, resolveSelection } from '@piwitests/reporter';

const selection = await resolveSelection(); // reads PIWI_SELECTION; undefined when unset
export default wrapConfig(defineConfig({ grep: selection?.grep }));
```

It stamps the run the same way `piwi run` does, and returns `undefined` (so the config runs everything) when no
selection is named or the dashboard cannot be reached.

## Guard it in CI

A tag convention can't tell you a smoke job silently shrank — a renamed file or an over-narrow grep quietly drops a
test, and the job stays green. `piwi gate --require-selection <key>` closes that gap: the dashboard re-resolves the
selection's current definition and fails the build if any test it now matches did not run, or ran and failed.

```bash
npx @piwitests/reporter run smoke                 # run the subset, stamping the run
npx @piwitests/reporter gate --require-selection smoke   # then assert it held
```

It composes with the other [gate](/guide/ci) rules (`--max-new-regressions`, `--fail-on-flaky`, …). A quarantined test is
exempt — quarantine already means "don't gate on this test".

## In the dashboard, and for agents

The project's **Selections** tab lists the built-ins and your saved selections, with a builder that previews live what
a definition resolves to — the matching tests, the estimated duration, any warnings, and the exact command — before you
save it. For AI agents, the [MCP server](/features/mcp) exposes `list_selections`, `resolve_selection` (key → tests + verify
command), `preview_selection` (an ad-hoc definition, dry-run) and `analyze_selections` (health and drift); the
`run-the-right-tests` skill ties them together.

## Health and drift

A selection resolves fresh every time, which is the point — and also the risk: the set it runs can quietly change
under you. A renamed file drops out of a `files` glob, a test turns flaky and falls below a `minPassRate`, and the job
stays green while covering less than you think. The Selections tab makes that visible.

Each selection shows what it resolves to now, and a **drifted** badge when that differs from what its most recent
`piwi run` recorded — the run stamped the hash and count it resolved then, so re-resolving and comparing catches a
silent shrink (or growth) between runs. A quarantined-member count flags selections carrying tests whose verdict is
already suspended.

Above the list, a **coverage** line answers the question a tag convention can't: how many tests are matched by *no*
stored selection. Those "unselected" tests are the gap nobody can see today — nothing routine runs them as a named
subset. Built-in selections don't count toward coverage (`quarantine-free` matches almost everything and would hide the
signal). The same data is available to agents through the `analyze_selections` MCP tool.

## Impact-from-diff

`piwi run impact --base <ref>` runs only the tests your change affects. The reporter computes the working-tree diff
against `<ref>` locally (`git diff --name-only`), and the dashboard maps those files to tests through two observed
edges:

- **Direct** — a changed file that _is_ a test file → the tests defined in it.
- **Reach** — a changed support file (a page object, helper, or app module) that a test's most recent execution
  actually ran through, per its captured source frames.

```bash
npx @piwitests/reporter run impact --base origin/main
```

It fails safe. A changed _source_ file that maps to no test can't be proven irrelevant, so the run **widens to the full
suite** with a warning rather than silently skipping it — impact never narrows away a test it's unsure about. A
docs-only or config-only change impacts nothing and runs nothing. This is evidence-based impact, not static analysis:
route- and page-level mapping (a changed server route → the tests that call it) needs a per-project config and is not
attempted yet.

## Suggestions

Piwi can _propose_ selections and tags from the history it keeps — suggest-only, with the evidence attached, never
applied. The **Suggestions** panel on the Selections tab (and the `suggest_selections` MCP tool) surface three kinds:

- **`@slow` tags** — tests whose average duration sits well past the suite's 95th percentile.
- **`@feature` tags** — the dominant route family a test hits (say `checkout`) when it carries no `feature` annotation,
  inferred from the routes it actually called.
- **A mined smoke suite** — a greedy weighted set cover over _observed_ route coverage under a time budget: it keeps
  picking the test that buys the most new routes per second until the budget is spent, producing the classic
  diminishing-returns curve. "Save as selection" turns the picks into a selection pinned to exactly those tests.

Honest about what it is: coverage here means the routes a test was _seen_ to hit on recent runs, not instrumented code
coverage — an approximation, and a good one for smoke's job, which is breadth over entry points. A test must be stable
(high pass rate, not flaky, not quarantined) to be mined into a smoke suite.

## What selections are not

- **Not instrumented test-impact analysis.** Predicates read _observed_ history — durations, pass rates, statuses — not
  a build-time dependency graph.
- **Not a way to hide failures.** [Quarantine](/features/flaky-tests) decides a test's verdict; a selection only decides whether
  it runs. The full suite stays your baseline — selections are for the fast loops in between.
- **Not a hosted service.** Everything resolves on your instance against your data.
