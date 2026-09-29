---
title: CI & sharding
description: "Run the reporter in CI: GitHub Actions, GitLab and others, shards merged into one run, the run URL for later steps and the merge gate."
lang: en-US
---

# CI & sharding

There is no Piwi-specific step to add to CI: the reporter runs inside `npx playwright test` and pushes results as they
happen. You set two environment variables.

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

`actions/checkout` fetches a shallow clone by default. That's fine: Piwi reads diffs from your Git host's API
([Source control](./source-control)), not from the checkout, so no `fetch-depth` change is required.

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

- **Source control**: commit SHA, message, author, branch, pull-request number, the pull request's target branch,
  and the repository URL. On a pull-request build the target branch is recorded as the run's **base branch**, which
  [baselines](/guide/concepts#baseline-last-green-run) fall back to when the branch has no history of its own.
- **CI**: provider, workflow or job name, build number, and a link back to the CI build.
- **Environment**: Node, Playwright and OS versions, plus each test's browser and viewport.
- **Shard index**: from Playwright's own `--shard` config.

[Test metadata](/reference/test-metadata#scm-information-git) lists the variables each field comes from. Set
`PIWI_BRANCH` (and `PIWI_BASE_BRANCH`) to override the resolved branches for a CI setup the detection does not cover,
or turn a collector off with `collectScmInfo: false` or `collectCiInfo: false`.

## Sharding

Playwright's `--shard=1/3` splits a suite across parallel jobs. Piwi merges them back into **one run**.

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

1. Each shard derives a **run label**, a stable identifier for the CI pipeline, from the provider's build id
   (`GITHUB_RUN_ID`, `CI_PIPELINE_ID`, `CIRCLE_WORKFLOW_ID` and their equivalents on the systems listed above).
2. Shards sharing a run label **and** a `projectName` resolve to the same run.
3. Each shard streams independently; the run stays `running` until the **last** shard calls finish.
4. Counters accumulate across shards. The run is `failed` if any shard reported a failure, and the run page shows a
   shard progress badge (`2/3`) while shards are still arriving.

**All shards must use the same `projectName`.** That's the one requirement.

Jobs sharded with `piwi run --shard` merge the same way ([details](/features/test-selection#print-shard-and-reorder)).

If your CI isn't detected, set the label yourself to anything common to all shards:

```typescript
['@piwitests/reporter', {
  serverUrl: 'https://piwi.example.com',
  projectName: 'my-project',
  runLabel: process.env.BUILD_TAG || 'my-custom-label',
}]
```

## Watching a run while CI is still going

Streaming is on by default: the run appears when the suite starts and fills in test by test, so you can read a
failure's trace before the pipeline is done. See [Reporter → Live streaming](./reporter#live-streaming).

## Getting the run URL back out of CI

The reporter surfaces the run URL wherever a later pipeline step can pick it up. All of it is best-effort: a
failure in any channel is logged and never fails your run.

**Always** — one line per failed test, printed the moment its final attempt fails, then a
`View run: <url>` line once the run lands:

```
[Piwi Dashboard] ✗ applies the discount code — getByRole('button', { name: 'Pay' }) never became enabled — click timed out after 30 s → https://piwi.example.com/test-runs/42/locate?file=tests%2Fcheckout.spec.ts&title=applies%20the%20discount%20code&retry=1&browser=chromium
[Piwi Dashboard] View run: https://piwi.example.com/test-runs/42
```

Between the title and the link is the failure **headline**, the one-line explanation the dashboard builds from the
Playwright error (see [Your first failure](./first-failure)). The per-test link opens the failing execution's page,
even while the run is still going.

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

Piwi can post the result on the pull request instead: a summary comment that separates new failures from pre-existing
ones, and a commit status. A failure cluster can also re-run its tests in CI from the dashboard. Both are described on
[Pull-request feedback & re-run](/features/pr-feedback).

## Blocking a merge

`npx playwright test` exits non-zero when anything failed. A merge policy usually asks harder questions (*did this
change break something that was working*, *did a critical test fail*), and those need the run history, so the
dashboard evaluates them.

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

- **A quarantined test's failure does not count**, but the gate always reports how many it excluded.

- **A test that failed and then passed on retry satisfies `--require-tag`.** Flakiness is what `--max-new-flaky` is
  for.
- **A required tag that matches no test in the run is a violation**, so a misspelled tag cannot pass silently.

`npx @piwitests/reporter gate --help` lists every option; `--json` prints the raw result for a pipeline to parse.

## Notifying people instead

To tell the team when main goes red, configure a [notification subscription](/features/notifications) on the
dashboard instead: the alerting rules stay in one place rather than in every pipeline.

## Troubleshooting

**Results don't appear.** Check the CI log for the reporter's own output; run with `PIWI_VERBOSE=true`
for the full request trace. The usual causes are an unreachable `PIWI_DASHBOARD_URL` from the runner's
network, or a missing API key against an instance with authentication enabled.

**Shards create several runs instead of one.** The run label wasn't detected, or the shards disagree on
`projectName`. Set `runLabel` explicitly.

**Traces or screenshots are missing.** Playwright records neither by default, so there is nothing to upload. Set
`use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }` in your Playwright config, or install through
[`wrapConfig`](./reporter#installing-via-wrapconfig), which sets both when they are unset.

**A run is stuck as `interrupted`.** When a run sends nothing for two minutes (a cancelled job, a killed runner,
a dropped network), the server marks it `interrupted`. If the reporter comes back, the next event revives the run, so
`interrupted` is only final when the job really died. Those runs are excluded by the **full runs only** filter in
[Analytics](/features/analytics#scope).

## Related

- [Reporter](./reporter): setup, streaming and authentication
- [Pull-request feedback & re-run](/features/pr-feedback): the result on the pull request
- [Test tags](/reference/test-metadata#test-tags): what `--require-tag` matches on
- [API keys](/operate/api-keys): the key CI uses
