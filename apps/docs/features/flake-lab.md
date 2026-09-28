---
title: Flake Lab
description: "Make a flaky test fail on demand: piwi flake replays each suspect from the test's history next to a control run, and piwi flake verify proves the fix under the same condition."
lang: en-US
---

# Flake Lab

<Needs reporter fixtures />

A flaky test costs the most when nobody can make it fail: the fix is a guess, and "it passed ten times in a row"
proves nothing about a failure that happens one time in twenty. The [Flakiness tab](./flaky-tests#suspects) ranks
**suspects** from the test's history, such as a request that is slower when it fails. The **Flake Lab** tests them:
`piwi flake` replays each suspect as a condition on your machine or in CI, next to a control run, until the failure
reproduces. A reproduced condition proves the cause, and the same condition later proves the fix.

## Run an experiment

From the project root, name the test by its test case id (the number in its dashboard URL) or by its spec file and
line:

```bash
npx @piwitests/reporter flake 1842
npx @piwitests/reporter flake tests/checkout.spec.ts:42
```

The command reads the test's plan from the dashboard, so it needs the dashboard URL and a reporter API key (the
same `PIWI_DASHBOARD_URL` and `PIWI_API_KEY` the reporter uses, or the project's `.env`). The specs must use the
[capture fixtures](/guide/capture-fixtures), which apply the conditions inside the page.

It runs, one after the other:

1. **The control**: the test alone, 10 times, with no condition.
2. **One arm per suspect**, most likely first: the test under that suspect's condition, up to 10 times, stopping at
   3 failures with the same error as in CI.

Every run has retries off and runs the checkout you are in. Before it starts, it prints an estimate from the test's
median duration; `--budget` (15 minutes by default) stops it from starting another arm once spent.

```text
piwi flake · checkout › pays with a saved card · 12 failures in 30 days

Suspects from history                                    condition
  1  GET /api/cart slower (≥1.6 s)            7/8 failures · 3/44 passes    delay to 1.8 s
  2  admin › resets catalog alongside         5/8 failures · 4/44 passes    run together
     both write /api/products

Estimate: up to 4 min · budget 15 min
Lab · dev-laptop · HEAD 9f2c1e0 · chromium · retries off
  control                            0/10
  1  delay GET /api/cart 1.8 s       3/4    stopped at 3 · same error as in CI          reproduced
  2  run with admin › resets catalog 1/10   same error as in CI · 1 different error (counted apart)  not reproduced
Verdict: reproduced by delay GET /api/cart 1.8 s (3/4 against 0/10, p = 0.011)
Saved to the test's Flakiness tab. After your fix: npx @piwitests/reporter flake verify 1842
```

## The conditions

| Suspect | Condition | How the arm applies it |
|---|---|---|
| A slow route | delay it to the failures' median duration | the fixtures hold each response until that long after the request started |
| A failed route | fail it with the same status, or abort it | the fixtures answer with the status, or reset the connection |
| Load | throttle the CPU ×4 | a DevTools session, so Chromium only |
| Another test alongside | run both together | both tests on two workers; only rounds where they overlapped count |
| The test just before | run that test first | both tests on one worker; only rounds where it ran just before count |
| A browser | pin the Playwright project | `--project` |

`--suspect <n>` runs only suspect `n`'s arm. `--all` also runs every condition at once when none reproduces alone.

## Reading the verdict

A failure counts toward an arm only when its error matches one of the test's failures in history (the same masked
error message, so a different timeout or id still matches). A condition that breaks the test some other way, such
as a delay that trips a timeout the test never hit in CI, is shown apart and has not reproduced the flake.

| Verdict | When |
|---|---|
| **Reproduced** | at least half the arm's runs failed with a matching error, and a one-sided Fisher exact test against the control gives p < 0.05 |
| **Amplified** | p < 0.05, but under half the runs failed |
| **Not reproduced** | anything else |

