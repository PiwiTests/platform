---
title: Branches
lang: en-US
---

# Branches

<Needs reporter />

Every run Piwi stores is tagged with the git **branch** it came from, and that branch is a real, queryable dimension — not a string buried in metadata. Filter any view to one branch, compare like with like, and let baselines and flakiness scoring stop mixing your feature branches together. This is the headline of 0.26: branch-aware runs and baselines.

**Needs:** the reporter only — the branch is collected automatically with the rest of the git metadata (`collectScmInfo`, on by default). Nothing to install or switch on.

## How the branch is recorded

On CI, git alone is unreliable: a pull-request checkout is usually a detached `HEAD`, so `git rev-parse` reports the literal string `HEAD` instead of a branch. The reporter resolves the real branch through a fallback chain instead:

1. **`PIWI_BRANCH`** — an explicit operator override, when you want to name the branch yourself.
2. **The CI provider's branch variables** — `GITHUB_HEAD_REF` / `GITHUB_REF_NAME` on GitHub Actions, the merge-request and commit refs on GitLab, and the equivalents for CircleCI, Travis, Azure, Jenkins and Bitbucket. On a pull-request build the **source** branch wins over the plain ref, so the run records the branch under test.
3. **`git rev-parse --abbrev-ref HEAD`** — the local answer, used only when it is a real branch. A detached `HEAD` is discarded rather than recorded.

When the provider exposes it, the reporter also captures the **pull-request number**, so [pull-request feedback](/guide/ci#pull-request-feedback) can look the PR up exactly instead of guessing from the branch name, and the pull request's **target branch** (`GITHUB_BASE_REF`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, `SYSTEM_PULLREQUEST_TARGETBRANCH`, `BITBUCKET_PR_DESTINATION_BRANCH`, Jenkins' `CHANGE_TARGET`, Travis' `TRAVIS_BRANCH` on a PR build), which becomes the run's **base branch** — the branch baselines fall back to. Set `PIWI_BASE_BRANCH` to name it yourself. Branch, PR and base-branch detection happen automatically as part of CI collection — see [CI & sharding → What gets detected](/guide/ci#what-gets-detected).

## The default branch

Each project has a **Default branch** setting on its **Settings** tab (placeholder `e.g. main`). Leave it blank and Piwi resolves it from your SCM provider. The default branch is the reference point for the rest of this page: baselines fall back to it, and "already flaky on the default branch" is measured against it.

## Filtering by branch

On a project page, the filter bar carries a **branch** multi-select (the git-branch icon, "All branches") next to the environment filter. It appears once the project has runs from more than one branch, and it scopes the **runs list** and the **flaky leaderboard** to the branches you pick. [Analytics](./analytics) has its own branch scope control, so a pass-rate trend or slow-test table can be read for one branch at a time.

Because the branch is an indexed column, these filters are served by the database rather than by fetching a wide batch and sifting metadata in memory. Runs reported before the column existed fall back to the branch recorded in their metadata, so old history still filters.

## Branch-aware baselines

The bigger change is invisible until you look for it: **baselines are chosen within an environment and a branch.**

- **The run-level baseline** — what the Changes tab, the stored regression signals, the CI gate, pull-request feedback, the bisect window and the AI diagnosis all compare against — is the last passing run **in the same environment**, on the **same branch**, then on the **base branch** the run's branch forked from (the pull request's target when the reporter captured it, else the default branch), then on any branch; only a run whose environment has no passing run at all falls through to another environment. Two feature branches reporting interleaved runs no longer become each other's baseline, and a `staging` run is not measured against a `production` one while a `staging` history exists. See [Core concepts](/guide/concepts#baseline-last-green-run) for the full ladder.
- **Choosing the base branch** — the Changes tab lets you take the baseline from any branch that has a passing run, so a long-lived branch can be compared against `release/2` rather than `main`; the choice is in the URL (`?baseBranch=`) and on the API and MCP tool. See [What changed in a run](./run-changes#the-baseline).
- **The visual-diff baseline** ([What changed in a run](./run-changes)) prefers the same environment, then the same branch, the same way, so a screenshot diff compares against a run that shares your branch's state.
- **Pull-request feedback** builds its "new failures vs. pre-existing" split from those same signals, and **exonerates** a test that is already flaky on the default branch — a failure the PR did not introduce is reported as pre-existing rather than blamed on the change. The `max-new-regressions` [CI gate](/guide/ci#blocking-a-merge) then counts the right number.
- **Performance alerts** — the `perf.regression` [notification](./notifications) measures a run against the previous runs on the same branch **in the same environment**.

## From an agent (MCP)

The MCP tools take a branch filter too: `list_runs` and the flaky tools accept a `branch` argument, so an agent can ask "what is failing on `main`" or "is this test flaky on my branch" without pulling every run. See the [MCP server](/features/mcp).

## Notifications

Notification subscriptions can filter by branch and alert only on the default branch, so a noisy work-in-progress branch does not page you. See [Notifications & alerts](./notifications).

## Limits

- **Branch scoping is opt-in per view for trends.** Analytics trends aggregate across every branch until you apply the filter; the flaky leaderboard already reads the default branch (plus runs with no branch) unless you scope it.
- **Branches are a run dimension, not yet entities.** There is no per-branch merge-readiness verdict, branch-class gate policy, or retention by branch class yet — those are the "branches as entities" work still under *Exploring* in the [roadmap](https://github.com/PiwiTests/platform/blob/main/ROADMAP.md).
- **A run needs a resolvable branch.** A purely local run with no CI variables, a detached `HEAD`, and no `PIWI_BRANCH` records no branch at all, so it will not appear under any branch filter.

## Related

- [CI & sharding](/guide/ci) — how the branch and PR number are detected on each provider
- [Flaky tests](./flaky-tests) — the leaderboard and regression signals the branch filter scopes
- [Analytics](./analytics) — trends you can read one branch at a time
- [Core concepts](/guide/concepts) — where branch sits among run, execution and baseline
