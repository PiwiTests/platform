# Flake Lab

A plan to make a flaky test fail on demand. Piwi explains a flaky test today by reading its evidence: the Attempts tab
lists what differed between a failing and a passing attempt, and a classifier names one of five causes. Flake Lab adds
the two steps that are missing: **suspects** ranked from the test's whole history (the requests that are slow when it
fails, the tests running beside it, the load on the machine), and a **lab** that replays each suspect as a condition,
next to a control, until the failure reproduces or the budget runs out. A reproduced condition proves the cause, and
the same condition later proves the fix.

**Status.** Proposed 2026-09-27. **PR 1 built 2026-09-28**: the five defects are fixed, the capture fixtures record
failed requests (`requestfailed`, status 0, `failure`), `network_requests` has a `failure` column, and the Attempts diff
compares request durations. **PR 2 built 2026-09-28**: `buildFlakeProfile` and its endpoint, the Flakiness tab,
the flaky list's top suspect, the Attempts links, `get_flake_profile`, the weak `known-flake-suspect` clue and the
`flake-lab` capability. **PR 3 built 2026-09-28**: the flake plan and verdict modules in core, `extractErrorSignature`
and `requestRouteKey` moved to core, flake mode in the reporter, the generalized interception, and the server's
isolation of flake-lab runs. **PR 4 built 2026-09-28**: `piwi flake` and `piwi flake verify`, the
`flake_experiments` and `flake_arms` tables, the plan, results and experiments endpoints, experiments on the
Flakiness tab, the reproduced badge, the strong clue, `plan_flake_experiment`, the skill and a seeded demo experiment.
**PR 5 built 2026-09-28**: `desktop_flake_lab_here` and Reproduce this flake, the flake-aware bisect and
`piwi flake verify --bisect`. **PR 6 built 2026-09-28**: verified fixed on the Flakiness tab and the flaky list,
off the ranking until the next retry-pass, and the quarantine release proposal. What changed while building PR 1:

- The server's filter did **not** keep status 0: it kept status ≥ 400 plus the 50 slowest others, so a quick reset
  could be dropped. It now keeps every request with status ≥ 400, status ≤ 0 or a `failure`.
- The wire had no network-request type (`networkRequests` was `unknown` on both sides). `WireNetworkRequest` in
  `@piwitests/core/wire` now names every field, `failure` included; the 1.0 entry is D24 in
  [`1.0-stabilization.md`](1.0-stabilization.md).
- A failed request's `duration` runs to the moment the failure was seen, since it has no response end.
- The classifier's browser distribution became `{ passed, failed }` per project. Environment now needs one browser
  with at least 3 failures and another with at least 3 passes and none. Its input is the test's last 100 attempts
  (passed or failed) from any non-probe run; the evidence texts still come from the failed ones.
- The same `'timedOut'` comparison against stored rows also sat in the AI context's recurrence section
  (`ai-context.ts`) and the trace-import roll-up (`import-runs.ts`); both are fixed.
- The failed-request clue and the network tab name the failure ("GET /api/cart failed with
  net::ERR_CONNECTION_RESET"), and the Attempts diff shows it on a request that failed on one side only.
- A slower request in the Attempts diff is a symmetric `network` row (no `only`), so it does not count as a failed
  request in the classifier's attempt-diff vote. Its link to the matching suspect waits for PR 2, which adds suspects;
  the row's key is the diff's own (method and URL without the query), not yet `normalizeRoute`.

What changed while building PR 2:

- A slow route is a suspect only for a route the passes call too: a route called on failures alone is a different
  path, not a slower one. Thresholds maximize the share of failures at or above them minus the share of passes, the
  lowest value on a tie; a label rounds its threshold down (1792 ms is "≥1.7 s").
- Load counts the overlapping executions on the attempt's own shard: other shards run on other machines.
- Shared write routes match by path across write methods, so a `PUT` and a `POST` to `/api/products` count, and come
  from the stored requests (status ≥ 400, failed, or the 50 slowest), so a fast write can be missing.
- The flaky list reads the top suspects from a second endpoint, `GET /api/projects/:id/flake-suspects`, after the list
  loads, so the list never waits on up to 50 profiles; each is read in a summary view without shared routes or other
  runs.
- The Attempts diff keys every request by the route key (method and `normalizeRoute` path, `GET /api/cart/:id`) and
  shows it in the row; a failed request's row keeps the full URL as its detail. A slower row links to the matching
  `slow-route` suspect, a request that failed on the failing attempt only to the `failed-route` one.
- The clue fires when the failing execution is among a suspect's supporting failures, highest ranked first; its detail
  gives this failure's own duration for a slow route. It is skipped when the project or instance declines `flake-lab`,
  read from the stored decisions alone since the capability is passive. Before loading a profile it counts the
  window's failures and passes (`mayHaveFlakeSuspects`): fewer than 3 failures or no pass cannot name a suspect, so
  the AI diagnosis, which reads the clues of every candidate cluster, pays one count for most tests.
- The Flakiness tab shows for a test with a retry-pass on record (`flakyRuns > 0`). The capability reads active once
  a project has a retry-pass.
- The hour of day is compared in six-hour UTC blocks. The demo seed collapses retries into one row, so a post-pass
  gives the checkout project's flaky test a failed-attempt row per flaky run (at least seven) with a slow cart, and the
  seed's regression signals walk only each run's final attempt.

What changed while building PR 3:

- The plan carries `version: 1`, and `experimentId` and `arm.id` are strings. A `fail` condition takes `match` like
  `delay`; both default to `all`. `alongside` and `after` name the other test by `{ file, title, suite }`, since the
  arm runs from a checkout that has no test case ids; the plan endpoint (PR 4) resolves the profile's
  `testCaseId` to it.
- The signature the lab compares is the masked message head (`flakeErrorSignature`, the `normalizedMessage` of
  `extractErrorSignature`), not the first line: two assertions on different locators share a first line.
- A route condition matches a request when `requestRouteKey(method, url)` equals its route, the key the profile
  names suspects by. The probes keep their pattern match (`:id` matches one segment).
- The results line carries more than the plan listed: `version`, `experimentId`, `role` (`target` or
  `companion`), `file`, `title`, `project`, `browserName`, `matchesHistory`, `parallelIndex`, `repeatEachIndex`,
  `retry` and one outcome per condition (`applied`, `not-matched`, `skipped` with a note, `by-command`). A
  companion line is written for an `alongside` or `after` test, so the lab reads the overlap and the order it got;
  other tests in the run write nothing. `startedAt` and `duration` span the capture fixture around the test.
- Probe mode and flake mode never mix: setting both stops the run in the config wrapper and fails each test in the
  fixtures. A plan that cannot be read or parsed fails the tests with the reason; the run is still stamped.
- The conditions go on the target's first page, and the page-creating paths (`browser.newPage`,
  `context.newPage`, the `page` fixture) wait for the install, so a CDP condition is on before the first
  navigation. Probe interception still installs without waiting.
