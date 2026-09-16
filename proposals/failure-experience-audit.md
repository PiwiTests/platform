# Failing-run data — an end-to-end audit

**Status:** audit — every recommendation implemented and merged to `main` (program closed 2026-09-05) · **Scope:** everything Piwi does with the data of a failing run — what the reporter captures, what the server keeps and analyzes, how the dashboard shows it, and what it hands back to fix the failure · **Date:** 2026-09-01

**UI follow-up:** [`ui-simplification.md`](ui-simplification.md) designs big bet **L** (one investigation page with a fixed reading order) for every screen around tests, places the in-progress triage actions, and reserves the spots where **D**, **E**, **F**, **J** and **K** land.

This document is written for the maintainers. It is deliberately blunt: the product already does more than any Playwright dashboard I know of, and that is exactly why the remaining gaps matter — a user who has installed the reporter, the fixtures, an SCM token and an LLM expects the red run to be *explained*, not just *documented*.

Every finding carries a file reference. Findings marked **(seen)** were observed first-hand on a seeded instance (`npm run app:seed:dev`, dev server, Chromium at 1440 px) and not only in the code.

---

## 0. The ten findings that matter most

1. **The failing-execution page does not answer the question the user arrived with.** The first screen is the pinned summary (four stat tiles, a meta strip) and the raw Playwright error. The verdict, the cluster, the AI card and *every* piece of captured evidence sit below the fold, and nine of the evidence cards start **folded** — including the failure screenshot. "Diagnosis-first" is, on screen, "raw-error-first". (`app/pages/test-run-cases/[id].vue:631-778`, `app/components/shared/CollapsibleSectionCard.vue:29`) **(seen)**

2. **We capture a lot but correlate nothing.** In the docs' own hero screenshot the call log says `element is not enabled` and the console card — at the very bottom, folded — says `price quote still pending after 20s — Pay stays disabled`. Those two lines *are* the diagnosis. Nothing on the page puts them next to each other; there is no time axis, no "what happened just before the failure". The AI verdict on that same screenshot blames "the click races the render", which the console line contradicts. (`apps/docs/public/screenshots/gather-evidence.png`)

3. **Evidence is silently lost between capture and screen.** Body-only attachments never upload; the structured locator suggestion and the user's pick are attached but never parsed; network request start times are captured and then dropped at ingest, which leaves a dead "t+Nms" code path in the AI context; failed and aborted requests are never captured at all; `console.log` is discarded; a failure in `beforeAll` has zero evidence. Each one is small; together they are the difference between "I can see the DOM" and "I can see what happened". (§3.2)

4. **Locator healing fires on failures that are not locator failures, and its recommendation can be harmful.** On a `toHaveCount(26)` assertion that received 51 rows, the panel recommends replacing `getByRole('row')` with `getByRole('row', { name: 'Ada Lovelace ada@example.com admin' })` — which would turn a row-count test into a single-row test. The server never checks whether the locator failed to *resolve*. (`server/utils/locator-healing.ts:486-500`, `app/pages/test-run-cases/[id].vue:706-712`) **(seen)**

5. **"What changed?" is computed against the wrong baseline.** The environment diff and the visual diff pick the test's last passing execution *on the same browser* — not on the same environment, and for the environment diff not even on the same branch. A `development` failure is diffed against a `production` pass, and the diff then dutifully reports "Environment label: development ← production" as the change. (`server/utils/environment-diff.ts:81-82`, `server/utils/visual-diff.ts:151-165`) **(seen)**

6. **The loop has holes at both ends.** At the start: the reporter prints one `View run:` line — no per-failure deep link in the terminal, nothing in the Playwright HTML report, and the Slack alert links each failure to the test's *history* page rather than to the failing execution. At the end: the fix plan has no UI, fix verification never updates the triage status (a cluster reads *Fix verified* and *Open* at the same time), and diagnosis history is stored but invisible. (`packages/reporter/src/internal/support/ci-output.ts:51`, `server/utils/notifications/dispatch.ts:122`, `server/utils/fix-verification.ts:231-251`) **(seen)**

7. **Retries are recorded but not explorable.** Every attempt is a separate execution row with its own error, screenshots and trace, yet the attempt chips on the final attempt's page are plain badges — not links — and the run's lists collapse to the final attempt. The single most valuable flaky-test signal (what differed between the failing attempt and the passing one) is never computed. (`app/components/test-case/TestCaseSummary.vue:175-196`, `shared/handlers/test-runs.ts:565-570`)

8. **Cluster identity is anchored to its first occurrence and named after Playwright's error kind.** `sampleError`, `signature` and `errorType` are never refreshed after creation; without auto-diagnose there is no title, so a project's cluster list reads `Error: expect(locator).toHaveCount(expected) failed` — an error *kind*, not a *problem*. Masking placeholders such as `<N>` leak into page titles. (`shared/handlers/failure-cluster-ops.ts:44-56`, `server/utils/cluster-naming.ts:101-108`) **(seen)**

9. **The same thing has several names, and several things share one name.** "Executions (10)" sits above "10 cases", "Search test cases…" and a "Test case" column, while the *stable* test identity is also called "Test case". The API, component and page comments say "failure groups"; the UI says "failure clusters". "Verdict" means the regression card, the AI verdict *and* the fix-verification verdict. Failing locators render as `getByRole({"role":"row"})` — serialized JSON, not Playwright syntax. (§4.6) **(seen)**

10. **Half-installed capture produces silently half-empty pages.** A spec that still imports `test` from `@playwright/test` reports fine and captures nothing; `collectPerformanceMetrics: false` also drops the ARIA snapshot and console logs, which the option doc does not say; `screenshot: 'only-on-failure'` — the Playwright option behind the "Failure evidence" card — appears nowhere on the docs site. The `/setup` capability checklist is the product's real answer to "is this blank because it's broken or because I never switched it on?" and no empty state links to it. (`packages/reporter/src/public/reporter.ts:349-366`, docs sweep §4.8)

The rest of this document is the evidence behind each of these, the smaller findings, and — in §6 — what "game changer" would concretely mean.

---

## 1. Method

