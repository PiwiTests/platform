# Scenario gaps — suggesting the tests that are missing

A design record for **scenario gaps**: the dashboard proposing tests that do not exist yet, computed from the history
it already keeps (routes, pages, locators, failures, diffs), from a small amount of new capture, and from two new
inputs an application team can opt into. A gap is always a suggestion with evidence and a next step — a draft spec,
an MCP call, a line in the pull-request comment — never a verdict.

**Status.** Proposed. Nothing below is shipped. The reach edges, the surface inventory and the detectors are designed
to land in that order, each useful on its own.

**Summary.** A missing test is only visible against a reference for what the application can do. Piwi stores five such
references today without treating any of them as one: the routes tests hit (`network_requests.normalized_url`), the
pages they end on (`test_runs_cases.page_state`), the controls they touch (`locator_snapshots`), the controls and links
a page exposes (ARIA snapshots), and the page-object methods a project owns (`test_functions`). Failures add a sixth:
every cluster is a scenario that was missing until it happened. Diffs add a seventh, and the sharpest: a changed file
no test reaches. The proposal builds one **reach index** (test → what it observably exercised) and one **surface
inventory** (what the application declares or exposes), runs deterministic **detectors** over the difference, ranks
the result by usage, risk and cost, and delivers it where the decision is made: a Gaps tab with the inbox's triage
verbs, an uncovered-changes section in PR feedback, a warn-only gate policy, and MCP tools so an agent writes the test.
Two new inputs are optional and bring their own process: an **application manifest** (declared routes and pages, from
the instrumentation packages, an OpenAPI URL or a committed JSON file) and **production route usage** (daily hit
counts per route, no bodies, no identifiers). Everything stays on the instance, honest by construction, and proposes
rather than applies.

## Problem

Piwi answers "what broke, why, and what to do" well. It cannot answer the question the same people ask the day after
a release: **what did we never test?** Three concrete shapes of that question go unanswered today.

1. **The suite is judged by what it contains, not by what it leaves out.** The catalog lists tests; spec health,
   flaky leaderboards and selection analytics describe those tests. Nothing describes the application side — routes
   no test has ever requested, pages no test has ever visited, a button rendered on twelve pages that no locator has
   ever targeted. The raw material is in the database (see the table below), read today only in one direction.

2. **A bug that escaped teaches nothing structural.** When a cluster is diagnosed and fixed, the diagnosis names the
   root cause and the patch, fix verification records that the fix held, and the story ends. Whether the test that
   failed was actually *about* that behavior, or caught it by accident, is never asked. A "checkout happy path" test
   that fails on a rounding bug is evidence that no rounding test exists — and the next rounding bug will need the same
   luck.

3. **A pull request is judged on the tests that ran, not on the code it changed.** PR feedback separates new
   failures from pre-existing ones, and the impact command maps changed files to tests. The inverse — the changed
   files that map to *no* test — is computed today only as a warning that widens the selection to the full suite
   ([`selection-impact.ts`](../apps/application/server/utils/selection-impact.ts)). That warning is the single most
   useful signal in this document, and it is currently thrown away.

Against the ROADMAP's own test: this is job 3, **hand back a fix**, applied before the failure exists. "The point is
to leave with something to do" — a ranked list of tests worth writing, each with the evidence for it and the closest
existing test to fork, is the same principle one step earlier in the loop. It also strengthens job 1: history that
can only describe the past is worth less than history that shapes what gets tested next.

## What the dashboard already knows

No detector in M1 needs new capture. Everything in this table exists and is indexed.