- The target's page is routed in every arm, the control and arms without a route condition included. Routing turns
  off the HTTP cache and sends every request through Playwright, so an arm that routed while its control did not
  would differ from it by more than its conditions (D5).
- The probes' `slow` fault is the shared `delay` action, held until 5 s after the request started rather than 5 s
  after the response arrived.
- On the server, `isLabRun` / `notLabRun` exclude probe and flake-lab runs together, and every former probe check
  uses them. Quarantine streaks and the regression baseline read every run, probe runs included; both now exclude
  lab runs, so probe runs leave them too.
- Only Chromium is installed where PR 3 was built, so the skip of `cpu` and `network` on another browser is covered
  by a unit test with a Firefox page, not a Firefox run.

What changed while building PR 4:

- **Early stop without `--max-failures`.** Playwright's flag counts every failure, so an arm runs in batches of up to
  5 repeats (`--repeat-each`), and its attempts are read in start order and cut after the 3rd matching failure. The
  count equals a run that stopped there whatever the batch size; a batch may run a few attempts past the stop. The
  control runs in one batch and never stops early; a verify arm stops at its first matching failure.
- Every arm runs one test at a time (`--workers=1`), as the control does, except `alongside` (`--workers=2`, plus
  `--fully-parallel` when both tests share a file). An `after` round counts when the attempt started just before it
  was the other test's, judged within one batch: Playwright interleaves the two files per repeat, so most rounds
  qualify. `-g` is each test's describe path and title, anchored after a space and before the tags.
