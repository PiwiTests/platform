# Closing the loop

A plan to make Piwi learn from what it hands back. Piwi keeps every run, explains each failure and hands back
something to do: a replacement locator, an auto-heal pull request, a validated patch, a fix plan, a gate verdict, a
gap draft, a failing test for a bug report, a bisected commit. Piwi learns what happened to almost none of them: it
does not record whether the heal was applied, the pull request merged, the patch used, the draft written or the
verdict overridden. So it cannot tell which of its suggestions work, cannot credit a fix to the action that produced
it, and proposes again what people already rejected. The verdicts these loops would read are also less reliable than
they look: a re-run at the same commit counts as a fix, Flake Lab runs count as CI results for the editor, and a
sharded run has no branch.

This plan fixes those verdicts first, then adds five shared pieces that every loop needs:

- a **run origin** on every run, and one **eligibility** rule deciding which runs may feed which analysis;
- an **outcome** table for every hand-back;
- **linking annotations and commit trailers** that tie a new test or a commit to what Piwi suggested;
- **precision per hand-back kind and per AI model** (2.5, 2.6), generalizing the gap detectors' precision loop;
- **write-back parity**: what a person can do in the dashboard, an agent can do through MCP.

On top of them it closes the loops one at a time, then covers the stages of a suite's life that Piwi does not touch
yet: environment incidents, new tests before they land, aging and escalation, release readiness and suite hygiene.

