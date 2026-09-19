# Scenario gaps — the Test Map

A design record for **scenario gaps**: the dashboard proposing tests that do not exist yet, from one graph of what
the application exposes, what the suite touches, what the suite would actually notice, and what is worth caring
about. A gap is always a suggestion with evidence and a next step — a draft spec, an MCP call, a line in the
pull-request comment — never a verdict.

**Status.** Third revision; **M1 is implemented** on the `claude/test-map-m1` branch. M1 ships the graph substrate
(`graph_nodes`, `graph_edges`, `scenario_gaps`) with route and page nodes and `reaches`/`changes` edges populated on
every ingest, the four M1 detectors (changed-unreached, success-only, single-covering-test, surface-drift), exposure
ranking over churn, age, escape history and priority, the uncovered-changes section and commit status in pull-request
feedback, and the `gaps`, `gaps/change-coverage` and `gaps/recompute` endpoints with the `get_change_coverage` MCP
tool. The M1 ingest path also holds the size-discipline rules that keep the graph proportional to a project's
surface: page nodes keyed on the path pattern, route nodes only from the run's own origin (its Playwright `baseURL`
plus a per-project allowlist), default-branch runs writing canonical rows while other branches write branch-tagged
ones so a pull-request route never drifts onto the default branch, and a nightly graph sweep that prunes `changes`
edges past ninety days, branch-tagged rows past thirty, and canonical nodes unseen for thirty runs once their
surface-drift gap has closed.