- `--project` names the Piwi project (for a `file:line` test), as in `probe` and `preflight`; the Playwright project
  comes from the plan (the project of most of the test's failures) or a `project` condition. `file:line` resolves
  through a fifth endpoint, `GET /api/projects/:id/flake-lab/test`.
- `--no-upload` still fetches the plan (without recording an experiment). When the dashboard cannot be reached, it
  exits 2 and says to pass `--plan <file>`, a saved plan response or the `plan` of `plan_flake_experiment`.
- A verify plan reruns the reproducing arm of the latest reproduced experiment for `flakeVerifyRuns(rate)` runs.
  Its verdict is `verified`, `still-fails` (a matching failure) or `inconclusive` (too few clean runs), and it
  stores `verifies_arm_id`. The plan's commit columns are `commit_sha` and `failure_commit_sha`, since `COMMIT` is an
  SQL keyword.
- `--all` adds a `combined` arm: every page condition (one per route and kind), the first `alongside`/`after` and
  the first `project`.
- Playwright's output goes to a log file in the session's temporary folder, and its tail is printed when an arm
  records no attempt of the test (the usual cause: specs without the capture fixtures).
- The session estimate and batch size live in core (`estimateFlakeSessionMs`), shared by the CLI and
  `plan_flake_experiment`; the Playwright spawn and the connection lookup are shared with `probe` and `preflight`.
- The flaky list reads the badge from the same `flake-suspects` call as the top suspect (a `lab` field), and the
  experiments list shows finished experiments only.

What changed while building PR 5:

- The shell reads the test's project and the commit of its latest failure from the flake plan (`record=false`), so
  the webview passes the test case id and the options only. A test whose latest failure has no commit cannot be run
  here; the command says to run `piwi flake` in the checkout instead.
- A flake-aware bisect step needed a CLI answer, not a new command: `piwi flake verify <test> --bisect` runs the
  reproducing arm alone (no control), saves nothing, and exits 0, 1 or 125 as `git bisect run` expects, so the same
  step works from a terminal. A step that exits 2 (the dashboard could not be read) stops the bisect.
- The `piwi` command comes from the linked folder first, since an older commit's reporter may not have `flake`; the
  test, its fixtures and Playwright come from the worktree. A commit whose fixtures predate flake mode records no
  attempt, which a bisect step skips.
- `--source desktop` records the experiment as run from the app; the shell passes its own URL and token in
  `PIWI_DASHBOARD_URL` and `PIWI_API_KEY`, which win over a `.env` in the worktree.
- The desktop guard refused the `piwi` commands' `X-API-Key` header (they got a 401 against the app); it reads it
  like the bearer token.
- The browser is not installed ahead of the lab, as it is for Reproduce here: the plan names the Playwright project,
  not the browser, and Playwright's own message names a missing one in the output.
- The lab's worktree is `<project>/flake-<sha>`, apart from a reproduction's of the same commit.

What changed while building PR 6:

- "After" the verification is by time: a retry-pass counts in a run that started after the verify experiment
  finished (`test_runs.start_time` against `flake_experiments.finished_at`, compared in code so SQLite and
  PostgreSQL agree). A commit cannot order runs without the repository's history, and runs on a branch without the
  fix keep flaking after it is verified elsewhere: those bring the test back, which is the honest reading until the
  fix lands. Retry-passes are read from every branch and environment, not only the ones the list shows.
- A later `still-fails` verify or `reproduced` reproduce takes the mark off; an `inconclusive` verify neither sets
  nor clears it.
- A verified test leaves `getProjectFlakyTests` itself, so every reader agrees without a filter of its own; the
  Failures tab's endpoint returns it apart, in `verifiedFixed`. Scheduled reports read the analytics leaderboard,
  which agrees. Notifications (their digests batch the same run events) and the gate read per-run flaky counts,
  where a retry-pass is what brings a test back anyway; the flaky debt chart counts past retry-passes and is
  unchanged.
- In quarantine, only a fix verified after the test was quarantined proposes release (`releaseReason:
  'verified-fix'`); no auto-release rule exists, so release stays a person's click.
- The demo seed is unchanged: its one reproduced test is the flaky list's showcase (top suspect, Reproduced badge),
  and a verified fix would take it off the ranking there.

The suspects are computed from data Piwi already stores. The lab adds a CLI command, a reporter mode like probe mode,
two tables, a desktop command and MCP tools. New wire fields, the plan file format, the command and the endpoints
freeze at 1.0 (D24 in [`1.0-stabilization.md`](1.0-stabilization.md)).

**Summary.** A flaky test costs the most when nobody can make it fail: the fix is a guess, and "it passed ten times in a
row" proves nothing about a failure that happens one time in twenty. Piwi keeps what a lab needs. Every attempt is its
own execution row with its start time, duration, worker and shard; every request the page made has its start time and
duration, on passing attempts as well as failing ones; every test of the same run, across shards, is in the same run.
From that history, Flake Lab ranks suspects with counts a reader can check ("GET /api/cart took over 1.6 s in 7 of 8
failures and in 3 of 44 passes"; "`admin › resets catalog` was running during 5 of 8 failures and 4 of 44 passes, and
both write `/api/products`"). Each suspect maps to a condition the capture fixtures can apply: delay one route's
responses, fail them, throttle the CPU, or run the other test alongside. `piwi flake` runs a control arm and one arm
per condition on the developer's machine or in CI, with retries off and early stopping, and counts only failures with
the same error signature as the ones in CI. The verdict, "reproduced by delaying GET /api/cart to 1.8 s: 3 of 4
against 0 of 10", is stored on the test. After a fix, `piwi flake verify` reruns the reproducing arm, and a pass there
is the verification the flaky list, quarantine, the desktop app's bisect and the `stabilize-flaky-tests` skill have
been missing.

## What the reader gets

```
$ npx @piwitests/reporter flake 1842
piwi flake · checkout › pays with a saved card · 12 failures in 30 days · flaky score 41

Suspects from history                                                          condition
  1  GET /api/cart is slower when it fails   >1.6 s in 7/8 failures · 3/44 passes   delay to 1.8 s
  2  admin › resets catalog runs alongside   5/8 failures · 4/44 passes             run together
                                             both write /api/products
  3  many tests running at once              ≥6 running in 6/8 failures · 11/44     CPU ×4

Lab · this machine · HEAD 9f2c1e0 · chromium · retries off
  control                          0/10
  1  delay GET /api/cart 1.8 s     3/4    stopped at 3 · same error as in CI   reproduced
  2  run with admin › resets…      1/10   different error (counted apart)      not reproduced
Verdict: reproduced by delaying GET /api/cart to 1.8 s (3/4 against 0/10, p = 0.011)
Saved to the test's Flakiness tab. After your fix: npx @piwitests/reporter flake verify 1842
```

```
Test case · checkout › pays with a saved card                    Flaky · score 41 · reproduced
[ Overview ]  Trend  [ Flakiness ]
  Suspects                         failures   passes   condition
    GET /api/cart slower (>1.6 s)     7/8      3/44     delay 1.8 s     reproduced 3/4 · 2 days ago
    admin › resets catalog alongside  5/8      4/44     run together    not reproduced 1/10
  Experiments  3 · last: verified fixed on 4e1a7b2 (0/20 under delay 1.8 s)
  [Reproduce in the desktop app]  [Copy command]
```

- Part 1 alone gives the suspects on the test page, in the Attempts tab, in a clue on failing executions of a flaky
  test, and through MCP. No run is needed.
- Part 2 adds the lab: `piwi flake`, `piwi flake verify`, the desktop app's Reproduce this flake, and experiments stored
  on the test.
- Part 3 feeds the verdicts back: a verified fix proposes quarantine release, bisect uses the reproducing condition,
  and the skill follows the lab instead of `--repeat-each=5`.

## What exists

- **Every attempt is a row.** `onTestEnd` fires once per attempt, so each attempt is its own `test_runs_cases` row
  (unique on run, case, retry, browser), with `status`, `duration`, `retries`, `workerIndex`, `shardIndex` and
  `startedAt` in epoch milliseconds from `result.startTime` (`packages/reporter/src/public/reporter.ts`), and an
  `attempts` JSON of `{ retry, status, duration, startedAt }` for the attempts so far.
- **Shards share a run.** The reporter derives an instance id from the project and the CI run label (`GITHUB_RUN_ID`,
  `CI_PIPELINE_ID`, …; `internal/support/instance-id.ts`, `ci.ts`), and the server reuses the running run for the other
  shards (`server/api/test-runs/setup.post.ts`, `start.post.ts`). Each execution keeps its own `shardIndex`.
- **Requests have timing on every attempt.** The capture fixtures record each `requestfinished` of type fetch, xhr,
  document and other: method, URL, status (0 without a response), duration, `startTime` (epoch ms), content type, and
  the backend's logs and trace headers (`internal/capture/capture-fixtures.ts`). The server keeps every request with
  status 400 or more, plus the 50 slowest others (`shared/utils/filter-network-requests.ts`), in `network_requests`, with
  a normalized URL (`normalizeRoute`). Timing relative to the test is `startTime − startedAt`, which the failure
  timeline already uses (`shared/failure-timeline.ts`).
- **Failed requests are not recorded.** No `requestfailed` listener exists, so a connection reset or an aborted
  request leaves no row. (Built in PR 1.)
- **The Attempts diff compares one pair.** `diffAttempts` (`shared/attempt-diff.ts`, via `getAttemptDiff` in
  `shared/handlers/test-cases.ts`) pairs a failed attempt with the next pass of the same run, case and browser, and
  lists an error on one side, requests that failed on one side (status 0 or ≥ 500), console entries, slow or failing
  steps, a duration gap, page state and ARIA landmarks. Request durations are loaded but not compared.
- **The classifier names one cause.** `classifyFlakyRootCause` (`shared/flaky-classify.ts`) returns `timing`,
  `network`, `assertion`, `environment` or `other` from error keywords, failed-request counts and Attempts-diff votes,
  stored on `test_cases.flaky_root_cause`. Only `POST /api/projects/:id/flaky-classify` runs it, and no page calls that.
- **Flaky scoring.** `getProjectFlakyTests` (`shared/handlers/projects.ts`) groups each run's final status per browser,
  counts retry-passes and pass/fail alternations, scores `round(100·(0.6·retryRate + 0.4·altRate))` and ranks by
  wasted CI minutes. The Failures tab's flaky segment lists them (`FlakyTestsList.vue`); the test case page offers
  Reproduce locally with `--repeat-each=20` (`app/pages/test-cases/[id].vue`).
- **Per-execution interference clues.** `worker-pollution` (the previous test on the same worker failed),
  `slow-request-overlapping-failure` (a request of 1.5 s or more in flight during the failed step), `lock-holder-failed`
  and `lock-cross-shard` (`shared/failure-clues.ts`, `shared/lock-overlap.ts`). They read one execution, not history.
- **Probe mode is a template.** `piwi probe` writes a plan file, sets `PIWI_PROBE`, `PIWI_PROBE_PLAN` and
  `PIWI_PROBE_RESULTS`, and spawns Playwright with `--grep` (`packages/reporter/src/cli/probe.ts`). Probe mode forces
  retries to 0 (`public/config-wrapper.ts`) and stamps the run (`piwiProbe: true`), and the server skips side effects
  for such runs (`isProbeRun`). The fixtures match a plan item by file and title (`internal/probe/mode.ts`, `plan.ts`)
  and intercept with `page.route('**/*')`, matching method and path pattern (`routeKey`), on the Nth match after the
  first navigation (`internal/probe/interception.ts`). The faults include `slow`, a fixed 5-second delay applied with
  `route.fetch()` then `fulfill` (`internal/probe/faults.ts`).
- **The desktop app runs tests in throwaway worktrees.** `desktop_reproduce_here` and `desktop_bisect_here`
  (`apps/desktop/src-tauri/src/worktree.rs`) check out a commit with `git worktree add --detach`, install, and run
  Playwright through the Node sidecar. The runner allowlists Playwright flags (`runner.rs`: `--repeat-each`,
  `--workers`, `--grep`, `--project`, `--retries`, `--trace`, …) and sets no other environment, so the webview cannot
  inject variables. Bisect decides good or bad from one exit code.
- **Fix verification is per cluster.** `verifyClusterFixes` (`server/utils/fix-verification.ts`) records a fix when
  every test of a cluster passes, and a regression when it fails again. A flaky test has no equivalent.
- **Quarantine release** is proposed after five consecutive passes (`shared/handlers/quarantine.ts`).
- **The skill.** `stabilize-flaky-tests` (`packages/reporter/templates/skills/stabilize-flaky-tests/SKILL.md`) ranks
  with `list_flaky_tests`, reads the trend and the failure, names four cause families, forbids retries and longer
  timeouts, and verifies with `--repeat-each=5`.
- **CPU throttling and network emulation** are not used anywhere.

### Defects found while researching this plan

These change what the suspects and the lab can rely on, so PR 1 fixes them:

1. `classifyFlakyRootCause` compares keywords such as `waitFor`, `ERR_`, `ECONNREFUSED` and `Expected:` against
   lowercased text without lowercasing them, so they never match (`shared/flaky-classify.ts`).
2. Its environment branch needs a browser distribution of passes and failures, but only failures are counted, so it
   never fires.
3. Its input keeps only rows from runs whose status is `failed`, which drops the retry-passes of green runs
   (`shared/handlers/flaky-classify.ts`).
4. The flaky leaderboard compares final statuses with `'timedOut'`, but rows store `timedout`, so timed-out finals are
   not counted (`shared/handlers/projects.ts`; also noted in `proposals/failure-experience-audit.md`).
5. The same-worker query behind `worker-pollution` filters by run and worker index but not shard, so workers of
   different shards are mixed (`shared/handlers/test-cases.ts`).

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Suspects are computed on demand from stored history, for one test, over its last 30 days (at most 200 attempts). Nothing new is stored for them. | The data exists. A profile per test is cheap to compute, and it is always current. |
| D2 | A suspect is shown with its raw counts (failures with the factor, passes with the factor), ranked by a smoothed lift, and only when at least 3 failures support it. | Counts let the reader judge a small sample. The floor keeps a single coincidence off the list. |
| D3 | Only factors with a condition the lab can apply become suspects: a route's timing, a route's failure, load, another test alongside or before. Other factors (time of day, another run on the same environment) are shown as context, without a condition. | A suspect is useful because it can be tested. Context still helps a human. |
| D4 | The lab runs where tests run: the CLI (a laptop or a CI job) and the desktop app. The dashboard only plans and records. | The dashboard never runs tests; that holds for probes too. |
| D5 | Every experiment has a control arm in the same session: same machine, same commit, same Playwright project, retries off. | Without a control, "fails 3 of 10 under the condition" says nothing: the test may fail 3 of 10 on this machine anyway. |
| D6 | A failure counts toward reproduction only when its error signature (`extractErrorSignature`, `shared/error-fingerprint.ts`) matches one of the test's failures in history; the plan carries those signatures. Other failures are shown apart. | A condition that breaks the test some other way has not reproduced this flake. |
| D7 | Arms stop early at 3 matching failures (`--max-failures=3`). The verdict is **reproduced** when the arm's rate is at least half and a one-sided Fisher exact test against the control gives p < 0.05, **amplified** when p < 0.05 at a lower rate, and **not reproduced** otherwise. | Early stopping keeps a lab session to minutes. The test is exact on small counts, and the rule is simple to state on the page. |
| D8 | Conditions are applied by the capture fixtures in a new flake mode, built like probe mode: a plan file, a results file, retries forced to 0, the run stamped so its results stay out of flakiness, regressions and notifications. | Probe mode already solves plan delivery, test matching, interception and run isolation. |
| D9 | The same conditions verify a fix: `piwi flake verify` reruns the reproducing arm. Zero matching failures in N runs, where N gives 95% confidence at the arm's reproduced rate (`N = ⌈ln 0.05 / ln(1 − rate)⌉`, at least 5), verifies it. | "Passes under the conditions that made it fail" is a verification; "passed ten times" is not. |
| D10 | Interference is measured from overlap in time within the same run, across shards, and flagged "approximate" when the two executions ran on different shards. | Shards of one run are on different machines; their clocks agree only roughly. |

## Part 1 — Suspects

### 1.1 Failed requests

The capture fixtures add a `requestfailed` listener beside `requestfinished` for the same resource types, recording the
request with status 0 and `failure` (Playwright's `request.failure().errorText`, for example `net::ERR_CONNECTION_RESET`).
The wire's network request gains an optional `failure` field; `network_requests` gains a nullable `failure` column; the
server's filter already keeps status 0.

### 1.2 The profile

`shared/handlers/flake-profile.ts` exports the pure `buildFlakeProfile(input)` and a loader. The input is the test's
attempts in its window (executions of non-probe, non-lab runs, as `getProjectFlakyTests` selects them), each with its
status, error signature, start, duration, run, shard, worker, browser and Playwright project, plus, per attempt, its
requests and the executions of the same run that overlapped it or ran before it on the same shard and worker.

| Factor | Measured per attempt | Condition |
|---|---|---|
| **Slow route** | for each route key (`METHOD normalizedUrl`), the attempt's slowest duration for it; the threshold is the lowest value that separates failures from passes best | `delay` that route to the failures' median duration |
| **Failed route** | the route answered ≥ 500, 0, or failed (1.1) | `fail` that route with the same status, or abort it |
| **Load** | how many executions of the same run overlapped the attempt; the threshold is chosen as for slow routes | `cpu` throttling ×4 (Chromium) |
| **Alongside** | each other test whose execution overlapped the attempt | `alongside` that test |
| **Before, same worker** | the test that ran last before it on the same shard and worker | `after` that test |
| **Browser or project** | the attempt's browser and Playwright project | `project` pinned to it |
| **Attempt** | first attempt or a retry | none: shown as "fails on first attempts only" |
| **Context** | hour of day; other runs on the same environment overlapping | none |

For each factor value: failures with it, failures without it, passes with it, passes without it. Lift is
`(fw + 1)/(f + 2) ÷ (pw + 1)/(p + 2)`. A factor is shown when `fw ≥ 3` and its lift is at least 2, at most 5 suspects,
ranked by lift × `fw`. For **alongside** and **before**, the suspect also lists shared routes: route keys with a write
method (`POST`, `PUT`, `PATCH`, `DELETE`) that both tests called in the overlapping window ("both write
`/api/products`").

### 1.3 Where it shows

- **Test case page.** A **Flakiness** tab on `app/pages/test-cases/[id].vue` when the test is flaky: suspects with their
  counts and conditions, experiments (Part 2), and the commands. The existing Reproduce locally stays.
- **Attempts tab.** `diffAttempts` also compares request durations: a route at least 1 s and twice as slow on the
  failing attempt becomes a row ("GET /api/cart 2.1 s on the failing attempt, 0.2 s on the passing one"). Each row links
  to the matching suspect.
- **Clue.** A new clue `known-flake-suspect` on a failing execution of a test that has a suspect this execution shows
  ("GET /api/cart took 2.1 s; it is slow in 7 of this test's 8 failures"), and its stronger form when an experiment has
  reproduced that suspect. Listed in `reference/clues.md`, which the drift test checks.
- **Flaky list.** A column for the top suspect and a "reproduced" badge (`FlakyTestsList.vue`).
- **MCP.** `get_flake_profile { testCaseId }` returns suspects, context and experiments.

## Part 2 — The lab

### 2.1 Conditions

A flake plan (`FlakePlan`, in `packages/core/src/flake-plan.ts` so the reporter and the app share it) is
`{ experimentId, test: { file, title, suite, project }, arm: { id, conditions } }`, one plan per arm. Conditions:

| Condition | Applied by | Notes |
|---|---|---|
| `delay { route, ms, match }` | `page.route` on the route key: `route.fetch()`, wait until `ms` after the request started, then `fulfill` | `match` is `all` or an ordinal after the first navigation, as probes match |
| `fail { route, status \| abort }` | `fulfill({ status })`, or `route.abort('connectionreset')` | |
| `cpu { rate }` | a CDP session: `Emulation.setCPUThrottlingRate` | Chromium only; an arm on another browser is skipped with a note |
| `network { latencyMs, downKbps, upKbps }` | CDP `Network.emulateNetworkConditions` | Chromium only; offered for a suspect of many slow routes at once |
| `alongside { test }` | the arm runs both tests with `--workers=2` | the lab keeps only rounds where the two executions overlapped, read from the results |
| `after { test }` | the arm runs both with `--workers=1` | the lab keeps only rounds where that test ran just before, read from the results |
| `project { name }` | `--project` | |

`internal/probe/interception.ts` is generalized: a matcher over route keys and an action, used by probe faults and flake
conditions alike. `faults.ts`'s fixed `slow` delay becomes a `delay` action with 5,000 ms.

### 2.2 Flake mode

- `PIWI_FLAKE_PLAN` (the arm's plan file) and `PIWI_FLAKE_RESULTS` (a JSONL of outcomes) switch it on, in
  `internal/config/env.ts` like the probe variables.
- `public/config-wrapper.ts` forces retries to 0, as probe mode does. The reporter stamps the run's metadata with
  `piwiFlakeLab: { experimentId, armId }`.
- `piwiCapture` loads the arm for the test (the probe matcher by file and title) and applies its conditions on the first
  instrumented page, before navigation.
- Each finished attempt appends `{ armId, status, errorSignature, startedAt, duration, workerIndex }` to the results.
- On the server, an `isFlakeLabRun` check beside `isProbeRun` keeps these runs out of flaky scoring, regression
  signals, clusters, notifications, the gate, quarantine streaks and the profile's own window.

### 2.3 `piwi flake`

`packages/reporter/src/cli/flake.ts`, registered in `cli/index.ts`:

```
npx @piwitests/reporter flake <test> [--suspect <n>|--all] [--runs <n>] [--budget <duration>] [--project <name>] [--no-upload] [--json]
npx @piwitests/reporter flake verify <test> [--runs <n>]
```

1. `<test>` is a test case id, or `file:line`, resolved through the catalog.
2. It fetches `GET /api/test-cases/:id/flake-plan`, which returns the profile's suspects as arms, most likely first, and
   creates an experiment record.
3. It runs the control arm (default 10 runs), then each arm (default up to 10 runs, stopping at 3 matching failures),
   each as one `playwright test <file> -g <title> --repeat-each=<n> --retries=0 --max-failures=3` with the arm's plan,
   through the same spawn path as `piwi run`. With `--all` it also runs the conditions combined when none reproduces
   alone. `--budget` (default 15 minutes) stops starting new arms.
4. It prints each arm and the verdict (D6, D7), and posts the results to `POST /api/projects/:id/flake-lab/results`
   unless `--no-upload`.
5. `verify` reruns the last reproducing arm and its control for N runs (D9) and posts a `verify` experiment.
6. Exit codes: 0 when it reproduced (or, for `verify`, the fix held), 1 when it did not, 2 on error.

The CLI runs the checkout it is in. It prints the commit it tested next to the commit of the failures, and warns when
they differ.

### 2.4 Storage

- `flake_experiments (id, project_id, test_case_id, kind: 'reproduce' | 'verify', commit, source: 'cli' | 'desktop' |
  'ci', machine, verdict, reproducing_arm_id, created_at, finished_at)`.
- `flake_arms (id, experiment_id, conditions JSON, runs, matching_failures, other_failures, p_value, verdict)`.
- `GET /api/test-cases/:id/flake-profile`, `GET /api/test-cases/:id/flake-plan`, `GET /api/test-cases/:id/flake-experiments`,
  `POST /api/projects/:id/flake-lab/results`, with the roles `probes/results` uses for writes.
- Experiments are deleted with their test case; retention keeps them otherwise (they are small and are the proof).

### 2.5 The desktop app

A **Reproduce this flake** button on the Flakiness tab when running in the desktop app. A new Rust command,
`desktop_flake_lab_here`, checks out the commit of the latest failure in a throwaway worktree (the reproduce path) and
runs `piwi flake` there through the Node sidecar. The webview passes only the test case id and the options; Rust builds
the arguments and the environment, as the runner's allowlist requires. Output streams as `piwi:local-run` events, and
the experiment appears on the tab when it finishes.

## Part 3 — Closing the loop

- **Verified fixed.** A `verify` experiment that holds marks the test "verified fixed on `<commit>`" on the Flakiness
  tab and the flaky list, and drops it from the list's ranking until it retry-passes again.
- **Quarantine.** For a quarantined test, a verified fix proposes release at once, without waiting for five passes.
- **Bisect.** When a test has a reproducing arm, the desktop app's bisect runs that arm at each step: bad when a matching
  failure appears, good after N clean runs (D9). "When did this flake start" gets an answer bisect cannot give from one
  exit code.
- **The skill.** `stabilize-flaky-tests` becomes: read `get_flake_profile`, run `piwi flake`, fix what the reproducing
  condition points at, and finish with `piwi flake verify`. Its rules against retries and longer timeouts stay.
- **MCP.** `plan_flake_experiment { testCaseId }` returns the commands and arms for an agent that runs the CLI itself.

## Delivery

| PR | Content | Needs |
|---|---|---|
| 1 | The five defects; `requestfailed` capture, wire field and column; request durations in the Attempts diff | — |
| 2 | `buildFlakeProfile` and its endpoint, the Flakiness tab (suspects only), the flaky list column, `get_flake_profile`, the clue | 1 |
| 3 | Flake mode in the reporter: plan and results files, conditions, interception generalized, run stamping and server isolation | — |
| 4 | `piwi flake` and `verify`, storage, results endpoint, experiments on the tab, `plan_flake_experiment`, the skill | 2, 3 |
| 5 | Desktop: `desktop_flake_lab_here`, flake-aware bisect | 4 |
| 6 | Verified fixes on the flaky list and quarantine | 4 |

PR 2 is useful on its own. Each PR carries its docs. The capability `flake-lab` (module `workflow`, passive data) is
registered in PR 2, so a project or instance can decline it and its surfaces disappear.

## File-by-file checklist

### PR 1 — defects and failed requests
- `apps/application/shared/flaky-classify.ts`, `shared/handlers/flaky-classify.ts`, `shared/handlers/projects.ts`,
  `shared/handlers/test-cases.ts` (shard in the same-worker query).
- `packages/reporter/src/internal/capture/capture-fixtures.ts` (`requestfailed`), collected and wire types, serializer;
  `packages/core/src/wire.ts`; `apps/application/tests/fixtures.ts` (the dogfood copy of the network capture).
- Schema (SQLite and PG) and generated migrations for `network_requests.failure`; `network-request-helpers.ts`.
- `shared/attempt-diff.ts` (durations).
- Tests: classifier cases for each defect, the leaderboard with `timedout`, a failed-request capture spec, Attempts
  diff durations.

### PR 2 — suspects
- `shared/handlers/flake-profile.ts` (new), `server/api/test-cases/[id]/flake-profile.get.ts` (new).
- `app/pages/test-cases/[id].vue`, `app/components/test-case/FlakinessTab.vue` (new), `FlakyTestsList.vue`.
- `shared/failure-clues.ts` (`known-flake-suspect`), `apps/docs/reference/clues.md`.
- `shared/capabilities.ts`, `shared/handlers/setup-status.ts`, `app/utils/setup-capabilities.ts`,
  `shared/piwi-features.ts`.
- `shared/mcp-tools.ts`, `server/utils/mcp/tools.ts` (`get_flake_profile`).
- Demo: seeded attempts with a slow route on failures, and the demo handler.
- Docs: `features/flaky-tests.md` (Suspects), `features/evidence.md` (Attempts).
- Tests: `buildFlakeProfile` on synthetic histories (a slow route, a neighbor, load, nothing), thresholds, the floor.

### PR 3 — flake mode
- `packages/core/src/flake-plan.ts` (new), `packages/core/src/flake-verdict.ts` (new: the one-sided Fisher exact test,
  the D7 rule and the D9 run count, shared by the CLI and the server).
- `extractErrorSignature` moves from `apps/application/shared/error-fingerprint.ts` to core (it already builds on
  `@piwitests/core/error-parse`; the app re-exports it), so the CLI can match signatures with `--no-upload`.
- Reporter: `internal/config/env.ts`, `public/config-wrapper.ts`, `internal/flake/mode.ts` (new),
  `internal/probe/interception.ts` and `faults.ts` (shared matcher and actions), `capture-fixtures.ts`,
  `public/reporter.ts` (stamp).
- App: `isFlakeLabRun` beside `isProbeRun` and every place that checks it (`run-finalize-side-effects.ts`, flaky
  scoring, quarantine, the gate, the profile).
- Tests: each condition against a local fixture server (delay measured, fail status, abort, CPU rate set), run
  isolation.

### PR 4 — the CLI and experiments
- `packages/reporter/src/cli/flake.ts` (new), `cli/index.ts`, `internal/support/selection-client.ts` (plan and results).
- Schema and migrations for `flake_experiments`, `flake_arms`; handlers and endpoints; retention on test case delete.
- `FlakinessTab.vue` (experiments), `shared/mcp-tools.ts` (`plan_flake_experiment`),
  `packages/reporter/templates/skills/stabilize-flaky-tests/SKILL.md`.
- Docs: `features/flake-lab.md` (new), `reference/cli.md`, `navigation.ts`.
- Tests: the verdict rule (Fisher exact, early stop, signature matching) as pure functions; the CLI end to end on a
  fixture suite with a test that fails when `/api/slow` takes over a second.

### PR 5 — desktop
- `apps/desktop/src-tauri/src/worktree.rs` (`desktop_flake_lab_here`, bisect arm), `lib.rs` (command registration),
  `app/composables/useDesktopLocalRuns.ts`, `FlakinessTab.vue`.
- Docs: `features/desktop.md`.

### PR 6 — verified fixes
- `shared/handlers/projects.ts` (ranking), `shared/handlers/quarantine.ts` (release proposal), `FlakyTestsList.vue`,
  `QuarantineTable.vue`.
- Docs: `features/flaky-tests.md` (Verified fixed, Quarantine).

## Verification

1. A fixture suite with a test that clicks Pay before `GET /api/cart` answers, and a server that answers in 100 ms
   normally and 2 s one time in ten. Run it 50 times with retries: the flaky list shows it, and the Flakiness tab lists
   "GET /api/cart slower" first with counts that add up to the runs.
2. `piwi flake` on it: the control arm stays near 0, the delay arm reproduces, the verdict and p-value print, and the
   experiment appears on the tab.
3. Fix the test (wait for the response) and run `piwi flake verify`: 0 of N under the delay; the test shows verified
   fixed.
4. A second fixture: two tests that write the same row, flaky only in parallel. The profile lists the other test
   alongside, with the shared write route; the `alongside` arm reproduces with `--workers=2`.
5. The lab runs are absent from the flaky list, the run list's regression signals and notifications.
6. In the desktop app, Reproduce this flake on a failure from an older commit: the worktree is at that commit, the
   output streams, and the checkout is untouched.

## Risks

- **Spurious suspects.** Many routes and many neighbors mean many comparisons. The floor of 3 supporting failures, the
  lift of 2, the cap of 5, and showing raw counts keep it honest; the lab is the real test, and a suspect that never
  reproduces is shown as such.
- **A local machine is not CI.** A delay reproduces a race anywhere; load and interference depend on the machine. The
  control arm (D5) catches a test that simply fails here, and the CI source lets a team run the lab in the pipeline where
  the flake lives.
- **Clock skew across shards.** Overlap across shards is labeled approximate (D10), and the lab's `alongside` arm checks
  the overlap it actually got.
- **Cost of a session.** Budgets, early stopping and one arm at a time bound it; the CLI prints the estimate from the
  test's median duration before starting.
- **Conditions change behavior beyond the race.** A delay can trip a timeout the test never hit in CI. Counting only
  matching error signatures (D6) separates those.

## Open questions

1. **Server-side delays.** With the Nitro instrumentation, a signed `delay` fault could delay inside the handler, which
   also delays what the server does after responding. Recommendation: client-side delays first; server delays when a
   profile's suspect is a backend dependency the client cannot see.
2. **Data-dependent flakes.** A test that fails when another run on the same environment changes shared data is shown as
   context but has no condition. Recommendation: leave it as context; a lab cannot recreate another team's pipeline.
3. **Where CI runs the lab.** Recommendation: document a manual workflow (`workflow_dispatch` with the test id) rather
   than running it automatically; it spends minutes.

## Not in this plan

- Automatic lab runs on every newly flaky test.
- Suspects for tests that fail every time (those are failures, and clusters explain them).
- Changing the flaky score itself; the verdicts sit beside it.
- Order-dependence across whole files (Playwright's file order within a worker is not controlled by the lab).