| Signal | Where it lives today | Captured on |
|---|---|---|
| Routes a test hit (pattern, method, status, duration) | `network_requests.normalized_url` / `method` / `status` | every execution |
| Page a test ended on, storage keys, cookie names | `test_runs_cases.page_state` | every execution |
| Locator call sites and the element each resolved to | `locator_snapshots` (`location`, `element_tag`, `element_attrs`, `element_text`) | every execution, upserted per call site |
| In-project frames a test ran through | `test_runs_cases.test_source_frames` (via `case_payloads`) | failures only — from the error stack |
| Every control and link on the page (role, name, `href`) | ARIA snapshot (`aria_snapshot_payload_id`) | failures; a green sample where one exists |
| Steps and their `expect` calls | `test_runs_cases.steps` / `step_events`, [`step-analysis.ts`](../apps/application/shared/step-analysis.ts) | every execution |
| Console entries, dialogs, backend logs and spans | `console_logs`, `dialogs`, `network_requests.server_logs` / `server_traces` | every execution |
| Browser, viewport, environment, branch | `test_runs_cases.browser`, `test_runs.environment` / `branch` | every execution / run |
| Tags, owner, priority, feature | `test_cases` denormalized columns, `test_runs_cases.test_meta` | refreshed every run |
| Page-object methods and the DOM pattern each drives | `test_functions` (`module`, `name`, `url_pattern`, `steps`) | catalog, scanned or recorded |
| Failure clusters, diagnoses, fix verification, first bad commit | `failure_clusters`, `failure_diagnoses`, cluster fix/regression state | per cluster |
| Skipped, did-not-run, blocked-by cascade, quarantine | `test_runs_cases.status` / `did_not_run_reason` / `blocked_by`, `quarantined_tests` | every execution |
| Commit, branch, PR number, base branch | `test_runs.metadata.scm` (reporter's [`metadata-collector.ts`](../packages/reporter/src/internal/collect/metadata-collector.ts)) | every run |
| Changed files with patches between two refs, file content at a ref | SCM providers ([`ScmProvider.ts`](../apps/application/server/utils/scm/ScmProvider.ts)), 30 files / 200 KB caps | on demand |
| Ownership | CODEOWNERS ([`scm/ownership.ts`](../apps/application/server/utils/scm/ownership.ts)) | on demand |
| Linked tickets | `entity_links`, Jira integration | per cluster |

Two rows carry the design's main caveat. **Source frames exist only for failures**, because they come from the error
stack; a test that always passes has none. **ARIA snapshots exist only for failures**, so the "everything on the page"
reference is sparse on healthy suites. Both are fixed by the same small capture change in M2, and until then the
detectors say so in their evidence.

## Design in one page

```
┌─ Delivery ────────────────────────────────────────────────────────────────┐
│ Gaps tab (triage: accept · snooze · dismiss · "covered by") · PR comment  │
│ "uncovered changes" · gate policy (warn-only) · MCP tools + skill ·       │
│ digest notification · accepted gap → draft spec (clipboard / PR / agent)  │
├─ Ranking ─────────────────────────────────────────────────────────────────┤
│ score = usage weight × risk (churn, past clusters, priority) × 1/cost     │
│ (a catalog method that reaches the page makes a gap cheap to close)       │
├─ Detectors (deterministic rules, AI optional on top) ─────────────────────┤
│ surface gaps · failure-derived gaps · diff-derived gaps · matrix gaps ·   │
│ false-coverage signals that discount the others                           │
├─ Two references, kept per project ────────────────────────────────────────┤
│ reach index: test → {file, route, page, control} it observably exercised  │
│ surface inventory: {route, page, control, link} the app exposes/declares  │
└───────────────────────────────────────────────────────────────────────────┘
```

Vocabulary: a **gap** is one suggested scenario with evidence. A **surface** is the application side (routes, pages,
controls, links). **Reach** is the test side. "Coverage" is used only with the qualifier the selection suggestions
already use — *observed* coverage, never instrumented code coverage — and the UI repeats that qualifier.

## The reach index

One table, `test_reach`, one row per `(test_case_id, kind, target)`:

```
test_reach
  id, project_id FK, test_case_id FK, kind, target, last_seen_run_id FK (set null), last_seen_at
  kind ∈ 'route' | 'page' | 'control' | 'file' | 'handler'
  unique (test_case_id, kind, target); index (project_id, kind, target)
```

It is a materialization, not a source of truth: rebuildable from the tables above, refreshed by
[`persist-run-cases.ts`](../apps/application/server/utils/persist-run-cases.ts) on every ingest, pruned with the runs
that fed it. Its edges, in the order they become available:

| Edge | Source | Available |
|---|---|---|
| `route` — `GET /api/orders/:id` | `network_requests.normalized_url` + `method` | today |
| `page` — `/checkout` | `page_state.url` at test end; every navigation once the page inventory ships (M2) | today (end URL), M2 (all) |
| `control` — `button "Export CSV"` on `/reports` | `locator_snapshots.element_*` resolved to a role + accessible name | today |
| `file` — `pages/CartPage.ts` | `locator_snapshots.location` (every run) ∪ `test_source_frames` (failures) ∪ trace action call sites where traces are retained | today |
| `handler` — `server/api/orders/[id].get.ts` | root server span carrying the handler's file (M2 instrumentation change) or a file-routing convention (Nitro, Nuxt pages, Next, SvelteKit) applied to the `route`/`page` edges | M2 |

The `file` edge is what makes the impact command precise and the diff detector honest. Today it exists only where a
test has failed; `locator_snapshots.location` already records the in-project call site of every locator on passing
runs, so most page-object files are reachable from it with no reporter change. The remaining hole (helpers that never
create a locator) closes with the trace call sites when the project retains traces on success, and with the shallow
import graph below otherwise.

**Import edges (optional, M3).** For a changed file with no reach, the SCM layer can fetch the file at the run's ref
and read its import specifiers one level up: the pages and handlers that import it already have edges. Capped by the
same 30-file budget as diagnosis, cached per commit, and marked in the evidence as inferred.

## The surface inventory

One table, `app_surface`, one row per `(project_id, kind, key)`:

```
app_surface
  id, project_id FK, kind, key, attrs JSON, origin,
  first_seen_run_id FK (set null), last_seen_run_id FK (set null), last_seen_at, usage_30d
  kind ∈ 'route' | 'page' | 'control' | 'link'
  origin ∈ 'observed' | 'manifest' | 'openapi' | 'usage'
  unique (project_id, kind, key)
```

Three origins, each a ramp a team can take independently:

1. **Observed** (M1, no setup). Every `route` edge and `page` edge in the reach index is also a surface row. Every
   control and link in a stored ARIA snapshot is a surface row keyed by role + accessible name + page. This alone
   powers the single-covering-test and success-only detectors, and the reachable-but-unvisited detector on the pages
   where a snapshot exists.

2. **Declared** (M3, one config or one CI step). What the application says it has, so "never observed" becomes
   "declared and never observed" — a real gap rather than an absence of evidence:
   - The **instrumentation packages** already own the framework. The Nitro plugin knows the router; the ASP.NET Core
     package knows the endpoint data source. Each grows a manifest: the route table (method, pattern, handler file)
     served at `/__piwi/manifest` outside production, fetched once by the reporter's global setup when a `baseURL` is
     configured and the header proves the plugin is present. Same guard as log capture (`PIWI_TEST_LOGS_DISABLED`).
   - An **OpenAPI URL** per project (dashboard setting). Routes, methods and — the part nothing else provides —
     documented response codes, so "409 is documented on `POST /api/orders` and no test has ever seen it" is a
     detector, not a guess.
   - A **committed `piwi.manifest.json`** for anything else: `{ routes: [...], pages: [...] }`, uploaded by the reporter
     when present next to the Playwright config. Written by hand or generated by the team's own build step; Piwi does
     not care which.

3. **Usage** (M4, a production process). Daily hit counts per route, so gaps rank by what real traffic touches.
   Detailed under *New data* below.

The inventory is upserted, never truncated: a route that stops appearing keeps `last_seen_at` and ages out of the
detectors after the retention window.

## Detectors

Every detector is a pure function over the two references plus history, returns gaps with evidence lines and a 0–1
confidence, and lives in `shared/handlers/scenario-gaps.ts` next to the selection suggestions so the demo mirrors it.
Deterministic first, like the failure clues engine; a model is only ever asked to *draft* the test for an accepted gap.

### Surface gaps

| Detector | Rule | Evidence lines | Proposed scenario |
|---|---|---|---|
| **Declared, never hit** | `app_surface` row with origin `manifest`/`openapi` and no `route`/`page` reach edge | "Declared in OpenAPI · 0 tests in the last 30 runs" | request the route / visit the page; fork the test that reaches the nearest sibling route |
| **Success only** | route with reach edges whose observed statuses are all 2xx/3xx; stronger when OpenAPI documents an error code | "Seen 412 times, always 200 · OpenAPI documents 401, 409" | the error path for each documented code, using the closest existing test's setup |
| **Single covering test** | route or page reached by exactly one test (the smoke miner's set cover, read backwards) | "Only `checkout › applies coupon` reaches this · that test is quarantined" | a second scenario, or a direct assertion in a test that already passes nearby |
| **Reachable, unvisited** | a `link` surface row whose `href` matches no `page` edge in the project | "Linked from 7 pages · never navigated to" | visit and assert the page; the link's page tells which test is closest |
| **Control nobody exercises** | a `control` surface row (from ARIA) with no `control` reach edge across the project | "Rendered on 12 pages · no locator targets it" | interact and assert; the function catalog is searched for a method whose DOM pattern matches |
| **Catalog method no test calls** | a `test_functions` row whose `module` has no `file` reach edge and whose `url_pattern` page has reach | "`CartPage.applyCoupon` · page reached by 4 tests · method called by none" | a scenario built from that method — the cheapest gap in the list |

### Failure-derived gaps

| Detector | Rule | Evidence lines | Proposed scenario |
|---|---|---|---|
| **Incidental catch** | a cluster whose diagnosis names a component or file that appears in none of the affected tests' titles, tags, `feature` or reached `file` edges | "Diagnosed cause: `pricing/rounding.ts` · caught by `checkout › happy path`" | a dedicated regression test seeded from the failing step, the assertion and the validated patch already on the cluster |
| **Fix did not hold** | cluster state `regressed` | "Fixed in `a1b2c3d`, regressed 6 days later" | same as above, ranked higher — the verifying test is too coarse |
| **Phantom coverage** | a test skipped, `fixme`, `didnotrun` or blocked-by for longer than N days (default 30) | "Skipped for 47 days · last passed on 2026-07-12" | none — this is a false-coverage row; it discounts every surface the test used to reach |
| **Passed with errors** | a passing execution whose console has an `error`, or whose backend logs carry `Error`, or a 5xx on a background request | "Passed · `POST /api/audit` returned 500 in the background" | an assertion scenario ("no server errors during X"), and the route joins *success only* |
| **Escaped defect** (M3) | a tracker issue in the project's Jira binding that no cluster links to, matched by the binding's labels | "Bug PROJ-412 · not linked to any cluster · title mentions `refund`" | a scenario for the issue; matched against tests by feature tag and title words |

### Diff-derived gaps

Computed for a run stamped with a PR number, between the baseline commit the run-changes ladder already picks
([`run-baseline.ts`](../apps/application/shared/run-baseline.ts)) and the run's commit.

| Detector | Rule | Evidence lines | Proposed scenario |
|---|---|---|---|
| **Changed, unreached** | a changed source file (by the impact resolver's extension set) with no `file`/`handler` reach edge from any test *in this run* | "Changed (+41 −3) · no test in run #812 reached it · 0 tests in the last 30 runs" | derived from the file: a route handler → *declared, never hit*; a page → visit it; a component → its importing pages |
| **New error path** | a patch hunk adding a thrown error or status code to a handler with a `route` edge | "Adds `409` to `POST /api/orders` · never observed" | *success only* for that route and code |
| **New control** | a patch hunk adding a form field, button or menu item to a template whose page has reach | "Adds `input[name=promo]` to `/checkout` · no locator targets it" | *control nobody exercises*, scoped to the PR |
| **Locator break ahead** | a patch hunk removing a `data-testid`, `id` or `name` value that appears in `locator_snapshots.element_attrs` | "Removes `data-testid=submit-order` · 3 call sites depend on it" | not a gap — a prediction; handed to healing as a pre-flight so the fix is ready before the run fails |
| **No spec touched** | a PR whose diff changes source files and no test file | "7 source files changed · 0 spec files" | the *changed, unreached* list, which is the whole diff |
| **Intent without a test** | commit or PR title words (after stop-word removal) that match no test title, tag or `feature` in the catalog | "`fix: negative quantity in cart` · no test mentions quantity" | a regression test drafted from the diff and the commit message |

### Matrix gaps

| Detector | Rule | Proposed scenario |
|---|---|---|
| **Browser / viewport** | a test or feature tagged `priority: critical` that ran on one browser or one viewport class in the last N runs | the same test under the missing Playwright project |
| **Environment** | a feature whose tests ran only on one `environment` while the project reports several | the same selection against the other environment |
| **Flag / storage** | a storage key or cookie name observed on some executions of a page and never on others (a feature flag) whose "on" and "off" states were never both exercised on the same test | the other state |

### False-coverage signals

These never produce a gap of their own. They lower the confidence of every surface a test reaches, so a route covered
only by an assertion-light or flaky test still ranks as a gap:

- **assertion-light** — a test with zero `expect` steps, or only visibility assertions, per step analysis;
- **retry-dependent** — passes only after a retry in most of the last N runs;
- **phantom** — the skip/did-not-run detector above;
- **quarantined** — the existing table.

## Ranking

Each gap carries `score = usage × risk / cost`, every factor in `[0.1, 1]` so a missing input never zeroes a row:

- **usage** — `usage_30d` from the production process when present; otherwise the number of tests that reach the
  surface's neighbors (a page linked from seven others is more used than a page linked from one).
- **risk** — churn of the files behind the surface over the last 90 days (SCM commits, cached), whether those files
  appear in any cluster's first-bad or fixing commit, and the highest `priority` tag among the tests that reach the
  surface's neighbors.
- **cost** — low when the function catalog has a method whose `url_pattern` matches the page, or a test already
  reaches the page (fork it); high when nothing reaches the page at all.

Ranking is transparent: the Gaps tab shows the three factors per row and the evidence lines behind each, and the MCP
tool returns the same numbers.

## New data, and the process that brings it

Everything in M1 runs on stored data. The rest adds capture in the order of cost to the team adopting it.

1. **Page inventory on passing runs** (reporter, M2). A compact list of controls and links per visited page —
   `{ url, controls: [{ role, name }], links: [{ name, href }] }` — attached as `piwi-page-inventory` and stored
   through `case_payloads` (identical pages across tests and runs dedupe to one row). Taken from `ariaSnapshot()` at
   navigation settle and at test end, bounded by the same timeout as the failure snapshot, capped at 500 entries per
   page, and skipped when the same URL was already inventoried by the worker during the run. Opt-out
   `capturePageInventory: false`. This is what turns *control nobody exercises* and *reachable, unvisited* from
   failure-sampled into whole-suite.

2. **Handler file on the root span** (instrumentation packages, M2). The root span the Nitro plugin already emits
   gains `handler: 'server/api/orders/[id].get.ts'`; the ASP.NET Core package adds the endpoint's display name and
   source when available. The reporter already forwards spans untouched; the server maps the field onto a `handler`
   reach edge. One field, both packages, no new header.

3. **The application manifest** (M3). The three ramps described under *surface inventory*. The new process for a
   team is one of: install the instrumentation package they may already have, paste an OpenAPI URL, or commit a JSON
   file. The reporter uploads whatever it finds on the next run; nothing is required.

4. **Production route usage** (M4, opt-in, a real process). The instrumentation packages gain a `usage` mode — on in
   production only when `PIWI_USAGE_ENDPOINT` and an API key are set — that counts requests per route pattern per
   day in memory and posts `{ day, routes: [{ method, pattern, count }] }` once a day (and on shutdown) to
   `POST /api/projects/:id/usage`. No paths with identifiers (the same normalization the reporter applies), no
   bodies, no headers, no user data, a hard cap on distinct patterns. Teams that will not run it can upload the same
   JSON from their access logs by hand or from a cron. The value is the one sentence this whole feature can then
   say: "of your 20 most-used routes, 6 have no test."

5. **Sampled real coverage** (M4, opt-in). `PIWI_COVERAGE=1` on one scheduled job makes the capture fixtures collect
   V8 coverage from Chromium per test and attach it; the server resolves it through the bundle's source maps (fetched
   from the app under test, same origin as the manifest) into `file` reach edges with origin `coverage`. Heavy, so it
   is sampled — a nightly full run, not every PR — and it replaces every heuristic edge above with the truth for the
   frontend where it runs.

## Diff-time delivery

The moment of leverage is the pull request. PR feedback ([`pr-feedback.ts`](../apps/application/shared/pr-feedback.ts))
gains one section, after the failure lists and before the selection line:

```
#### 🟣 Uncovered changes (3 of 7 files)
No test in this run reached these files. Observed reach, not instrumented coverage.

- `server/api/orders/[id].patch.ts` — changed (+41 −3) · adds `409` · 0 tests in the last 30 runs → suggested: *PATCH /api/orders/:id returns 409 on a stale version*
- `components/PromoField.vue` — new · imported by `/checkout` (4 tests reach the page) → suggested: *checkout applies a promo code*
- `utils/rounding.ts` — changed · in the fixing commit of cluster #212 (regressed once) → suggested: *cart total rounds half-up*
```

Each line links to the gap on the dashboard, and the dashboard row links back to the PR. The gate
([`gate.post.ts`](../apps/application/server/api/test-runs/%5Bid%5D/gate.post.ts)) gains `maxUncoveredChanges`,
off by default and **warn-only in its first release** (a violation is reported, the verdict is unchanged) until the
reach index has a full milestone of production behind it. A blocking mode is a later decision, not a default.

The desktop app runs the same analysis against the local working tree before anything is pushed: it already reads
local source and generates reproduction and bisect commands, so "what in my uncommitted diff has no test" is one
more command in the same toolbox.

## Dashboard delivery

A **Gaps** tab on the project page, alongside Selections, listing gaps ranked by score with the inbox's verbs:

- **Accept** — opens the draft. The draft is a spec skeleton assembled deterministically: title from the gap,
  `piwi:` annotations from the nearest test, the catalog methods that reach the page as steps, and a `TODO` assertion
  naming what to check. With an AI provider configured, the same grounding pipeline diagnosis uses (source at the
  ref, the nearest test's source, the patch for a diff gap) fills the assertion in and the draft is validated the way
  patches are. Delivery is a choice per accept: copy to clipboard, open as a draft PR on the auto-heal PR machinery
  (branch, one new file, evidence-rich body, per-project allowlist), or hand to an agent through MCP.
- **Snooze** — the existing options (`1-day`, `1-week`, `until-recurs`); a snoozed surface gap wakes when the surface
  changes (new declared code, a diff touching its handler).
- **Dismiss** with a reason: `not-worth-testing`, `covered-elsewhere`, `wrong`. The second asks for the covering
  test and writes a manual `test_reach` edge with origin `manual`, so the index learns; the third is the feedback loop
  for detector precision, reported per detector on the admin stats page.
- **Covered by** — the same manual edge without dismissing, for gaps the team wants to keep watching.

A **gaps** inbox queue on Home lists accepted-but-unwritten gaps older than a week, next to `needs-ticket`. A weekly
**digest** through the existing notification channels carries the top five new gaps per project, off by default.

## MCP and agents

Three tools, one skill:

- `list_scenario_gaps(projectId, { kinds?, minScore?, prNumber?, limit })` — ranked gaps with evidence, factors and
  the nearest test.
- `get_change_coverage(runId | projectId + base + head)` — per changed file: reach edges found, the tests behind
  them, and the gap when there is none. What an agent working a PR calls first.
- `draft_scenario(gapId)` — the same deterministic skeleton the Accept button builds, plus the grounding context
  (nearest test source, catalog methods, patch) so the agent writes the assertion itself.

The `write-the-missing-test` skill template mirrors `run-the-right-tests`: call `get_change_coverage` on the current
branch, pick the highest-scoring gap in scope, draft it, run it through `piwi run` with a file filter, and open it in
the same PR. Accepting a gap through MCP records the same triage state as the tab.

## Storage & API

Three tables, both dialects, and one column:

```
test_reach            (above)
app_surface           (above)
scenario_gaps
  id, project_id FK, detector, key (dedupe: detector + surface/test/file/cluster), title,
  evidence JSON, confidence, score, factors JSON,
  test_case_id FK?, failure_cluster_id FK?, test_run_id FK?, pr_number?,
  status ∈ 'open' | 'snoozed' | 'dismissed' | 'accepted' | 'closed', snoozed_until, dismiss_reason,
  assigned_to FK users?, created_at, updated_at, closed_at
test_reach.origin     ∈ 'observed' | 'trace' | 'convention' | 'import' | 'coverage' | 'manual'
```

Gaps are persisted, unlike selection suggestions, because triage state must survive recomputation and a gap closes
itself: the nightly recompute marks a gap `closed` when its surface gains a reach edge, and the closing run is
recorded so "we closed 14 gaps this month" is a real number. Recompute runs as a Nitro scheduled task per project
after the nightly retention sweep, and on demand from the tab; diff detectors run inline when a PR run finishes,
before PR feedback posts.

Endpoints, project-scoped through the existing access guards:

```
GET            /api/projects/:id/gaps                       # ranked, filterable by detector/status/pr
GET            /api/projects/:id/gaps/:gapId                 # evidence, factors, nearest test, draft
POST           /api/projects/:id/gaps/:gapId/triage          # accept | snooze | dismiss | covered-by
POST           /api/projects/:id/gaps/:gapId/draft           # skeleton, optionally AI-filled → clipboard | pr
GET            /api/projects/:id/gaps/change-coverage        # ?run= | ?base=&head=
POST           /api/projects/:id/gaps/recompute
GET/PUT        /api/projects/:id/surface/manifest            # declared routes/pages (openapi url | json)
POST           /api/projects/:id/usage                       # production route counts (API key, usage scope)
```

Retention: `test_reach` and `app_surface` rows referencing pruned runs keep their `last_seen_at` and age out after
`PIWI_RETENTION_DAYS`; `scenario_gaps` in `closed`/`dismissed` state are pruned with the same window; open gaps are
never pruned. Imported runs feed the reach index (they are real history) but never trigger diff detectors or PR
feedback, consistent with imports being silent.

## What this deliberately is not

- **Not instrumented coverage, and it never claims to be.** Every screen, comment and tool result says *observed
  reach*. The optional V8 sampling is the one place real coverage enters, and its edges are labeled by origin.
- **Not a test generator.** The draft is a skeleton with the reachable setup filled in; the assertion is the human's
  or the agent's, and an AI-filled draft goes through the same validation as a diagnosis patch. Nothing is committed
  except through the reviewed PR ramp, on the auto-heal rules.
- **Not a gate by default.** `maxUncoveredChanges` ships warn-only. A team decides to block on it after seeing its
  precision on their own data, never on day one.
- **Not a coverage percentage.** No single number on the project page. A percentage over an observed surface is
  wrong in the unsafe direction (it looks complete when the surface is sparse). The Gaps tab shows counts per
  detector and the trend of gaps closed.
- **Not a service, not telemetry.** The usage process is the application posting to the team's own Piwi instance
  under their own key; nothing leaves the deployment.

## Interactions worth designing, not discovering

- **Impact and gaps share the index.** The impact resolver's `reach` map becomes a read of `test_reach`. Its safe
  widening on an unmapped source file stays; it just happens less often, and each time it does, it is also a gap.
- **Healing gets a pre-flight.** The *locator break ahead* detector is a diff-time input to locator healing: the
  ranked alternatives already stored per call site can be recomputed against the new template before the run fails.
  Worth wiring in M3 so the auto-heal PR can land in the same PR that broke the locator.
- **Baselines on partial runs.** A PR run stamped with a selection reaches less by construction. *Changed,
  unreached* must read "no test *in this run*" and add the project-wide count from history, or every smoke run will
  cry wolf. The evidence line format above is designed for that.
- **The 1.0 freeze.** The manifest JSON shape, the usage payload and the `piwi-page-inventory` attachment are
  external contracts. Land them, or explicitly defer them, in the stabilization pass.
- **Surface key stability.** Controls are keyed by role + accessible name + page; a renamed button is a new surface
  and an aged-out old one, which is correct. Routes are keyed by the reporter's normalization, so a change to that
  normalization is a migration of `app_surface`, and a note in [`1.0-stabilization.md`](1.0-stabilization.md).
- **Demo mode.** Detectors are pure and live in `shared/handlers/`, so the demo mirror runs them over the seed. The
  seed gains a declared manifest and one PR-stamped run so the Gaps tab and the uncovered-changes section render.

## Milestones

- **M1 — the index and the first detectors (stored data only).** `test_reach` + `app_surface` (origin `observed`)
  built on ingest and backfilled by a one-off task; `scenario_gaps` with triage; detectors *success only*, *single
  covering test*, *catalog method no test calls*, *incidental catch*, *fix did not hold*, *phantom coverage*,
  *passed with errors*, plus the false-coverage discounts; ranking without usage; the Gaps tab; `list_scenario_gaps`;
  demo handlers; docs page. Useful with zero setup on any instance with history.
- **M2 — the whole suite, and the diff.** Page inventory on passing runs (reporter) and handler file on the root
  span (both instrumentation packages) → *control nobody exercises*, *reachable unvisited*, and `file`/`handler`
  edges on passing tests; diff detectors on PR runs; the uncovered-changes section in PR feedback;
  `maxUncoveredChanges` warn-only; `get_change_coverage`; the desktop's local-diff command.
- **M3 — declared surfaces and the ramps.** Manifest from the instrumentation packages, OpenAPI URL and committed
  JSON → *declared, never hit* and documented error codes; *escaped defect* over the Jira binding; import edges;
  *locator break ahead* wired into healing; `draft_scenario`, the Accept ramp (clipboard / draft PR / agent) and the
  skill; digest notification; matrix detectors.
- **M4 — usage and truth.** Production route usage in the instrumentation packages and the upload endpoint; usage
  in the ranking and the "most-used routes without a test" card; sampled V8 coverage with source-map resolution;
  a decision on a blocking gate mode based on M2–M3 precision data.

## Open questions

1. **Where the page inventory is taken.** At every navigation settle is complete but costs an `ariaSnapshot()` per
   page per test; at test end only is cheap but misses intermediate pages. The per-worker URL cache makes the first
   affordable on most suites — is a size threshold (skip pages over N nodes) enough, or does it need a per-project
   sampling rate?
2. **Accessible-name keys across locales.** A suite that runs in two languages produces two surfaces for one button.
   Key by `data-testid` when present, else role + name, and accept the duplication otherwise?
3. **Manifest fetch trust.** The reporter fetching `/__piwi/manifest` from `baseURL` is one more request against the
   app under test at setup. Guard it behind the instrumentation header being present on the first response, or
   behind an explicit reporter option?
4. **Usage payload authentication.** A production app posting to Piwi needs a credential with one scope. Do API
   keys grow scopes for this, or does the usage endpoint take its own token kind like the streaming token?
5. **Which detectors post to the PR.** The uncovered-changes section can become the longest part of the comment on
   a refactor. Cap at five lines with a link, or only post the rows above a score threshold?
6. **Incidental-catch matching.** Diagnosis names a cause in prose and sometimes a file; matching that against test
   titles and reached files is a heuristic. Ship it with a low default confidence and let dismiss-as-wrong tune the
   threshold, or hold it until the reach index has `file` edges on passing tests (M2)?
7. **Gaps for tests that exist but are wrong.** Assertion-light and retry-dependent tests only discount today. A
   detector that proposes *strengthening* an existing test ("add a network assertion to `checkout › happy path`") is
   adjacent and cheap; is it this feature or a spec-health one?
