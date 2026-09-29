---
title: Pull-request feedback & re-run
description: "Piwi posts a run's result on the pull request, new failures apart from pre-existing ones, and re-runs a cluster's tests in CI from the dashboard."
lang: en-US
---

# Pull-request feedback & re-run

<Needs reporter scm />

The run URL a CI job prints is a link somebody has to click. Piwi can instead post the result onto the pull request
itself, which is where the person who broke the test already is. And once a cluster is fixed, the cluster page can
start the CI run that proves it.

## What gets posted

Two things get posted when a run finishes:

- **A summary comment** on the branch's open pull request: one comment per pull request, edited on each later run rather than appended, so a busy
  branch doesn't collect a comment per push.
- **A commit status**: passed or failed against the run's commit, pull request or not, so a pull request shows the result in its checks
  list. Required for a branch-protection rule.

What the comment says, in this order:

1. **New failures**: failing now, passing in the last green run. This change caused them.
2. **Pre-existing failures**: already broken before this change. Separated so nobody debugs someone else's bug.
3. **Flaky**: passed only on a retry.
4. **Looks fixed**: `test.fail()` tests that passed, each with "remove `test.fail()`" and its file, since the bug they
   reproduce no longer shows.
5. **New failure clusters**: root causes never seen before in this project.
6. **Fixed by this change**: clusters this pull request closed, with how long they were open. See
   [Did the fix work?](./failure-clusters#did-the-fix-work)

Each failure carries its error, its owner and tags when the test declares them (see
[ownership metadata](/reference/test-metadata#ownership-metadata-piwi-annotations)), and, when a locator broke, the
[replacement locator](./locator-healing) captured from the last passing run. The footer reports the CI minutes the run
spent on waits and failed attempts. When the [Test Map](./scenario-gaps) has a diff to work with, the comment adds the
changed files no test reached, then **Locators this change breaks**: the locators whose label, test id, placeholder or
translation the diff removes or renames, matched against the base branch's locator index as
[Locator preflight](./preflight) does. It lists only breaks none of whose tests ran in this run (a failing one is
already listed with its failure, a passing one was updated), so it names what the run did not exercise: tests outside
the selection, on another shard set, or in a nightly suite. Each comes with its call site and, for a rename, the
rewritten locator.

## Turn it on

Turn it on in **Settings → Pull requests** (off by default). It needs:

- **`PIWI_SITE_URL`** set on the dashboard. Every link in the comment is built from it; without it nothing is posted,
  because a comment full of unreachable links is worse than no comment.
- **An SCM token with write access** to the repository, set instance-wide or per project: `repo` on GitHub, `api` on
  GitLab. [Source control](/guide/source-control) explains where to set it and what else uses it.
- **Branch and commit metadata on the run**, which the reporter [detects automatically](/guide/ci#what-gets-detected).

## Re-run from the dashboard

Once a cluster is fixed, the fastest way to prove it is to re-run exactly the affected tests, and a
[filtered run that passes them all closes the cluster](./failure-clusters#did-the-fix-work). The cluster page can
trigger that run in CI for you: **Re-run in CI**, next to *Copy retry command*, dispatches a workflow or pipeline with
the cluster's retry arguments (`file:line` specs, `--project` when they share one) and links to the run it started. The
last dispatch (when, by whom, and a link) shows under the Test evidence header.

It is **off by default** and configured per project on the project's edit page, under **CI re-run**. Turn it on and
fill in the block for your provider:

| Provider | Target you configure | Token scope |
|---|---|---|
| **GitHub** | Workflow file name (e.g. `e2e.yml`), a ref, and the `workflow_dispatch` input that receives the arguments | `actions:write` (a classic PAT's `workflow` scope) |
| **GitLab** | A ref and the pipeline variable name that receives the arguments | `api` |
| **Bitbucket** | The `custom:` pipeline name and the variable name that receives the arguments | `pipeline:write` |

The dispatch uses the project's SCM token, so that token needs the write scope above. The button is disabled with an
explanatory tooltip when the feature is off, no target is configured for the repository's provider, or no token is set.

Your workflow has to actually consume the value. A minimal GitHub example that forwards the input to Playwright:

```yaml
on:
  workflow_dispatch:
    inputs:
      args:
        description: Playwright arguments
        required: false
        default: ''
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright test ${{ inputs.args }}
```

On GitLab, read the variable in your test job (`npx playwright test $PW_ARGS`); on Bitbucket, reference it the same way
inside the `custom:` pipeline you named. GitHub's `workflow_dispatch` returns no run id, so the link goes to the
workflow's runs page filtered to the branch; GitLab and Bitbucket link straight to the pipeline.

## Limits

- Pull-request feedback posts on GitHub and GitLab. On Bitbucket the settings page saves, but nothing is posted.
- Piwi only ever edits a comment it wrote itself (identified by a hidden marker), so a human comment is never
  overwritten.
- Everything here is best-effort: the run is already stored by the time it runs, and a missing token or an unreachable
  host is logged rather than failing your pipeline.
- A comment reports; it does not block. To fail the build on a policy, use the
  [merge gate](/guide/ci#blocking-a-merge).

## Related

- [CI & sharding](/guide/ci): run the reporter in CI and gate a merge
- [Source control](/guide/source-control): the SCM token and its scopes
- [Auto-heal PRs](./auto-heal): the pull request Piwi opens itself
- [Failure clusters & the inbox](./failure-clusters): the clusters the comment and the re-run act on