An arm stops at 3 matching failures. Playwright's `--max-failures` counts every failure, so the command runs an arm
in batches of up to five repeats and cuts its count after the third matching failure: the result is the one a run
that stopped there would give. The control never stops early.

The command prints the commit it tested next to the commit of the test's latest failure, and warns when they
differ: a condition that reproduces on today's code says little about last month's failure. The control catches a
test that simply fails on this machine.

## Verify a fix

After the fix, rerun the condition that reproduced it:

```bash
npx @piwitests/reporter flake verify 1842
```

It reruns the reproducing arm and its control for enough runs that a failure at the rate it reproduced would have
shown with 95% confidence (`⌈ln 0.05 / ln(1 − rate)⌉`, at least 5), and stops at the first matching failure. With
none, the fix is **verified**. The verify experiment appears on the Flakiness tab next to the one it verifies, and the
test reads [verified fixed](./flaky-tests#verified-fixed): off the flaky ranking until it retry-passes again, and a
quarantined test is proposed for release at once.

**Exit codes:** `0` an arm reproduced the failure (`verify`: the fix held) · `1` nothing reproduced (`verify`: it
still fails, or too few runs passed to say) · `2` error. Every flag is on the [CLI reference](/reference/cli#flake).

## Where results show

- The test's **Flakiness** tab lists its experiments and each suspect's latest result ("reproduced 3/4 · 2 days
  ago"), with buttons that copy the `piwi flake` and `piwi flake verify` commands.
- The **flaky list** marks a test whose latest experiment reproduced it.
- The [clue](/reference/clues) `known-flake-suspect` turns strong on a failure showing a suspect an experiment
  reproduced.
- Over [MCP](/features/mcp), `get_flake_profile` returns the experiments, and `plan_flake_experiment` gives an agent
  the commands and arms to run itself. The `stabilize-flaky-tests` [agent skill](/features/agent-skills) follows
  this loop.

The lab's own runs are stamped as flake-lab runs: the reporter still sends them, and the dashboard keeps them out of
the flaky score, regression signals, clusters, notifications, quarantine and the suspects.

## Run it in CI

A local machine is not CI: a delay reproduces a race anywhere, but load and interference depend on the machine. To
run the lab where the flake lives, add a manual workflow and start it with the test case id. It is not run on every
push, since it spends minutes:

```yaml
# .github/workflows/flake-lab.yml
name: Flake Lab
on:
  workflow_dispatch:
    inputs:
      test:
        description: Test case id, or file:line
        required: true
jobs:
  flake:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx @piwitests/reporter flake "${{ inputs.test }}"
        env:
          PIWI_DASHBOARD_URL: ${{ vars.PIWI_DASHBOARD_URL }}
          PIWI_API_KEY: ${{ secrets.PIWI_API_KEY }}
```

The experiment is recorded with the source `ci`. Exit code 1 (nothing reproduced) fails the job; add
`continue-on-error: true` to the step when you only want the result on the tab.

## Without the dashboard

`--no-upload` keeps the results off the dashboard, but the plan still comes from it. When the dashboard cannot be
reached, pass a plan saved earlier with `--plan <file>`: the response of the plan endpoint, or the `plan` the
`plan_flake_experiment` MCP tool returns. The verdict is computed locally the same way.

## Limits

- The lab runs where tests run: your machine or a CI job. The dashboard only plans and records.
- `cpu` needs Chromium; on another browser the arm reports the condition as skipped.
- A failure that depends on another team's run on a shared environment has no condition; it stays context on the
  Flakiness tab.
- Order across whole files is not controlled: an `after` arm counts only the rounds Playwright happened to run in
  the order it asked for.

## Related

- [Flaky tests & quarantine](./flaky-tests): the flaky score and the suspects the lab tests
- [Piwi CLI](/reference/cli#flake): every flag of `piwi flake`
- [Clue rules](/reference/clues): `known-flake-suspect`
- [Agent skills](./agent-skills): `stabilize-flaky-tests`
