---
title: CI & sharding
lang: en-US
---

# CI & sharding

CI is where Piwi earns its keep — it's the place your results were disappearing from. There is no
Piwi-specific step to add: the reporter runs inside `npx playwright test` and pushes results as they
happen. In practice you set two environment variables.

```yaml
env:
  PIWI_DASHBOARD_URL: https://piwi.example.com
  PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}   # only if authentication is enabled
```

Everything else — branch, commit, author, workflow, build URL, shard index — is
[detected automatically](#what-gets-detected).

## GitHub Actions

```yaml
name: e2e
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
        env:
          PIWI_DASHBOARD_URL: https://piwi.example.com
          PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}
```

`actions/checkout` fetches a shallow clone by default. That's fine for the commit metadata Piwi
records, but [AI diagnosis](/features/ai-diagnosis) reads the diff since the last green run from your git host
over the API, not from the checkout — so no `fetch-depth` change is required.

## GitLab CI

```yaml
e2e:
  image: mcr.microsoft.com/playwright:v1.61.1-noble   # at or above the reporter's peer range
  script:
    - npm ci
    - npx playwright test
  variables:
    PIWI_DASHBOARD_URL: https://piwi.example.com
    PIWI_API_KEY: $PIWI_API_KEY
```

## Other systems

Jenkins, CircleCI, Azure DevOps, Travis, Buildkite, TeamCity, Bitbucket, Semaphore, AppVeyor and Drone
are recognized too — set the same two variables however your system exposes them. Nothing about the
reporter is platform-specific; unrecognized CI just means less auto-filled metadata.

## What gets detected

Without any configuration, the reporter records:

- **Source control** — commit SHA, message, author, branch, pull-request number, the pull request's
  target branch, and the repository URL.
  The branch is resolved through a fallback chain so a CI pull-request build never records the literal
  `HEAD` git reports on a detached checkout: an explicit `PIWI_BRANCH` override, then the CI provider's
  branch variables (`GITHUB_HEAD_REF`/`GITHUB_REF_NAME`, `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`/
  `CI_COMMIT_REF_NAME`, `CIRCLE_BRANCH`, and the equivalents for Travis, Azure, Jenkins and Bitbucket),
  then the local git checkout. On a pull-request build the target branch (`GITHUB_BASE_REF`,
  `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, `SYSTEM_PULLREQUEST_TARGETBRANCH`,
  `BITBUCKET_PR_DESTINATION_BRANCH`, `CHANGE_TARGET`, or `PIWI_BASE_BRANCH` to name it yourself) is
  recorded as the run's **base branch**, which [baselines](/guide/concepts#baseline-last-green-run) fall
  back to when the branch has no history of its own.
- **CI** — provider, workflow/job name, build number, and a link back to the CI build, from the
  provider's environment variables.
- **Environment** — Node, Playwright and OS versions, plus each test's browser and viewport.
- **Shard index** — from Playwright's own `--shard` config.

Turn off either collector with `collectScmInfo: false` / `collectCiInfo: false` if you'd rather not
store it. Set `PIWI_BRANCH` (and `PIWI_BASE_BRANCH`) to override the resolved branches for a CI setup
the chain does not cover.

## Sharding

Playwright's `--shard=1/3` splits a suite across parallel jobs. Piwi merges them back into **one run**
— you shouldn't have to think about shards when reading results.

```yaml
strategy:
  matrix:
    shard: [1, 2, 3]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/3
    env:
      PIWI_DASHBOARD_URL: https://piwi.example.com
      PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}
```

How the merge works:

1. Each shard derives a **run label** — a stable identifier for the CI pipeline — from environment
   variables (`GITHUB_RUN_ID`, `CI_PIPELINE_ID`, `CIRCLE_WORKFLOW_ID`, `TRAVIS_BUILD_ID`,
   `BUILD_BUILDID`, `BUILD_ID`, `BUILDKITE_BUILD_ID`, `TEAMCITY_BUILD_ID`, `BITBUCKET_BUILD_NUMBER`,
   `SEMAPHORE_WORKFLOW_ID`, `APPVEYOR_BUILD_ID`, `DRONE_BUILD_NUMBER`).
2. Shards sharing a run label **and** a `projectName` resolve to the same run.
3. Each shard streams independently; the run stays `running` until the **last** shard calls finish.
4. Counters accumulate across shards. The run is `failed` if any shard reported a failure.
5. The run detail page shows a shard progress badge (`2/3`) while shards are still arriving.

**All shards must use the same `projectName`.** That's the one requirement.

If your CI isn't detected, set the label yourself to anything common to all shards:

```typescript
['@piwitests/reporter', {
  serverUrl: 'https://piwi.example.com',
  projectName: 'my-project',
  runLabel: process.env.BUILD_TAG || 'my-custom-label',
}]
```

Both the streaming and the batch (`submit` / `upload`) paths support sharding.

## Watching a run while CI is still going

Streaming is on by default: the run appears in the dashboard when the suite starts and fills in test by
test, with traces and attachments uploaded per test as they finish. You can open a failure and start
reading the trace before the pipeline is done. See [Reporter → Live streaming](./reporter#live-streaming)
to tune batch size or turn it off.

## Getting the run URL back out of CI

After results land, the reporter surfaces the dashboard run URL wherever a pipeline can pick it up, so
a later step (a Slack post, a deploy gate, a PR comment) doesn't have to scrape stdout. All of it is
best-effort — a failure in any channel is logged and never fails your run.

**Always** — one line per failed test, printed the moment its final attempt fails, then a
`View run: <url>` line once the run lands:

```
[Piwi Dashboard] ✗ applies the discount code — getByRole('button', { name: 'Pay' }) never became enabled — click timed out after 30 s → https://piwi.example.com/test-runs/42/locate?file=tests%2Fcheckout.spec.ts&title=applies%20the%20discount%20code&retry=1&browser=chromium
[Piwi Dashboard] View run: https://piwi.example.com/test-runs/42
```

The part between the title and the link is the failure **headline** — the one-line explanation the dashboard builds from the Playwright error (see [Failure evidence](/features/evidence#one-execution-diagnosis-first)). The GitHub job summary lists the same headline next to each failed test.

The per-test link resolves to the failing execution's page (`/test-run-cases/:id`) and works in
streaming and batch mode alike — it is built from what the reporter knows at that moment (run id,
spec file, title, retry and Playwright project), so it prints while the run is still going. A link to a
test the dashboard cannot find (results pruned by retention, an upload that never landed) renders a
readable "not found" page instead of an error.

**GitHub Actions (automatic)** — step outputs, a job summary listing the failed tests with their links
(20 at most, the rest counted as "+N more"), and a `::notice::` annotation:

```yaml
- run: npx playwright test
  id: e2e
  env:
    PIWI_DASHBOARD_URL: https://piwi.example.com
- run: echo "Results: ${{ steps.e2e.outputs.piwi_run_url }}"
  if: always()
```

Available outputs: `piwi_run_url`, `piwi_run_id`, `piwi_run_status`, `piwi_failed_count`, `piwi_project_id`.

**GitLab CI (automatic)** — a dotenv report (`piwi.env` by default, override with `PIWI_DOTENV_FILE`)
carrying `PIWI_RUN_URL`, `PIWI_RUN_ID`, `PIWI_RUN_STATUS`, `PIWI_FAILED_COUNT`, `PIWI_PROJECT_ID` and
`PIWI_CI_BUILD_URL`.
Declare it so later jobs inherit the variables:

```yaml
e2e:
  script:
    - npx playwright test
  artifacts:
    reports:
      dotenv: piwi.env
```

**Any other system** — set `outputFile` (or `PIWI_OUTPUT_FILE`) and read the JSON:

```yaml
- run: npx playwright test
  env:
    PIWI_OUTPUT_FILE: piwi-run.json
- run: cat piwi-run.json   # { runUrl, runId, projectId, projectName, status, ciBuildUrl, failedCount, failures }
```

`failures` lists every test whose final attempt failed as `{ title, file, retry, browser, url }`, with
`url` the same per-test link the log prints.

## Pull-request feedback

The run URL above is a link somebody has to click. Piwi can instead post the result onto the pull request itself, which
is where the person who broke the test already is.

Turn it on in **Settings → Pull requests** (off by default). Two things get posted when a run finishes on a branch with
an open pull request:

- **A summary comment** — one comment per pull request, edited on each later run rather than appended, so a busy branch
  doesn't collect a comment per push.
- **A commit status** — passed/failed against the run's commit, so the pull request shows the result in its checks list.
  Required for a branch-protection rule.

What the comment says, in this order:

1. **New failures** — failing now, passing in the last green run. This change caused them.
2. **Pre-existing failures** — already broken before this change. Separated so nobody debugs someone else's bug.
3. **Flaky** — passed only on a retry.
4. **New failure clusters** — root causes never seen before in this project.
5. **Fixed by this change** — clusters this pull request closed, with how long they were open. See
   [Did the fix work?](/features/ai-diagnosis#did-the-fix-work)

Each failure carries its error, its owner and tags when the test declares them (see
[ownership metadata](./reporter#ownership-metadata-piwi-annotations)), and — when a locator broke — the
[replacement locator](/features/locator-healing) captured from the last passing run. The footer reports the CI minutes
the run spent on waits and failed attempts.

### What it needs

- **`PIWI_SITE_URL`** set on the dashboard. Every link in the comment is built from it; without it nothing is posted,
  because a comment full of unreachable links is worse than no comment.
- **An SCM token with write access** to the repository — set globally, or per project on the project's edit page. The
  same token the [AI diagnosis](/features/ai-diagnosis) SCM integration uses, but it now needs write scope: `repo` on GitHub,
  `api` on GitLab.
- **Branch and commit metadata on the run**, which the reporter [detects automatically](#what-gets-detected).

GitHub and GitLab are supported. On Bitbucket the settings page still saves, but nothing is posted — the provider has no
implementation yet.

Piwi only ever edits a comment it wrote itself (identified by a hidden marker), so a human comment is never overwritten.
Everything here is best-effort: the run is already stored by the time it runs, and a missing token or an unreachable
host is logged rather than failing your pipeline.

## Re-run from the dashboard

Once a cluster is fixed, the fastest way to prove it is to re-run exactly the affected tests — and a
[filtered run that passes them all now closes the cluster](/features/ai-diagnosis#did-the-fix-work). The cluster page can
trigger that run in CI for you: **Re-run in CI**, next to *Copy retry command*, dispatches a workflow / pipeline with
the cluster's retry arguments (`file:line` specs, `--project` when they share one) and links to the run it started. The
last dispatch — when, by whom, and a link — shows under the Test evidence header.

It is **off by default** and configured per project on the project's edit page, under **CI re-run**. Turn it on and
fill in the block for your provider:

| Provider | Target you configure | How it is dispatched | Token scope |
|---|---|---|---|
| **GitHub** | Workflow file name (e.g. `e2e.yml`), a ref, and the `workflow_dispatch` input that receives the arguments | `POST /actions/workflows/{workflow}/dispatches` with `ref` + `inputs` | `actions:write` (a classic PAT's `workflow` scope) |
| **GitLab** | A ref and the pipeline variable name that receives the arguments | `POST /projects/{id}/pipeline` with `ref` + `variables` | `api` |
| **Bitbucket** | The `custom:` pipeline name and the variable name that receives the arguments | `POST /pipelines/` with a custom pipeline target + `variables` | `pipeline:write` |

The dispatch uses the project's [SCM token](#what-it-needs) (the same one PR feedback and auto-heal use), so that token
needs the write scope above — broader than the read-only token diagnosis needs. The button is disabled with an
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

## Blocking a merge

`npx playwright test` exits non-zero when anything failed. That is the only question it can answer. A merge policy
usually asks harder ones — *did this change break something that was working*, *did a critical test fail*, *did a new
failure cause appear* — and those need the run history, so the dashboard evaluates them.

```yaml
- run: npx playwright test
  env:
    PIWI_DASHBOARD_URL: https://piwi.example.com
    PIWI_OUTPUT_FILE: piwi-run.json      # records which run to gate on

- run: npx @piwitests/reporter gate --require-tag @critical --max-new-regressions 0
  if: always()
  env:
    PIWI_DASHBOARD_URL: https://piwi.example.com
    PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}