**M2 is implemented** on the `claude/test-map-m2` branch. M2 broadens the graph with `control`, `link`, `handler` and
`dependency` nodes and the `contains`, `links`, `triggers`, `loads`, `handled-by` and `calls` edges (size rule 3 —
templated control names and the 200-per-page cap — applied on ingest); the page inventory the reporter records on
passing runs (`piwi-page-inventory`, stored through `case_payloads`); one instrumentation release carrying the root
span's handler field and a signed `X-Piwi-Probe` header, honored outside production and flagged off; client probes
with the `probes` table (named `probes`, not "oracle"), the `checks` edges, the `probes/plan` and `probes/results`
endpoints and the `piwi probe` command; the M2 detectors wired into the automatic recompute; features from tags as
feature nodes with `groups` edges; the `list_scenario_gaps` and `draft_scenario` MCP tools with the deterministic
draft skeleton and the `write-the-missing-test` skill; and the `maxUncoveredChanges` gate policy, off by default and
warn-only. The change-time detectors (new error path, new control, intent without a test, locator break ahead) ship
as pure detectors pending the change-coverage path carrying hunk and title data, and the desktop local-diff command
stays the M1 TODO. M3 and later remain proposed. The first revision built two references (a reach index and a surface inventory)
and listed the difference; the second added an oracle axis, an exposure score and a feature graph after a review of
the products and research in this area ([Prior art](#prior-art), [References](#references)); the third made the graph
the substrate, split resilience findings from suite gaps, thinned the first milestone to a spine and put an entry
condition on everything after it ([Revision history](#revision-history)).

**Summary.** A missing test is only visible against a reference for what the application can do. Piwi already stores
the pieces of that reference: the routes tests hit, the pages they end on, the controls they touch, the controls and
links a page exposes, the page-object methods a project owns, the spans a backend emitted per request, the failures
that escaped, and the diff of every pull request. This record joins them into **one typed graph** per project, in
which a page links to a page, a control triggers a route, a route is handled by a file, a handler calls a
dependency, a test reaches and checks some of these, and a commit changes one of them. Three findings from the
literature decide what is built on that graph. **Reach is not protection** — a large share of code that tests execute
is pseudo-tested, nothing fails when it breaks [8][9] — so the model has a *checked* axis, measured by probing passing
tests with faults, first at the Playwright route boundary and then inside the server through a signed per-request
header. **A dashboard of predictions changes nothing** — Google measured no behavior change from company-wide bug
prediction [6], while coverage on changed lines inside code review is the form developers used [7] — so the
pull-request comment and the agent tools ship first and the dashboard tab last. **Where bugs escape is knowable** —
changed-but-untested code, high churn, and *older* components rather than new ones [1][2][3][5] — so the ranking is
an explicit *exposure* score. The plan is thin at the start and self-pruning after: the first milestone is one honest
paragraph in a pull request, and everything later carries an entry condition measured on the same evidence the
feature asks teams to trust. Everything stays on the instance, says *observed reach* rather than coverage, and
proposes rather than applies.

## Revision history

### Third revision — coherence

| Change | Was | Now | Why |
|---|---|---|---|
| One substrate | three stores, then a graph described as views over them, with both kept as tables | `graph_nodes`, `graph_edges`, `oracle_probes`; the reach index, surface inventory and oracle ledger are views, defined as such | two sources of truth for reach; dependency nodes had no table |
| Resilience findings | "unhandled failure" listed as a fifth gap class the score never mentioned | a separate finding kind with its own ranking rule, exposure × severity, outside the protection formula | not derived from the three axes |
| Order of the record | reach, surface, oracle, then the graph last | model, graph, then the three views | a reader met the substrate after the things built on it |
| Milestone spine | M1 carried the graph, eleven detectors, three tools and the draft builder | M1 is route and page reach, four detectors, the PR section and `get_change_coverage`; M2 and M3 follow; the rest waits on entry conditions | a first milestone that is a whole product never ships |
| Entry conditions | M4 and M5 as numbered promises | server probes, usage, exploration, V8 coverage and a blocking gate each proceed only on a measured condition | the precision loop applied to the plan itself |
| Detector milestones | five graph-derived detectors assigned to nothing | every detector carries its milestone | |
| Instrumentation releases | handler field in M2, probe header in M3 | one release in M2 carrying both, probe support flagged off until M3 | two releases of two packages for one feature |
| Stale lines | "never server state"; open question 1 already answered in the body; `features.source` without `catalog`; the `loads` edge marked observed today; a not-noticed line in the M1 comment example | each corrected in place | |

### Second revision — the research

| Change | Was | Now | Evidence |
|---|---|---|---|
| Third axis | reached or not | reached · checked · exposed | [8][9][19] |
| Oracle probes, two levels | assertion-count heuristic | client probes at `page.route`; server probes through a signed per-request header applied by the instrumentation | [29][35][36] |
| Delivery order | tab first | PR comment and MCP tools first, tab last | [6][7] |
| Exposure score | risk loosely defined | usage, churn, age, escape history, priority; age weighted *up* | [3][4][5] |
| Ticket and feature as units | files and routes | changes joined to tickets; surfaces clustered into features | [2][26] |
| Feature graph | three stores | one typed graph; detectors are missing-edge patterns | [10][13][29] |
| Usage source | a standalone integration | counts from the instrumentation packages teams already install | mabl retired its Segment usage integration in 2026 |
| Precision loop | dismiss reasons | per-detector precision from triage; self-muting below threshold | [25][18] |

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

## The model: reached, checked, exposed

Every node of the application surface — a route, a page, a control, a dependency, and the feature that groups them —
is scored on three axes:

- **Reached** — does any test observably exercise it? From `reaches` edges. Discounted when the only tests are flaky,
  quarantined, skipped for weeks, or a single test.
- **Checked** — would a test fail if it broke? From `checks` edges, which probe outcomes write; before a probe has
  run, an assertion prior from step analysis.
- **Exposed** — how much does it matter? From production usage, churn, age, escape history and priority tags.

Four gap classes fall out:

| Class | Meaning |
|---|---|
| **Blind spot** | No trusted test reaches it. Declared in a manifest, seen in an ARIA inventory, or linked from a visited page, and never exercised. |
| **False comfort** | Tests reach it and a probe shows they would not notice it breaking. The most dangerous class, because the catalog says it is covered. |
| **Fragile** | Reached and checked, but only by a single test, a flaky one, a quarantined one, or one that has not actually run in weeks. |
| **Protected** | Reached by more than one trusted test and at least one probe made a test fail. Not listed; counted, so the trend is visible. |

Server-side probes produce a second kind of result that is not a suite gap: a **resilience finding**. The
application did not degrade gracefully under a failed handler or dependency — blank page, uncaught error, spinner
past the timeout — whether or not a test noticed. Findings sit in the same list, carry the same triage verbs, and are
ranked by exposure and severity alone, because the protection formula does not apply to them.

```
# suite gaps
protection = reach × check              # each in [0.1, 1]; a missing input never zeroes a row
gap score  = exposure × (1 − protection) / cost

# resilience findings (server probes only)
finding score = exposure × severity     # unhandled 1.0 · degraded 0.5

reach     from trusted covering tests (flaky, quarantined, phantom, single → discounted)
check     probe outcomes; before a probe: assertion prior from step analysis
exposure  usage_30d · churn_90d · age · escape_history · priority
cost      low when a catalog method reaches the page or a test can be forked
```

"Coverage" is used only with the qualifier the selection suggestions already use — *observed* reach, never
instrumented coverage — and the UI repeats that qualifier.

## The graph substrate

Everything in this record is a fact about the same objects. Kept as separate tables they answer separate questions;
kept as one typed graph they answer any path question, and every detector becomes a missing-edge pattern. The three
views a reader expects — a reach index, a surface inventory and an oracle ledger — are queries over the graph, not
tables of their own.

Two edge kinds are new and both come from data already captured. **Triggers**: step events carry a start time per
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
| `loads` | page → route | document and XHR requests during navigation settle (needs the page inventory, M2) | observed |
| `handled-by` | route → handler file | root span handler field (M2) or file-routing convention | observed or convention, labeled |
| `calls` | handler → dependency | child spans under the request's root span | observed |
| `imports` | file → file | shallow import scan at the run's ref (M3) | inferred |
| `groups` | feature → page, route, control | tags, catalog url patterns, URL clustering | by source, in that order |
| `reaches` | test → page, control, route, file, handler | network requests, page state, locator call sites, source frames, trace call sites | trusted or discounted per test |
| `checks` | test → route, dependency | probe outcomes; assertion prior before a probe | probe or prior, labeled |
| `uses` · `drives` | test → catalog function → control pattern | function catalog, source frames, call sites | observed |
| `changes` | commit or ticket → file | SCM diff, commit message ids | observed |
| `affects` · `caused-by` | cluster → test; cluster → file | failure clusters, first-bad and fixing commits | observed |
| `owns` | owner → file, test | CODEOWNERS | observed |

What the graph answers that separate tables cannot:

- **Blast radius of a change**, in both directions: file → handler → route → control → page → feature, and at each
  hop the tests that reach it, the tests that check it, and the owner. The impact command and the uncovered-changes
  section from one traversal.
- **Blast radius of a dependency.** If the payments service is down, which features degrade, which pages show it,
  and which tests would notice. Server-side probes fill the `checks` edges on dependency nodes; the graph says which
  ones are worth filling.
- **The path to a gap.** From a reached page to an unreached one through links and controls. That path is the
  draft's step list; a gap with no path is a gap the draft cannot reach and says so.
- **Cross-feature coupling.** Two features sharing a handler or a dependency: a change to one is a regression risk
  for the other, and the PR comment can say "also touches Refunds through `orders.post.ts`".
- **Drift over time.** Every node and edge carries first and last seen. Nodes that appeared with no reach are new
  surface; nodes that vanished with tests still pointing at them make those tests orphans.
- **Usage against test effort.** Usage counts sit on route and page nodes, test counts on the same nodes; a feature
  with a large share of traffic and a small share of tests is the one card a product owner needs.

### Storage

```
graph_nodes     id, project_id, kind ∈ feature|page|control|link|route|handler|dependency|file,
                key, attrs JSON, origin ∈ observed|manifest|openapi|convention|import|coverage|usage|manual,
                first_seen_run_id, last_seen_run_id, last_seen_at, usage_30d,
                branch? (null = canonical, written by default-branch runs; set for other branches)
                unique (project_id, kind, key, branch)
                a feature node's attrs: { url_patterns, source ∈ tag|catalog|cluster|manual }

graph_edges     id, project_id, from_kind, from_key, to_kind, to_key,
                kind ∈ links|contains|triggers|loads|handled-by|calls|imports|groups|
                       reaches|checks|uses|drives|changes|affects|caused-by|owns,
                confidence, origin, evidence JSON, first_seen_run_id, last_seen_run_id, branch?
                unique (project_id, from_kind, from_key, kind, to_kind, to_key, branch)
                from/to kinds also name test cases, clusters, commits, tickets and owners

oracle_probes   id, project_id, test_case_id, node_id (route or dependency), level ∈ client|server,
                fault ∈ status-500|empty-body|drop-field|stale-value|slow|throw|dependency|extreme|replay|auth,
                applied (from X-Piwi-Trace; client probes always true),
                outcome ∈ noticed|not-noticed|inconclusive, handled ∈ graceful|degraded|unhandled|n/a,
                run_id, probed_at, evidence JSON
                → writes or refreshes one `checks` edge test → node with the outcome

scenario_gaps   id, project_id, kind ∈ gap|finding, detector,
                class ∈ blind-spot|false-comfort|fragile|unhandled|degraded, key,
                title, evidence JSON, factors JSON, score, feature_node_id?, ticket?,
                test_case_id?, failure_cluster_id?, test_run_id?, pr_number?,
                status ∈ open|snoozed|dismissed|accepted|closed, dismiss_reason?,
                assigned_to?, created_at, updated_at, closed_at, closed_by_run_id?

views           reach_index       = graph_edges where kind = reaches
                surface_inventory = graph_nodes where kind in (page, control, link, route, handler, dependency)
                oracle_ledger     = oracle_probes joined to its checks edge
```

Both dialects (`schema.sqlite.ts` + `schema.pg.ts`). Not a graph database: typed endpoints and recursive common
table expressions capped at a depth of six. A project with thousands of tests produces tens of thousands of edges.
The page inventory and probe evidence flow through the content-addressed `case_payloads` table. Nodes and edges
referencing pruned runs keep `last_seen_at` and age out after `PIWI_RETENTION_DAYS`; closed and dismissed gaps prune
with the same window; open gaps never. Gaps persist because triage must survive recomputation, and a gap closes
itself when its node gains a trusted edge, so "closed this month" is a real number. Imported runs feed the graph but
never trigger diff detectors, probes or PR feedback.

**Size discipline.** The upsert rule bounds growth per run, not the cardinality of what is upserted and not growth
over time. Six rules keep a large application's graph proportional to its surface rather than to its data:

1. **Pattern keys for pages.** Page nodes are keyed on the normalized path pattern, ids collapsed the way
   `normalized_url` already does for routes, never on the host, so staging and production runs land on the same node.
2. **Own-origin routes only.** Route nodes come only from requests to the Playwright `baseURL` origin plus a
   per-project allowlist. Analytics beacons and CDN assets with cache-busting query strings never become nodes.
3. **Templated control names.** Control and link keys collapse digits, dates and ids in the accessible name, and a
   page keeps at most 200 distinct controls after templating. A table of five hundred orders is one control.
4. **A ninety-day window on `changes` edges**, pruned on their own schedule, because churn needs no more and commits
   are unique keys that would otherwise grow with history forever.
5. **A staleness sweep of its own.** A node unseen for thirty runs is removed once its surface-drift gap has been
   triaged, independently of `PIWI_RETENTION_DAYS`, which is opt-in and cannot be relied on.
6. **Canonical writes from the default branch only.** Runs on other branches write nodes and edges tagged with their
   branch. Change coverage reads both; branch-tagged rows are dropped when the pull request closes or merges, so a
   route added in a PR never shows up as drift on the default branch.

With those rules a large application — roughly three thousand routes, fifteen hundred pages and five thousand tests
each reaching thirty routes and five pages — produces about 175,000 `reaches` edges, and on the order of half a
million rows once M2 adds controls, links, triggers and calls. Both dialects handle that with indexes on both edge
endpoints and project-scoped recursive queries under the depth cap. Rules 1, 2, 4, 5 and 6 belong to the M1 ingest
path; rule 3 arrives with the page inventory in M2.

## What exists today

No detector in the first milestone needs new capture.

| Signal | Where it lives today | Captured on |
|---|---|---|
| Routes a test hit (pattern, method, status, duration) | `network_requests.normalized_url` / `method` / `status` | every execution |
| Page a test ended on, storage keys, cookie names | `test_runs_cases.page_state` | every execution |
| Locator call sites and the element each resolved to | `locator_snapshots` (`location`, `element_tag`, `element_attrs`, `element_text`) | every execution, upserted per call site |
| In-project frames a test ran through | `test_runs_cases.test_source_frames` (via `case_payloads`) | failures only — from the error stack |
| Every control and link on the page (role, name, `href`) | ARIA snapshot (`aria_snapshot_payload_id`) | failures; a green sample where one exists |
| Steps, their timing and their `expect` calls | `test_runs_cases.steps` / `step_events`, [`step-analysis.ts`](../apps/application/shared/step-analysis.ts) | every execution |
| Console entries, dialogs, backend logs and spans with child spans | `console_logs`, `dialogs`, `network_requests.server_logs` / `server_traces` | every execution |
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

```
SOURCES                          SUBSTRATE (per project)             ANALYSIS                DELIVERY
reporter attachments  ──┐        ┌─ graph_nodes  ────────────┐       ┌─ detectors ─────┐     ┌─ PR comment + status   M1
instrumentation       ──┼──────► │  graph_edges              │ ────► │  exposure       │ ──► │  MCP tools + skill     M1
SCM (diff, tickets)   ──┤ upsert │  oracle_probes            │ views │  ranking        │     │  gate policy, warn     M2
failure history       ──┤        │  ─────────────────────────│       └─ draft builder ─┘     │  Gaps tab + graph view M3
probe runs, 2 levels  ──┘ nightly│  reach index · surface    │              ▲                └─ weekly digest         M3
                                 │  inventory · oracle ledger│              └──── triage: dismissed-as-wrong, covered-by
                                 └───────────────────────────┘                    → detector precision, manual reaches edges
```

Sources Piwi already ingests write into the graph on every ingest. Probe runs at two levels write probe rows and
refresh `checks` edges. Detectors and the exposure ranking read the views. Delivery goes to the pull request and the
agent first.

## View: reach

What each test observably exercised, as `reaches` edges. The word is chosen against "coverage" on purpose, and the
edges degrade in the safe direction: no edge means no evidence, never proof of absence.

| Edge target | Source today | Captured on | Change needed |
|---|---|---|---|
| `route` | `network_requests.normalized_url` + method + status | every execution | none |
| `page` | `page_state.url` at test end; every navigation once the page inventory ships | every execution | M2 attachment |
| `control` | `locator_snapshots.element_*` resolved to role + accessible name | every execution | none |
| `file` | `locator_snapshots.location` (in-project call site, every run) ∪ `test_source_frames` (failures) ∪ trace action call sites where traces are retained | every execution for locator call sites | none; import edges in M3 |
| `handler` | root server span carrying the handler file, or a file-routing convention (Nitro, Nuxt pages, Next, SvelteKit) applied to `route`/`page` edges | every execution | M2 instrumentation field |
| `coverage` origin (later) | sampled V8 coverage from Chromium on one scheduled job, resolved through source maps | nightly only | later, opt-in; entry condition below |

This is the same map regression test selection reads forward [20][21][24]. The impact resolver's reach map becomes a
read of these edges; its safe widening on an unmapped source file stays, it just happens less, and each time it does
the file is also a gap.

## View: surface, features and tickets

What the application exposes or declares, as nodes. Three origins, each a ramp a team can take independently; the
detectors name the origin so "never observed" is never confused with "declared and never observed":

1. **Observed** (M1, no setup). Every reach edge implies its node. Every control and link in a stored ARIA snapshot
   is a node keyed by role, accessible name and page. Coverage criteria for GUIs have been event-based since 2001
   [10]; this is the observed version of that model.
2. **Declared** (M3). The instrumentation packages already own the framework and grow a route manifest served at
   `/__piwi/manifest` outside production, fetched once by the reporter's global setup. An **OpenAPI URL** per project
   adds documented response codes, so status-code class coverage [11][12] becomes a detector rather than a guess. A
   committed **`piwi.manifest.json`** covers anything else.
3. **Usage** (later, with an entry condition). Daily hit counts per route from the instrumentation packages in
   production mode. Never a separate analytics hookup.

**Features.** Files and routes are the engineer's unit; the tester's and the product owner's unit is the feature, and
the strongest recent result in end-to-end generation measures feature coverage rather than line coverage [26].
Feature nodes group surface nodes through `groups` edges, derived three ways in order of trust: the `piwi:feature`
tag on tests that reach them, the function catalog's `url_pattern`, and URL clustering with a name proposed the way
clusters are already named. A gap is then reported as "Refunds: 2 of 9 declared routes reached, 0 error paths, only
1 trusted test", and the Gaps tab, the PR comment and the digest group by feature.

**Tickets.** Ticket coverage — the ratio of a ticket's changed methods that tests executed — exposes gaps teams then
act on [2]. Piwi gets the join for free: ticket ids in commit messages and the PR body, and the Jira binding's links,
as `changes` edges from a ticket. At change time every gap carries its ticket, and the PR comment gives a verdict per
ticket, not just per file.

## View: oracle, at two levels

Reach says a test touched a route. It does not say the test would fail if that route returned garbage. Mutation
testing is the accepted answer at the unit level [8][9], checked coverage is its theoretical form [30], and Meta now
uses mutants to decide which tests are worth generating [19]. An end-to-end suite has two cheaper mutation points
than source code: the network boundary Playwright controls, and the request scope the instrumentation packages
already own.

### Level one — client probes (M2)

```
1. pick a pair        test T reaches route R; T passing; R unprobed; highest exposure first
2. run T under        page.route(R, mutate) — one of: status-500 · empty-body · drop-field ·
   interception       stale-value (replay a previous response) · slow (+5 s); client side only;
                      only requests issued after the first navigation, so seeding calls are never mutated
3a. T fails           → noticed: checks edge T → R, outcome noticed; protection up
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
reporter receives the probe plan from the server (pairs and faults), applies it through `page.route` in the worker,
and stamps the run so it never counts as a real run: no clusters, no regression signals, no notifications — exactly as
imports are silent today.

**Budget and safety.** One fault per test per run, a per-project nightly budget (default fifty), pairs ordered by
exposure, re-probe only on change. Response mutation happens in the browser, so the backend never receives anything
it would not receive in the plain run. Probes are off for any project without a scheduled job configured; nothing
runs on a developer's machine unasked.

**Before a probe has run**, the check factor is an assertion prior from step analysis: a test with no `expect` steps,
or only visibility assertions, on the route's page starts low. Probes replace the prior with an observation, and the
ledger records which.

### Level two — server probes (M3, on an entry condition)

The client probe rewrites a response in the browser, so the server never runs its error path. A server probe sends
the fault with the request and lets the instrumentation package apply it inside the server, scoped to that one
request. This is the mechanism Netflix built as FIT — a header carrying a fault rule that hooks in the common
libraries honor [35] — and LinkedIn as LinkedOut — a request filter injecting error, delay or timeout on one
downstream call for one request [36]. The research form is service-level fault injection: start from a passing
functional test, inject faults at every remote call it makes, and let the test tell you what it never checked [29].

The plumbing already exists. The Nitro plugin ([`integrations/nitro/src/index.ts`](../integrations/nitro/src/index.ts))
wraps the whole handler chain in an AsyncLocalStorage scope and parses the W3C `traceparent` header at the same
point, so a probe header read there is visible to every hook, middleware and handler of exactly that request and to
nothing else. The ASP.NET Core package sits in the same position with middleware and a delegating handler for
outbound calls. Both packages ship the header support in their M2 release, alongside the handler field, flagged off
until M3.

```
reporter worker ──── request + X-Piwi-Probe (HMAC · nonce · TTL) ────► instrumentation · request scope
picks (test, route, fault)                                              ├─ handler:    throw · status · delay · extreme
on the Nth request to R,                                                ├─ dependency: fail or delay one outbound call ──► DB · cache · downstream
after the first navigation                                              └─ data:       mutate the object before serialization
                ◄─── response + X-Piwi-Trace: fault applied? ───────────┘
two signals per probe:  oracle     — what the test did: noticed · not noticed          → checks edge
                        resilience — what the app did: console · dialogs · ARIA · logs → graceful · degraded · unhandled
```

| Fault | Applied where | What it reveals beyond the client probe |
|---|---|---|
| `throw` · `status` · `delay` | inside the handler | the server's error middleware, logging and retry logic execute; the backend log capture records what they did |
| `dependency` (fail or delay one outbound call) | the outbound client: fetch, HTTP client, DB driver hook, cache | the child spans already recorded per request name every dependency call site before any probe runs; the LinkedOut and Filibuster class of fault [29][36] |
| `data` (drop, null, empty list, stale) | the response object before serialization | the server serializer and the client parser both run on the mutated shape |
| `extreme` (empty or default return) | the handler | if every test still passes, the handler is pseudo-tested by the end-to-end suite in the unit-level sense [8] |
| `replay` · `auth` · `slow-first` | the request pipeline | idempotency of a repeated write, session expiry mid-flow, a race on the first request |

**Two signals per probe.** The oracle signal is whether the test failed, and it writes a `checks` edge. The
resilience signal is what the application did while the fault was applied, and the capture fixtures already record
it: console errors, uncaught exceptions, dialogs, the ARIA snapshot, backend logs. That is the resilience finding of
the model section: under a failed payments call the checkout page shows nothing, logs an uncaught error, and no test
covers it. Chaos tools ask whether the system survives [34]; this asks that and whether anyone would have known.

**Search.** Follows Filibuster [29]: enumerate the requests and child spans of a passing test, inject one fault per
distinct call site, deduplicate by route pattern, order by exposure, and try pairs only for the top of the list.
Google's mutation testing reached a 75 percent usefulness rate by surfacing one mutant per line and only the ones
its filters rated interesting [31]; the same strictness applies to which probes are run and which results are shown.

**Guards.** The header is HMAC-signed with a secret shared between reporter and instrumentation, carries a nonce and
a short TTL, and is honored only outside production under the same guard as log capture (`PIWI_TEST_LOGS_DISABLED`).
Fault classes are allow-listed per project. Dependency faults on state-changing routes can leave partial writes,
which is real behavior worth seeing, so they default to off and require an ephemeral or staging database. The
instrumentation reports the fault it actually applied in `X-Piwi-Trace`, so a probe the server did not honor is
recorded as inconclusive, never as a pass.

## Exposure

Each factor lives in [0.1, 1] so a missing input can never zero a row; the Gaps tab and the MCP tools show the
factors, not just the product.

| Factor | Source | Why it is in the score |
|---|---|---|
| **Usage** | `usage_30d` from instrumentation in production; otherwise in-degree in the link graph and the number of tests that reach the node's neighbors | suites built from real usage are as effective as white-box ones [14][15] |
| **Churn** | commits touching the files behind the node in the last 90 days, cached per commit | relative churn is highly predictive of defect density [3]; change-level risk models are built on it [4] |
| **Age** | first commit of the files behind the node | escaped defects concentrate in older, frequently modified components, not new code [5]; age multiplies churn |
| **Escape history** | files in any cluster's first-bad or fixing commit; tracker bugs without a linked cluster | an area that has already let a bug through is the definition of a residual-fault region [5] |
| **Priority** | highest `piwi:priority` among tests reaching the node's neighbors; feature-level tag | the team's own statement of what matters |

**The mabl lesson.** mabl weighted page coverage by daily users through a Segment integration and retired it in 2026.
A usage signal that needs its own analytics hookup is a signal most teams never turn on. Piwi's usage counts come
from the instrumentation package a backend team installs once for logs and spans, with one more environment
variable, and an uploaded access-log summary for teams that will not instrument production.

## Detectors

Pure functions over the graph plus history, in `shared/handlers/scenario-gaps.ts` beside the selection suggestions
so the demo runs them. Deterministic first, like the failure clues engine; a model is asked only to draft the test
for an accepted gap. Every row names its class and its milestone.

| Detector | Class | Pattern | Evidence line | Next step | M |
|---|---|---|---|---|---|
| Changed, unreached | blind spot | changed source file with no `reaches` edge into it, its handler or its route from any test in this run [1][2] | "+41 −3 · no test in run #812 · 0 in 30 runs" | derived from the file kind; per ticket | 1 |
| Success only | blind spot | route whose observed statuses are all 2xx/3xx; stronger with documented error codes [11] | "Seen 412 times, always 200 · documents 401, 409" | the error path per documented code | 1 |
| Single covering test | fragile | node reached by exactly one trusted test (the smoke set cover read backwards) | "Only checkout › coupon reaches this · quarantined" | a second scenario | 1 |
| Surface drift | blind spot | nodes first seen in the last run with no `reaches` edge; nodes that vanished with tests still pointing at them | "/billing/plans appeared in run #830 · 0 tests" | a scenario for the new surface | 1 |
| Phantom coverage | fragile | test skipped, fixme, did-not-run or blocked-by for > 30 days | "Skipped 47 days · last passed 2026-07-12" | discounts every node it used to reach | 2 |
| Passed with errors | false comfort | passing execution with console error, backend `Error` log, or background 5xx | "Passed · POST /api/audit returned 500 in background" | "no server errors during X"; route joins success-only | 2 |
| Catalog method no test calls | blind spot | `test_functions` row with no `uses` edge, page reached | "CartPage.applyCoupon · page reached by 4, called by 0" | the cheapest gap: steps already exist | 2 |
| Incidental catch | fragile | cluster diagnosis names a file or component in none of the affected tests' titles, tags, feature or `reaches` edges [25] | "Cause pricing/rounding.ts · caught by checkout › happy path" | a regression test seeded from the failing step and the validated patch | 2 |
| Fix did not hold | fragile | cluster state regressed | "Fixed in a1b2c3d · regressed 6 days later" | same, ranked higher | 2 |
| Intent without a test | blind spot | commit/PR title words match no test title, tag or feature | "fix: negative quantity · no test mentions quantity" | regression test drafted from the diff and message | 2 |
| New error path | blind spot | hunk adds a thrown error or status to a handler with a `route` node | "Adds 409 to POST /api/orders · never observed" | success-only for that code | 2 |
| Assertion-light | false comfort (prior) | zero or visibility-only `expect` steps on the page; becomes the prior once a probe runs | "3 tests, 0 expect on data" | schedule a probe; propose one assertion | 2 |
| Not noticed | false comfort | `checks` edge with outcome `not-noticed` on a node with exposure above threshold | "Passes with 500 on POST /api/orders" | the assertion named by the fault | 2 |
| Control nobody exercises | blind spot | `control` node with no `reaches` edge project-wide [10] | "On 12 pages · no locator targets it" | interact; catalog searched for a matching method | 2 |
| Reachable, unvisited | blind spot | `links` edge to a page node with no `reaches` edge | "Linked from 7 pages · never navigated to" | visit and assert | 2 |
| API-only route | blind spot | `route` node with reach but no `triggers` or `loads` edge into it | "POST /api/exports · reached only by request fixtures" | an API-level scenario, or nothing if headless by design | 2 |
| Orphan test | fragile | test whose `reaches` edges all point to nodes not seen in the last N runs | "3 pages it reaches disappeared 40 days ago" | retire or repoint | 2 |
| New control | blind spot | hunk adds a field, button or menu item to a template whose page has reach | "Adds input[name=promo] on /checkout" | control detector scoped to the PR | 2 |
| Locator break ahead | prediction | hunk removes a testid/id/name present in a control node's attributes | "Removes data-testid=submit-order · 3 call sites" | healing pre-flight, not a gap | 2 |
| Declared, never hit | blind spot | node with origin manifest or openapi and no `reaches` edge | "Declared in OpenAPI · 0 tests in 30 runs" | request it; fork the test reaching the nearest sibling | 3 |
| Escaped defect | blind spot | tracker bug in the project's binding with no linked cluster; matched by labels, feature, title words | "PROJ-412 · no cluster · mentions refund" | a scenario for the issue; feeds escape history | 3 |
| Unprobed dependency | false comfort (prior) | `calls` edge to a dependency node with no `checks` edge from any test | "payments-svc called by 3 routes · never probed" | schedule a dependency probe | 3 |
| Not handled | finding: unhandled / degraded | server probe with `handled ∈ degraded\|unhandled` | "payments-svc down → /checkout blank, uncaught TypeError" | an error-state scenario; owner from the handler's file | 3 |
| Matrix | fragile | critical feature on one browser or viewport class; feature on one environment; flag state never both ways | "critical · chromium only · no mobile viewport" | the missing Playwright project | 3 |

Four signals never produce a gap of their own but lower the reach factor of every node a test touches:
assertion-light, retry-dependent, phantom, quarantined. A route covered only by such a test still ranks as a gap.

## Change time

A diff is the smallest, most current reference there is, and it arrives at the only moment someone can still act
[1][7]. This is the whole of the first milestone.

```
PR run finishes ─► baseline ladder ─► SCM diff ─► join per file ─┬─► PR comment, per ticket
(branch, pr#,       (run-baseline.ts)   (files,     reaches edges: │   commit status (warn-only gate row, M2)
 commit, selection)                     hunks,      this run +     │   MCP get_change_coverage
                                        tickets)    last 30 runs;  │
                                                    checks edges;  │
desktop: the same join on the local working tree ──► file kind ────┘
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
- `components/OrderRow.vue` · reached by 4 tests · **not noticed** (from M2): `checkout › edits quantity`
  still passes when the PATCH returns 500 → *assert the row reflects the saved quantity* · draft

**No ticket**
- `utils/rounding.ts` · in the fixing commit of cluster #212, regressed once · exposure high
  → *cart total rounds half-up* · draft

4 files reached and checked. Gate `maxUncoveredChanges`: warn.
```

The gate ([`gate.post.ts`](../apps/application/server/api/test-runs/%5Bid%5D/gate.post.ts)) gains
`maxUncoveredChanges` in M2, off by default and **warn-only in its first release**; a blocking mode has an entry
condition below. The desktop app runs the same join against the local working tree before anything is pushed.

> **M1 TODO — desktop local-diff.** The change-coverage handler
> ([`shared/handlers/change-coverage.ts`](../apps/application/shared/handlers/change-coverage.ts)) already takes the
> changed files as input, so the desktop variant is a thin call once the shell can hand it a local `git diff`. That
> plumbing — a Tauri command and a desktop-only route that gathers the working-tree diff — is not itself thin, so M1
> ships only the server change-coverage path (a finished PR-stamped run, or `?base=&head=` on the API); the desktop
> local-diff command is deferred rather than half-built.

## Delivery, and the learning loop

The order matters more than the surfaces. A ranked list on a project page is the exact artifact that changed nothing
at Google [6].

1. **The PR comment and commit status** (M1). Where the author already looks, per ticket, with a draft link per gap.
2. **MCP tools and a skill.** `get_change_coverage(run | base, head)` in M1;
   `list_scenario_gaps(project, { class, feature, minScore, pr })`, `draft_scenario(gap)` and
   `get_feature_graph(node, depth)` in M2 and M3. The `write-the-missing-test` skill mirrors `run-the-right-tests`:
   read change coverage on the current branch, take the top gap in scope, draft, run it with a file filter, open it
   in the same PR. TestGen-LLM's 73 percent acceptance came from filtering candidates before proposing them [18]; the
   draft builder validates the same way diagnosis validates patches.
3. **The draft** (M2). A deterministic skeleton: title from the gap, `piwi:` annotations from the nearest test, the
   graph path from a reached page to the gap as the step list, catalog methods where they match, a `TODO` assertion
   naming what to check. With an AI provider, the assertion is filled in from the source at the ref, the nearest
   test's source and the patch. Delivered by clipboard, as a draft PR on the auto-heal machinery, or to the agent.
4. **The Gaps tab and the graph view** (M3), grouped by feature, with the inbox verbs. Accept opens the draft.
   Snooze wakes when the node changes. Dismiss asks for a reason: *not worth testing*, *covered elsewhere* (asks for
   the test, writes a manual `reaches` edge), *wrong*. A `gaps` inbox queue on Home lists accepted-but-unwritten gaps
   older than a week.
5. **The digest** (M3). Top five new gaps per project, weekly, off by default.

**Precision is a first-class number.** Heuristic traceability tops out around 78 percent precision at the function
level [25], and the incidental-catch detector is that problem in reverse. Every triage verdict is a labeled example:
accepted and covered-by count for the detector, dismissed-as-wrong counts against it. The admin stats page shows
precision per detector per project. A detector below 60 percent on a project with at least twenty verdicts mutes
itself there and says so, and its rows drop out of the PR comment first. The same numbers are the entry conditions
for everything after M3.

## API

```
GET            /api/projects/:id/gaps                       # ranked; filter by kind/class/detector/feature/status/pr
GET            /api/projects/:id/gaps/:gapId                 # evidence, factors, nearest test, draft
POST           /api/projects/:id/gaps/:gapId/triage          # accept | snooze | dismiss | covered-by
POST           /api/projects/:id/gaps/:gapId/draft           # skeleton, optionally AI-filled → clipboard | pr
GET            /api/projects/:id/gaps/change-coverage        # ?run= | ?base=&head=          (M1)
GET            /api/projects/:id/graph                       # ?node=kind:key&depth=          (M3)
POST           /api/projects/:id/gaps/recompute
GET/PUT        /api/projects/:id/surface/manifest            # declared routes/pages (openapi url | json)
GET            /api/projects/:id/probes/plan                 # what `piwi probe` runs tonight (reporter API key)
POST           /api/projects/:id/probes/results              # outcomes from a probe run
POST           /api/projects/:id/usage                       # production route counts (usage-scoped key; later)
```

## Milestones

- **M1 — one honest paragraph in a pull request.** `graph_nodes` and `graph_edges` with route and page nodes,
  `reaches` edges from network requests and page state, `changes` edges from the diff, first and last seen on both; the size rules that touch ingest (pattern keys for pages,
  own-origin routes, branch-tagged rows off the default branch, the ninety-day window on `changes`, the staleness
  sweep);
  four detectors (changed unreached, success only, single covering test, surface drift); exposure from churn, age,
  escape history and priority; the uncovered-changes section per ticket in PR feedback and the commit status;
  `get_change_coverage`; the desktop local-diff command; demo handlers; docs. Zero setup on any instance with history
  and an SCM token. Success measure: the share of uncovered-changes lines that lead to a test in the same PR.
- **M2 — the whole suite, and the first oracle.** Control, link, handler, dependency and file nodes; `contains`,
  `links`, `triggers`, `loads`, `handled-by`, `calls` edges; page inventory on passing runs with templated control names and the per-page cap; one instrumentation
  release carrying the handler field and the probe header support, flagged off; client probes with `piwi probe` and
  the nightly budget; `checks` edges; the M2 detectors; features from tags and catalog; `list_scenario_gaps`,
  `draft_scenario`, the deterministic draft and the skill; `maxUncoveredChanges` warn-only. Success measure: the
  not-noticed rate of client probes on pilot projects, which is also the entry condition for server probes.
- **M3 — declared surface, server probes, the tab, and the loop.** Manifest from instrumentation, OpenAPI URL and
  committed JSON; server probes enabled where the instrumentation header is present, the resilience findings;
  escaped defects over the Jira binding; import edges; the Gaps tab grouped by feature, the graph view,
  `get_feature_graph` and its endpoint; the gaps inbox queue; the digest; precision per detector with self-muting;
  the M3 detectors; healing pre-flight wired to auto-heal.

## Later, each with an entry condition

None of these is numbered, because none should be built on a promise. Each proceeds when its condition is met on
real projects, measured by the precision loop, and each has a smaller alternative that ships without it.

| Item | What it adds | Entry condition | Without it |
|---|---|---|---|
| **Server probes** (in M3, gated) | the resilience signal; dependency faults; the real error path | client probes report not-noticed on at least one in ten probed pairs across pilot projects | client probes alone |
| **Production route usage** | the usage factor from real traffic; the "most-used routes without a test" card | a team asks for it, or exposure ranking is dismissed as wrong more than one time in five | link in-degree and neighbor test counts as the usage proxy |
| **Guided exploration** | an agent walks the graph frontier from reached pages into unreached surface, recording paths that become drafts | reachable-unvisited and surface-drift gaps outnumber accepted drafts | the explorer targets are listed as gaps with their path |
| **Sampled V8 coverage** | `file` nodes for frontend components no locator touches, on one nightly job | covered-elsewhere dismissals name frontend component files more often than any other kind | page-object files from locator call sites, handler files from spans |
| **Blocking gate mode** | `maxUncoveredChanges` fails the build | detector precision above 80 percent on the project for three months | warn-only |
| **Probes on dialogs and storage** | fault classes beyond the network | route probes have produced accepted gaps on the project | route probes |

Exploration is the one later item with a mechanism worth stating: a budgeted walk from reached pages along `links`
and `contains` edges into nodes with no `reaches` edge, inventoried links first, declared routes last, recording every
path in the extension's existing recording format and matching it against the function catalog, so the output is a
draft test rather than a screenshot. Crawling to infer states is twenty years old [13]; the current tools do it with
an agent [26][27][28] and explore everything, including the checkout flow forty tests already cover. Piwi knows
where the suite is *not*, which is the only reason to build one more. It runs from a scheduled job or the desktop
app, never on a production origin, and is off unless configured.

## New data, and the process each one implies

1. **Page inventory on passing runs** (reporter, M2). `{ url, controls: [{ role, name }], links: [{ name, href }] }`
   attached as `piwi-page-inventory`, stored through `case_payloads`, taken at navigation settle and test end, capped
   at 500 entries per page, skipped when the worker already inventoried the URL in this run, opt-out
   `capturePageInventory: false`. What the control and link detectors and the `loads` edge need.
2. **One instrumentation release** (both packages, M2). The root span gains the handler's source file, and the
   request scope learns to read a signed `X-Piwi-Probe` header, flagged off by default. The reporter already forwards
   spans untouched.
3. **Probe mode and `piwi probe`** (reporter, M2). The reporter fetches the plan, applies client faults through
   `page.route` and, when enabled, signs server faults onto the chosen request; the run is stamped as a probe.
   Process: one scheduled CI job per project, or the desktop app.
4. **The application manifest** (M3). Instrumentation-served route table, an OpenAPI URL, or a committed JSON.
5. **Server probes enabled** (M3, gated). The flag, a shared secret, and a per-project allowlist of fault classes and
   routes.
6. **Production route usage** (later, opt-in). Instrumentation in production counts requests per route pattern per
   day and posts `{ day, routes: [{ method, pattern, count }] }` once a day under a usage-scoped key. No identifiers,
   no bodies, no headers, a hard cap on distinct patterns. Process: two environment variables on the production
   deployment, or a cron that uploads an access-log summary.
7. **Guided exploration** (later). A scheduled job or a desktop action, page budget, never a production origin.
8. **Sampled real coverage** (later, opt-in). `PIWI_COVERAGE=1` on one scheduled job; V8 coverage resolved through
   source maps into `file` nodes with origin `coverage`.

## What this deliberately is not

- **Not coverage, and it never claims to be.** Every screen, comment and tool result says *observed reach*. Sampled
  V8 coverage is the one place real coverage enters, labeled by origin.
- **Not mutation of source code, and never in production.** Client probes rewrite responses in the browser. Server
  probes apply a runtime fault to one signed request, outside production, with fault classes and routes allow-listed
  per project, and never touch the code.
- **Not a test generator.** The draft is a skeleton with the reachable path filled in; the assertion is the human's or
  the agent's, and an AI-filled draft is validated like a diagnosis patch. Nothing is committed except through the
  reviewed PR ramp.
- **Not a gate by default.** Warn-only until precision is measured on the team's own data.
- **Not a percentage.** A percentage over an observed surface looks complete exactly when the surface is sparse.
  Counts per class and per feature, and the trend of gaps closed.
- **Not a graph database, not a crawler of everything, not a service.** One edge table with recursive queries;
  exploration budgeted against the suite's reach; usage counts are the application posting to the team's own
  instance under their own key.

## Interactions worth designing, not discovering

- **Impact and gaps share the graph.** The impact resolver's reach map becomes a read of `reaches` edges.
- **Healing gets a pre-flight.** *Locator break ahead* is a diff-time input to locator healing; the ranked
  alternatives per call site can be recomputed against the new template before the run fails.
- **Baselines on partial runs.** *Changed, unreached* reads "no test *in this run*" and adds the project-wide count.
- **The 1.0 freeze.** The manifest JSON, the usage payload, the probe plan, the probe header and the
  `piwi-page-inventory` attachment are external contracts; land or defer them in
  [`1.0-stabilization.md`](1.0-stabilization.md).
- **Demo mode.** Detectors are pure and live in `shared/handlers/`; the seed gains a declared manifest, a PR-stamped
  run and a few probe outcomes so the Gaps tab and the PR section render.

## Open questions

1. **Probe scope configurability.** Faults apply only to requests issued after the first navigation, and to the Nth
   matching request. Is that rule enough, or does a project need to name its seeding routes explicitly?
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
10. **Probe header trust.** Is the reporter API key acceptable as the signing key, or does a staging environment need
    its own secret?
11. **State-changing routes under dependency faults.** Ephemeral database per probe run, a per-project allowlist of
    routes, or both?
12. **Trigger-edge confidence.** Two actions in quick succession share a request window. Is the share of executions
    where the co-occurrence held enough, or does the reporter need to tag requests with the current step id?

## Prior art

| Product | What it does | Relation |
|---|---|---|
| [Teamscale Test Gap Analysis](https://teamscale.com/features/test-gap-analysis) | changed-and-untested methods from repository changes and profiler coverage; feature coverage maps gaps to tickets | the mature form of change-time gaps; needs code coverage; method-level |
| [SeaLights](https://docs.sealights.io/knowledgebase/coverage-and-quality-insights/test-gaps-analysis-report) | test gap analytics, user-story coverage, quality gates | same idea, closed SaaS, coverage-based |
| [Codecov patch coverage](https://docs.codecov.com/docs/commit-status) | a status check on the lines a PR touched | the mainstream form of "uncovered changes" |
| [Datadog Test Impact Analysis](https://docs.datadoghq.com/tests/test_impact_analysis/how_it_works/), [Develocity PTS](https://gradle.com/develocity/product/predictive-test-selection/), Launchable | per-test coverage or learned history to select tests | the same graph read forward; none reports the inverse |
| [mabl coverage](https://help.mabl.com/hc/en-us/articles/19083839661460-The-coverage-overview-dashboard) | link crawler discovers pages; journeys per page; daily users via a Segment integration retired in 2026 | closest to the surface view; knows only its own tests |
| [Octomind](https://octomind.dev/docs/advanced/octomind-bot), Checksum, Meticulous | crawl the app or record sessions, propose journeys, emit Playwright or replay | the draft ramp as a whole product; blind to the existing suite and its failures |
| [Keploy](https://keploy.io/record-replay-testing), [Speedscale](https://docs.speedscale.com/concepts/replay/) | record production API traffic, replay as regression tests | the usage pillar taken to generation, APIs only |
| [Restats](https://github.com/SeUniVr/restats) | REST coverage metrics from an OpenAPI spec and observed traffic | the declared-surface detectors, as an academic tool |
| [Netflix FIT and ChAP](http://techblog.netflix.com/2014/10/fit-failure-injection-testing.html), [LinkedIn LinkedOut](https://engineering.linkedin.com/blog/2018/05/linkedout--a-request-level-failure-injection-framework) | request-scoped fault injection: a header or cookie carries the fault rule, library hooks or a request filter apply it | the exact mechanism of the server probe; they ask whether the system survives, not whether a test would notice |
| [Gremlin ALFI](https://www.gremlin.com/blog/the-next-step-application-level-fault-injection/), [Istio and Envoy fault filters](https://istio.io/latest/docs/tasks/traffic-management/fault-injection/), [Toxiproxy](https://qaskills.sh/blog/toxiproxy-fault-injection-testing-guide-2026), [WireMock](https://wiremock.org/2.x/docs/simulating-faults/) | fault injection at the library, mesh, TCP and stub level | alternative application points; none joined to a test suite or a coverage map |
| [chaosbringer](https://github.com/mizchi/chaosbringer), [playwright-network-chaos-mcp](https://glama.ai/mcp/servers/vola-trebla/playwright-network-chaos-mcp) | Playwright-level network and runtime fault injection with invariants, or under agent control | the client probe as a standalone tool; unaware of the suite |

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
    <https://dl.acm.org/doi/10.1145/503209.503244> — event-based adequacy; the control nodes.
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
    <https://arxiv.org/abs/1810.05286> — the graph read forward.
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