Four parallel code sweeps (reporter capture, server ingestion and analysis, dashboard display, documentation and proposals) plus a first-hand walk through the seeded dashboard: home, project, a failed run with one failure (run #70), a run with three failures across two clusters (run #56), a failing execution folded and fully expanded, two cluster pages (one fix-verified, one with a stale-name locator), and the Steps and History tabs. The screenshots in `apps/docs/public/screenshots/` were read as the intended design. GitHub issues were checked for user feedback (six issues total, two recent bugs about the trace viewer and shard metadata — no failure-experience feedback yet, which is itself a signal that the audit has to be internal).

Seed-data oddities (run numbers out of chronological order, `@fixme` tags on failing tests) are excluded unless the product's handling of them is the finding.

---

## 2. The journey today: from a red run to a fix

This is the path a developer actually walks. Each row lists what Piwi gives them at that step and where it stops short.

| Step | What the user has | Where it stops short |
|---|---|---|
| **Test fails locally or in CI** | Playwright's own terminal output. At the end of the run the reporter logs `View run: <url>`, writes GitHub step outputs / a GitLab dotenv, and a `::notice::` annotation. | No per-failure line (`✗ title → <execution url>`). Nothing is attached to the Playwright HTML report, so a developer opening `playwright show-report` never learns Piwi exists. The URL is emitted *after* the whole run, so on a 20-minute suite the link arrives 20 minutes after the failure scrolled by. (`ci-output.ts:41-56`) |
| **Alert arrives** | Slack / email / webhook with the top three failures, a 300-char error excerpt and owners; `cluster.new` with a sample excerpt; PR comment with new vs pre-existing failures, owners, replacement locators, "fixed by this change". | The Slack failure link goes to `/test-cases/:id` — the history page — not to the failing execution with the evidence (`dispatch.ts:122`). The excerpt is the raw first 300 chars of the error, so a timeout reads `Test timeout of 30000ms exceeded.` with the useful call log cut off. Bitbucket PR feedback saves settings and posts nothing. |
| **Opens the run** | Summary tiles, failures sorted first with a one-line error and a cluster badge, seven tabs (Executions, Insights, Failure clusters, Since last pass, Timeline, Compare, Slow endpoints). | Above the fold the page spends its space on total/passed/skipped/didn't-run tiles and a meta strip (Playwright version, Piwi version, upload size). Nothing says *what* broke. Insights, Failure clusters, Since last pass and Compare all answer "what is wrong / what changed" from different angles on different tabs. Switching to the tree view (a cookie that persists for a year) silently drops the inline error, the cluster badge and failures-first sorting (`TestCasesTree.vue:183`). **(seen)** |
| **Opens the execution** | Diagnosis tab: raw error, jump chips, verdict card, cluster card, AI card, evidence funnel of up to eleven cards. | See §4.1. Short version: the error is the only thing visible; everything that would explain it is folded or below the fold; nothing is correlated. |
| **Reads the cluster** | Signature, counts, first/last seen, fix verdict, triage rail, evidence sections, "What changed", AI diagnosis. | Named after the error kind; sample error frozen at first occurrence; "What changed" shows *Unsupported SCM host* and *No changes found in this range* side by side; the diagnosis panel occupies the whole right column with an empty state when no provider is configured. **(seen)** |
| **Fixes** | Copy locator / Copy patch / Copy fix prompt / Open in IDE / Copy retry command; MCP `get_fix_plan` and `explain_failure` for agents; auto-heal PR on the default branch. | The fix plan — the one artifact that bundles diagnosis, edit, failing tests, owner and verify command — has no page. Two different retry commands exist for the same run. Quarantine and ownership are not reachable from any failure page. |
| **Verifies** | Fix verification on the next full run (stopped failing / diagnosis verified / regressed); PR comment "Fixed by this change". | Triage status stays *Open*. Nobody is told "your fix held" except through the PR comment. Partial runs (`--grep`) never verify, so the natural "re-run just this test" loop can never close a cluster. |

The pattern is consistent: **every stage has the right data and the wrong hand-off.** The information exists one click, one tab or one table away from where the decision is made.

---

## 3. Data: what we capture, what we lose

### 3.1 Inventory — what a failing execution carries

Reporter defaults are in `packages/reporter/src/internal/config/env.ts:8-27`; ingest caps in `apps/application/shared/ingest-limits.ts:37-48`.

| Evidence | Captured when | Needs | Cap / rule | Shown where |
|---|---|---|---|---|
| Error text (all `result.errors` joined, deduped) | every attempt | reporter | 20 000 chars, head 75 % + tail 25 % (`sanitize.ts:222-229`); fingerprint computed on the *uncapped* text | Error card; run list one-liner; alerts (300 chars) |
| Source snippet + call-stack frames | failed / timedOut only | reporter | 30 lines of context, 4 frames × 8 lines; `node_modules` skipped | Test source card (full trace stack when a trace exists) |
| Per-attempt outcomes | every attempt | reporter | 30 attempts | Attempt chips (badges only) |
| Steps, step events, slowest step, wasted time | pass and fail | `collectPerformanceMetrics` (default on) | 500 steps / 1 000 events | Steps tab, summary |
| Trace / screenshots / video / custom files | whatever Playwright wrote to disk | Playwright `use.trace` / `screenshot` / `video` | attachment **must have a `path`** | Failure evidence card (folded), Artifacts tab, trace viewer |
| Browser + environment config | every case | reporter | from the *project* `use`, not the live context | Meta strip, environment diff |
| Git / CI metadata | run start | `collectScmInfo` / `collectCiInfo` | 5 s `git` timeout | Meta strip, Since last pass, PR feedback |
| ARIA snapshot of the page | **failure only** | fixtures | 100 000 chars; content-addressed | ARIA card (folded), healing fallback, AI context |
| Locator snapshots + ranked alternatives | after each **successful** action / positive assertion | fixtures, `captureLocators` | one per call site; 10 alternatives; `selectorCounts` and `hasLabel` dropped at ingest (`locator-healing.ts:755-761`) | Alternative locators panel |
| Console `warning` / `error` / `assert` | pass and fail | fixtures | 200 entries, 2 000 chars each | Console card (always open) |
| Network requests (fetch / xhr / document / other) | pass and fail, `requestfinished` only | fixtures | top 50 by duration + all failed; query strings stripped; **`startTime` dropped** (`network-request-helpers.ts:36-46`) | Network card (always open), slow endpoints |
| Backend logs / spans (`X-Piwi-Logs`, `X-Piwi-Trace`) | per request | fixtures + instrumentation package | none on the wire; 50 entries / 500 chars in the instrumentation | Inline under the request |
| Web Vitals | teardown | fixtures, Chromium for LCP/CLS/INP | — | Performance tab |
| App state (URL, storage key names + lengths, cookie names + flags) | pass **and** fail (pass side is the diff baseline) | fixtures, `capturePageState` | 50 keys / 30 cookies; values never captured | App state card (folded) |
| Fresh locator suggestion, user pick | failure only | fixtures (+ headed local run for the pick) | — | reach the server only as **annotation text**; the structured attachment body is never parsed (`file-handler.ts:95-148`) |
| DOM snapshot, full call stack, full network with headers and capped bodies | derived from the uploaded trace | Playwright trace | server-side masking of sensitive headers and token-shaped strings | DOM snapshot card, Test source "Full stack", Network "Full trace" |

### 3.2 Silent losses — captured, then dropped or never shown

Ranked by how often a real investigation would miss them.

1. **Failed and aborted requests are never captured by the fixtures.** The listener is `requestfinished` only (`capture-fixtures.ts:961-1020`). A DNS failure, a CORS abort, a cancelled navigation — the request that most often *is* the failure — is invisible unless a trace exists.
2. **Request and response bodies, request headers.** Never captured (`capture-fixtures.ts:976-991`). The AI verdict in the docs screenshot cites `GET /api/users?page=1 returns 50 records`; the human looking at the same page cannot see that body. With a trace the "Full trace" view shows a capped body preview, so the data exists in one path and not the other.
3. **Network timing is captured and then thrown away.** The wire carries `startTime`; the `network_requests` table has no such column, so `ai-context.ts:1680-1687` computes a `t+Nms` offset from a field that is always `undefined`. This single dropped column is what blocks a failure timeline (§6.B).
4. **`console.log` / `info` / `debug` are discarded** (`capture-fixtures.ts:950`). Teams that log state transitions with `console.log` (most of them) get nothing; teams that use `console.warn` get everything. An allowlist by pattern or a rolling window of the last N `log` lines before the failure would cost nothing.
5. **Body-only attachments never upload.** `testInfo.attach(name, { body })` has no `path`, and `findAllAttachments` requires one (`file-handler.ts:71`). No warning is logged. Anyone attaching a JSON payload, a rendered email or a PDF from a test loses it.
6. **The structured locator suggestion and the user's pick are attached and never read.** Both names are in `INTERNAL_ATTACHMENT_NAMES` (so not uploaded as files) and absent from `parsePerformanceAttachments`, so they survive only as annotation strings. `piwi-ai-meta` is declared and has no producer (`attachments.ts:18`).
7. **`collectPerformanceMetrics: false` also drops the ARIA snapshot, console and page state** — everything is parsed inside that one `if` (`reporter.ts:349-366`). The option doc admits it is "the one option that silently disables others" but lists only the three sub-toggles. The worker keeps capturing and attaching; the reporter ignores it.
8. **Options only reach the worker through `wrapConfig`.** `applyOptionsToEnv` is called in `config-wrapper.ts:61` and nowhere else. A reporter registered directly in `reporter: [[…]]` — the form the docs show first — leaves `captureLocators`, `capturePageState`, `inspectOnFailure`, `pickLocatorOnFailure` inert unless the `PIWI_*` env var is set.
9. **Nothing outside a test is captured.** `beforeAll` / `afterAll` / global setup failures have no console, network, ARIA or vitals (`capture-fixtures.ts:200-206`). These are the failures that take down forty tests at once (§2 of the mass-failure recipe) and they are the least evidenced.
10. **`frameLocator` is excluded** from the wrapped methods (`packages/core/src/locator-methods.ts:7`), so anything inside an iframe (payment widgets, embedded editors) has no locator snapshots and no healing.
11. **Streaming mode uploads one trace per case** (the last one found, `file-handler.ts:154-158`) while batch mode uploads all; a multi-context test loses traces under the default (streaming) path.
12. **Viewport / locale / timezone come from the project config, not the page** (`metadata-collector.ts:129-170`). A `test.use({ viewport })` override or a `browser.newContext({ … })` inside the test is not reflected, so the environment diff can report an unchanged viewport for a test whose real viewport changed.
13. **The crash-recovery file carries no binary evidence** (`crash-recovery.ts:26-38`): when every upload rung fails, traces, screenshots and videos are gone for good, and the next run resubmits a results-only payload. The multipart → JSON fallback (`run-submitter.ts:274-275`) loses the same set on a partial failure.
14. **A thrown `_expect` records no failed locator** (`capture-fixtures.ts:810` has no `try/catch`), so the suggestion path stays silent on the very assertion failures it exists for; only the picker falls back to parsing the error text.

### 3.3 Not captured at all — and would change what a user can conclude

- **A time axis.** Steps have `startTime`, console entries have `timestamp`, screenshots have file times, the failure has `startedAt + duration`, network has `startTime` on the wire. Nothing joins them. "What happened in the two seconds before the failure?" is unanswerable on the page today.
- **The previous test in the same worker.** `workerIndex` is stored (`reporter.ts:324`), so "the test before this one on worker 2 failed / left a modal open" is computable but never computed. Cross-test pollution is the classic flaky root cause and it has no evidence path.
- **Where the page was, and where it was supposed to be.** The URL is in app state (folded card); the ARIA snapshot's top-level landmark tells you if the test is staring at a login page. Neither is surfaced as a *fact* ("the page ended on `/login` — expected `/users`").
- **Timing relative to the timeout.** Test timeout, slowest step and duration are all stored; "the slowest step took 90 % of the budget" is a one-line derived fact nobody shows.
- **Element state at the moment of the failed action.** Playwright's call log says `element is not enabled` / `not visible` / `resolved to 51 elements` / `0 matches`; the DOM snapshot can show *why*. Neither is parsed.
- **A passing-run ARIA snapshot.** Snapshots are failure-only, so there is nothing to diff the page structure against. A sampled ARIA snapshot on green (once per test per day) would enable "what changed on the page" as a structural diff — cheaper and more precise than the pixel diff.
- **Per-step screenshots or DOM.** Only Playwright's final screenshot exists outside the trace; steps carry no evidence pointer.

### 3.4 Retries

Each attempt is its own `CollectedTestCase` (`reporter.ts:290-405`) and its own DB row (unique on `run, case, retries, browser`, `persist-run-cases.ts:463-467`), so attempt-level evidence *exists*. But: the attempt chips are `title`-only badges (`TestCaseSummary.vue:175-196`); the run's failure groups keep the highest-retry row per test (`test-runs.ts:565-570`); the only route to a sibling attempt is the 24-square history strip, which is `ClientOnly` and unlabeled. And the failure-time picker deliberately runs only on the final attempt, so a test that passes on retry never gets a pick. The flaky-test question — *what differed between attempt 1 and attempt 2?* — is never computed (§6.E).

### 3.5 Analysis defects found on the way

These are correctness issues in the pipeline that shape what the user sees, not just missing features.

- **Cluster exemplar frozen at creation.** `bumpExisting` updates `lastSeenRunId` and `occurrences` only (`failure-cluster-ops.ts:44-56`); `sampleError`, `signature`, `errorType`, `selector` never change. Naming, embedding, the AI's "sample error" section and even re-fingerprinting on a version bump are all anchored to the first occurrence forever.
- **`occurrences` counts rows, not tests, and is never decremented on run deletion** (`schema.sqlite.ts:205`). Retries and per-browser rows inflate it; only retention and extract-cases recompute it.
- **Over- and under-grouping by design, with no feedback channel.** Masking every number, every `Received/Expected` value and every locator option string (`error-fingerprint.ts:94-138`) merges two different assertion failures on the same locator into one cluster; keeping the primary locator argument forks a renamed test id into a new cluster. Both are defensible defaults, but the only correction tool is "Extract" (split) — there is no "these two are the same" without an embedding model, and no way to learn from a human merge.
- **Baselines ignore environment.** Environment diff: same test, `passed`, same browser — nothing else (`environment-diff.ts:81-82`). Visual diff: same-branch preferred, environment ignored (`visual-diff.ts:151-165`). Regression signals: per-run baseline, branch-aware, environment-blind, and stored flags may be computed against a `--grep`-filtered green run while run insights require a full run — the two can disagree on the same run (`compute-regression-signals.ts:77`, `run-insights.ts:96-102`).
- **A brand-new test that fails is never a "new regression"** because the baseline is per-run and the test is absent from it (`compute-regression-signals.ts:77`).
- **Unscoped diagnosis lookups.** `ai-context.ts:1126-1138` and `projects.ts:1139-1151` select `failure_diagnoses` by cluster without `scope = 'cluster'`; an execution-scope row can surface as the cluster's prior diagnosis.
- **Dead staleness detection.** `failure_diagnoses.context_sha` is declared "for staleness detection" (`schema.sqlite.ts:308`) and never written; the "Diagnosis may be stale" banner is driven by `lastSeenRunId` alone, so it also shows on a cluster that is *Fix verified* **(seen)**.
- **`'timedOut'` casing** in the flaky leaderboard's per-browser check (`projects.ts:1344`) while the stored value is `timedout` — timed-out finals can be under-counted.
- **The SSE stream publishes the uncapped error** (`events.post.ts:229`) while the stored row is capped, so the live view and the reload can differ.
- **Single-process event bus** (`run-events.ts:7`): a restart between `finish` and `upload` force-marks the run `failed`.

---

## 4. Display: what is confusing

### 4.1 The execution page, in the order a user meets it **(seen)**

1. **The pinned summary spends the first 300 px on Duration / Attempts / Steps / Worker tiles** and a meta strip. On a failure, three of the four tiles are irrelevant to the question "why did this fail?". The signal badges (New regression, Passed on retry) are small chips next to the title.
2. **The Error card is the whole first screen.** It is Playwright's text, ANSI-colored and internal frames collapsed (`renderAnsi`, `condenseErrorText`) — faithful, but **unparsed**: no Expected / Received panel, no separated call log, no highlighted locator, no plain-language line ("the click never happened because the button stayed disabled"). The fingerprinting code already parses error type, locator and expected/received for hashing; the UI does not reuse any of it.
3. **The jump-chip row** lists sections that may not exist. Environment diff, Visual diff and DOM snapshot chips are gated only on "the run has an id" (`[id].vue:520-536`), and the cards they target render nothing on `no-baseline` / `no-screenshot` / `no-trace`, so the chip scrolls to nothing — contradicting the comment above the code that says exactly that must not happen.
4. **Between 1024 and 1279 px the rail lands under the funnel.** The grid switches to two columns at `xl` but the order flips at `lg` (`[id].vue:667-682`), so on a common laptop width the verdict, cluster and AI cards are ten cards down.
5. **Nine cards start folded, including the screenshot.** `CollapsibleSectionCard` defaults to folded and the evidence card is one (`case-evidence`); console and network, which are `SectionCard`s, are always open. The fold state is a per-browser cookie, so the *first* impression is the worst one, and expanding everything produces a page ~2 600 px tall with the DOM snapshot's raw CSS at the bottom.
6. **The healing panel appears whenever the error contains a locator expression** (`[id].vue:706-712` has no condition; the server extracts a leaf selector from any error). On the `toHaveCount` failure it recommends narrowing the locator; on a `page.goto` timeout cluster the run's clusters tab shows a "Locator fix" signal built from ARIA guesses. Suggestions are also long: the stale-name case lists the original locator among its own alternatives and eight unrelated elements "from the failing page" (Pay now, CVV, Expiry date…).
7. **Failing locators render as serialized objects** — `getByRole({"role":"row"})`, `getByLabel({"label":"Email address"})` — while every alternative renders as Playwright code.
8. **The environment diff's arrow is unlabeled.** `1.51.0 ← 1.52.0`, `light ← dark`: which side is *now*? Red/green is the only cue. The diff's headline example on the seeded instance is the environment *label* itself, a consequence of the baseline flaw in §3.5.
9. **Console and network are shown without any relation to the failure** — three 200 OK requests and their durations, unsorted by time; a console warning with no "N seconds before the failure".
10. **Missing evidence is inconsistent.** No console → the card is simply absent (`[id].vue:733-735`); no visual baseline → nothing; no locator data → a rich guidance card (the best empty state on the page); no trace → a nudge under two cards. A user cannot tell "not captured" from "nothing happened" from "not configured".
11. **The AI card's not-configured copy points at a control that does not exist**: "Use Export → AI context in the header" — the export menu has no such item; the real control is the "Copy prompt" button in the card's own header (`TestCaseAiCard.vue:255-259`).
12. **The verdict card is called three things**: "Regression status" on screen, "Failure verdict" in its help topic, "verdict card" in the architecture map. "Last passed in execution in run #71" for a failure in run #70 is a seed artifact, but it shows that the strip and the sentence are keyed on run *id*, not time.

### 4.2 The run page **(seen)**

- **Failures first, but nothing about the failure first.** The Executions tab does sort failures to the top with a one-line error and a cluster badge — good. But the page opens on tiles and a meta strip; "what broke" is the sixth thing on screen.
- **Seven tabs answer overlapping questions.** Insights (new regressions / new flaky / performance), Failure clusters, Since last pass (commit range), Compare (pick a run), Timeline (workers). A user has to know which lens holds their answer.
- **The clusters tab shows masked signatures** (`Timeout <N>ms exceeded.`) and overflows horizontally (the *Known since* column is cut off at 1440 px).
- **Three same-sized buttons per cluster row** — Show failing tests (stays), Diagnose (modal), View (leaves) — with no cue about which one navigates. The Diagnose modal is a degraded cluster page: no staleness banner, no evidence screenshots, no link to the cluster (`FailureGroups.vue:228-256, :280`).
- **Two different retry commands** for the same run, one from the summary (`file-line` mode with line numbers) and one from the clusters tab (no line, no project) (`RunSummary.vue:51-65`, `FailureGroups.vue:39-53`).
- **Tree view is a trap** (§2).
- **Search matches title and location only**; you cannot search failures by error text anywhere.

### 4.3 The cluster page **(seen)**

- **Named after the error kind.** Without auto-diagnose there is no title; with it, the run and project tables show the title first while the cluster page shows the signature first and demotes the title (`ClusterSummary.vue:75-79`). A project's cluster list becomes a list of Playwright error messages.
- **Contradictory state is by design, but reads as a bug.** *Fix verified* + *Open* + *Last seen: Failed* + "Diagnosis may be stale" on one screen. The docs argue the disagreement is the point; the screen does not say so.
- **"What changed" shows two messages at once**: *Unsupported SCM host* and *No changes found in this range*.
- **Every left-column section is folded**, so the first view is seven headers and a triage rail.
- **The right column is an empty state** when no AI is configured — 40 % of the screen for "configure a provider".
- **"Extract"** is the only bulk action in the failure UI and its label does not say what it extracts.
- **No way back** to the execution the user came from — "Open execution" goes to the representative case only.

### 4.4 The healing panel

Beyond the gating issue: two recommendations compete ("Recommended fix" vs "Most stable option"), the score badges (`90`, `100`, `72`) are unexplained on the page, and the stale-name warning is a paragraph of prose. The provenance line ("Pre-captured from the last passing run — highest confidence · captured 7 days ago") is the best sentence on the page and should lead.

### 4.5 The AI diagnosis panel

Two implementations with different capabilities: the cluster panel streams, shows stages, can be cancelled and notifies; the execution card blocks on a spinner (`TestCaseAiCard.vue:105-126`). The coverage strip is dense (nineteen chips plus "19 not included · ~2.5k tokens") and reads as a debug view. Cost is tokens only, never money. Feedback is thumbs with an optional note; nothing shows whether feedback changed anything. Diagnosis history has an endpoint and no UI. "Notify when diagnosis completes?" is offered even when the diagnosis is already complete **(seen in the docs screenshot)**.

### 4.6 Terminology

| Concept | Names in use | Where |
|---|---|---|
| One attempt of one test on one browser | Executions (tab) · cases (counter) · Test case (column, search placeholder, empty state) · test-run case (legacy URL, comments) | `test-runs/[id].vue:578`, `TestCasesList.vue:203-363` |
| The test's identity across runs | Test case (navbar link, `/test-cases/:id`) | — the same words as the row above |
| Grouped failures | Failure clusters (UI) · failure groups (API route, component, comments) | `FailureGroups.vue`, `/api/test-runs/:id/failure-groups` |
| The regression card | Regression status (title) · Failure verdict (help) · verdict card (architecture) | `TestCaseVerdictCard.vue:111`, `help-content.ts:256` |
| "Verdict" | the regression card · "AI verdict" chip on the cluster card · fix-verification verdict (stopped failing / diagnosis verified / regressed) | three meanings, one word |
| Triage status | formatted via `formatTriageStatus` in two places, raw enum + `capitalize` in two others | `ClusterSummary.vue:34-36`, `FailureClustersList.vue:100-102` |
| Timed out | "failed" everywhere except the execution verdict chip (`formatStatusLabel` maps it) | `utils/index.ts:258-263` |
| Evidence sections | "Failure evidence" (execution) vs "Test evidence" (cluster) for the same artifacts | — |
| Docs | "debug prompt" at `/test-cases/:id` (stale, wrong URL); "Traces & Console tab" (does not exist); "the dashboard never writes to your repository" next to auto-heal PRs; 40 vs 45 MCP tools | `reporter.md:83`, `backend-logs.md:18`, `ai-diagnosis.md:226`, `index.md:118` |

### 4.7 Small things that read as broken

- `Cluster not found.` is a bare unstyled div (`failure-clusters/[id].vue:384`); every other detail page uses `ErrorState`.
- Failed cluster-name fetches fall back silently to `Cluster #N` (`test-runs/[id].vue:494-502`).
- The Share button is visible and broken in the public demo (share links are not mirrored in the demo router).
- The healing panel's doc comment says it stays a plain card on the execution page; it folds there (`LocatorHealingPanel.vue:34`).
- Global shortcuts are `g h / g p / g a / g s` only; no next-failure, no `j`/`k`, no bulk select anywhere except Extract.

---

## 5. Action: what we hand back, and where it stops

What exists is substantial: ranked locator replacements with a one-line git-applyable edit, a validated AI patch with `git apply` / download, a retry command in three modes, Open-in-IDE on every frame, a fix plan and `explain_failure` over MCP, auto-heal PRs with a head-content guard, fix verification with three honest verdicts, PR comments that separate new from pre-existing failures, and a quarantine with an exit ramp. Where it stops:

| Gap | Evidence |
|---|---|
| **The fix plan has no page.** The one object that assembles diagnosis + edit + failing tests + owner + verify command is API/MCP-only. | `server/api/failure-clusters/[id]/fix-plan.get.ts`; zero references in `app/` |
| **Verification never closes triage.** `fixVerification` is set; `status` stays `open`. | `fix-verification.ts:231-251` |
| **Partial runs can never verify**, so the natural loop — fix, re-run *this* test, see green — never records a fix. | `fix-verification.ts:113-114` |
| **Nobody is told their fix held** except through the PR comment; there is no `cluster.fixed` / `cluster.regressed` notification event. | `shared/notification-events.ts:1-12` |
| **Quarantine and ownership are unreachable from the failure.** Quarantine lives on the project tab; owner is a read-only badge when a `piwi:owner` annotation exists; CODEOWNERS ownership is used in PR comments and the leaderboard but not shown on the execution or cluster page. | `TestMetaBadges.vue:64-67` |
| **No bulk actions**: no multi-select on the run's executions, no bulk triage, no bulk quarantine, no bulk re-diagnose. | `ClusterExtractCasesModal.vue` is the only multi-select |
| **Auto-heal is default-branch, full-run only** and excludes ARIA-derived suggestions — correct, but it means the feature never helps on the PR where the locator actually broke. | `heal/policy.ts:119-236` |
| **Agents get more than humans.** `explain_failure` and `get_fix_plan` bundle what the UI scatters across a dozen cards; the human has "Copy AI context". | `server/utils/mcp/tools.ts:1613-1657` |
| **The reporter never talks back.** No per-failure link, no HTML-report attachment, no `piwi explain <test>`. The `piwi` CLI has `gate`, `select`, `run`, `ai`, `skills` — nothing that pulls a verdict into the terminal. | `packages/reporter/src/cli/` |

---

## 6. What "game changer" would mean

The product's own roadmap ranks its purpose as *keep the history → explain the failures → hand back a fix*. Today the first is excellent, the second is a set of good parts that do not add up on screen, and the third is strongest for agents and weakest for the person actually looking at the page. The ideas below are ordered by how much they change the second and third points. Each is deterministic first, AI second — the moat is that Piwi *has the data*; the model is optional.

### A. A verdict that reads like a colleague wrote it (no LLM required)

Replace the raw error as the first thing on the page with a **structured failure headline** computed from what is already stored:

> **`Pay` button never became enabled — the click timed out after 30 s.**
> New regression on `main` since run #4 (commit `a1b2c3d4`, Alice Chen, "add new payment provider integration"). Same failure in 1 other test this run (cluster #1). Owner: checkout team. Console 20 s before the failure: *"price quote still pending after 20s — Pay stays disabled"*.

Everything in that paragraph is derivable today:

- **What failed**: a Playwright error parser — action vs assertion, the locator, expected/received, timeout, and the *last call-log state* (`element is not enabled`, `not visible`, `resolved to 51 elements`, `0 matches`, `strict mode violation`). The fingerprinting module already extracts type, locator and expected/received for hashing (`shared/error-fingerprint.ts`); the UI just never uses it. Playwright's error formats are finite and stable enough to cover the top twenty shapes with tests.
- **Why-class**: regression / flaky / infrastructure / environment from the signals already stored (`isNewRegression`, `isNewFlaky`, worker correlation, cluster error type, environment diff, `didNotRunReason`).
- **Since when**: first failing run, last green run, commit range, author — all in the regression context.
- **Who**: `piwi:owner` or CODEOWNERS, already resolved server-side for PR comments.
- **The one clue**: see B and C.

The raw error stays one click away, verbatim. This is the single change that makes "diagnosis-first" true.

### B. The failure timeline

One horizontal time axis per execution: steps (with the failed one marked), console entries, network requests with their status and duration, backend log entries, Web Vitals events, the screenshot/video timestamps, and the moment of failure. Every element is already timestamped except network at rest — restoring the dropped `startTime` column is the only schema change. Selecting a window shows what happened inside it; the default window is *the failed step plus the N seconds before it*. This turns "console (1) / network (3)" from two unrelated lists into "what the app was doing when the test gave up". With a trace, the same axis becomes a launcher into the trace viewer at that moment.

### C. Clues: a rule-based correlation engine, shown to humans and fed to the model

A small library of deterministic detectors that each produce a cited, ranked *clue*. The point is that they run on every failure, cost nothing, and are exactly the kind of "evidence" the diagnosis prompt currently has to rediscover from raw text:

| Clue | Signal already stored |
|---|---|
| A request to `X` failed with 5xx / 0 within N s of the failure | network status + (restored) startTime |
| A console error mentions the element's name or the failing route | console text × locator args / URL |
| The element exists in the ARIA snapshot under a different name (rename) | healing's `matchRenamedElement` result |
| The element is present but disabled / hidden (state, not existence) | call-log parse + ARIA snapshot |
| The page ended on `/login` (or a 404 / error page) instead of the expected route | app state URL + ARIA landmarks |
| The previous test on this worker failed or timed out (pollution) | `workerIndex` + run ordering |
| The slowest step used > 80 % of the timeout budget (timing, not logic) | steps + `timeout` |
| Viewport / locale / Playwright version differ from the last pass *in the same environment* | environment diff, once the baseline respects environment |
| The failure appears only on one browser of the matrix | per-browser rows in the run |
| The same cluster was fixed before by commit `Y` (see K) | fix verification history |

Each clue carries a `[section]` citation so it doubles as the evidence list the AI result already renders. A failure with strong clues may not need a model call at all; a failure with none is exactly the one worth spending tokens on — which also makes the auto-diagnose budget smarter than "three newest clusters".

### D. A failure inbox instead of a project list

The home page says "5 failing now" and shows project health bars. A team on Monday morning wants a **queue of problems**: new clusters since they last looked, clusters owned by them, regressions on the default branch, fixes that did not hold, quarantines ready for release, merge suggestions awaiting a decision. Each row: the headline from A, the top clue from C, owner, age, a one-key triage (`r` resolve, `i` ignore, `q` quarantine, `a` assign, `o` open). Keyboard `j`/`k`, bulk select, snooze, "link to issue" (entity links exist). This is where Piwi stops being a place you *look* and becomes a place you *work*.

### E. Diff the attempts

For a test that failed then passed in the same run, compute the delta between the attempts: which requests were slower or failed only in the failing attempt, which console lines appeared only there, how the step timings differ, whether the ARIA snapshot (captured on failure) shows a state the passing attempt never reached. That delta *is* the flakiness fingerprint, and it is computable from data Piwi already stores per attempt. No tool does this; it would turn the flaky leaderboard from a ranking into an explanation, and it feeds the root-cause classifier (which today counts keywords).

### F. Reproduce and bisect in one click

Piwi knows the failing test, the commit, the branch, the environment, the browser project, and the last green commit. Hand back a **reproduction bundle**: the retry command (one canonical builder, not two), the exact checkout (`git switch --detach <sha>`), the Playwright project, the environment variables the run declared, and — when a trace exists — the `storageState` hint. Then the obvious next step: a generated `git bisect run` script between last green and first red for that one test. The desktop app already has "Run locally"; this is the CI-failure version of it.

### G. Close the loop without a human noticing

- Auto-propose *resolved* when a cluster is `diagnosis-verified`, and auto-*reopen* on `regressed` — with an audit note, so the triage state and the machine verdict stop disagreeing silently.
- A `cluster.fixed` and `cluster.regressed` notification event, delivered to the author of the fixing commit when the SCM token can resolve them.
- Let a partial run verify a cluster when it executed *every* test the cluster covers (the current rule requires `isFullRun`; the docs' own reasoning — "a test that didn't execute hasn't been shown to pass" — is satisfied by the stricter check that is already implemented).
- From the cluster page, trigger the re-run: a `workflow_dispatch` / pipeline trigger with the retry command as input, using the SCM token that already exists.

### H. Meet the developer where the failure appears

- The reporter prints, per failing test, `✗ <title> → <execution url>` as soon as the execution exists (streaming already assigns ids live), and attaches a `piwi-link` to the test so the Playwright HTML report links to the evidence.
- `npx piwi explain <file:line | title>` prints the headline (A) and the clues (C) in the terminal; the same over MCP already exists for agents.
- Alerts link to the execution, not the history page; the excerpt is the headline, not the first 300 chars.
- A PR comment that leads with the headline and the clue per failure rather than the raw first line of the error.

### I. Evidence without asking for setup

Two thirds of the evidence funnel needs the fixtures, and partial adoption is invisible. Three moves:

- `wrapConfig` (which already injects the reporter and global setup) sets `screenshot: 'only-on-failure'` and `trace: 'retain-on-failure'` when unset and logs one line saying so; those two options unlock the DOM snapshot, full stack, full network with bodies and the visual diff *without* the fixtures.
- Derive more from the trace on the server: console entries and failed requests are in every trace, and the import path already reads console from traces (`import-evidence.ts`); reported runs should get the same fallback when the fixtures are absent.
- Every empty evidence card states one of exactly three things — *not captured (enable X)*, *captured, nothing happened*, *not applicable* — and links to the `/setup` capability checklist. The AI coverage strip already knows the difference; humans should get it too.

### J. Structural page diff

Sample an ARIA snapshot on passing runs (rate-limited: once per test per day) so that a failure can show a **structural diff of the page** against its last green: the renamed button, the missing table, the modal that stayed open. Cheaper and far more legible than the pixel diff, and it makes healing's "the element looks renamed" a visible fact rather than a warning paragraph.

### K. Institutional memory

Resolved clusters, their fix commits, their triage notes and diagnosis feedback are a knowledge base nobody queries. When a new cluster appears, search *resolved* clusters (deterministically by fingerprint family and locator, semantically when an embedding role exists) and show "you fixed something like this on 2026-07-12 in commit `abc123`, open for 2 days" — with a one-click "apply the same triage". The embedding reconciliation only compares open clusters today (`cluster-reconcile.ts:235-246`).

### L. One investigation page with a fixed reading order

Fold A–C into a single page shape used by both the execution and the cluster: **Verdict → Clues → Evidence (tabbed: Timeline · Screen · Source · Network · Console · Page) → Fix → Verify.** Sections open by *relevance* (a clue that cites the console opens the console), not by a cookie. The raw error, the ARIA tree and the DOM go under Evidence, never on the first screen. The cluster page is the same layout with an "across N tests" strip on top; the two stop diverging (Failure vs Test evidence, signature vs title, three buttons vs one).

---

## 7. A prioritized plan

**Delivery status (2026-09-05, final).** Everything in this plan is merged to `main`. Quick wins: all fourteen (#428, #429, #430, #431) plus the agent tooling — the `run-app` skill and `app:screens --route` (#434). Medium: **A** verdict headline (#432), **B** failure timeline with call context (#433), **G** loop-closing + partial-run verification (#438), the fix-plan page and diagnosis history (#439), **I** evidence without setup (#440), the quarantine / owner / issue-link actions with bulk triage (#441), the cluster exemplar refresh (#454). Big bets: **C** clue engine (#435), **L** the unified investigation layout delivered as the UI simplification (#442–#456, #459 — see [`ui-simplification.md`](ui-simplification.md)), **E** attempt diffing (#458), **F** reproduction bundle + generated bisect (#460), **M** the desktop runs the reproduction and drives the bisect (#461), **J** green ARIA samples + structural page diff (#465), **K** resolved-cluster memory (#462), **D** the failure inbox (#467), and **S** one home for SCM provider hosts and URLs (#466, landed through #462 — a cleanup the maintainer asked for after spotting provider logic re-implemented outside `server/utils/scm/`). Nothing is left to start; the lists below keep their ✅ markers as the record of where each item landed.

> **Note on references.** The file paths and line numbers in §0, §4 and Appendix A describe the code as audited on 2026-09-01. The UI simplification has since rebuilt the failure screens, so those pointers are historical; the *findings* they describe are resolved. The live map of the screens is [`ui-simplification.md`](ui-simplification.md).

### Quick wins (days each, mostly one file) — ✅ shipped 2026-09-02

All fourteen landed in PRs #428 (docs), #429 (reporter and alerts), #430 (UI) and #431 (server analysis), plus four extras the sessions added on the way: ANSI-colored error text where raw escape codes leaked, a navbar that no longer repeats the breadcrumb, a `/test-runs/:id/locate` route that resolves an execution from its file, title and retry, and the deterministic cluster name applied everywhere the signature used to be shown.

1. Show the failure screenshot expanded by default; fold console/network instead (`CollapsibleSectionCard` default or an explicit `default-folded="false"` on `case-evidence`).
2. Gate the healing panel and the "Locator fix" signal on a *resolution* failure: `0 matches`, strict-mode violation, or `waiting for <locator>` without a later `locator resolved to` (`resolveHealingForCase`, `FailureGroups.vue`).
3. Make the environment-diff and visual-diff baselines prefer the same environment, then the same branch (`environment-diff.ts:81`, `visual-diff.ts:151`).
4. Restore `startTime` on `network_requests` (wire already carries it) and delete the dead offset code or make it live.
5. Fix the `lg:order` / `xl:grid-cols` mismatch and the three jump chips that can scroll to nothing.
6. Print `getByRole('row')`, not `getByRole({"role":"row"})`, for the failing locator; label the diff arrow (*now* vs *last pass*).
7. Attempt chips become links to the sibling execution; the history strip gets a label and a keyboard focus.
8. Reporter: log a per-failure execution link as soon as the streaming id exists; attach a `piwi-link` attachment; warn once when a body-only attachment is skipped.
9. Slack links → `/test-run-cases/:id`; alert excerpt → the message head (pre-call-log), not the first 300 chars.
10. Auto-propose *resolved* on `diagnosis-verified` and reopen on `regressed`; add the two notification events.
11. Fix the stale "Export → AI context" copy; render `Cluster not found` with `ErrorState`; hide Share in demo mode.
12. Docs: document `screenshot: 'only-on-failure'` next to `trace`; fix "debug prompt" / "Traces & Console tab"; scope the "never writes to your repository" sentence; align the MCP tool count; mark the two shipped proposals as shipped.
13. Give clusters a deterministic title when no AI title exists: `<error kind> on <locator or route> in <spec basename>` beats the raw signature, and never show `<N>` in a title.
14. One retry-command builder for the run page.

### Medium (a few weeks, one feature each)

- ✅ **A** the structured error parser + verdict headline, reused by the run list, alerts, PR comments and the CLI. *(#432)*
- ✅ **B** the failure timeline (needs 4 above), with per-action call context. *(#433)*
- ✅ **G** the loop-closing rules and the partial-run verification change — plus fix-author notification and re-run from the cluster page. *(#438)*
- ✅ **I** `wrapConfig` defaults, trace-derived fallbacks, three-state empty cards linking to `/setup`. *(#440)*
- ✅ Fix-plan page + diagnosis history UI (both endpoints existed); real staleness via a written context hash. *(#439)*
- ✅ Quarantine / owner / link-to-issue actions on the execution and cluster pages; a multi-select on the run's executions with bulk triage. *(#441; the UI simplification relocates these controls into the rebuilt headers)*
- ✅ Cluster exemplar refresh (`sampleError` from the latest occurrence, keep the original for re-fingerprinting). *(#454)*

### Big bets (a quarter each)

Each now lands in a **slot the UI simplification reserved** (`ui-simplification.md` §11, last row), so these build on the rebuilt screens rather than the pages the audit first described.

- ✅ **C** the clue engine, with clues fed into the diagnosis prompt as a first-class section and used to prioritize the auto-diagnose budget. *(#435)*
- ✅ **L** the unified investigation layout — the UI simplification. Execution, cluster, run and project pages, the run's Changes/Timeline split, the Home *Open failures* card and every test list rebuilt (PRs #442–#456 in `main`, 2026-09-04); the vocabulary/docs sweep landed (#459). Tracked in [`ui-simplification.md`](ui-simplification.md), not restarted here.
- ✅ **D** the failure inbox. The UI plan's Home *Open failures* card (#442) is D at its smallest; the audit's D is the full inbox on top of it — queues, snooze, assign, bulk actions and a "since you last looked" cut. *(#467)*
- ✅ **E** attempt diffing for flaky tests, feeding the root-cause classifier. Home: an **Attempts** tab in `EvidenceTabs` shown when a test has more than one attempt, diffing the failing attempt against the passing one (error, timing, network, page state). *(#458)*
- ✅ **F** reproduction bundle + generated bisect. Home: a **Reproduce** section in `FixCard`, beside Verify's retry command and *Re-run in CI*; the same recipe in the fix-plan Markdown export and the `get_fix_plan` MCP tool. *(#460)*
- ✅ **J** sampled green ARIA snapshots + structural page diff. Home: a **Page diff** toggle on the Screen evidence tab; the reporter samples an ARIA snapshot on passing tests the server marks as due (once per test per day). *(#465)*
- ✅ **K** resolved-cluster memory. Home: a **Fixed before** section in the Fix card, surfacing how a matching cluster was resolved previously, with *Apply the same triage*. *(#462)*
- ✅ **M** desktop: *run* the reproduction, don't copy it. *(#461)* F stops at a copy-paste recipe and a `git bisect` script on purpose — they must work for Docker/web users and MCP agents. The desktop shell already spawns the linked folder's own Playwright with the bundled Node (`desktop_run_local_tests`), but it knows nothing about git and nothing about the app under test, so a *Run locally* next to the recipe still runs whatever HEAD the folder is on. M closes that gap, in three parts, all desktop-only and all behind the existing folder link:
  1. **Reproduce here** — one click in `FixCard` › Reproduce runs the recipe: check out the failing commit in a `git worktree` under the app's data dir (the user's checkout, uncommitted changes and `node_modules` are never touched), `npm ci`, install the browser, run the exact test through the existing sidecar path; output streams into the *Local runs* tray like any run. A new Tauri command spawns `git` (the user's — the shell bundles Node only; a missing git is a one-line error, like the missing-Playwright case today).
  2. **Find the breaking commit here** — the same button beside the bisect script. The shell drives the bisect itself (`git bisect start bad good` in the worktree, then per step: install, run the test, `git bisect good|bad`, `git bisect skip` when the install fails) rather than `git bisect run`, so the tray shows real progress (*step 3 of 7 — a1b2c3d bad*), a stop is a stop, and the worktree is removed on stop, exit and quit (`LocalRuns::kill_all` already exists for this). The result — *first bad commit `abc123` — subject, author* — links to the SCM commit and is written to the cluster as its suspect commit, where the fix plan and the regression window already look.
  3. **The app under test** — a bisect of the test repo only means something when the app is built from the same checkout. `inspect.rs` already parses the Playwright config; it also detects a `webServer` block. Present: nothing to do, Playwright starts the app at each commit. Absent: the Reproduce section says so plainly — *"your tests target `https://staging…`; bisecting this repo can only find test-side changes"* — and offers a per-link **start command** (stored in the shell's `settings.json` beside the folder path, e.g. `npm run dev` + a readiness URL) that the shell starts before the run and per bisect step, waits for, and kills after. An app that lives in another repository stays out of scope: that is a two-repo bisect, and the section says so instead of pretending.

  Constraints that shape the design: never move the user's HEAD (hence the worktree); `npm ci` per step because the lockfile can change inside the window; git required on `PATH`; long runs already raise an OS notification.
- ✅ **S** one home for SCM provider hosts and URLs. Not from the audit: while reviewing M and K the maintainer noticed provider-specific host rules and web URLs being re-implemented outside `server/utils/scm/` (a `buildCompareUrl` and a `buildCommitUrl` with copied hostname switches, the provider union declared eight times, `link-detect` with its own idea of a GitLab host, an unfurl layer that only knows GitHub). M put the URL builders in `shared/scm-urls.ts`; S makes it the only place: one `ScmProviderName`, `link-detect` on the shared detector, unfurl rebuilt on the real providers so GitLab and Bitbucket links unfurl too, an `AGENTS.md` rule and a guard test that fails on any provider literal outside the allow-list. *(#466, landed through #462)*

---

## Appendix A — Defects found (with locations)

| # | Where | What |
|---|---|---|
| 1 | `apps/application/app/pages/test-run-cases/[id].vue:667-682` | Column breakpoint `xl`, order breakpoint `lg`: rail is pushed below the funnel between 1024 and 1279 px. |
| 2 | `apps/application/app/pages/test-run-cases/[id].vue:520-536` | Environment diff / Visual diff / DOM snapshot jump chips gated on run id only; the cards render nothing on `no-baseline` / `no-screenshot` / `no-trace`, so the chip is inert. |
| 3 | `apps/application/app/components/test-case/TestCaseAiCard.vue:255-259` | Not-configured copy refers to "Export → AI context", which does not exist in `ExportMenu.vue`. |
| 4 | `apps/application/app/pages/test-run-cases/[id].vue:706-712`, `server/utils/locator-healing.ts:486-500` | Healing panel and recommendation for errors whose locator resolved (e.g. `toHaveCount` mismatch). |
| 5 | `apps/application/server/utils/environment-diff.ts:81-82` | Baseline ignores environment and branch. |
| 6 | `apps/application/server/utils/visual-diff.ts:151-165` | Baseline ignores environment. |
| 7 | `apps/application/server/utils/ai-context.ts:1680-1687`, `server/database/schema.sqlite.ts:520-545` | `r.startTime` read from a table with no such column; `t+Nms` never renders. |
| 8 | `apps/application/server/database/schema.sqlite.ts:308` | `context_sha` declared for staleness detection, never written; the stale banner also shows on fix-verified clusters. |
| 9 | `apps/application/shared/handlers/failure-cluster-ops.ts:44-56` | `sampleError` / `signature` / `errorType` / `selector` frozen at cluster creation. |
| 10 | `apps/application/shared/handlers/projects.ts:1344` | `'timedOut'` compared where the stored value is `'timedout'`. |
| 11 | `apps/application/server/utils/ai-context.ts:1126-1138`, `shared/handlers/projects.ts:1139-1151` | Diagnosis looked up by cluster id without `scope = 'cluster'`. |
| 12 | `apps/application/server/api/test-runs/[id]/events.post.ts:229` | SSE publishes the uncapped error; stored row is capped. |
| 13 | `apps/application/shared/handlers/flaky-classify.ts:70-77` | `networkErrorCount` / `status5xxCount` always 0 — dead classifier inputs. |
| 14 | `packages/reporter/src/internal/files/file-handler.ts:71` | Body-only attachments skipped silently. |
| 15 | `packages/reporter/src/internal/files/file-handler.ts:95-148`, `capture/attachments.ts:18` | `piwi-locator-suggestion` and `piwi-user-pick` bodies never parsed; `piwi-ai-meta` has no producer. |
| 16 | `packages/reporter/src/public/config-wrapper.ts:61` | Worker-side options only bridged to env through `wrapConfig`. |
| 17 | `packages/reporter/src/internal/files/file-handler.ts:154-158` | Streaming uploads one trace per case; batch uploads all. |
| 18 | `packages/reporter/src/internal/capture/capture-fixtures.ts:810` | `_expect` interception has no `try/catch`; a thrown assertion records no failed locator. |
| 19 | `apps/application/app/components/run/TestCasesTree.vue:183` | Tree view drops error line, cluster badge and failures-first sort. |
| 20 | `apps/application/app/components/run/FailureGroups.vue:39-53` vs `RunSummary.vue:51-65` | Two different retry commands for one run. |
| 21 | `apps/application/app/components/run/FailureGroups.vue:280` | Diagnose modal renders `DiagnosisPanel` without `lastSeenRunId` / `affectedTestCases`. |
| 22 | `apps/application/app/pages/failure-clusters/[id].vue:384` | Bare `Cluster not found.` div. |
| 23 | `apps/application/app/demo/api/router.ts` | Share-link routes not mirrored; Share button visible and failing in the demo. |
| 24 | `apps/application/server/utils/notifications/dispatch.ts:122` | Slack failure links target `/test-cases/:id` (history), not the execution. |
| 25 | `apps/application/server/utils/fix-verification.ts:231-251` | Verification sets `fixVerification` but never `status`. |
| 26 | `apps/docs/reporter.md:83`, `backend-logs.md:18`, `ai-diagnosis.md:226`, `index.md:118` | Stale "debug prompt" + wrong URL; non-existent "Traces & Console tab"; unscoped "never writes to your repository"; 40 vs 45 tools. |
| 27 | `proposals/first-class-branches.md`, `proposals/test-selection.md` | Headers say nothing shipped; both are largely shipped. |
| 28 | `apps/application/app/composables/useDesktopHistoryNav.ts:11` | Unhandled rejection in the dev server log on every SSR page render (`Cannot read properties of undefined (reading 'history')`) — observed while running the audit, outside its scope. |

## Appendix B — What the docs promise vs what needs installing

The evidence funnel on `evidence.md` is complete only with: the reporter, `trace: 'retain-on-failure'`, `video`, `screenshot: 'only-on-failure'` (undocumented), the capture fixtures *and* the import rewrite in every spec, a backend instrumentation package (NuGet or npm, non-production only), an AI provider, an SCM token (read for diffs, write for PR feedback and auto-heal), and a per-browser IDE mapping. No page totals this; the `/setup` checklist does it in-app and is linked from nowhere on the failure pages. Four promised evidence blocks — environment diff, visual diff, app state, DOM snapshot — are named in one bullet and explained nowhere. There is no end-to-end "red run → fix → verified" walkthrough; the closed loop is documented only from the agent's side.

## Appendix C — Files read first-hand

Reporter: `public/reporter.ts`, `internal/capture/*`, `internal/collect/*`, `internal/files/file-handler.ts`, `internal/submit/*`, `internal/support/ci-output.ts`, `internal/support/run-url.ts`, `internal/config/env.ts`. Server: `utils/persist-run-cases.ts`, `utils/sanitize.ts`, `utils/locator-healing.ts`, `utils/environment-diff.ts`, `utils/visual-diff.ts`, `utils/ai-context.ts`, `utils/ai-diagnosis.ts`, `utils/fix-verification.ts`, `utils/fix-plan.ts`, `utils/cluster-*.ts`, `utils/notifications/*`, `utils/scm/pr-feedback.ts`, `database/schema.sqlite.ts`, `shared/error-fingerprint.ts`, `shared/handlers/*`. App: `pages/test-runs/[id].vue`, `pages/test-run-cases/[id].vue`, `pages/failure-clusters/[id].vue`, `components/run/*`, `components/test-case/*`, `components/cluster/*`, `components/diagnosis/*`, `components/shared/LocatorHealingPanel.vue`, `components/shared/CollapsibleSectionCard.vue`, `utils/help-content.ts`. Docs: all 41 pages, `README.md`, `ROADMAP.md`, `proposals/*.md`, `CHANGELOG.md` (last ten releases).