```

The command reads the run id from `PIWI_OUTPUT_FILE` (or `--run-id`, or `./piwi-run.json`), asks the dashboard to
evaluate the policy, prints every violation, and exits.

| Rule | Fails the build when |
|---|---|
| `--require-tag <tags>` | Any test carrying one of these tags failed |
| `--max-failed <n>` | More than `n` tests failed |
| `--max-new-regressions <n>` | More than `n` tests newly started failing versus the last green run |
| `--max-new-flaky <n>` | More than `n` tests newly started passing only on retry |
| `--max-quarantined <n>` | More than `n` tests are [quarantined](/features/flaky-tests#quarantine-with-a-way-out) — a ceiling on quarantine debt |
| `--fail-on-new-cluster` | This run introduced a failure cluster never seen before |
| `--fail-on-flaky` | This run contains any flaky test (passed only after a retry) — stricter than `--max-new-flaky`, which only counts tests *newly* flaky |

At least one rule is required — an empty policy is rejected rather than passing. Exit codes are part of the contract:
**0** satisfied, **1** violated, **2** could not evaluate. A gate that cannot run never reports success, so a
misconfigured pipeline fails loudly instead of waving every merge through.

Three behaviors worth knowing:

- **A quarantined test's failure does not count**, but the gate always reports how many it excluded — a green gate that
  silently ignored failures would be worthless.

- **A test that failed and then passed on retry satisfies `--require-tag`.** Flakiness is what `--max-new-flaky` is
  for; treating a recovered test as a failure would make the rule unsatisfiable on any suite with retries.
- **A required tag that matches no test in the run is a violation.** A misspelled `--require-tag @critcal` would
  otherwise pass silently, which is the worst outcome for a rule meant to block merges.

`npx @piwitests/reporter gate --help` lists every option. Add `--json` to get the raw result for a pipeline to parse. (Invoking through the package name keeps npx on this package; a plain `npx piwi gate` also works wherever the reporter is already a dependency, as it is in any job that ran the tests.)

## Notifying people instead

If all you want is "tell the team when main goes red", you don't need any of the above — configure a
[notification subscription](/features/notifications) on the dashboard side and let it push to Slack, email, or
a webhook. That keeps the alerting rules in one place instead of in every pipeline.

## Troubleshooting

**Results don't appear.** Check the CI log for the reporter's own output; run with `PIWI_VERBOSE=true`
for the full request trace. The usual causes are an unreachable `PIWI_DASHBOARD_URL` from the runner's
network, or a missing API key against an instance with authentication enabled.

**Shards create several runs instead of one.** The run label wasn't detected, or the shards disagree on
`projectName`. Set `runLabel` explicitly.

**Traces are missing.** Traces have to be recorded before they can be uploaded — set
`use: { trace: 'retain-on-failure' }` (or `'on-first-retry'`) in your Playwright config.

**Screenshots are missing.** Same cause: Playwright's `screenshot` option defaults to `'off'`, so
nothing is recorded for the reporter to upload. Set `use: { screenshot: 'only-on-failure' }` (or
`'on'`) in your Playwright config; the reporter needs no option of its own.

**A run is stuck as `interrupted`.** A live reporter heartbeats every ~15s; when a run goes quiet for
two minutes — a cancelled job, an OOM-killed runner, a dropped network — the server marks it
`interrupted` rather than leaving it `running` forever. If the reporter comes back (a long test, a
transient blip) the next event revives the run automatically, so `interrupted` is only final when the
job really died. Those runs are excluded by the **full runs only** filter in
[Analytics](/features/analytics#scope).

## See also

- [Reporter](./reporter) — every option, streaming, and locator healing
- [Authentication](/operate/authentication) — creating the API key CI uses
- [Concepts → Test run](./concepts#test-run) — why shards are one run
- [Notifications](/features/notifications) — alerting without touching the pipeline
- [Test tags & ownership](./reporter#test-tags) — what `--require-tag` matches on