**Status.** Proposed 2026-10-02. Nothing is built. Researched against `main` at `b103d2d` (0.45.0): one researcher per
subsystem, 28 candidate open loops each checked against the code by a reviewer asked to refute it, and a separate
search for lifecycle stages nobody had listed ([Appendix C](#appendix-c-method)). The defects found on the way are in
[Appendix A](#appendix-a-defects-found), and [Part 0](#part-0-defects-first) fixes them before anything else ships.
Parts 0 to 3 are specified to the file. Parts 4 to 7 are sketched with their first step and get their own proposals
when they start.

Paths are relative to `apps/application/` unless they start with `packages/`, `apps/`, `integrations/` or `proposals/`.

**Terms.** Each is used with this one meaning throughout:

- **Hand-back**: anything Piwi gives a person or an agent to act on, the third of
  [Piwi's purposes](../ROADMAP.md#what-piwi-is-for) ("hand back a fix").
- **Outcome**: what happened to a hand-back: `suggested`, `applied`, `verified`, `rejected` or `regressed`.
- **Run origin**: what launched a run: CI, a CI re-run from the dashboard, a local run, the desktop app, an editor,
  `piwi preflight`, `piwi bug`, Flake Lab, a probe, a bisect step, a reproduction, an import.
- **Eligible run**: a run allowed to feed a given analysis (a baseline, fix verification, flaky scores, the selection
  catalog, the editor's CI failures). Eligibility depends on the run origin, the branch, whether the run is complete
  (it ran the whole suite: not a `--grep` run, a selection or a run still in progress), and whether it is an
  environment incident.
- **Fix attempt**: a change that a person or an agent reports having made to fix a cluster (a patch, a locator edit, a
  fix plan carried out), tied to a commit or a branch. It is the `fix-attempt` kind of hand-back; heals and diagnoses
  that Piwi suggests have their own kinds.
- **Environment incident**: a run whose failures come from the environment under test being down or broken, not from
  the tests or the code.

## What the reader gets

```
Cluster #214 · Login button renamed · fixed
  Fixed in run #912 on main at abc1234, 2 days after it first failed.
  Fixed by: auto-heal pull request #41, merged (Piwi-Heal trailer in abc1234).
  Not counted: run #905 passed at the failing commit 7f3e2d1 (a re-run, recorded as flake evidence).
```

```
Analytics · Hand-back outcomes · last 90 days · main
  Locator heals    31 call sites now use the recommended locator · 9 auto-heal PRs merged, 2 closed
  AI diagnoses     44 · rated helpful 12 of 17 · the fix touched the diagnosed files in 19
  Gap drafts       23 drafted · 8 closed by the test written from them
  CI gate          blocked 6 merges · 1 merged anyway, then regressed on main
  Flaky tests      5 verified fixed with Flake Lab · 2 flaked again
```

```
Run #930 · environment incident · not counted
  41 of 44 tests failed, 39 of them navigating to https://staging.example.test (connection refused).
  The same host failed in 2 other projects within 20 minutes.
  Left out of flaky scores, baselines, fix verification and the gate (inconclusive). One incident marker added.
```

```
AI context · Proven facts
  - Bisect (desktop app, shared to this instance): first bad commit abc1234 "Rename price field".
  - Flake Lab: "slow GET /api/cart" reproduced 7 of 10 (commit 7f3e2d1, 2026-09-30); "CPU load" ruled out, 0 of 10.
  - Marker: deploy "staging 2026-10-01 14:02", between the last green run and the first failure.
```

```
Pull request #88 · New tests (3)
  checkout › applies a coupon     no assertion after the last click
  checkout › shows the total      12.4 s, slower than 90% of the suite
  cart › removes an item          reaches the same routes and pages as cart › empties the cart
  Burn-in: 20 runs under CPU and network load, 1 failure (cart › removes an item)
```

```
checkout.spec.ts:42   flaky 18% · top suspect: slow GET /api/cart (reproduced 7 of 10)
  Piwi: Reproduce this flake · Piwi: Verify the flake fix
```

- Part 0 alone makes "fixed", "regressed", the editor's CI failures and the AI's prior assessment trustworthy.
- Parts 1 and 2 add the run origin, eligibility, incidents, the outcome table and the Analytics section above.
- Part 3 lets agents, editors and the desktop app report back.
- Parts 4 to 6 use those pieces to explain with proven facts, learn what the suite misses, and act on time and
  ownership. Part 7 covers independent tracks (privacy, activation, AI steps, unread data).

## The loop today

| Stage | What Piwi does | Where the loop is open |
|---|---|---|
| Author | Recorder and codegen, AI steps, gap drafts, bug-report specs | A test written from a gap draft is never linked back to its gap |
| Select | Selections, impact from a diff, preflight | Impact never learns from a test it skipped that failed later, and skips passing users of a changed helper (A1) |
| Run and capture | Reporter, capture fixtures, backend packages, probes, Flake Lab | Runs carry no origin; route reach comes from a capped request list; Playwright's `pageerror` and `crash` events are not recorded; ASP.NET Core sends spans only for probes |
| Keep | Ingest, rollups, retention | Sharded runs and imports lose the branch (A3); imports overwrite current state (A19); auto-heal outcomes and per-test history are pruned; Flake Lab, probe and bisect runs feed the editor's CI failures, the selection catalog, change coverage, the environment, visual and page diffs and shared state (A6 to A10) |
| Explain | Clusters, clues, verdicts, AI diagnosis | Proven facts (the bisected commit, lab verdicts other than a reproduced suspect, resource findings, markers) do not reach the AI context, and a reproduced suspect reaches it only as a clue; the seven cause sources listed in 4.2 are never reconciled |
| Route and decide | Inbox, owners, notifications, PR comment, gate, Jira | The gate verdict and the PR comment are not stored; an assignment notifies nobody; insights are never sent |
| Fix | Heals, auto-heal PRs, patches, fix plans, MCP and skills, editor quick fixes, desktop reproduce and bisect | Whether a hand-back was applied is never recorded; agents read almost everything and write almost nothing |
| Verify | Fix verification, quarantine streaks, `piwi flake verify`, the bug-report lifecycle | Any green run counts: at the same commit (A4), on any branch (A5), and desktop bisect and reproduction steps, which carry no lab stamp (A34); the bug-report lifecycle ignores branch and run type (A20) |
| Learn | Four closed loops, below | Everything else |

The four loops that are closed today:

- **Gap detector precision.** Each triage verdict counts for or against the detector that raised the gap, and a
  detector whose precision is below 60% after at least 20 verdicts is muted (`shared/handlers/detector-precision.ts`).
- **Green ARIA sampling.** The server lists the tests that need a new ARIA snapshot from a passing run
  (`GET /api/projects/:id/aria-sampling`, `shared/handlers/aria-sampling.ts`). It is the only place where the server
  tells the capture fixtures what to capture.
- **Flake Lab.** A `piwi flake verify` whose verdict is `verified` marks the test verified fixed, takes it off the
  flaky ranking until it retry-passes again and proposes a quarantine release (`shared/handlers/flake-verified.ts`,
  the release in `shared/handlers/quarantine.ts`).
- **Bug reports.** A test carrying `piwi:bug <id>` moves its report through test-committed, looks-fixed and closed,
  and a later failure reopens it (`applyBugReportLifecycle`, `shared/handlers/bug-reports.ts`).

The last one is the pattern to generalize: an annotation ties a test to what Piwi suggested, and later runs move the
state, with no client call and no telemetry.

## What exists

- **An outcome inferred from runs, computed and thrown away.** `stampHealedRun` (`server/utils/locator-healing.ts`)
  stamps the last run, other than the failing one, that saw the recommended locator's signature in any of the test's
  locator snapshots, at any call site. That detects an applied heal whatever applied it (the editor's quick fix,
  `piwi preflight --fix`, the desktop's `apply_locator_fix`, a skill, a hand edit), because it reads the code that
  ran. It is computed on read, never stored or counted.
- **Auto-heal actions.** `heal_actions` goes pending, processing, opened, then merged or closed, or ends failed or
  skipped (`server/utils/heal/pr-state.ts`); its
  `kind` column defaults to `open-pr` and the sweeper ignores it. Heal commits carry a `Piwi-Heal: <dedupeKey>`
  trailer (`server/utils/heal/dispatch.ts`). Merged and closed states only free the open-PR cap
  (`server/utils/heal/policy.ts`) and add to one count in `shared/handlers/analytics/progress.ts`.
- **Fix verification** (`server/utils/fix-verification.ts`) records `stopped-failing`, `diagnosis-verified` (the
  commits since the last failure touched the diagnosed files) or `regressed`, resolves the cluster on
  `diagnosis-verified`, and tells the fix's author (`server/utils/notifications/fix-author.ts`).
- **Lab stamps.** Probe and Flake Lab runs carry a metadata key read by `isLabRun`, `notLabRun` and `notLabExecution`
  (`shared/handlers/probes.ts`). `runFinalizeSideEffects` skips lab runs entirely
  (`server/utils/run-finalize-side-effects.ts`), and the dashboard's test list filters them. Many other consumers do
  not (A6 to A10). `piwi run` stamps its selection through `PIWI_SELECTION_*`
  (`packages/reporter/src/public/reporter.ts`).
- **Diagnosis feedback.** Thumbs up or down with a note (`server/api/failure-diagnoses/[id]/feedback.patch.ts`, MCP
  `submit_diagnosis_feedback`), versions in `failure_diagnosis_versions`. A thumbs-down is meant to add a "do not
  repeat" line to the next diagnosis (`priorDiagnosisSection` in `server/utils/ai-context.ts`), but it never reaches a
  real diagnosis (A2).
- **MCP write tools today:** `set_cluster_status`, `set_cluster_base_commit`, `submit_diagnosis_feedback`,
  `run_cluster_diagnosis`, `create_issue`, `create_test_function`, and on the desktop `apply_locator_fix` and
  `import_local_report` (`server/utils/mcp/tools.ts`, `shared/mcp-tools.ts`). `setup_piwi` is the only prompt
  (`shared/mcp-prompts.ts`). The six workflow skills (`packages/reporter/templates/skills/*/SKILL.md`) never call a
  write-back tool except an optional `set_cluster_status`.
- **A desktop round trip that already works.** Piwi Picker posts a reproduction request with the bug report id and
  the instance URL to the desktop app, the window asks the developer to confirm (`DesktopReproRequestModal.vue`), and
  the verdict can be shared on the team instance through `POST /api/bug-reports/:id/reproductions`. The editor service
  can reach both: it resolves the team instance's credentials (`namedInstance`) and reads the desktop app's address and
  token from its discovery file (`readDesktopDiscovery`), though each context's client talks to only one of them
  (`resolveContextConnection`, `packages/editor/src/context.ts`).
- **Outboxes.** Notifications, auto-heal actions and integration actions share `server/utils/outbox.ts`. Retention
  prunes settled rows after `PIWI_RETENTION_NOTIFICATION_DAYS` (30 by default, read in
  `server/tasks/retention/sweep.ts`; the prune functions are in `server/utils/retention.ts`).
- **Rollups.** `analytics_daily_rollups` are written at finalize and by `archiveRunsIntoRollups` before retention
  deletes a run (`shared/handlers/analytics/rollups.ts`).
- **Analytics.** The metric catalog (`shared/analytics/metrics.ts`, `MetricDef.capability` accepts only `test-map`),
  insight rules (`shared/analytics/insight-rules.ts`) and per-project targets (`shared/analytics/targets.ts`). Insights
  and targets are read by widgets and quality reports only (scheduled, previewed, shared or fetched with
  `get_quality_report`), never by notifications.
- **Capabilities.** `shared/capabilities.ts` with `CapabilityDef.since`, and `resolveProjectStates` in
  `shared/handlers/capabilities.ts`.
- **CI re-run** (`server/utils/ci-rerun.ts`, `shared/ci-rerun.ts`) dispatches a workflow with one input holding the
  Playwright arguments. GitHub answers 204 with no run id, GitLab's pipeline id and Bitbucket's build number are
  dropped, and the record is `lastRerunDispatch` only.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Outcomes are inferred first from the runs Piwi already receives. Explicit write-backs from MCP, editors and the desktop are additions, never prerequisites. | Works with no client change, sees hand edits, sends nothing anywhere. |
| D2 | Nothing leaves the instance. Production data (route usage, 5.4) enters only when the user pushes it to an import endpoint. | Zero telemetry, as everywhere else in Piwi. |
| D3 | Every analysis that compares runs reads one eligibility rule. Flake Lab, probe, bisect, reproduction, import and incident runs are excluded per use, not by each caller. | Today each caller filters, or forgets to (A6 to A10, A24). |
| D4 | The run origin is a metadata key, `metadata.piwiOrigin = { kind, ref }`, stamped by the launcher through `PIWI_ORIGIN` and `PIWI_ORIGIN_REF`. No column until a query needs an index. | Additive on the wire, and every launcher can set an environment variable. |
| D5 | A fix is recorded only when the commit changed since the cluster last failed, on an eligible run of the cluster's branch or the default branch. A pass at the same commit is flake evidence. | A4 and A5. |
| D6 | Links over guesses. A test written from a gap draft carries `piwi:gap <id>`, as a bug spec carries `piwi:bug <id>`. Commits Piwi writes or suggests carry `Piwi-Heal` or `Piwi-Cluster` trailers, and Piwi reads full commit messages to find them. | The bug-report lifecycle shows that an annotation closes a loop with no heuristic. |
| D7 | Learning demotes and explains. It never switches a model, and it mutes or blocks only above a sample floor (the `MUTE_MIN_VERDICTS` pattern). | Self-hosted instances have small samples. |
| D8 | Every MCP write tool calls the same shared handler as its REST route, with the same role check. MCP gets no verb the dashboard lacks. | One behavior, one test, one audit path. |
| D9 | Outcome rows follow run retention. Daily counters per kind and outcome go into a rollup table before rows are pruned. | Whether hand-backs work must survive `PIWI_RETENTION_DAYS`. |
| D10 | Each new surface sits under an existing capability or a new declinable one. Each new metadata key, event, MCP tool and CLI command gets a D entry in [`1.0-stabilization.md`](1.0-stabilization.md) before it ships. | Every optional capability can be declined, and the wire freezes at 1.0. |
| D11 | Part 0 ships before any learning feature. | Every loop reads the verdicts those defects corrupt. |

## Part 0: Defects first

Three pull requests, grouped by what they protect. Each row of [Appendix A](#appendix-a-defects-found) names the file
and the scenario.

- **PR 1, the verdicts.** Fix verification ignores a pass at the failing commit and runs on other branches (A4, A5).
  The next diagnosis receives the prior assessment, a rating stays on the version it rated, and a diagnosis rated
  unhelpful is no longer offered under Fixed before, the list of resolved clusters this one resembles (A2, A26, A38).
  Open auto-heal rows are kept, the state sweep checks the least recently checked rows first, and failed or skipped
  rows free their dedupe key (A11, A29, A30). A status change keeps the triage note (A16). AI usage is counted by
  creation time (A32). PR 1 also changes one behavior on purpose: `piwi/tests` stays green when only quarantined tests
  failed, with a project setting to keep the current rule (A25, 2.3).
- **PR 2, ingest and lab runs.** The branch on `/begin`, sharded `/finish` and imports (A3). Lab runs left out of the
  editor's CI failures, the selection catalog, change coverage, the environment, visual and page diffs, green samples
  and the AI's baseline comparison (A6 to A9, A24). Lab and bisect runs no longer write locator snapshots or test
  metadata (A10). The step cap keeps the failing step (A18). Imports backdated, without touching current metadata or
  locks (A19). These use `notLabRun` directly; PR 4 moves them to the eligibility rule.
- **PR 3, analysis.** Impact selection widens to the full suite when a changed file is mapped only through another
  test's failure frames, or when a changed non-source file maps to no test (A1, A23). The AI context reads retry
  passes by test, not by cluster (A12). Owner filters apply to every event that carries owners (A13). "Move to a new
  cluster" creates a real cluster, rejected merge pairs block auto-merge and LLM "no" verdicts are stored (A14, A15).
  The clue and the flaky list show the reproduced suspect first, and the load suspect keeps a stable id (A17, A33).
  The bug-report lifecycle reads default-branch runs only (A20). Re-probe on a source change, `covered-by` closes the
  gap (A21, A22). The desktop's bisect banner matches the cluster, and reproduction and bisect steps report to the
  local app only (A27, A34). A declined `green-samples` capability stops green sampling (A35). `piwi ai check` names a
  command that works (A31).

## Part 1: Eligible runs

### 1.1 Run origin

The reporter reads `PIWI_ORIGIN` (`ci`, `ci-rerun`, `local`, `desktop`, `editor`, `preflight`, `bug`, `flake-lab`,
`probe`, `bisect`, `reproduce`) and `PIWI_ORIGIN_REF` (a dispatch id, a cluster id, a bug report id) into
`metadata.piwiOrigin`. With nothing set, it records `ci` when it detects a CI provider and `local` otherwise, and
`collectCiInfo` learns Bitbucket Pipelines' build number and URL (A41). Imports are stamped `import` by the server
(`shared/handlers/import-runs.ts`), since no reporter launches them.

| Launcher | Sets | File |
|---|---|---|
| Desktop app: local run, reproduction, bisect step, Piwi Picker reproduction | `desktop`, `reproduce`, `bisect` with the cluster id, `reproduce` with the bug report id | `apps/desktop/src-tauri/src/runner.rs`, `worktree.rs`, `repro.rs` |
| Editor run commands | `editor` | `packages/editor/src/server.ts` (an `env` field on the run command, not a shell prefix, so it works on Windows) |
| `piwi preflight --run`, `piwi bug --write` | `preflight`, `bug` with the report id | `packages/reporter/src/cli/preflight.ts`, `bug.ts` |
| CI re-run from the dashboard | `ci-rerun` with the dispatch id | `server/utils/ci-rerun.ts`, through an optional configured input or variable |
| Flake Lab, probes | `flake-lab`, `probe` (alongside their existing stamps) | `packages/reporter/src/internal/flake/mode.ts`, `internal/probe/plan.ts` |

A CI re-run also stores GitLab's pipeline id and Bitbucket's build number in its dispatch record and matches them at
finalize. GitHub rejects an undeclared `workflow_dispatch` input, so the correlation input is its own optional setting;
without it, the dispatch is matched on ref, time window and test files. The re-run also passes each affected test's
file and line instead of whole files, and dispatches on the cluster's branch rather than the configured ref (A28).

### 1.2 One eligibility rule

`shared/run-eligibility.ts` (new) exports `isEligibleRun(run, use)` and a query helper for the same rule. The uses:

| Use | Excludes |
|---|---|
| `baseline` (run and execution baselines, the environment, visual and page diffs, the AI's baseline comparison) | Flake Lab, probe, bisect, reproduction, incident; partial runs for run-level baselines |
| `fix-verification` | the above, plus a pass at the failing commit (D5) and other branches |
| `flakiness` | Flake Lab, probe, bisect, reproduction, incident |
| `selection-catalog` (pass rate, last status, recent failures, durations, suggestions) | Flake Lab, probe, bisect, reproduction, incident |
| `branch-failures` (what the editor shows as CI failures) | everything but complete CI runs when one exists on the branch |
| `change-coverage` and other "not reached in N runs" analyses | partial runs, Flake Lab, probe, bisect, reproduction |
| `shared-state` (locator snapshots, test metadata sync, green samples) | Flake Lab, probe, bisect, reproduction, historical import |
| `auto-heal` | Flake Lab, probe, bisect, reproduction, incident |
| `bug-lifecycle` | branches other than the default, `bug`, Flake Lab, probe, bisect, reproduction |
| `notifications` and the gate | Flake Lab and probe (as today), incident (inconclusive) |

The consumers fixed by hand in PR 2 move to it, and `isLabRun` becomes one of its cases. A unit test lists every use
and the origins it excludes, so a new origin has to be placed explicitly.

### 1.3 The branch on every ingest path

`/begin` and the sharded `/finish` resolve the branch from the metadata they receive (`resolveRunBranch`). Blob
imports read the commit and branch from the blob's config metadata. A run with no branch is "unknown": analytics stop
counting it as the default branch, and `pruneStaleCanonicalNodes` (`server/utils/graph-ingest.ts`) stops treating it
as the default branch. A startup backfill, like `server/plugins/locator-index-backfill.ts`, sets the branch from
`metadata.scm` on existing rows.

### 1.4 Historical imports

An imported run older than the newest stored run is historical: its executions get `createdAt` from their attempt's
start, it does not run `syncTestCaseMetadata`, does not overwrite locks, does not wake snoozed clusters, and is not
eligible for `shared-state`. Imports stay silent, as today.

### 1.5 Environment incidents

`shared/handlers/run-health.ts` (new) classifies a finished run from data already stored: the share of tests that
failed, the share of failures in the largest cluster, navigation, connection and crash error kinds, failed requests to
the app's host (from `baseURL`), and the same host or fingerprint failing in other projects within 30 minutes. A run
it flags gets `metadata.incident = { reason, host, projects }` and:

- is excluded by the eligibility rule from baselines, fix verification, flaky scores, the selection catalog and
  auto-heal;
- adds one `incident` marker (the category exists in `shared/marker-categories.ts`) and sends one
  `environment.incident` event to the project's subscribers, not to test owners;
- gives the gate an inconclusive verdict, distinct from pass and fail;
- shows as one row in the inbox instead of one row per new cluster.

A person can mark a run as an incident or clear the flag, and the run page says which rule decided. Optionally, the
reporter's global setup checks that `baseURL` answers before the workers start.

### 1.6 Ingest health

`metadata.ingestHealth` records what ingest dropped or rebuilt: steps and console lines dropped by the caps, the
submit fallback the reporter used, traces skipped, evidence rebuilt from the trace. The run page and the AI context show
it. A run reaped by `server/utils/stale-runs.ts` sends a `run.interrupted` event. It does not run the finalize side
effects, because `server/utils/revive-run.ts` can bring a reaped run back.

## Part 2: Outcomes

### 2.1 The outcome table

`handback_outcomes`, one row each time a hand-back reaches a new outcome:

| Column | Holds |
|---|---|
| `kind` | `locator-heal`, `auto-heal-pr`, `diagnosis`, `fix-attempt`, `gap-draft`, `bug-spec`, `quarantine-proposal`, `merge-suggestion`, `gate`, `flake-verify` |
| `subject` | the cluster, test case, gap, bug report or call site it is about |
| `suggestion_key` | a stable hash of what was suggested (for a heal: the call site, the failing locator and the recommended locator) |
| `outcome` | `suggested`, `applied`, `verified`, `rejected`, `regressed` |
| `channel` | `inferred`, `ui`, `mcp`, `editor`, `desktop`, `cli`, `ci` |
| `actor` | the user or the API key, null when inferred |
| `run_id`, `commit`, `created_at` | where it was seen |

Before retention prunes rows, a daily counter per project, kind and outcome goes into a sibling of
`analytics_daily_rollups` (D9).

### 2.2 Outcomes inferred from runs

No client change is needed for any of these:

- **Locator heal.** At ingest, when the failing call site itself (not another call site of the same test) shows the
  recommended signature, record `applied` with channel `inferred`, labeled "matched the recommendation". The next
  eligible passing run records `verified`. `healedInRunId` is stored instead of recomputed, and only later runs count
  (A40).
- **Diagnosis.** A `diagnosis-verified` fix records `verified` on the diagnosis version that was current when the
  fix landed; `cluster.regressed` records `regressed`.
- **Auto-heal PR.** Merged records `applied` and closed without merging records `rejected`. A green run on the heal
  branch is noted in the action's result (2.4); the next eligible passing run after the merge records `verified`.
- **Merge suggestion and quarantine proposal.** An approved merge records `applied`, written by
  `approveMergeSuggestion` before the merge deletes the suggestion row; a rejected merge records `rejected`, read from
  `cluster_merge_suggestions`. An accepted release records `applied`, read from `quarantined_tests.released_at`; a
  declined proposal or release records `rejected` when a person dismisses it, since nothing stores that today.
- **Flake verify.** A `piwi flake verify` whose verdict is `verified` records `verified`; the test's next retry-pass
  records `regressed`.
- **Bug spec.** The bug-report lifecycle records test-committed as `applied`, closed as `verified` and a reopen as
  `regressed`.
- **Gap draft.** Issuing a draft records `suggested`; 5.1 adds `verified`.

### 2.3 The gate and the PR feedback, stored

- `gate_evaluations` (run, commit, PR number, policy and its hash, passed, violations, source, evaluated at), written
  by `server/api/test-runs/[id]/gate.post.ts`. The response is unchanged and the run is not modified.
- An opt-in commit status `<statusContext>/gate`, following the `<statusContext>/change-coverage` pattern in
  `server/utils/scm/pr-feedback.ts`.
- The PR feedback posted per run (provider, PR number, comment id, statuses posted). Setup marks PR feedback active
  from it (`shared/handlers/setup-status.ts`) instead of from the setting alone.
- A sweep, like the auto-heal PR state sweep, reads the final state of PRs whose gate failed. A PR merged despite the
  failed gate records the gate's outcome as `rejected`. A later regression of the same cluster on the default branch
  counts as "escaped past the gate".
- `piwi/tests` ignores quarantined failures and says "N quarantined" (A25, in PR 1), with a project setting to keep
  the strict rule.

### 2.4 Auto-heal outcomes

- Retention prunes merged, closed, failed and skipped rows after their counters are rolled up, never opened ones (A11).
- An edit whose auto-heal PR was closed without merging (same file, failing locator and recommended locator) is not
  proposed again unless a person picks that locator later in the snapshot picker.
- `fetchChanges` returns full commit messages. Today GitHub and GitLab cut them to the first line
  (`server/utils/scm/GitHubProvider.ts`, `GitLabProvider.ts`) and Bitbucket's `fetchChanges` returns no commits at all
  (`BitbucketProvider.ts`), so no trailer is ever seen; Bitbucket needs a commits call over the range. Fix
  verification reads `Piwi-Heal` and records the auto-heal PR in an optional `healPr` field on the fix, not as a new
  verdict value, so the `cluster.fixed` payload stays compatible.
- Runs on a heal branch link to their action (the branch name carries the run id and the edit signature) and record
  "verified on the branch" in the action's result.

### 2.5 Diagnosis quality

After A2 and A26:

- `server/api/settings/ai/usage.get.ts` and `AiUsagePanel.vue` add, per provider and model: rated helpful (with
  counts), share of patches that apply (`patchValidation`), verified by the fix, and regressed. Below 10 ratings the
  panel says the sample is too small.
- A prompt hash is stored in the diagnosis details, so a prompt change can be compared without a migration.
- A diagnosis rated unhelpful is re-run once its context hash changes, inside the auto-diagnose budget. Ignored
  clusters stop counting against that budget.
- A high-confidence `flaky-test` diagnosis becomes one of the reasons on a quarantine candidate
  (`server/utils/quarantine-candidates.ts`).
- Models are never switched automatically (D7).

### 2.6 Are hand-backs working

New catalog metrics: `heal-adoption` (call sites now using the recommendation), `heal-pr-merge-rate`,
`diagnosis-helpful-rate`, `diagnosis-verified-rate`, `gap-drafts-closed` (counted once 5.1 links a test to its gap),
`gate-blocked-merges`, `gate-overrides`, `flakes-verified-fixed`. `MetricDef.capability` accepts any capability, not
only `test-map`, so each metric is hidden when its capability is declined. They show as a "Hand-back outcomes" section
in Analytics, a sentence group in quality reports, and through the existing metrics MCP tools and `/api/metrics`.

## Part 3: Write-back

### 3.1 MCP verbs

Thin tools over the shared handlers the REST routes already use (D8):

| Tool | Does | Handler |
|---|---|---|
| `triage_cluster` | assign, snooze, quarantine, release, resolve with a note; several clusters at once | `patchClusterAssignee`, `bulkTriageClusters` in `shared/handlers/failure-clusters.ts` |
| `triage_gap` | accept, snooze, dismiss with a reason, covered-by | `triageGap` in `shared/handlers/scenario-gaps.ts` |
| `decide_merge_suggestion` | approve or reject | `approveMergeSuggestion`, `rejectMergeSuggestion` in `shared/handlers/cluster-merge-suggestions.ts` |
| `set_bug_report_status` | dismiss, reopen | `shared/handlers/bug-reports.ts` |
| `rerun_cluster_in_ci` | dispatch the re-run | `server/utils/ci-rerun.ts` |
| `link_issue` | link an existing ticket | `createLink` in `shared/handlers/links.ts` |
| `set_cluster_bisect` | record a first bad commit | 3.4 |

`list_open_clusters` already filters on the merge-suggestion and quarantine-ready queues; these tools let an agent act
on them. `set_cluster_status` stops erasing triage notes (A16).

### 3.2 Agent diagnoses and fix attempts

- `record_diagnosis` takes the diagnosis JSON schema the server already validates, stores it with provider `agent` and
  the model the agent names, validates its patch server-side and snapshots it into the versions. The dashboard shows
  it as written by an agent. Instances with no AI provider then get diagnoses, Fixed before and
  `diagnosis-verified` from the agent the developer already uses.
- `report_fix_attempt` takes a cluster, a kind (patch, locator edit, fix plan), a patch hash or the edit, a commit or a
  branch, and the diagnosis id. It records `applied` with channel `mcp`; fix verification later turns it into
  `verified` or `regressed`. The fix plan suggests a `Piwi-Cluster: <id>` trailer for the commit, and fix
  verification reads it as it reads `Piwi-Heal` (2.4) to tie the fix to the attempt.

### 3.3 Skills and prompts that report back

- `mcp_tool_calls` logs write tools only (API key, tool, subject, result), passing the key id through
  `event.context` in `server/routes/mcp.post.ts`. It follows notification retention, can be declined, and shows on the
  cluster's timeline ("an agent recorded a fix attempt").
- Each workflow skill ends with its write-back: `investigate-failure` with `submit_diagnosis_feedback` and
  `report_fix_attempt`, `write-the-missing-test` with `triage_gap` (and `piwi:gap <id>` once 5.1 adds the
  annotation), `apply-locator-healing` with `report_fix_attempt`.
- The six workflow skills are also served as MCP prompts, versioned with the app and bundled the way the docs corpus is
  (`shared/docs-corpus.ts`). `piwi skills add` stamps a version in each `SKILL.md` front matter and reports "outdated"
  apart from "edited" (`packages/reporter/src/cli/skills.ts`). The desktop app offers to install them in a linked
  folder, next to the MCP client configs it already writes (`apps/desktop/src-tauri/src/mcp_clients.rs`).

### 3.4 The desktop app and the team instance

- A team instance accepts a bisect result. Today `server/api/failure-clusters/[id]/bisect.post.ts` returns 404 unless
  the desktop token is set; it stops requiring the token, and its role check already limits it to administrators and
  reporters. The body is typed in `packages/core` before 1.0.
- The editor passes jobs between the two. On a CI failure from the team instance, "Reproduce in the desktop app" and
  "Find the breaking commit in the desktop app" post a job request (kind, commit, arguments, instance URL, the remote
  cluster id) to the desktop app, which asks the developer to confirm, as Piwi Picker's reproduction requests do. The
  editor polls the verdict and offers "Share on <instance>" with its own key. The desktop app never stores the team's
  key, and running code at another commit always needs the click in its window.
- Flake Lab follows the same path: the editor fetches the plan from the team instance with recording on, the desktop
  app runs it with `--plan` and `--json`, and the editor uploads the results.
- The desktop app links a local run by the `PIWI_ORIGIN_REF` it set, not as the newest id above a baseline, so
  concurrent runs stop cross-linking (A46).

### 3.5 Flake Lab from the editor and the failure pages

- An editor code lens on a flaky test: "Reproduce this flake" and "Verify the flake fix", built from
  `GET /api/projects/:id/flake-lab` and `flakeLabNextCommand`, run through the editor's existing run command with
  `--server-url`, so the results land on the instance the editor reads.
- Next-step rows (`shared/next-step.ts`): reproduce under the top suspect, then verify once reproduced. Home links the
  project's flaky tests that have an untested suspect or a reproduction waiting for a verify.
- An optional `flakeLab` workflow target in the CI re-run settings, reusing the dispatch.
- Planning order: untested suspects first, the reproduced one preferred in the clue and the flaky list (A17). A suspect
  that did not reproduce is demoted and explained, never dropped: ten clean runs only set an upper bound on the failure
  rate.

## Part 4: Proven facts in every explanation

Sketched; its own proposal when it starts.

### 4.1 A proven-facts section in the AI context

Right after the clues in `server/utils/ai-context.ts`: the bisected commit ("proven by bisect"), every latest Flake Lab
verdict including "ruled out" (with its commit and date), a verified fix, the resource findings of the representative
execution's worker, markers between the last green run and the first failure, the linked ticket's status and
resolution, and a merged auto-heal PR. In the same change, produce the `dialogs` and `pageDiff` sections that
`shared/diagnosis-sections.ts` declares and nothing writes (A42), and add the attempt diff to the retry progression.
The demo mirror (`app/demo/api/diagnosis-context.ts`) follows. The context hash covers every section, so each existing
diagnosis shows as stale once after the upgrade.

### 4.2 One cause

`shared/failure-cause.ts` (new) resolves `{ cause, source, confidence, evidence, conflicts }` from what exists today:
`errorType`, `ParsedErrorKind`, the verdict's `FailureWhy`, `flakyRootCause`, the AI category, the clue story and the
lab verdicts. Precedence: a person, then a reproduced lab suspect, then a strong clue story, then the AI (not rated
unhelpful, confidence medium or higher), then `flakyRootCause`, then `errorType`. The next step, the inbox clue and
the AI context read it. Later: a cause override on the cluster, and a source on `flakyRootCause`, so a verified fix
clears it (A39) and the finalize step stops overwriting a person's or the lab's value. It also settles the
disagreement where a `goto` timeout is a timeout in the inbox and an infrastructure failure on the cluster page.

### 4.3 The top clue and later diagnoses reach every delivery route

- The top clue in the PR comment entries (at most 5 per section), in notifications (at most 3 failures), in the Jira
  body (replacing the fingerprint hint) and in the editor's diagnostics, under the existing include toggles.
- `piwi explain <file:line | id> [--json]` prints the clues and the fix plan's Markdown. It was planned in
  [`failure-experience-audit.md`](failure-experience-audit.md) and never shipped.
- A `commentOnDiagnosis` integration policy (off by default) comments a ticket when a diagnosis completes after it was
  filed. The auto-heal PR body names the linked ticket, and a `commentOnHealPr` policy comments it when the PR opens or
  merges. A diagnosis line in PR entries refreshes the comment on `diagnosis.completed`, for the PR's latest run only.

### 4.4 Markers as evidence

`piwi marker` in the CLI, `create_marker` and `list_markers` over MCP, and an opt-in deploy marker from the CI
metadata. Markers between the last green run and the first failure feed the verdict's "since", a clause in the
situation block, the proven-facts section (4.1) and the cluster's trend chart, which hides markers today. The run
header shows every marker in its window (A37).

### 4.5 Resource clues

`pages-left-open` and `cpu-starved` clues from `test_runs_cases.resources` (pages open when the test started, browser
run-queue wait, event-loop delay), gated on the `resources` capability and silent where a metric is missing. Then an
open-pages factor in the flake profile, a REST endpoint for findings, an editor diagnostic at the opening line, and a
`fix-resource-leaks` skill. New clues reach the AI context through the clues section with no extra work.

### 4.6 Reversible cluster merges

A merge log (method, score, actor, the triage state of the cluster merged away), the original fingerprint on each
execution so a merge can be undone, and an unmerge endpoint. Part 0 already makes rejected merges stay rejected and
"Move to a new cluster" create a cluster.

## Part 5: What the suite misses

Sketched; its own proposal when it starts.

### 5.1 From a gap to the test that closes it

The draft emits `piwi:gap <id>`, and `TestMetadata` gains `gap` next to `bug` (`packages/core/src/test-meta.ts`).
`scenario_gaps` gains `closed_by_test_case_id` and `close_reason` (`test-written`, `covered-by`, `signal-gone`). When a
test carrying the annotation reaches the gap's subject, the gap closes with that test, the draft's outcome becomes
`verified`, and the verdict counts toward its detector's precision. The score gains the protection factor the schema
comment already describes (the share of probes the reaching tests noticed) and a smoothed precision factor. A gap can
become a ticket through `entity_links`, gets an owner through `server/utils/scm/ownership.ts`, and sends `gap.new`
above a minimum score, and project-wide gaps get their exposure (A45). The eleven pure detectors with no production
caller ([Appendix B](#appendix-b-docs-and-proposals-that-say-more-than-the-code)) are wired one at a time behind the
precision loop.

### 5.2 Impact that learns from its misses

One `resolveFileReach` serves impact (`server/utils/selection-impact.ts`) and change coverage
(`server/utils/scm/change-coverage.ts`): spec path, locator call sites, route conventions, code reach, handler pairs
and source frames. That restores the precision Part 0 gives up for A1. The selection stamp gains the base commit. When
an eligible complete run fails a test that a recent impact run on the same branch skipped (flaky and quarantined tests
aside), Piwi records an impact miss and adds a learned `affects` edge, a kind the graph schema already reserves.
Unmapped files are kept as changed-unreached instead of dropped.

### 5.3 New tests before they land

A "New tests" PR section for tests absent from the base branch's runs (`server/utils/branch-baseline.ts`), each checked
from stored data: no assertion step, slower than the project's 90th percentile, a brittle locator
(`packages/core/src/locator-stability.ts`), the same reached routes and pages as an existing test. `piwi flake burn-in
<files>` runs the lab's arms with a generic stress profile (control, CPU, network, a neighbor test) and counts any
failure. A gate rule, `maxUnprovenNewTests`, can require the burn-in.

### 5.4 Escapes

- A per-page escape history from every bug report of the last 180 days, not only open ones, with the routes their
  pages load. Reported failed requests match route keys, so "a 500 in the field on a route the suite only sees
  succeed" joins the success-only gap.
- Open reports on a cluster's pages go into the AI context.
- `detectEscapedDefect` gets a loader: tracker bugs with no linked cluster, through the configured connection.
- A user-pushed import, `PUT /api/projects/:id/surface/usage`, fills `graph_nodes.usage_30d`, modeled on the manifest
  import. It is never a beacon (D2).

### 5.5 Capture fidelity

- A per-execution route set (method and normalized URL) taken before the 50-request cap, stored as a content-addressed
  payload, feeds the graph. Reach then no longer depends on which requests were the slowest.
- `pageerror` and `crash` are recorded as console entries of those types, with no schema change. That makes the
  probes' "unhandled" class reachable and gives a direct crash signal.
- A wrapper on Playwright's `request` fixture, the first step of [`api-contract-drift.md`](api-contract-drift.md), so
  API-only tests reach routes.
- ASP.NET Core sends a root span on every request with the endpoint and the route template, and serves
  `/__piwi/manifest` from its endpoint data source (`integrations/aspnetcore`). The Nitro manifest comes from the
  build-time handler list instead of the requests the server has seen (`integrations/nitro/src/manifest.ts`).
- Per test and route, web-vitals medians compared in the Changes tab.

### 5.6 A capture plan from the server

The ARIA sampling answer grows into a capture plan, `{ aria, codeReach, inventory, declined }`, which global setup
writes to one file as it writes the ARIA sample file today. The server turns code reach on for tests whose reach rows
are missing or old, for flaky tests and for files an impact miss named; the reporter skips declined captures; local
options still win. Code reach then becomes affordable on every run.

### 5.7 Bug reports, the last step

- A "Commit the failing test" action opens a pull request with the commit version of the spec, as a second kind of
  heal action. It is gated by the `bug-reports` capability and SCM write access, not by the auto-heal switch, and it
  adds a new file with a guard that the path does not exist (`applyHealAction` drops new files today). The sweeper
  reads `kind` (A44).
- "Keep as failing test" in the desktop app writes the commit version into the bugs folder after a reproduction,
  instead of deleting the spec. The app also removes the reproduction spec when it quits mid-run (A36).
- The person who filed the report hears when it looks fixed and when it closes, through the fix-author personal
  channel. Reproduction verdicts give a "confirmed" or "cannot reproduce" badge.
- Before Send, Piwi Picker shows the open reports on the same page.
- The editors list the open reports for the pages a file's tests visit, with "Write the failing test".

## Part 6: Time, ownership and release

Sketched; its own proposal when it starts.

### 6.1 Aging and escalation

`quarantined_tests.expires_at` and `failure_clusters.assigned_at`. A per-project policy next to the targets:
unassigned for N days, open beyond the target age, quarantined for more than 30 days, `test.fixme()` for more than 60,
an accepted gap unwritten for 14. A nightly task queues `cluster.overdue`, `quarantine.expired` and `target.missed`
through the outbox, routed by owner, with an inbox queue for overdue items and an optional Jira comment policy. Insight
rules (`stale-cluster`, `owner-load`, `quarantine-debt-growth`) become subscribable the same way.

### 6.2 Assignment and one work queue

A `cluster.assigned` event when the assignee resolves to a user, delivered through the fix-author personal channel and
the live stream. The Jira assignee fills Piwi's when it is empty. `/api/inbox` returns typed items (clusters, open bug
reports, auto-heal PRs waiting for review, new leaks, reproduced flakes waiting for a verify, quarantine releases,
overdue items), and `list_work` serves the same over MCP. A teams entity waits until a second consumer needs one, as
[`issue-tracker-integrations.md`](issue-tracker-integrations.md) decided.

### 6.3 Release readiness

`piwi gate --release <label>` and a snapshot at the release marker's run: open clusters by test priority, quarantines
with their age, accepted gaps still unwritten, fixes not yet verified, files changed since the previous release that
no test reaches, and open bug reports. It is stored as a report snapshot linked to the marker and rendered by the
quality-report pipeline. Clusters that appear after the release link back to it.

### 6.4 Suite hygiene and test identity

- Per test: cost (duration, runs per week, `shared/ci-cost.ts`), real regressions caught in 180 days, reach no other
  trusted test has, last execution, skip or fixme age. Proposals: move to a nightly selection, merge with a named test,
  delete, un-skip. Shown on the Performance tab, as an MCP tool and as a quality-report section.
- It needs stable test identity. When one test disappears and another appears in the same file or with the same title,
  Piwi proposes a rename, and a person confirms it into `test_case_aliases`. A test absent from N eligible complete
  runs gets `retired_at`, which also drops it from the `failed` selection (A43). Per-test daily rollups keep the
  history these decisions read past retention.

### 6.5 Dependency bumps

A run whose diff touches only manifests and lockfiles, or that carries a Playwright version marker, groups its new
locator failures together and heals them in one batch. With a per-project opt-in, the edits go onto the bump pull
request's own branch; today auto-heal skips every branch but the default. One PR section lists what was healed and
what needs review.

## Part 7: Independent tracks

Each can start at any time.

### 7.1 Evidence privacy

`packages/core/src/mask.ts` masks base64 data URIs, JWTs and long hex strings only, so a password typed with `fill()`
is stored as typed, shown on the timeline and sent in the AI context (A47). Playwright's own trace keeps it too; Piwi
keeps it indefinitely and sends it to a model.

- The capture fixtures mask `fill`, `type` and `pressSequentially` values when the target is a password input, has an
  `autocomplete` of `current-password`, `new-password`, `one-time-code` or `cc-*`, or matches a project's
  `secretPatterns`.
- Ingest masks card numbers (Luhn check), IBANs, emails and known API-key prefixes in step parameters and console text.
- Exports and share links scrub the trace archives they include (`server/utils/trace-zip.ts`).
- The AI context runs a redaction pass, shown in the prompt preview (`shared/ai-prompt-preview.ts`).
- `apps/docs/guide/privacy.md` states all of it.

### 7.2 Activation beyond the first run

- `CapabilityDef` gains `reporterSince`, and the project's capability states read the latest run's reporter version:
  "resources need reporter 0.45; this project reports 0.41". `app/utils/setup-capabilities.ts` already promises this.
- A per-project "what you are missing" card from `resolveProjectStates`, visible to non-administrators.
- `piwi init --login` through the device flow the editors and Piwi Picker use (`server/utils/extension-connect.ts`),
  and `piwi init --ci github|gitlab` writing the workflow (connection, output file, gate, optional scheduled probe and
  flake jobs) from the YAML already in `apps/docs/guide/ci.md`.
- Companion tools detected from approved connections and key use (`CompanionToolsCard.vue` says "informative rather
  than detected" while the evidence exists).

### 7.3 AI steps report their replays

The `piwi-ai-usage` manifest gains an optional replay result per entry (replayed, authored, drifted, postcondition
failed, missing), caught and rethrown in the fixture, so the AI steps tab ranks artifacts by drift. The healing panel
offers the re-author command next to an AI step's prompt (`piwi ai resolve --grep <title> --update-ai`).

### 7.4 Data captured and never read

| Data | Decision |
|---|---|
| `relatedIssue` run option | Wire it as a run-to-ticket link (`entity_links` origins `reporter` and `annotation` are never written) |
| `metadata.performance` | Remove before 1.0 |
| `ciInfo` option (the UI reads `metadata.ci`) | Remove before 1.0 |
| ARIA locator suggestion annotation | Keep: it targets Playwright's own report |
| Graph edges `triggers` and test-to-control `reaches` (read by detectors, never written) | Write them: test-to-control from the locator index, triggers from step and request timing |
| Graph edges `imports` and `changes` (read only by the generic walk) | Use imports one hop in reach, and changes in the escape history |
| Piwi Picker's "Not tested" overlay (copies a locator only) | Add "Record from here" and a link to the Gaps tab |

## Part 8: Further out, each with an entry condition

| Item | Starts when |
|---|---|
| Policy as code: a `piwi.policy.json` the reporter sends, the gate evaluating the stored policy, `piwi policy pull` and `push`, settings export and import without secrets | A team asks to review gate policy in pull requests, or 1.0 settles the gate surface |
| Team knowledge packs: declarative clue rules, "promote a triage note to a rule", export and import, Fixed before across projects | 4.2 has shipped |
| Instance health: task heartbeats, failed deliveries per channel with a retry, storage growth against free disk, `instance.degraded` | The first report of notifications failing silently |
| Reports to Piwi's maintainers: a redacted fixture opened as a prefilled issue or downloaded as a test fixture, an "unparsed error shapes" counter | 7.1 has shipped |
| Accessibility and page budgets: a control that lost its accessible name, unnamed controls, per-page budget gate rules | 5.5 has shipped |
| Outcome-driven ranking of heal strategies and per-rule clue precision | A project passes 50 recorded heal outcomes |

## Storage and wire

| Kind | Added |
|---|---|
| Tables | `handback_outcomes`, its daily rollup, `gate_evaluations`, the PR feedback record, `mcp_tool_calls`. Later: `scenario_gaps.closed_by_test_case_id` and `close_reason`, `quarantined_tests.expires_at`, `failure_clusters.assigned_at` and a cause override, `test_case_aliases`, per-test daily rollups, the original fingerprint on `test_runs_cases`, a merge log, a route-set payload column on `test_runs_cases` |
| Run metadata | `piwiOrigin`, `incident`, `ingestHealth` |
| Reporter | `PIWI_ORIGIN`, `PIWI_ORIGIN_REF`, console entry types `pageerror` and `crash`, the route-set attachment, the capture-plan file, `gap` in test metadata |
| Events | `environment.incident`, `run.interrupted`, `cluster.assigned`, `cluster.overdue`, `quarantine.expired`, `target.missed`, `gap.new` |
| MCP | `triage_cluster`, `triage_gap`, `decide_merge_suggestion`, `set_bug_report_status`, `rerun_cluster_in_ci`, `link_issue`, `set_cluster_bisect`, `record_diagnosis`, `report_fix_attempt`, `create_marker`, `list_markers`, `list_work`, and the workflow prompts |
| CLI | `piwi explain`, `piwi marker`, `piwi flake burn-in`, `piwi gate --release`, `piwi init --login` and `--ci` |

Migrations are generated for both dialects, per [`apps/application/AGENTS.md`](../apps/application/AGENTS.md#database).
Every row of this table gets a D entry in [`1.0-stabilization.md`](1.0-stabilization.md) before it ships (D10).

## Delivery

| PR | Part | Content | Needs |
|---|---|---|---|
| 1 | 0 | The verdicts: A2, A4, A5, A11, A16, A26, A29, A30, A32, A38; the quarantine-aware `piwi/tests` (A25) | none |
| 2 | 0 | Ingest and lab runs: A3, A6 to A10, A18, A19, A24 | none |
| 3 | 0 | Analysis: A1, A12 to A15, A17, A20 to A23, A27, A31, A33 to A35 | none |
| 4 | 1 | Run origin from every launcher (A41), the eligibility rule, CI re-run correlation and targeting (A28) | 2 |
| 5 | 1 | Branch backfill, historical imports, ingest health, `run.interrupted` | 2 |
| 6 | 1 | Environment incidents | 4 |
| 7 | 2 | Outcome table, inferred outcomes, rollup counters (A40) | 4 |
| 8 | 2 | Gate evaluations and status, the PR feedback record, the override sweep | 7 |
| 9 | 2 | Auto-heal outcomes, full commit messages, trailers | 7 |
| 10 | 2 | Diagnosis quality, the hand-back metrics and section | 7 to 9 |
| 11 | 3 | MCP triage verbs | 1 |
| 12 | 3 | `record_diagnosis`, `report_fix_attempt`, the write log, skills that end with their write-back, skills as prompts | 7, 11 |
| 13 | 3 | Bisect results on team instances, jobs passed from the editor to the desktop app (A46) | 4 |
| 14 | 3 | Flake Lab in the editor, the next step and Home | 4 |

Parts 4 to 7 get their own proposals; Part 7 can start at any time, and 7.1 is the one to start first. Each PR carries
its docs, its demo handlers (`npm run app:check:demo`) and, where it adds a page or a section, its screenshot scene.

## File-by-file checklist

### PR 1: the verdicts
- `server/utils/fix-verification.ts`: no fix when the commit is unchanged since the last failure (recorded as flake
  evidence); candidates scoped to the cluster's branch or the default branch.
- `server/utils/ai-diagnosis.ts`: the prior assessment comes from the snapshot written before `claimRunningRow` resets
  the row; `runningDiagnosisFields` resets the feedback and its note. `server/utils/ai-context.ts`:
  `priorDiagnosisSection` reads that snapshot. `server/utils/cluster-memory.ts`: `findFixedBefore` skips a diagnosis
  rated unhelpful, so the AI context and the fix plan both follow.
- `server/utils/retention.ts` (`pruneHealActions` without `opened`), `server/utils/heal/pr-state.ts` (bump the row on
  each check, oldest check first), `server/utils/heal/policy.ts` (failed and skipped rows free their dedupe key).
- `shared/handlers/failure-clusters.ts`: status changes and bulk triage keep the triage note unless a new one is given.
- `shared/pr-feedback.ts` (`buildCommitStatus`), `server/utils/scm/pr-feedback.ts` (quarantined ids through
  `getQuarantinedCaseIds`), the project setting, `apps/docs/features/flaky-tests.md`.
- `server/api/settings/ai/usage.get.ts`: the window reads creation time.
- Tests: `tests/unit/fix-verification.test.ts`, `pr-feedback.test.ts`, `heal-pr-state.test.ts`,
  `ai-context-sections.test.ts`.

### PR 2: ingest and lab runs
- `server/api/test-runs/[id]/begin.post.ts`, `server/api/test-runs/[id]/finish.post.ts` (sharded path): the branch.
- `shared/handlers/import-runs.ts`, `server/utils/blob-report.ts`: branch and commit from the blob's metadata.
  `server/utils/persist-run-cases.ts`: historical imports keep current metadata and locks, executions dated from their
  attempt.
- Lab filters: `server/utils/branch-failures.ts`, `shared/handlers/selections.ts`,
  `shared/handlers/selection-suggestions.ts`, `shared/handlers/change-coverage.ts`, `server/utils/environment-diff.ts`,
  `server/utils/visual-diff.ts`,
  `server/utils/page-diff.ts`, `shared/handlers/aria-sampling.ts`, the baseline comparison in
  `server/utils/ai-context.ts`. `branch-failures.ts` also takes complete runs only.
- `server/utils/persist-run-cases.ts`: no locator-snapshot or test-metadata writes from lab and bisect runs.
- `server/utils/sanitize.ts`: the step cap keeps failed steps and records how many it dropped.
- Tests: one per consumer, each with a lab run newer than the CI run.

### PR 3: analysis
- `server/utils/selection-impact.ts`: a file mapped only through another test's failure frames widens; a changed
  non-source file widens unless something maps it. `tests/unit/selection-impact.test.ts`.
- `server/utils/ai-context.ts`: recurrence and retry sections read the cluster's tests' executions.
- `shared/notification-events.ts`: the owners filter applies to every event whose payload carries owners.
- `shared/handlers/failure-clusters.ts` (`extractClusterCases`: "Move to a new cluster" creates a cluster and appends
  to its note),
  `app/components/cluster/ClusterAffectedTests.vue`, `server/utils/cluster-reconcile.ts` (skip rejected pairs, store
  LLM "no" verdicts).
- `shared/failure-clues.ts`, `shared/handlers/flake-profile.ts`: the reproduced suspect first; the load suspect's id
  without its threshold. `tests/unit/failure-clues.test.ts` with several suspects.
- `shared/handlers/bug-reports.ts`: the lifecycle reads default-branch runs only.
- `shared/handlers/probes.ts` (re-probe on a source hash), `shared/handlers/scenario-gaps.ts` (`covered-by` closes the
  gap; a covered-by on a surface-drift gap does not switch on project-wide control gaps).
- `apps/desktop/src-tauri/src/worktree.rs` (reproduction and bisect steps pinned to the local app, as lab sessions are),
  `app/components/shared/ReproduceSection.vue` (match the live bisect by cluster).
- `shared/handlers/aria-sampling.ts` (honors a declined `green-samples` capability),
  `packages/reporter/src/internal/ai/check.ts` (the message) and `packages/reporter/src/cli/ai.ts` (the prune stub).

### PR 4: run origin and eligibility
- `packages/reporter/src/internal/config/env.ts`, `internal/collect/metadata-collector.ts`, `packages/core/src/wire.ts`.
- `apps/desktop/src-tauri/src/runner.rs`, `worktree.rs`, `repro.rs`; `packages/editor/src/server.ts`;
  `packages/reporter/src/cli/preflight.ts`, `bug.ts`; `shared/handlers/import-runs.ts` (`import`);
  `server/utils/ci-rerun.ts`, `shared/ci-rerun.ts` and the three providers (dispatch ids, the optional correlation
  input, each test's file and line, the cluster's branch).
- `shared/run-eligibility.ts` (new) and its unit test; every PR 2 consumer, `shared/handlers/bug-reports.ts` and
  `shared/handlers/probes.ts` move to it.
- `shared/piwi-env-vars.ts`, `apps/docs/guide/ci.md`, `proposals/1.0-stabilization.md`.

### PR 5: branch, imports, ingest health
- A startup backfill in `server/plugins/`; analytics stop counting a null branch as the default branch;
  `server/utils/graph-ingest.ts` (`pruneStaleCanonicalNodes`).
- `metadata.ingestHealth` from `server/utils/sanitize.ts` and the submit paths; the run page; `ai-context.ts`.
- `server/utils/stale-runs.ts` and `shared/notification-events.ts` (`run.interrupted`).
- `shared/handlers/import-runs.ts`, `server/utils/persist-run-cases.ts`: a historical import does not wake snoozed
  clusters and is not eligible for `shared-state`.

### PR 6: environment incidents
- `shared/handlers/run-health.ts` (new), `server/utils/run-finalize-side-effects.ts`, `shared/handlers/markers.ts`,
  `shared/notification-events.ts`, `server/api/test-runs/[id]/gate.post.ts` and `packages/reporter/src/cli/gate.ts`
  (inconclusive), the inbox, the run header, a docs page, the demo seed.

### PR 7: outcomes
- Schema in both dialects and generated migrations; `server/utils/outcomes.ts` (new).
- `server/utils/locator-healing.ts` and `persist-run-cases.ts` (store `healedInRunId`, later runs only),
  `server/utils/fix-verification.ts` (the diagnosis version), `server/utils/heal/pr-state.ts`,
  `shared/handlers/analytics/rollups.ts`, `server/utils/retention.ts`.
- `shared/handlers/cluster-merge-suggestions.ts`, `shared/handlers/quarantine.ts` (decisions copied as outcomes),
  `server/api/projects/[id]/gaps/[gapId]/draft.post.ts` (an issued draft records `suggested`).

### PR 8: the gate and the PR feedback
- Schema and migrations; `server/api/test-runs/[id]/gate.post.ts`; `server/utils/scm/pr-feedback.ts`;
  `shared/handlers/setup-status.ts`; a sweep in `server/tasks/`; `apps/docs/guide/ci.md`.

### PR 9: auto-heal outcomes
- `server/utils/heal/policy.ts`, `server/utils/scm/ScmProvider.ts`, GitHub and GitLab (full messages), Bitbucket (the
  commits over the range), `server/utils/fix-verification.ts` (`healPr`), `shared/notification-events.ts` (additive
  payload field).
- `shared/auto-heal.ts` and `server/utils/heal/lookup.ts` (a run on a heal branch finds its action from the branch name
  and records "verified on the branch").

### PR 10: diagnosis quality and hand-back metrics
- `server/api/settings/ai/usage.get.ts`, `app/components/settings/AiUsagePanel.vue`, `server/utils/ai-diagnosis.ts`
  (budget), `server/utils/quarantine-candidates.ts`, `shared/analytics/metrics.ts` and its value loader, the Analytics
  page, the quality-report sentences, `apps/docs/features/analytics.md`.

### PR 11: MCP verbs
- `shared/mcp-tools.ts`, `server/utils/mcp/tools.ts`, the generated MCP tools page.

### PR 12: agent diagnoses, fix attempts, prompts
- `server/utils/mcp/tools.ts`, `server/routes/mcp.post.ts` (key id), schema for `mcp_tool_calls`,
  `shared/mcp-prompts.ts`, `packages/reporter/src/cli/skills.ts`, `apps/desktop/src-tauri/src/mcp_clients.rs`, the
  cluster timeline, `server/utils/fix-verification.ts` (`Piwi-Cluster`).
- `packages/reporter/templates/skills/*/SKILL.md`, `apps/docs/features/agent-skills.md`.

### PR 13: desktop and team instance
- `server/api/failure-clusters/[id]/bisect.post.ts`, a bisect body type in `packages/core`, the desktop job request
  (generalizing `DesktopReproRequestModal.vue`), `packages/editor/src/server.ts` (quick fixes, polling, sharing),
  `apps/vscode` and `apps/jetbrains` commands, `app/composables/useDesktopLocalRuns.ts` (A46),
  `apps/docs/features/desktop.md`, `apps/docs/features/editors.md`.

### PR 14: Flake Lab from the editor and the failure pages
- `packages/editor/src/server.ts` (code lens), `shared/next-step.ts`, Home, `shared/ci-rerun.ts` (lab target),
  `shared/handlers/flake-lab.ts` (planning order), `apps/docs/features/flake-lab.md`.

## Verification

1. A cluster fails at commit A; the same commit is re-run and passes: no fix is recorded, the cluster stays open, the
   re-run is recorded as flake evidence. A pass at commit B on the default branch records the fix.
2. A sharded run on a pull-request branch has its branch; the editor shows its failures; the
   same-branch baseline picks it (`selectBaselineRun`).
3. Twelve `piwi flake` arms after a CI run: the editor's CI failures, change coverage, the `failed` selection, the
   environment, visual and page diffs and the locator snapshots are unchanged.
4. A heal applied by hand and pushed: the next CI run records `applied` (inferred) and the run after it `verified`;
   Analytics shows one call site adopted.
5. An auto-heal PR closed without merging: the next default-branch run opens no PR for the same edit. A PR left open
   for 31 days keeps its row and opens no duplicate.
6. A diagnosis rated unhelpful, then re-run: the prompt carries the prior assessment and the "do not repeat" line, and
   the new version carries no rating.
7. An agent calls `get_fix_plan`, edits, calls `report_fix_attempt`, and CI passes on a new commit: the attempt is
   `verified` and the cluster's timeline shows it.
8. The gate fails, the PR is merged anyway, and the cluster regresses on main: one override and one escape are counted.
9. The staging host refuses connections during one run in two projects: one incident marker, one event, unchanged
   flaky scores, an inconclusive gate.
10. A CI failure bisected in the desktop app from the editor and shared: the team instance's cluster shows the first
    bad commit.
11. With code reach off, a changed helper used by passing tests and by one test that failed in it last time: impact
    widens to the full suite.

## Risks

- **Attribution noise.** An inferred `applied` also counts a hand edit that happens to match the recommendation, so it
  is labeled "matched the recommendation", not "applied by Piwi".
- **Numbers move after Part 0 and Part 1.** Stricter fix verification sends fewer `cluster.fixed` events. Leaving lab
  runs out changes pass rates and durations. A quarantine-aware `piwi/tests` changes what the status means. The release
  notes say so, and the quarantine rule has a setting.
- **Local runs.** On the desktop app every run is local, and some teams only run locally against a team instance.
  Eligibility must not leave those projects with no baseline (open question 1).
- **1.0 surface.** The plan adds metadata keys, events, MCP tools and CLI commands while the wire is about to freeze.
  D10 makes each one an explicit decision.
- **Small samples.** D7 keeps every learned number behind a floor and out of automatic decisions.
- **The write log.** Write tools only, bounded by retention, declinable.
- **Scope.** Fourteen specified PRs and four sketched parts. Parts 4 to 7 start only with their own proposal, and
  each specified PR ships value on its own.

## Open questions

1. **Do local runs on a team instance count for flaky scores and baselines?** Recommendation: complete local runs
   count as today, except as the editor's CI failures when a CI run exists on the branch; partial runs never count for
   "not reached in N runs" analyses such as change coverage; on the desktop app, local runs are the primary data.
2. **Is a hand edit that matches the recommendation an applied heal?** Recommendation: yes, labeled as matched.
3. **Does `record_diagnosis` obey a declined `ai` capability?** Recommendation: no. Declining `ai` stops Piwi calling a
   model; an agent's diagnosis is the developer's own. Agent diagnoses get their own declinable capability.
4. **What does the gate return when the run is an incident?** Recommendation: a distinct exit code, decided in
   `1.0-stabilization.md` with the other gate codes.
5. **Incident thresholds.** Recommendation: start with 80% of tests failed and 70% of failures navigating or connecting
   to the app's host, and tune them on the demo and on real projects before the flag affects the gate.
6. **Should a green run on a heal branch mark the draft PR ready for review?** Recommendation: no, a comment only.
7. **Outcome counters: a new rollup table or columns on `analytics_daily_rollups`?** Recommendation: a sibling table
   with the same keys, since the run rollups are per run and outcomes are per hand-back.

## Not in this plan

- Learning heal-strategy weights and the auto-heal minimum score from outcomes: auto-heal is off by default and capped
  at three open PRs per project, so there is almost no data (Part 8 names the entry condition).
- Precision per clue rule: sixteen deterministic rules and very few labels.
- Flake Lab priors shared across tests: one test's results would change another test's suspect ranking.
- One-click signed actions in Slack, Teams and email: they need the instance to be reachable from outside and put
  bearer tokens in messages.
- Share links in PR comments: a bearer token in public repositories.
- A pull request from Piwi that removes `test.fail()`: the PR that fixes the bug is the place, and the PR comment
  already says so.
- Notifications and rollups for resource leaks: the gate and the PR comment cover CI.
- Switching AI models automatically.
- Anything that sends data off the instance.

## Appendix A: Defects found

Found while researching this plan, on `b103d2d`. ✓ marks the ones re-read by hand after the reviewer reported them.

| # | Severity | Defect | Where |
|---|---|---|---|
| A1 ✓ | High | Impact selection skips passing tests that use a changed helper. Source frames are recorded only on failure and only each test's latest execution is read, so one recent failure inside the helper marks it mapped, nothing widens, and every other user of the helper is skipped (code reach off, the default). | `server/utils/selection-impact.ts` (`loadSourceReach`), `packages/reporter/src/public/reporter.ts` |
| A2 ✓ | High | The AI's prior assessment never reaches a real diagnosis. `claimRunningRow` resets the row to `running` before the context is built, and `priorDiagnosisSection` returns nothing unless the row is completed. The triage note, the thumbs-down "do not repeat" line and the previous category are never sent, though the prompt preview shows them. | `server/utils/ai-diagnosis.ts`, `server/utils/ai-context.ts` |
| A3 | High | Sharded runs have no branch: `/begin` writes metadata without it and the sharded `/finish` ignores the metadata it receives; blob and trace imports set none. The same-branch baseline, the editor's CI failures and the rollups miss these runs, and graph pruning treats them as the default branch. | `server/api/test-runs/[id]/begin.post.ts`, `finish.post.ts`, `shared/handlers/import-runs.ts`, `server/utils/graph-ingest.ts` |
| A4 ✓ | Medium | A pass at the failing commit is recorded as a fix: no check that the commit changed. A CI retry, or Piwi's own "Re-run in CI", sends `cluster.fixed`, emails that commit's author, posts "fix landed" on the ticket, then marks the cluster regressed at the next failure. | `server/utils/fix-verification.ts` |
| A5 | Medium | Fix verification ignores the branch: a green run on a pull-request or heal branch records the fix, can resolve the cluster and transition its ticket; the next default-branch failure reopens it. | `server/utils/fix-verification.ts`, `server/utils/integrations/policies.ts` |
| A6 ✓ | Medium | The editor's CI failures come from the newest run on the branch, whatever it is: a Flake Lab arm, a local `--grep` run or a run still in progress. | `server/utils/branch-failures.ts` |
| A7 | Medium | The selection catalog counts lab runs: a probe the test noticed fails it, so the built-in `failed` selection re-runs a healthy test; lab arms inflate durations and lower pass rates, which taints `slow` tags and smoke suggestions. | `shared/handlers/selections.ts`, `shared/handlers/selection-suggestions.ts` |
| A8 | Medium | Change coverage reads the last 30 runs by id with no lab, branch or completeness filter; after `piwi flake`, changed files read "reached in 0 of 30 runs". | `shared/handlers/change-coverage.ts` |
| A9 | Medium | The environment, visual and page diffs pick their baseline from the 20 newest passing executions with no lab filter, so a passing lab arm can be the baseline; green-sample deduplication counts lab samples, so CI green samples are dropped for 24 hours. | `server/utils/environment-diff.ts`, `visual-diff.ts`, `page-diff.ts`, `server/utils/persist-run-cases.ts`, `shared/handlers/aria-sampling.ts` |
| A10 | Medium | Lab and bisect runs write shared state: a bisect step at an old commit rewrites tags, owner and locks, and replaces locator snapshots with old ones, so healing works from stale pages. | `server/utils/persist-run-cases.ts` |
| A11 ✓ | Medium | Auto-heal rows still `opened` are pruned after 30 days, and the state sweep never touches a row while its PR stays open; the cap and the dedupe key disappear and the next run opens a duplicate PR. | `server/utils/retention.ts` (`pruneHealActions`), `server/utils/heal/pr-state.ts` |
| A12 ✓ | Medium | The AI context calls every flaky cluster persistent: passed executions are never fingerprinted, and the recurrence and retry sections look for passed rows carrying the cluster id. The demo seed hides it by setting the cluster id on every row. | `server/utils/persist-run-cases.ts`, `server/utils/ai-context.ts` |
| A13 ✓ | Medium | A subscription filtered by owner receives every non-run event of the project (new clusters, flakiness spikes, performance regressions): the owners filter runs only for `run.*` events. | `shared/notification-events.ts` |
| A14 | Medium | "Move to a new cluster" unlinks the tests, which rejoin the same cluster at their next failure, though the dialog says they regroup into their own; the note typed there replaces the cluster's triage note. | `shared/handlers/failure-clusters.ts`, `app/components/cluster/ClusterAffectedTests.vue` |
| A15 | Medium | A rejected merge suggestion can be merged by the embedding or LLM pass; LLM "no" verdicts are not stored, so the same pair is judged and paid for again; an approved merge leaves no record. | `server/utils/cluster-reconcile.ts` |
| A16 | Medium | Changing a cluster's status (inbox, lists, MCP `set_cluster_status`, bulk triage) wipes its triage note, including the automatic "reopened" lines. | `shared/handlers/failure-clusters.ts` |
| A17 | Medium | A reproduced flake cause is hidden when a higher-ranked suspect is untested: the clue and the flaky list take the first suspect. | `shared/failure-clues.ts`, `shared/handlers/flake-profile.ts` |
| A18 | Medium | The step cap keeps the first 500 steps with no marker, and can drop the failing step. | `server/utils/sanitize.ts` |
| A19 | Medium | Imported executions are dated at import time and become the latest; an old blob overwrites current tags, owner and priority and sets locks to null, which lock-aware sharding then ignores. | `server/utils/persist-run-cases.ts`, `shared/handlers/import-runs.ts` |
| A20 | Medium | The bug-report lifecycle ignores branch and run type: a feature-branch run closes a report, and an uncommitted `piwi bug --write` run marks it test-committed; the ticket follows each flip. | `server/utils/run-finalize-side-effects.ts`, `shared/handlers/bug-reports.ts` |
| A21 | Medium | The re-probe trigger (`changed` in `buildProbePlan`) compares the probe time with `test_cases.updated_at`, which moves on tag, owner or flaky-cause writes, not on a change to the test's source or the route's handler; a not-noticed gap stays open after the assertion is fixed. | `shared/handlers/probes.ts` |
| A22 | Medium | `covered-by` leaves the gap open and never closes most gap classes; one covered-by on a surface-drift control gap switches on control gaps for the whole project. | `shared/handlers/scenario-gaps.ts` |
| A23 | Medium | A diff touching only CSS, HTML, JSON or YAML maps to no test, and `piwi run impact` runs nothing and exits 0. | `server/utils/selection-impact.ts`, `packages/reporter/src/cli/select.ts` |
| A24 | Medium | The AI context's baseline comparison counts lab passes, ignores the branch and compares run ids, so it can say a cluster "passed on a newer commit" after `piwi flake`. | `server/utils/ai-context.ts` |
| A25 | Low-medium | `piwi/tests` turns red on quarantined failures (`buildCommitStatus` counts every failure). The flaky-tests page says quarantine applies to the gate's checks "and nothing else", so this is documented behavior; PR 1 changes it on purpose, behind a setting (2.3). | `shared/pr-feedback.ts`, `apps/docs/features/flaky-tests.md` |
| A26 | Low-medium | A rating carries over to the next diagnosis version. | `server/utils/ai-diagnosis.ts` |
| A27 | Low-medium | The desktop app shows a running bisect's commit on any cluster of the same project. | `app/components/shared/ReproduceSection.vue` |
| A28 | Low-medium | "Re-run in CI" passes whole spec files (no line, no title filter), the same path once per affected test, and dispatches on the configured ref (GitHub, GitLab) or the repository's default branch (Bitbucket) rather than the cluster's branch. | `shared/ci-rerun.ts`, `server/utils/ci-rerun.ts` |
| A29 | Low | The heal state sweep always takes the 50 oldest rows and starves newer ones. | `server/utils/heal/pr-state.ts` |
| A30 | Low | A failed or skipped heal row keeps its dedupe key for 30 days, logged as "already queued". | `server/utils/heal/policy.ts` |
| A31 | Low | `piwi ai check` recommends `piwi ai prune --apply`, which exits 2. | `packages/reporter/src/internal/ai/check.ts` (the message), `packages/reporter/src/cli/ai.ts` (the stub) |
| A32 | Low | AI usage filters on `updatedAt`, which a rating moves; earlier versions' tokens are never counted. | `server/api/settings/ai/usage.get.ts` |
| A33 | Low | The load suspect's id embeds its threshold, so a lab result detaches when the threshold moves. | `shared/handlers/flake-profile.ts` |
| A34 | Low | Desktop reproduction and bisect steps inherit the app's environment; with a team URL and key in it, each step uploads an ordinary run of an old commit to the team instance. | `apps/desktop/src-tauri/src/worktree.rs` |
| A35 | Low | A declined `green-samples` capability is still sampled. | `shared/handlers/aria-sampling.ts` |
| A36 | Low | A desktop reproduction spec may be left in the project when the app quits mid-run (removed only on the run's end; inferred from the code). | `apps/desktop/src-tauri/src/repro.rs` |
| A37 | Low | The run header misses markers: a strict comparison and a limit applied before the environment filter. | `shared/handlers/test-runs.ts` |
| A38 | Low | A diagnosis rated unhelpful is still offered under Fixed before, in the AI context and the fix plan. | `server/utils/cluster-memory.ts` (`findFixedBefore`), `server/utils/ai-context.ts` |
| A39 | Low | `flakyRootCause` is never cleared, so the Test Map distrusts a test even after a verified fix. | `shared/handlers/scenario-gaps.ts` |
| A40 | Low | `stampHealedRun` accepts any run but the failing one, earlier runs included: it checks `lastSeenRunId !== failingRunId` only. | `server/utils/locator-healing.ts` |
| A41 | Low | Bitbucket Pipelines runs are recorded as "Unknown CI" (through `CI=true`) with no build number or URL: `collectCiInfo` has no Bitbucket case, though the branch and PR readers do. | `packages/reporter/src/internal/collect/metadata-collector.ts` |
| A42 | Low | The AI context's coverage block says the dialogs and page-diff sections are absent while clues cite them. | `shared/diagnosis-sections.ts`, `server/utils/ai-context.ts` |
| A43 | Low | A failed test that was renamed or deleted stays in the `failed` selection, which then finds no tests. | `shared/handlers/selections.ts` |
| A44 | Low | The heal sweeper ignores `heal_actions.kind`. | `server/utils/heal/dispatch.ts` |
| A45 | Low | Project-wide gaps sit at the score floor: the sweep, recompute and PR feedback pass no exposure, the age factor stays at or below 0.25, and import-origin file nodes create one-run surface-drift gaps. | `shared/handlers/scenario-gaps.ts`, `server/tasks/graph/sweep.ts` |
| A46 | Low | The desktop app links a local run as the newest id above a baseline, so concurrent runs cross-link. | `app/composables/useDesktopLocalRuns.ts` |
| A47 ✓ | Medium | A value typed with `fill()` into a password field is stored as typed, shown on the timeline and sent in the AI context; masking covers token-shaped strings only. | `packages/core/src/mask.ts`, `server/utils/sanitize.ts` |

## Appendix B: Docs and proposals that say more than the code

- [`scenario-gaps.md`](scenario-gaps.md) says the M2 detectors are wired. Eleven pure detectors have no production
  caller: phantom-coverage, passed-with-errors, catalog-method-no-test-calls, incidental-catch, assertion-light,
  intent-without-test, new-error-path, new-control, locator-break-ahead (it ships through `computeRunLocatorBreaks`
  instead), matrix, and escaped-defect from a tracker. The `scenario_gaps` schema comment describes a protection
  factor the score does not have.
- [`failure-experience-audit.md`](failure-experience-audit.md) says every recommendation is implemented; `piwi explain`
  (section H) never shipped.
- The "Move to a new cluster" dialog says the tests regroup into their own cluster (A14).
- `app/utils/setup-capabilities.ts` says "Automatic from reporter 0.45"; nothing reads the reporter version (7.2).
- `CompanionToolsCard.vue` says the list is informative rather than detected, while approved connections and key use
  could detect it (7.2).
- `piwi flake verify --bisect` says in its help that it saves nothing, while every step is reported as a lab run.

## Appendix C: Method

- One researcher per subsystem (reporter and capture, CLI and skills, ingest and data model, analysis, delivery and
  integrations, AI and agents, Test Map and selections, extension and bug reports, editors and desktop, product surface
  and proposals) mapped what each area produces, who reads it, what it hands back, and whether Piwi learns the outcome.
- The places where Piwi never learns the outcome became 28 candidate open loops. Eight reviewers, each holding three to
  five candidates, checked every claim against the code with the instruction to refute it; a claim that did not hold
  changed the candidate. The verdicts were 13 partially existing, 15 confirmed missing, none already built.
- A separate reviewer looked for stages nobody had listed. Environment incidents, new-test admission, aging, release
  readiness, suite hygiene, dependency bumps, privacy and the items in Part 8 come from it.
- Two more reviewers then checked this document: one against the code, one for consistency and wording.
- The defects marked ✓ in Appendix A were re-read by hand.
