# Scenario gaps — the Test Map

A design record for **scenario gaps**: the dashboard proposing tests that do not exist yet, from one model of what the
application exposes, what the suite touches, what the suite would actually notice, and what is worth caring about. A
gap is always a suggestion with evidence and a next step — a draft spec, an MCP call, a line in the pull-request
comment — never a verdict.

**Status.** Proposed, second revision. The first revision built two references (a reach index and a surface
inventory) and listed the difference; a review of the products and the research in this area (see
[Prior art](#prior-art) and [References](#references)) changed the shape of the product in three ways, recorded in
[What changed](#what-changed-since-the-first-revision). Nothing is shipped.

**Summary.** A missing test is only visible against a reference for what the application can do. Piwi stores five such
references today without treating any of them as one: the routes tests hit (`network_requests.normalized_url`), the
pages they end on (`test_runs_cases.page_state`), the controls they touch (`locator_snapshots`), the controls and links
a page exposes (ARIA snapshots), and the page-object methods a project owns (`test_functions`). Failures add a sixth:
every cluster is a scenario that was missing until it happened. Diffs add a seventh, and the sharpest: a changed file
no test reaches. Three findings from the literature reshape what is built on top. **Reach is not protection** — a
large share of code that tests execute is pseudo-tested, nothing fails when it breaks [8][9] — so the model gets a
third axis, *checked*, measured by probing passing tests with mutated network responses at the Playwright route
boundary. **A dashboard of predictions changes nothing** — Google measured no behavior change from company-wide bug
prediction [6], while coverage on changed lines inside code review is the form developers used [7] — so the
pull-request comment and the MCP tools ship first and the Gaps tab last. **Where bugs escape is knowable** —
changed-but-untested code, high churn, and *older* components rather than new ones [1][2][3][5] — so the ranking is an
explicit *exposure* score. Everything stays on the instance, honest by construction, and proposes rather than applies.

## Problem

Piwi answers "what broke, why, and what to do" well. It cannot answer the question the same people ask the day after
a release: **what did we never test, and what do we only think we test?**

1. **The suite is judged by what it contains, not by what it leaves out.** The catalog lists tests; spec health, flaky
   leaderboards and selection analytics describe those tests. Nothing describes the application side — routes no test
   has ever requested, pages no test has ever visited, a button rendered on twelve pages that no locator has ever
   targeted.

2. **A passing test is taken as protection.** A test that visits a page and asserts a heading is visible "covers" the
   page and every request it makes. Whether it would fail if the orders endpoint returned a 500 is never asked. At the
   unit level this is measured — between 6 and 53 percent of covered methods are pseudo-tested [8] — and an end-to-end
   suite has the same disease under a different name.

3. **A bug that escaped teaches nothing structural.** When a cluster is diagnosed and fixed, the story ends. Whether
   the test that failed was actually *about* that behavior, or caught it by accident, is never asked.

4. **A pull request is judged on the tests that ran, not on the code it changed.** The impact command maps changed
   files to tests; the inverse — the changed files that map to *no* test — is computed only as a warning that widens
   the selection ([`selection-impact.ts`](../apps/application/server/utils/selection-impact.ts)) and then thrown away.
   Changed-but-untested code is where field faults concentrate [1][2].

Against the ROADMAP's own test: this is job 3, **hand back a fix**, applied before the failure exists.

## What changed since the first revision

| Change | Was | Now | Evidence |
|---|---|---|---|
| Third axis | reached or not | reached · checked · exposed; a gap is high exposure with low reach or low check | [8][9][19] |
| Oracle probes | assertion-count heuristic only | scheduled probe runs mutate responses at `page.route` and record whether the test noticed | [8][19] |
| Delivery order | Gaps tab in M1, PR comment in M2 | PR comment and MCP tools in M1, tab in M3 | [6][7] |
| Exposure score | usage × risk / cost, risk loosely defined | usage, churn, age, escape history, priority as named factors; age weighted *up* | [3][4][5] |
| Ticket as a unit | file-level only | changes joined to tickets through ids in commit messages and the PR; a verdict per ticket | [2]; Teamscale feature coverage |
| Feature as a unit | route, page, control | surfaces clustered into features; gaps reported per feature | [26] |
| Usage source | a standalone usage integration | counts come from the instrumentation packages teams already install | mabl retired its Segment usage integration in 2026 |
| Guided exploration | not in scope | an explorer spends its budget only on inventoried or declared surface the suite does not reach | [13][26][27][28] |
| Precision loop | dismiss reasons | per-detector precision tracked from triage; a detector below threshold on a project mutes itself | [25][18] |
| Server-side probes | client-side response mutation only | a signed per-request header carries a fault the instrumentation applies inside the handler, a dependency call or the serializer; two signals per probe, oracle and resilience | [29][35][36] |
| Feature graph | three separate stores | one typed graph: pages, controls, routes, handlers, dependencies, files, tests, tickets, clusters; reach, check and change are edge kinds; detectors are missing-edge patterns | [10][13][29] |

## The model: reached, checked, exposed

Every element of the application surface — a route, a page, a control, and the feature that groups them — is scored on
three axes:

- **Reached** — does any test observably exercise it? From the reach index. Discounted when the only tests are flaky,
  quarantined, skipped for weeks, or a single test.
- **Checked** — would a test fail if it broke? From the oracle ledger: probe outcomes first, an assertion prior from
  step analysis before a probe has run.
- **Exposed** — how much does it matter? From production usage, churn, age, escape history and priority tags.

Five classes fall out:

| Class | Meaning |
|---|---|
| **Blind spot** | No trusted test reaches it. Declared in a manifest, seen in an ARIA inventory, or linked from a visited page, and never exercised. |
| **False comfort** | Tests reach it and a probe shows they would not notice it breaking. The most dangerous class, because the catalog says it is covered. |
| **Fragile** | Reached and checked, but only by a single test, a flaky one, a quarantined one, or one that has not actually run in weeks. |
| **Protected** | Reached by more than one trusted test and at least one probe made a test fail. Not listed; counted, so the trend is visible. |
| **Unhandled failure** | A server-side probe made a dependency or handler fail and the application did not degrade gracefully: blank page, uncaught error, infinite spinner. Listed whether or not a test noticed. |

The score is stated in the open so the ranking is arguable rather than magic:

```
protection = reach × check              # each in [0.1, 1]; a missing input never zeroes a row
gap score  = exposure × (1 − protection) / cost

reach     from trusted covering tests (flaky, quarantined, phantom, single → discounted)
check     probe outcomes; before a probe: assertion prior from step analysis
exposure  usage_30d · churn_90d · age · escape_history · priority
cost      low when a catalog method reaches the page or a test can be forked
```

"Coverage" is used only with the qualifier the selection suggestions already use — *observed* reach, never
instrumented coverage — and the UI repeats that qualifier.

## What the dashboard already knows

No detector in M1 needs new capture.

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
| Page-object methods and the DOM pattern each drives | `test_functions` (`module`, `name`, `url_pattern`, `steps`) | catalog |
| Failure clusters, diagnoses, fix verification, first bad commit | `failure_clusters`, `failure_diagnoses`, cluster fix/regression state | per cluster |
| Skipped, did-not-run, blocked-by cascade, quarantine | `test_runs_cases.status` / `did_not_run_reason` / `blocked_by`, `quarantined_tests` | every execution |
| Commit, branch, PR number, base branch | `test_runs.metadata.scm` ([`metadata-collector.ts`](../packages/reporter/src/internal/collect/metadata-collector.ts)) | every run |
| Changed files with patches, file content at a ref | SCM providers ([`ScmProvider.ts`](../apps/application/server/utils/scm/ScmProvider.ts)), 30 files / 200 KB caps | on demand |
| Ownership | CODEOWNERS ([`scm/ownership.ts`](../apps/application/server/utils/scm/ownership.ts)) | on demand |
| Linked tickets | `entity_links`, Jira integration | per cluster |

Two rows carry the main caveat. **Source frames exist only for failures**, and **ARIA snapshots exist only for
failures**. Both are fixed by the same capture change in M2; until then the detectors say so in their evidence.

## Architecture

Three stores sit between the sources Piwi already ingests and the places a gap is delivered. Each is a
materialization, rebuildable from tables that exist today, refreshed on ingest and pruned with the runs that fed it.

```
SOURCES                        STORES (per project)          ANALYSIS              DELIVERY
reporter attachments  ──┐      ┌─ surface inventory ─┐       ┌─ detectors ──┐      ┌─ PR comment + status  (M1)
instrumentation       ──┼────► │  reach index        │ ────► │  exposure    │ ───► │  MCP tools + skill    (M1)
SCM (diff, tickets)   ──┤      │  oracle ledger      │       │  ranking     │      │  gate policy, warn    (M2)
failure history       ──┤      └─────────────────────┘       └─ draft ──────┘      │  Gaps tab + inbox     (M3)
probe runs (M2)       ──┘                                          ▲               └─ weekly digest        (M3)
                                                                   └──── triage: dismissed-as-wrong, covered-by
                                                                         → detector precision, manual reach edges
```

### Storage

```
app_surface     id, project_id, kind ∈ route|page|control|link, key, attrs JSON, feature_id?,
                origin ∈ observed|manifest|openapi|usage, first_seen_run_id, last_seen_run_id,
                last_seen_at, usage_30d                       unique (project_id, kind, key)

features        id, project_id, name, url_patterns JSON, tag?, source ∈ tag|cluster|manual

test_reach      id, project_id, test_case_id, kind ∈ route|page|control|file|handler, target,
                origin ∈ observed|trace|convention|import|coverage|manual,
                last_seen_run_id, last_seen_at                unique (test_case_id, kind, target)

oracle_probes   id, project_id, test_case_id, surface_id, level ∈ client|server,
                fault ∈ status-500|empty-body|drop-field|stale-value|slow|throw|dependency|extreme|replay|auth,
                target? (dependency name for server faults), applied (from X-Piwi-Trace),
                outcome ∈ noticed|not-noticed|inconclusive, handled ∈ graceful|degraded|unhandled|n/a,
                run_id, probed_at, evidence JSON

graph_edges     id, project_id, from_kind, from_key, to_kind, to_key,
                kind ∈ links|contains|triggers|loads|handled-by|calls|imports|groups|
                       reaches|checks|uses|drives|changes|affects|caused-by|owns,
                confidence, origin, evidence JSON, first_seen_run_id, last_seen_run_id
                unique (project_id, from_kind, from_key, kind, to_kind, to_key)

scenario_gaps   id, project_id, detector, class ∈ blind-spot|false-comfort|fragile|unhandled, key,
                title, evidence JSON, factors JSON, score, feature_id?, ticket?,
                test_case_id?, failure_cluster_id?, test_run_id?, pr_number?,
                status ∈ open|snoozed|dismissed|accepted|closed, dismiss_reason?,
                assigned_to?, created_at, updated_at, closed_at, closed_by_run_id?
```

Both dialects. Nothing large goes inline: the page inventory and probe evidence flow through `case_payloads`. Gaps
persist because triage must survive recomputation, and a gap closes itself when its surface gains a trusted edge, so
"closed this month" is a real number.

## The reach index

What each test observably exercised. It degrades in the safe direction: no edge means no evidence, never proof of
absence.

| Edge | Source today | Captured on | Change needed |
|---|---|---|---|
| `route` | `network_requests.normalized_url` + method + status | every execution | none |
| `page` | `page_state.url` at test end; every navigation once the page inventory ships | every execution | M2 attachment |
| `control` | `locator_snapshots.element_*` resolved to role + accessible name | every execution | none |
| `file` | `locator_snapshots.location` (in-project call site, every run) ∪ `test_source_frames` (failures) ∪ trace action call sites where traces are retained | every execution for locator call sites | none; import edges in M3 |
| `handler` | root server span carrying the handler file, or a file-routing convention (Nitro, Nuxt pages, Next, SvelteKit) applied to `route`/`page` edges | every execution | M2 instrumentation field |
| `coverage` origin | sampled V8 coverage from Chromium on one scheduled job, resolved through source maps | nightly only | M5, opt-in |

This is the same map regression test selection reads forward [20][21][24]. The impact resolver's reach map becomes a
read of this table; its safe widening on an unmapped source file stays, it just happens less, and each time it does
the file is also a gap.

## The surface inventory, and features as the unit

Three origins, each a ramp a team can take independently; the detectors say which origin a row came from so "never
observed" is never confused with "declared and never observed":

1. **Observed** (M1, no setup). Every reach edge is also a surface row. Every control and link in a stored ARIA
   snapshot is a row keyed by role, accessible name and page. Coverage criteria for GUIs have been event-based since
   2001 [10]; this is the observed version of that model.
2. **Declared** (M3). The instrumentation packages already own the framework and grow a route manifest served at
   `/__piwi/manifest` outside production, fetched once by the reporter's global setup. An **OpenAPI URL** per project
   adds documented response codes, so status-code class coverage [11][12] becomes a detector rather than a guess. A
   committed **`piwi.manifest.json`** covers anything else.
3. **Usage** (M4). Daily hit counts per route from the instrumentation packages in production mode. Never a separate
   analytics hookup.

**Features.** Files and routes are the engineer's unit; the tester's and the product owner's unit is the feature, and
the strongest recent result in end-to-end generation measures feature coverage rather than line coverage [26].
Surfaces are clustered into features three ways, in order of trust: the `piwi:feature` tag on tests that reach them,
the function catalog's `url_pattern`, and URL clustering with a name proposed the way clusters are already named. A
gap is then reported as "Refunds: 2 of 9 declared routes reached, 0 error paths, only 1 trusted test", and the Gaps
tab, the PR comment and the digest group by feature.

**Tickets.** Ticket coverage — the ratio of a ticket's changed methods that tests executed — exposes gaps teams then
act on [2]. Piwi gets the join for free: ticket ids in commit messages and the PR body, and the Jira binding's links.
At change time every gap carries its ticket, and the PR comment gives a verdict per ticket, not just per file.

## Oracle probes

Reach says a test touched a route. It does not say the test would fail if that route returned garbage. Mutation
testing is the accepted answer at the unit level [8][9], and Meta now uses mutants to decide which tests are worth
generating [19]. An end-to-end suite has a cheaper mutation point than source code: the network boundary Playwright
already controls.

```
1. pick a pair        test T reaches route R; T passing; R unprobed; highest exposure first
2. run T under        page.route(R, mutate) — one of: status-500 · empty-body · drop-field ·
   interception       stale-value (replay a previous response) · slow (+5 s); client side only
3a. T fails           → noticed: R is checked by T; ledger row; protection up
3b. T passes          → not-noticed: false-comfort gap on R; evidence is the mutation
4. next pair          nightly budget of N probes per project; a pair is re-probed only when
                      the test's source or the route's handler changes
```

| Mutation | What "not noticed" means | Suggested next step |
|---|---|---|
| `status-500` | the test never depends on the request succeeding | assert the effect on the page, or that no error toast appears |
| `empty-body` | the rendered data is never asserted | assert one field from the response |
| `drop-field` (one JSON key) | that field is never asserted | a targeted assertion, named in the evidence |
| `stale-value` | the test cannot tell a write took effect | assert on the value that should have changed |
| `slow` (+5 s) | the test does not wait for this request; a timing-flaky candidate | an explicit wait; the flaky classifier learns |

**Where it runs.** A probe run is a normal Playwright run with the reporter's capture fixtures in probe mode, driven
by `piwi probe` from a scheduled CI job or from the desktop app, against the same target the nightly suite uses. The
reporter receives the probe plan from the server (pairs and mutations), applies it through `page.route` in the worker,
and stamps the run so it never counts as a real run: no clusters, no regression signals, no notifications — exactly as
imports are silent today.

**Budget and safety.** One mutation per test per run, a per-project nightly budget (default fifty), pairs ordered by
exposure, re-probe only on change. Response mutation happens in the browser, so the backend never receives anything
it would not receive in the plain run. Probes are off for any project without a scheduled job configured; nothing
runs on a developer's machine unasked.

**Before a probe has run**, the check factor is an assertion prior from step analysis: a test with no `expect` steps,
or only visibility assertions, on the route's page starts low. Probes replace the prior with an observation, and the
ledger records which.

## Server-side probes

The client-side probe rewrites a response in the browser, so the server never runs its error path. A server-side
probe sends the fault with the request and lets the instrumentation package apply it inside the server, scoped to
that one request. This is the mechanism Netflix built as FIT — a header carrying a fault rule that hooks in the
common libraries honor [35] — and LinkedIn as LinkedOut — a request filter injecting error, delay or timeout on one
downstream call for one request [36]. The research form is service-level fault injection: start from a passing
functional test, inject faults at every remote call it makes, and let the test tell you what it never checked [29].

The plumbing already exists. The Nitro plugin ([`integrations/nitro/src/index.ts`](../integrations/nitro/src/index.ts))
wraps the whole handler chain in an AsyncLocalStorage scope and parses the W3C `traceparent` header at the same
point, so a probe header read there is visible to every hook, middleware and handler of exactly that request and to
nothing else. The ASP.NET Core package sits in the same position with middleware and a delegating handler for
outbound calls.

```
reporter worker ──── request + X-Piwi-Probe (HMAC · nonce · TTL) ────► instrumentation · request scope
picks (test, route, fault)                                              ├─ handler:    throw · status · delay · extreme
on the Nth request to R,                                                ├─ dependency: fail or delay one outbound call ──► DB · cache · downstream
after the first navigation                                              └─ data:       mutate the object before serialization
                ◄─── response + X-Piwi-Trace: fault applied? ───────────┘
two signals per probe:  oracle    — what the test did: noticed · not noticed         → oracle ledger
                        resilience — what the app did: console · dialogs · ARIA · logs → graceful · degraded · unhandled
```

| Fault | Applied where | What it reveals beyond the client probe |
|---|---|---|
| `throw` · `status` · `delay` | inside the handler | the server's error middleware, logging and retry logic execute; the backend log capture records what they did |
| `dependency` (fail or delay one outbound call) | the outbound client: fetch, HTTP client, DB driver hook, cache | the child spans already recorded per request name every dependency call site before any probe runs; the LinkedOut and Filibuster class of fault [29][36] |
| `data` (drop, null, empty list, stale) | the response object before serialization | the server serializer and the client parser both run on the mutated shape |
| `extreme` (empty or default return) | the handler | if every test still passes, the handler is pseudo-tested by the end-to-end suite in the unit-level sense [8] |
| `replay` · `auth` · `slow-first` | the request pipeline | idempotency of a repeated write, session expiry mid-flow, a race on the first request |

**Two signals per probe.** The oracle signal is whether the test failed. The resilience signal is what the
application did while the fault was applied, and the capture fixtures already record it: console errors, uncaught
exceptions, dialogs, the ARIA snapshot, backend logs. That adds the fourth gap class, *unhandled failure*: under a
failed payments call the checkout page shows nothing, logs an uncaught error, and no test covers it. Chaos tools ask
whether the system survives [34]; this asks that and whether anyone would have known.

**Search.** Follows Filibuster [29]: enumerate the requests and child spans of a passing test, inject one fault per
distinct call site, deduplicate by route pattern, order by exposure, and try pairs only for the top of the list.
Google's mutation testing reached a 75 percent usefulness rate by surfacing one mutant per line and only the ones
its filters rated interesting [31]; the same strictness applies to which probes are run and which results are shown.

**Guards.** The header is HMAC-signed with a secret shared between reporter and instrumentation, carries a nonce and
a short TTL, and is honored only outside production under the same guard as log capture (`PIWI_TEST_LOGS_DISABLED`).
Fault classes are allow-listed per project. Dependency faults on state-changing routes can leave partial writes,
which is real behavior worth seeing, so they default to off and require an ephemeral or staging database. The
instrumentation reports the fault it actually applied in `X-Piwi-Trace`, so a probe the server did not honor is
recorded as inconclusive, never as a pass. The client-side probe stays in M2 because it needs nothing from the
backend; the server-side probe is M3, enabled only where the instrumentation header is present.

## Exposure

Each factor lives in [0.1, 1] so a missing input can never zero a row; the Gaps tab and the MCP tool show the
factors, not just the product.

| Factor | Source | Why it is in the score |
|---|---|---|
| **Usage** | `usage_30d` from instrumentation in production; otherwise in-degree in the link graph and the number of tests that reach the surface's neighbors | suites built from real usage are as effective as white-box ones [14][15] |
| **Churn** | commits touching the files behind the surface in the last 90 days, cached per commit | relative churn is highly predictive of defect density [3]; change-level risk models are built on it [4] |
| **Age** | first commit of the files behind the surface | escaped defects concentrate in older, frequently modified components, not new code [5]; age multiplies churn |
| **Escape history** | files in any cluster's first-bad or fixing commit; tracker bugs without a linked cluster | an area that has already let a bug through is the definition of a residual-fault region [5] |
| **Priority** | highest `piwi:priority` among tests reaching the surface's neighbors; feature-level tag | the team's own statement of what matters |

**The mabl lesson.** mabl weighted page coverage by daily users through a Segment integration and retired it in 2026.
A usage signal that needs its own analytics hookup is a signal most teams never turn on. Piwi's usage counts come
from the instrumentation package a backend team installs once for logs and spans, with one more environment
variable, and an uploaded access-log summary for teams that will not instrument production.

## Detectors

Pure functions over the stores plus history, in `shared/handlers/scenario-gaps.ts` beside the selection suggestions
so the demo runs them. Deterministic first, like the failure clues engine; a model is asked only to draft the test
for an accepted gap.

| Detector | Class | Rule | Evidence line | Next step |
|---|---|---|---|---|
| Declared, never hit | blind spot | manifest/OpenAPI row with no `route`/`page` edge | "Declared in OpenAPI · 0 tests in 30 runs" | request it; fork the test reaching the nearest sibling |
| Success only | blind spot | route whose observed statuses are all 2xx/3xx; stronger with documented error codes [11] | "Seen 412 times, always 200 · documents 401, 409" | the error path per documented code |
| Not noticed | false comfort | probe outcome `not-noticed` on a route with exposure above threshold | "Passes with 500 on POST /api/orders" | the assertion named by the mutation |
| Assertion-light | false comfort (prior) | zero or visibility-only `expect` steps on the page; becomes a prior once a probe runs | "3 tests, 0 expect on data" | schedule a probe; propose one assertion |
| Single covering test | fragile | surface reached by exactly one trusted test (the smoke set cover read backwards) | "Only checkout › coupon reaches this · quarantined" | a second scenario |
| Phantom coverage | fragile | test skipped, fixme, did-not-run or blocked-by for > 30 days | "Skipped 47 days · last passed 2026-07-12" | discounts every surface it used to reach |
| Reachable, unvisited | blind spot | `link` row whose href matches no `page` edge | "Linked from 7 pages · never navigated to" | visit and assert; explorer target |
| Control nobody exercises | blind spot | `control` row with no `control` edge project-wide [10] | "On 12 pages · no locator targets it" | interact; catalog searched for a matching method |
| Catalog method no test calls | blind spot | `test_functions` row with no `file` edge, page reached | "CartPage.applyCoupon · page reached by 4, called by 0" | the cheapest gap: steps already exist |
| Incidental catch | fragile | cluster diagnosis names a file or component in none of the affected tests' titles, tags, feature or `file` edges [25] | "Cause pricing/rounding.ts · caught by checkout › happy path" | a regression test seeded from the failing step and the validated patch |
| Fix did not hold | fragile | cluster state regressed | "Fixed in a1b2c3d · regressed 6 days later" | same, ranked higher |
| Passed with errors | false comfort | passing execution with console error, backend `Error` log, or background 5xx | "Passed · POST /api/audit returned 500 in background" | "no server errors during X"; route joins success-only |
| Escaped defect | blind spot | tracker bug in the project's binding with no linked cluster; matched by labels, feature, title words | "PROJ-412 · no cluster · mentions refund" | a scenario for the issue; feeds escape history |
| Changed, unreached | blind spot | changed source file with no `file`/`handler` edge from any test in this run [1][2] | "+41 −3 · no test in run #812 · 0 in 30 runs" | derived from the file kind; per ticket |
| New error path | blind spot | hunk adds a thrown error or status to a handler with a `route` edge | "Adds 409 to POST /api/orders · never observed" | success-only for that code |
| New control | blind spot | hunk adds a field, button or menu item to a template whose page has reach | "Adds input[name=promo] on /checkout" | control detector scoped to the PR |
| Locator break ahead | prediction | hunk removes a testid/id/name present in `locator_snapshots.element_attrs` | "Removes data-testid=submit-order · 3 call sites" | healing pre-flight, not a gap |
| Intent without a test | blind spot | commit/PR title words match no test title, tag or feature | "fix: negative quantity · no test mentions quantity" | regression test drafted from the diff and message |
| Matrix | fragile | critical feature on one browser or viewport class; feature on one environment; flag state never both ways | "critical · chromium only · no mobile viewport" | the missing Playwright project |
| Not handled | unhandled | server probe outcome `handled ∈ degraded\|unhandled`: blank page, uncaught error, spinner past the test timeout | "payments-svc down → /checkout blank, uncaught TypeError" | an error-state scenario; owner from the handler's file |
| Unprobed dependency | false comfort (prior) | a `calls` edge to a dependency with no `checks` edge from any test | "payments-svc called by 3 routes · never probed" | schedule a dependency probe |
| API-only route | blind spot | a `route` node with reach but no `triggers` edge from any control | "POST /api/exports · reached only by request fixtures" | an API-level scenario, or nothing if the route is headless by design |
| Orphan test | fragile | a test whose `reaches` edges all point to surface not seen in the last N runs | "3 pages it reaches disappeared 40 days ago" | retire or repoint; the surface drift that removed them is named |
| Surface drift | blind spot | nodes first seen in the last run with no `reaches` edge; nodes that vanished with tests still pointing at them | "/billing/plans appeared in run #830 · 0 tests" | a scenario for the new surface; explorer target |

## Change time

A diff is the smallest, most current reference there is, and it arrives at the only moment someone can still act [1][7].

```
PR run finishes ─► baseline ladder ─► SCM diff ─► join per file ─┬─► PR comment, per ticket
(branch, pr#,       (run-baseline.ts)   (files,     reach: this run │   commit status (warn-only gate row)
 commit, selection)                     hunks,      + last 30 runs  │   MCP get_change_coverage
                                        tickets)    oracle ledger   │
                                                    file kind →     │
desktop: the same join on the local working tree ──► detector ──────┘
```

Inline when a PR-stamped run finishes, before PR feedback posts. A run stamped with a selection reaches less by
construction, so "no test in this run" is always paired with the count from history. The section in
[`pr-feedback.ts`](../apps/application/shared/pr-feedback.ts):

```
#### 🟣 Uncovered changes · 3 of 7 files · 2 tickets
Observed reach, not instrumented coverage. Numbers from this run and the last 30 on `main`.

**PROJ-418 · Stale-version conflict on order updates**
- `server/api/orders/[id].patch.ts` · changed (+41 −3) · adds `409` · 0 tests in 30 runs
  → *PATCH /api/orders/:id returns 409 on a stale version* · draft
- `components/OrderRow.vue` · reached by 4 tests · **not noticed**: `checkout › edits quantity`
  still passes when the PATCH returns 500 → *assert the row reflects the saved quantity* · draft

**No ticket**
- `utils/rounding.ts` · in the fixing commit of cluster #212, regressed once · exposure high
  → *cart total rounds half-up* · draft

4 files reached and checked. Gate `maxUncoveredChanges`: warn.
```

The gate ([`gate.post.ts`](../apps/application/server/api/test-runs/%5Bid%5D/gate.post.ts)) gains
`maxUncoveredChanges`, off by default and **warn-only in its first release**. A blocking mode is a later decision on
precision data, never a default. The desktop app runs the same join against the local working tree before anything is
pushed.

## Guided exploration

Crawling an application to infer its states is twenty years old [13], and the current generation of tools does it with
an agent that proposes journeys and emits Playwright [26][27][28]. Their weakness is that they explore everything,
including the checkout flow forty tests already cover. Piwi knows where the suite is *not*.

The explorer is an agent driving Playwright through the same MCP tools, with a page budget and a rule: start from a
reached page, follow only frontier links and controls (inventoried links first, declared routes last), stop when the
frontier is empty or the budget is spent. It reports new surface rows, pages that returned errors, and a recorded path
per discovered page in the extension's existing recording format, matched against the function catalog — so the
output is a draft test, not a screenshot. Runs from a scheduled job or the desktop app, never on a production origin,
off unless configured. M4, because its value is proportional to how good the frontier is.

## The feature graph: one substrate

Everything above stores facts about the same objects: a page links to a page, a control triggers a route, a route is
handled by a file, a handler calls a dependency, a test reaches and checks some of these, a commit changes a file, a
cluster is caused by another. Kept as three tables they answer three questions. Kept as one typed graph they answer
any path question, and every detector becomes a missing-edge pattern. The reach index, the surface inventory and the
oracle ledger are views over it.

Two edge kinds are new, and both come from data already captured. **Triggers**: step events carry a start time per
action and network requests carry a start time per request, so "clicking *Place order* caused `POST /api/orders`" is
a co-occurrence inside the step window, confirmed across executions and scored by how often it holds. **Calls**: the
child spans under a request's root span name every dependency the handler reached. Joined through the route, they
connect a button to a database query. Crawlers infer the client-side state graph [13], tracing tools draw the
service map, and fault-injection interposition records the RPC graph [29]; none of them joins the three through the
tests that exercise them.

```
TESTS              PAGES          CONTROLS         ROUTES                 HANDLERS              DEPENDENCIES
cart › coupon ···► /cart ───────► Apply coupon ──► POST /api/coupons ───► coupons.post.ts ────► DB
                     │ links        contains         triggers ·94           handled by            calls
checkout › happy ·► /checkout ───► Place order ───► POST /api/orders ────► orders.post.ts ─────► DB · payments-svc · cache
  path               │                                 ✗ checks: not noticed (500)                  (payments-svc unprobed)
(no test)          /orders/:id ──► Change address ─► PATCH /api/orders/:id ► orders/[id].patch.ts ► DB
                                                                                 ▲ changes: PR #418 · PROJ-418
```

Reading left to right answers what a test protects; right to left answers what a change threatens. In the sketch the
bottom row is a blind spot end to end, the middle row is reached but its order route did not notice a 500, the
payments dependency has never been probed, and the pull request touches the one handler nobody reaches.

| Edge | From → to | Source | Confidence |
|---|---|---|---|
| `links` | page → page | ARIA snapshot link targets; page inventory (M2) | observed |
| `contains` | page → control | ARIA snapshot; locator snapshots resolved to role + name | observed |
| `triggers` | control → route | request start time inside the action step's window, across executions | share of executions where it held; shown on the edge |
| `loads` | page → route | document and XHR requests during navigation settle | observed |
| `handled-by` | route → handler file | root span handler field (M2) or file-routing convention | observed or convention, labeled |
| `calls` | handler → dependency | child spans under the request's root span | observed |
| `imports` | file → file | shallow import scan at the run's ref (M3) | inferred |
| `groups` | feature → page, route, control | tags, catalog url patterns, URL clustering | by source, in that order |
| `reaches` | test → page, control, route, file, handler | the reach index | trusted or discounted per test |
| `checks` | test → route, dependency | the oracle ledger, with outcome | probe or assertion prior |
| `uses` · `drives` | test → catalog function → control pattern | function catalog, source frames, call sites | observed |
| `changes` | commit or ticket → file | SCM diff, commit message ids | observed |
| `affects` · `caused-by` | cluster → test; cluster → file | failure clusters, first-bad and fixing commits | observed |
| `owns` | owner → file, test | CODEOWNERS | observed |

What the graph answers that the tables cannot:

- **Blast radius of a change**, in both directions: file → handler → route → control → page → feature, and at each
  hop the tests that reach it, the tests that check it, and the owner. The impact command and the uncovered-changes
  section from one traversal.
- **Blast radius of a dependency.** If the payments service is down, which features degrade, which pages show it,
  and which tests would notice. Server-side probes fill the `checks` edges on dependency nodes; the graph says which
  ones are worth filling.
- **The path to a gap.** From a reached page to an unreached one through links and controls. That path is the
  explorer's frontier walk and the draft's step list; a gap with no path is a gap the draft cannot reach and says so.
- **Cross-feature coupling.** Two features sharing a handler or a dependency: a change to one is a regression risk
  for the other, and the PR comment can say "also touches Refunds through `orders.post.ts`".
- **Drift over time.** Every edge carries first and last seen. Nodes that appeared with no reach are new surface;
  nodes that vanished with tests still pointing at them make those tests orphans. Both are detectors above.
- **Usage against test effort.** Usage counts sit on route and page nodes, test counts on the same nodes; a feature
  with a large share of traffic and a small share of tests is the one card a product owner needs.

**Storage and scale.** This is not a graph database. One `graph_edges` table in both dialects, typed endpoints, and
recursive common table expressions for traversal, capped at a depth of six. A project with thousands of tests
produces tens of thousands of edges; the surface inventory and the reach index become views over it, and the oracle
ledger stays its own table because a probe row carries more than an edge. The MCP tool
`get_feature_graph(feature | file | route | dependency, depth)` returns a neighborhood with the class of each node
and the tests on each hop — the one call an agent needs before touching a handler.

## Delivery, and the learning loop

The order matters more than the surfaces. A ranked list on a project page is the exact artifact that changed nothing
at Google [6].

1. **The PR comment and commit status** (M1). Where the author already looks, per ticket, with a draft link per gap.
2. **MCP tools and a skill** (M1). `get_change_coverage(run | base, head)`,
   `list_scenario_gaps(project, { class, feature, minScore, pr })`, `draft_scenario(gap)`. The
   `write-the-missing-test` skill mirrors `run-the-right-tests`: read change coverage on the current branch, take the
   top gap in scope, draft, run it with a file filter, open it in the same PR. TestGen-LLM's 73 percent acceptance came
   from filtering candidates before proposing them [18]; the draft builder validates the same way diagnosis validates
   patches.
3. **The draft** (M1). A deterministic skeleton: title from the gap, `piwi:` annotations from the nearest test,
   catalog methods that reach the page as steps, a `TODO` assertion naming what to check. With an AI provider, the
   assertion is filled in from the source at the ref, the nearest test's source and the patch. Delivered by clipboard,
   as a draft PR on the auto-heal machinery, or to the agent.
4. **The Gaps tab** (M3), grouped by feature, with the inbox verbs. Accept opens the draft. Snooze wakes when the
   surface changes. Dismiss asks for a reason: *not worth testing*, *covered elsewhere* (asks for the test, writes a
   manual reach edge), *wrong*. A `gaps` inbox queue on Home lists accepted-but-unwritten gaps older than a week.
5. **The digest** (M3). Top five new gaps per project, weekly, off by default.

**Precision is a first-class number.** Heuristic traceability tops out around 78 percent precision at the function
level [25], and the incidental-catch detector is that problem in reverse. Every triage verdict is a labeled example:
accepted and covered-by count for the detector, dismissed-as-wrong counts against it. The admin stats page shows
precision per detector per project. A detector below 60 percent on a project with at least twenty verdicts mutes
itself there and says so, and its rows drop out of the PR comment first.

## API

```
GET            /api/projects/:id/gaps                       # ranked; filter by class/detector/feature/status/pr
GET            /api/projects/:id/gaps/:gapId                 # evidence, factors, nearest test, draft
POST           /api/projects/:id/gaps/:gapId/triage          # accept | snooze | dismiss | covered-by
POST           /api/projects/:id/gaps/:gapId/draft           # skeleton, optionally AI-filled → clipboard | pr
GET            /api/projects/:id/gaps/change-coverage        # ?run= | ?base=&head=
POST           /api/projects/:id/gaps/recompute
GET/PUT        /api/projects/:id/surface/manifest            # declared routes/pages (openapi url | json)
GET            /api/projects/:id/probes/plan                 # what `piwi probe` runs tonight (reporter API key)
POST           /api/projects/:id/probes/results              # outcomes from a probe run
POST           /api/projects/:id/usage                       # production route counts (usage-scoped key)
```

Retention: `test_reach` and `app_surface` rows referencing pruned runs keep `last_seen_at` and age out after
`PIWI_RETENTION_DAYS`; closed and dismissed gaps prune with the same window; open gaps never. Imported runs feed the
reach index but never trigger diff detectors, probes or PR feedback.

## New data, and the process each one implies

1. **Page inventory on passing runs** (reporter, M2). `{ url, controls: [{ role, name }], links: [{ name, href }] }`
   attached as `piwi-page-inventory`, stored through `case_payloads`, taken at navigation settle and test end, capped
   at 500 entries per page, skipped when the worker already inventoried the URL in this run, opt-out
   `capturePageInventory: false`.
2. **Handler file on the root span** (both instrumentation packages, M2). One field; the reporter already forwards
   spans untouched.
3. **Probe mode and `piwi probe`** (reporter, M2). The reporter fetches the plan, applies it via `page.route`, stamps
   the run as a probe. Process: one scheduled CI job per project, or the desktop app.
4. **The application manifest** (M3). Instrumentation-served route table, an OpenAPI URL, or a committed JSON.
5. **Production route usage** (M4, opt-in). Instrumentation in production counts requests per route pattern per day
   and posts `{ day, routes: [{ method, pattern, count }] }` once a day under a usage-scoped key. No identifiers, no
   bodies, no headers, a hard cap on distinct patterns. Process: two environment variables on the production
   deployment, or a cron that uploads an access-log summary.
6. **Guided exploration** (M4). A scheduled job or a desktop action, page budget, never a production origin.
7. **Sampled real coverage** (M5, opt-in). `PIWI_COVERAGE=1` on one scheduled job; V8 coverage resolved through source
   maps into `file` edges with origin `coverage`.

## What this deliberately is not

- **Not coverage, and it never claims to be.** Every screen, comment and tool result says *observed reach*.
- **Not mutation testing of the application.** Probes mutate responses in the browser, never source or server state.
- **Not a test generator.** The draft is a skeleton with the reachable setup filled in; the assertion is the human's or
  the agent's, and an AI-filled draft is validated like a diagnosis patch. Nothing is committed except through the
  reviewed PR ramp.
- **Not a gate by default.** Warn-only until precision is measured on the team's own data.
- **Not a percentage.** A percentage over an observed surface looks complete exactly when the surface is sparse. Counts
  per class and per feature, and the trend of gaps closed.
- **Not a crawler of everything.** Exploration is budgeted against the suite's reach.
- **Not a service, not telemetry.** Usage counts are the application posting to the team's own instance.

## Interactions worth designing, not discovering

- **Impact and gaps share the index.** The impact resolver's `reach` map becomes a read of `test_reach`.
- **Probes and fixtures.** A test that seeds data through the API before the UI step would see its seeding request
  mutated if the route matches; probes mutate only requests issued after the first navigation (open question 1).
- **Healing gets a pre-flight.** *Locator break ahead* is a diff-time input to locator healing; the ranked alternatives
  per call site can be recomputed against the new template before the run fails.
- **Baselines on partial runs.** *Changed, unreached* reads "no test *in this run*" and adds the project-wide count.
- **The 1.0 freeze.** The manifest JSON, the usage payload, the probe plan and the `piwi-page-inventory` attachment are
  external contracts; land or defer them in [`1.0-stabilization.md`](1.0-stabilization.md).
- **Demo mode.** Detectors are pure and live in `shared/handlers/`; the seed gains a declared manifest, a PR-stamped run
  and a few probe outcomes so the Gaps tab and the PR section render.

## Milestones

- **M1 — the index, the diff, and the agent.** `test_reach`, `app_surface` (observed), `graph_edges` with the structural edges
  (links, contains, triggers, loads, calls) and the reach index as a view, `scenario_gaps`; detectors on
  stored data (success only, single covering test, phantom, passed with errors, catalog method, incidental catch, fix
  did not hold, assertion-light as prior, changed/unreached, new error path, intent without a test); exposure without
  usage; the PR comment section per ticket; `get_change_coverage`, `list_scenario_gaps`, `draft_scenario` and the
  skill; deterministic draft; demo handlers; docs. Useful with zero setup on any instance with history and an SCM
  token.
- **M2 — the whole suite, and the oracle.** Page inventory on passing runs; handler file on the root span; probe mode
  and `piwi probe` with the nightly budget; the oracle ledger; not-noticed, control, reachable-unvisited, new-control
  and locator-break-ahead detectors; features from tags and catalog; `maxUncoveredChanges` warn-only; the desktop
  local-diff command.
- **M3 — declared surface, the tab, and the loop.** Manifest from instrumentation, OpenAPI URL, committed JSON;
  documented error codes; escaped defects over the Jira binding; import edges; the Gaps tab grouped by feature with
  triage; the gaps inbox queue; the digest; precision per detector with self-muting; matrix detectors; healing
  pre-flight wired to auto-heal; server-side probes through a signed per-request header in both instrumentation
  packages, the resilience signal and the *unhandled failure* class; the feature-graph view per feature and
  `get_feature_graph`.
- **M4 — usage and exploration.** Production route counts in both instrumentation packages and the upload endpoint;
  usage in exposure and the "most-used routes without a test" card; guided exploration from a scheduled job and the
  desktop.
- **M5 — truth, and the blocking decision.** Sampled V8 coverage with source-map resolution; a decision on a blocking
  gate mode from M2–M4 precision data; probes extended to dialogs and storage state if the route probes have earned it.

## Open questions

1. **Probe mutations and test fixtures.** Mutate only requests issued after the first navigation, or only the Nth
   matching request? Configurable per project?
2. **Probe budget defaults.** Fifty a night is a guess; should the budget be minutes, using recorded test durations?
3. **Feature clustering trust.** Does a cluster-derived feature appear in the PR comment, or only in the tab until
   someone names it?
4. **Where the page inventory is taken.** Every navigation settle, with a node-count threshold, or a sampling rate?
5. **Accessible-name keys across locales.** Key by `data-testid` when present, else role and name?
6. **Manifest fetch trust.** Guard behind the instrumentation header on the first response, or an explicit option?
7. **Usage payload authentication.** API-key scopes, or a token kind like the streaming token?
8. **How much of the PR comment.** Cap at five lines with a link, or a score threshold?
9. **Strengthening versus adding.** A not-noticed probe suggests strengthening an existing test. This feature, or spec
   health?
10. **Probe header trust.** A shared HMAC secret between reporter and instrumentation is one more secret to
    provision. Is the reporter API key acceptable as the signing key, or does a staging environment need its own?
11. **State-changing routes under dependency faults.** A failed payments call after an order row was written is
    exactly the case worth seeing and exactly the case that dirties a shared staging database. Ephemeral database per
    probe run, a per-project allowlist of routes, or both?
12. **Trigger-edge confidence.** Two actions in quick succession share a request window. Is the share of executions
    where the co-occurrence held enough, or does the reporter need to tag requests with the current step id?

## Prior art

| Product | What it does | Relation |
|---|---|---|
| [Teamscale Test Gap Analysis](https://teamscale.com/features/test-gap-analysis) | changed-and-untested methods from repository changes and profiler coverage; feature coverage maps gaps to tickets | the mature form of change-time gaps; needs code coverage; method-level |
| [SeaLights](https://docs.sealights.io/knowledgebase/coverage-and-quality-insights/test-gaps-analysis-report) | test gap analytics, user-story coverage, quality gates | same idea, closed SaaS, coverage-based |
| [Codecov patch coverage](https://docs.codecov.com/docs/commit-status) | a status check on the lines a PR touched | the mainstream form of "uncovered changes" |
| [Datadog Test Impact Analysis](https://docs.datadoghq.com/tests/test_impact_analysis/how_it_works/), [Develocity PTS](https://gradle.com/develocity/product/predictive-test-selection/), Launchable | per-test coverage or learned history to select tests | the same index read forward; none reports the inverse |
| [mabl coverage](https://help.mabl.com/hc/en-us/articles/19083839661460-The-coverage-overview-dashboard) | link crawler discovers pages; journeys per page; daily users via a Segment integration retired in 2026 | closest to the surface inventory; knows only its own tests |
| [Octomind](https://octomind.dev/docs/advanced/octomind-bot), Checksum, Meticulous | crawl the app or record sessions, propose journeys, emit Playwright or replay | the draft ramp as a whole product; blind to the existing suite and its failures |
| [Keploy](https://keploy.io/record-replay-testing), [Speedscale](https://docs.speedscale.com/concepts/replay/) | record production API traffic, replay as regression tests | the usage pillar taken to generation, APIs only |
| [Restats](https://github.com/SeUniVr/restats) | REST coverage metrics from an OpenAPI spec and observed traffic | the declared-surface detectors, as an academic tool |
| [Netflix FIT and ChAP](http://techblog.netflix.com/2014/10/fit-failure-injection-testing.html), [LinkedIn LinkedOut](https://engineering.linkedin.com/blog/2018/05/linkedout--a-request-level-failure-injection-framework) | request-scoped fault injection: a header or cookie carries the fault rule, library hooks or a request filter apply it | the exact mechanism of the server-side probe; they ask whether the system survives, not whether a test would notice |
| [Gremlin ALFI](https://www.gremlin.com/blog/the-next-step-application-level-fault-injection/), [Istio and Envoy fault filters](https://istio.io/latest/docs/tasks/traffic-management/fault-injection/), [Toxiproxy](https://qaskills.sh/blog/toxiproxy-fault-injection-testing-guide-2026), [WireMock](https://wiremock.org/2.x/docs/simulating-faults/) | fault injection at the library, mesh, TCP and stub level | alternative application points; none joined to a test suite or a coverage map |
| [chaosbringer](https://github.com/mizchi/chaosbringer), [playwright-network-chaos-mcp](https://glama.ai/mcp/servers/vola-trebla/playwright-network-chaos-mcp) | Playwright-level network and runtime fault injection with invariants, or under agent control | the client-side probe as a standalone tool; unaware of the suite |

## References

1. Eder, Hauptmann, Junker, Juergens, Vaas, Prommer. *Did we test our changes? Assessing alignment between tests and
   development in practice.* AST 2013. <https://ieeexplore.ieee.org/document/6595800> — changed-but-untested methods
   over 14 months of an industrial system; the origin of test gap analysis.
2. Rott, Niedermayr, Juergens, Pagano. *Ticket coverage: putting test coverage into context.* WETSoM 2017.
   <https://arxiv.org/abs/1804.07599> — per-ticket ratio of changed methods executed by tests; the ticket join.
3. Nagappan, Ball. *Use of relative code churn measures to predict system defect density.* ICSE 2005.
   <https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/>
   — the churn factor.
4. Kamei, Shihab, Adams, Hassan, Mockus, Sinha, Ubayashi. *A large-scale empirical study of just-in-time quality
   assurance.* IEEE TSE 2013. <https://dl.acm.org/doi/10.1145/3558489.3559068> — change-level risk prediction.
5. Cotroneo, De Rosa, Improta, Varriale. *What makes software bugs escape testing? Evidence from a large-scale
   empirical study.* arXiv, April 2026. <https://arxiv.org/abs/2604.26672> — escaped bugs concentrate in older,
   frequently modified, high-churn components; the age factor and escape history.
6. Lewis, Lin, Sadowski, Zhu, Ou, Whitehead. *Does bug prediction support human developers? Findings from a Google
   case study.* ICSE 2013.
   <https://neverworkintheory.org/2013/06/06/does-bug-prediction-support-human-developers-findings-from-a-google-case-study.html>
   — no identifiable change in developer behavior; why the dashboard ships last.
7. Ivanković, Petrović, Just, Fraser. *Code coverage at Google.* ESEC/FSE 2019.
   <https://dl.acm.org/doi/10.1145/3338906.3340459> — coverage on changed lines in code review; why the PR comment
   ships first.
8. Niedermayr, Juergens, Wagner. *Will my tests tell me if I break this code?* CSED 2016.
   <https://arxiv.org/abs/1611.07163> — pseudo-tested methods, 6 to 53 percent of covered methods; the checked axis.
9. Vera-Pérez, Danglot, Monperrus, Baudry. *A comprehensive study of pseudo-tested methods.* Empirical Software
   Engineering 2018. <https://arxiv.org/abs/1807.05030> — replication on 28k+ methods; Descartes.
10. Memon, Soffa, Pollack. *Coverage criteria for GUI testing.* ESEC/FSE 2001.
    <https://dl.acm.org/doi/10.1145/503209.503244> — event-based adequacy; the control surface.
11. Martin-Lopez, Segura, Ruiz-Cortés. *Test coverage criteria for RESTful web APIs.* A-TEST 2019.
    <https://dl.acm.org/doi/10.1145/3340433.3342822> — status-code class coverage; the success-only detector.
12. Corradini, Zampieri, Pasqua, Ceccato. *Restats: a test coverage tool for RESTful APIs.* ICSME 2021.
    <https://arxiv.org/abs/2108.08209>.
13. Mesbah, van Deursen, Lenselink. *Crawling Ajax-based web applications through dynamic analysis of user interface
    state changes.* ACM TWEB 2012. <https://dl.acm.org/doi/10.1145/2109205.2109208> — Crawljax; guided exploration.
14. Elbaum, Rothermel, Karre, Fisher. *Leveraging user-session data to support web application testing.* IEEE TSE
    2005. <https://www.researchgate.net/publication/3188481_Leveraging_User-Session_Data_to_Support_Web_Application_Testing>
    — the usage pillar.
15. Sampath, Sprenkle, Gibson, Pollock, Souter. *Applying concept analysis to user-session-based testing of web
    applications.* IEEE TSE 2007.
    <https://www.academia.edu/3490133/Applying_Concept_Analysis_to_User_Session_Based_Testing_of_Web_Applications>.
16. Santelices, Chittimalli, Apiwattanapong, Orso, Harrold. *Test-suite augmentation for evolving software.* ASE
    2008. <https://www.semanticscholar.org/paper/Test-Suite-Augmentation-for-Evolving-Software-Santelices-Chittimalli/05cf2988ea3ac5e697fc51f85e7dd2031dd8af01>
    — the formal name of the change-time ramp.
17. Danglot, Vera-Pérez, Yu, Zaidman, Monperrus, Baudry. *A snowballing literature study on test amplification.* JSS
    2019. <https://arxiv.org/abs/1705.10692>.
18. Alshahwan et al. *Automated unit test improvement using large language models at Meta.* FSE 2024 Industry.
    <https://arxiv.org/abs/2402.09171> — 73 percent acceptance through pre-filtering; the draft builder's rule.
19. Foster et al. *Mutation-guided LLM-based test generation at Meta.* FSE 2025 Industry.
    <https://arxiv.org/abs/2501.12862> — mutants drive which tests are generated; the oracle probes.
20. Gligoric, Eloussi, Marinov. *Practical regression test selection with dynamic file dependencies.* ISSTA 2015.
    <https://dl.acm.org/doi/10.1145/2771783.2771784> — Ekstazi.
21. Legunsen, Shi, Marinov. *STARTS: STAtic regression test selection.* ASE 2017.
    <https://www.cs.cornell.edu/~legunsen/pubs/LegunsenETAL17STARTS.pdf>.
22. Herzig, Greiler, Czerwonka, Murphy. *The art of testing less without sacrificing quality.* ICSE 2015.
    <https://www.microsoft.com/en-us/research/publication/the-art-of-testing-less-without-sacrificing-quality/>.
23. Memon et al. *Taming Google-scale continuous testing.* ICSE SEIP 2017.
    <https://research.google/pubs/taming-google-scale-continuous-testing/>.
24. Machalica, Samylkin, Porth, Chandra. *Predictive test selection.* ICSE SEIP 2019.
    <https://arxiv.org/abs/1810.05286> — the index read forward.
25. White, Krinke, Tan. *Establishing multilevel test-to-code traceability links.* ICSE 2020.
    <http://www0.cs.ucl.ac.uk/staff/jkrinke/publications/icse20.pdf> — 78 percent MAP; the precision loop.
26. Alian, Nashid, Shahbandeh, Shabani, Mesbah. *Feature-driven end-to-end test generation.* ICSE 2025.
    <https://arxiv.org/abs/2408.01894> — AutoE2E and E2EBench; features as the unit.
27. Le et al. *Automated web application testing: end-to-end test case generation with large language models and
    screen transition graphs.* JSAI 2025. <https://arxiv.org/abs/2506.02529>.
28. Ye, Yu, Xu, Peng, Yu. *AI agents for web testing: a case study in the wild.* arXiv 2025.
    <https://arxiv.org/abs/2509.05197>.
29. Meiklejohn, Estrada, Song, Miller, Padhye. *Service-level fault injection testing.* SoCC 2021.
    <https://dl.acm.org/doi/10.1145/3472883.3487005> — Filibuster; faults at every remote call of a passing
    functional test; the search strategy and the dependency fault class.
30. Schuler, Zeller. *Assessing oracle quality with checked coverage.* ICST 2011.
    <https://dl.acm.org/doi/10.1109/ICST.2011.32> — oracle quality as the share of executed statements that influence
    an assertion; the theoretical form of the checked axis.
31. Petrović, Ivanković. *State of mutation testing at Google.* ICSE SEIP 2018.
    <https://research.google.com/pubs/archive/46584.pdf> — 75 percent usefulness over 150,000 surfaced mutants by
    strict selection; the rule for which probes to run and show.
32. Praphamontripong, Offutt. *Applying mutation testing to web applications.* ICSTW 2010.
    <https://www.albany.edu/faculty/offutt/research/papers/webmujava.pdf> — web-specific mutation operators.
33. *Mutta: a novel tool for E2E web mutation testing.* Software Quality Journal 2023.
    <https://link.springer.com/article/10.1007/s11219-023-09616-6>.
34. Zhang, Monperrus and colleagues. *ChaosMachine, ChaosOrca, Phoebe: application-level chaos engineering.* KTH,
    2019–2021. <https://github.com/ASSERT-KTH/royal-chaos> — chaos engineering evaluated as error-handling quality;
    the resilience signal.
35. Netflix. *FIT: failure injection testing* (2014) and *ChAP: chaos automation platform* (2017).
    <http://techblog.netflix.com/2014/10/fit-failure-injection-testing.html> — a header carrying a fault rule on
    tagged requests; the request-scoped probe mechanism.
36. LinkedIn. *LinkedOut: a request-level failure injection framework.* 2018.
    <https://engineering.linkedin.com/blog/2018/05/linkedout--a-request-level-failure-injection-framework> — error,
    delay and timeout on one downstream call for one request; the dependency fault class.
