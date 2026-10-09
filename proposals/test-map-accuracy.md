# Test Map: fuller inputs, measured accuracy, and the extension

A plan for the second generation of the Test Map ([`adr/scenario-gaps.md`](../adr/scenario-gaps.md)). The first
shipped its three milestones quickly; this one starts from what it gets wrong on a realistic project, fills the
inputs it never writes, adds the signals a team already owns elsewhere, gives the map indicators of its own
accuracy, and joins it with the browser extension, which already sees the one thing the map cannot: the whole
rendered surface of a page.

**Status.** Proposed 2026-10-09. Nothing in it is built. The evidence comes from the web-dashboard demo project
(`shared/demo/demo-test-map.mjs`), whose gaps are exactly what the live detectors compute from its graph
(`tests/unit/demo-test-map.test.ts` recomputes them on the seed). New wire fields, attachments and endpoints freeze
at 1.0 and get an entry in [`1.0-stabilization.md`](1.0-stabilization.md).

**Summary.** The demo models an admin console: 4 features, 16 observed routes, 10 declared ones, 17 pages, 34
controls, 16 links, 16 handlers, 7 dependencies, and 10 tests; 120 nodes and 244 edges. The detectors find 61 gaps. About a third are
wrong or missing in ways the code explains, not the model: every route a click sends reads as "reached only by
request fixtures", a page a test walks through reads as "never visited", the nodes only a flaky test reaches raise
nothing, features never group the surface their tests miss, and every node gap ranks on the floor value of three of
its four exposure factors. Part 1 fixes those with data Piwi already stores. Part 2 adds inputs, ordered by cost.
Part 3 defines two families of indicators: how well the suite covers the application, and how far the Test Map's
own estimate can be trusted, with the demo turned into a labeled benchmark. Part 4 makes the extension's Tested
elements overlay a client of the Test Map and a source for it. Part 5 lists larger bets, each behind an entry
condition, the way the first record did.

## What the demo shows

| # | Finding | Where in the code | On the demo |
|---|---|---|---|
| 1 | A test reaches only the page it **ends** on; pages it walks through count as unvisited | `pageUrlOf` in `server/utils/graph-ingest.ts` reads `page_state.url` | `/users/invite is linked but never visited`, although *invites a user by email* opens it |
| 2 | No `test → control` reach is ever written, and *control nobody exercises* stays silent until one exists | `detectControlNobodyExercises` gate in `shared/handlers/scenario-gaps.ts` | 0 control gaps for 34 inventoried controls, *Delete organization* and *Transfer ownership* among them |
| 3 | `triggers` edges are never written (`buildTriggerEdges` in `shared/graph.ts` has no caller), and `loads` covers navigation settle only | `detectApiOnlyRoute` | all 8 click-sent routes flagged *API-only*; the demo team dismissed 5 as wrong |
| 4 | *Single covering test* needs exactly one trusted test; a node only untrusted tests reach raises nothing | `detectSingleCoveringTest` (`trustedTests.length !== 1`) | `/settings/appearance` and its two routes, reached only by the flaky dark-mode test: no gap at all |
| 5 | A feature groups only the nodes its tests reach | `syncFeatureNodes` | 25 of 61 gaps sit under *Ungrouped*; the feature map cannot show what a feature misses |
| 6 | Hub nodes join every feature | `getFeatureMap` link rule | `GET /api/session`, reached by 9 of 10 tests, links all four features and puts "9 tests" on each |
| 7 | The project-wide recompute never receives exposure; churn, age and escape history stay at 0.1 for every node gap | callers of `computeScenarioGaps` | 61 scores between 0.035 and 0.141, ordered by detector confidence |
| 8 | Route keys keep the redacted query, so one endpoint can be several route nodes | `normalizeRoute` in `@piwitests/core/page-key` | the model avoids queries; a real `?page=` and `?role=` split `GET /api/users` in two |
| 9 | Surface drift flags derived nodes and the first build; link keys are prefixed twice | `detectSurfaceDrift` over every node kind | a recompute of the checkout demo raises *New feature Checkout — confirm it is tested*; *New link link:Single sign-on* |
| 10 | Server probe findings are only ever *degraded* | `classifyProbeHandled` (reporter) returns graceful or degraded; `classifyHandled` (server) has no caller | one degraded finding; *unhandled* cannot occur |
| 11 | Muting withholds the *changed, unreached* pull-request section and nothing else | `change-coverage.ts` | a muted detector keeps its rows in the tab, the digest and the Home queue |
| 12 | Eleven detectors are pure functions with no caller | phantom coverage, passed with errors, catalog method, incidental catch, assertion-light, intent, new error path, new control, matrix, tracker escapes, locator break ahead | their inputs mostly exist (steps, console, backend logs, function catalog, diffs) |

Findings 1 to 4 make the map say wrong things; 5 to 7 make it hard to read; 8 to 12 are smaller. None needs a new
capture.

## Decisions

| D | Decision | Why |
|---|---|---|
| D1 | Fix the substrate before adding sources | most wrong gaps come from inputs Piwi has and does not join |
| D2 | Every new input is an origin on the existing nodes and edges | one substrate; a detector names the origin it read |
| D3 | A percentage only over a surface with a known denominator | the first record's rule ("not a percentage") stands for observed surface; a declared or fully rendered surface has a denominator |
| D4 | The map measures its own accuracy, on every project and on a labeled benchmark | precision from triage measures only what people bother to triage |
| D5 | The extension reads the map and writes to it, with consent, role and name only | it sees the rendered surface, states included, that no capture records |
| D6 | Production signals come from tools a team already runs | the mabl lesson in the first record: a signal that needs its own hookup stays off |

## Part 1: fix the substrate

1. **Page reach from navigations.** Write a `reaches` edge for every own-origin main-frame navigation of a test,
   with `evidence.arrival` for the page the test ended on. The capture fixtures already listen to
   `framenavigated` for the page inventory, so the reporter adds the list of page URLs to the wire case. Fixes
   finding 1 and gives *single covering test* the right count.
2. **Control reach from the locator index.** The locator index (`locator_usages`, what the extension's overlay
   evaluates) knows, per test, the chains it ran, their actions and the pages they ran on. Parse each chain with
   `@piwitests/core/locator-chain`: a `getByRole(role, { name })` maps to a `role:name` control key directly; a test
   id, label or CSS chain maps through the element its locator snapshot resolved to (`element_tag`,
   `element_attrs`). Write `test → control` reaches with `evidence.action` = `operated` or `checked`. Wakes *control
   nobody exercises* (finding 2) and gives every control the overlay's own distinction.
3. **Trigger edges.** Call `buildTriggerEdges` at ingest: action steps carry start times and requests carry start
   times, and `requestInStepWindow` already pads the window. Keep the confidence as the share of executions where
   the pairing held. *API-only route* then reads triggers (finding 3).
4. **Untrusted-only nodes.** A node with no trusted test and at least one untrusted one becomes a fragile gap,
   *Only untrusted tests reach it*, naming the flaky, quarantined or skipped test (finding 4). This is the
   *phantom coverage* detector's case, wired.
5. **Feature grouping beyond reach, and hubs.** A feature also groups, with origin `inferred` and a confidence below
   one: the pages its pages link to under the same path prefix, the controls its pages contain, and declared routes
   sharing an OpenAPI tag or a path prefix with its routes. A node reached by more than half the tests, or grouped
   by more than half the features, is a hub: drawn, but neither linking features nor counted in a feature's tests
   (findings 5 and 6).
6. **Exposure for node gaps.** The nightly sweep computes file exposure for the handler files (`handled-by`) and,
   by convention, page files, and passes it to `computeScenarioGaps`. Age is the file's first commit, read once
   from the provider and cached, not the oldest of the last twelve commits scanned (finding 7).
7. **Route keys without the query.** The node key drops the query; the parameter names move to `attrs.query`.
   A migration merges the split nodes and their edges (finding 8).
8. **Drift on surface only, and not at the first build.** Exclude `feature` nodes, and raise drift only for a node
   first seen after the project's first graph run. Fix the double link prefix (finding 9).
9. **Unhandled findings.** The fixtures already capture page errors and the ARIA snapshot: report an uncaught
   exception, or a backend error with a blank page, so the server's `classifyHandled` can return *unhandled*
   (finding 10).
10. **Muting everywhere.** A muted detector's rows leave the digest, the Home queue and the default tab filter,
    which shows them under *Muted (n)* (finding 11).
11. **Wire the cheap pure detectors.** *Passed with errors* (console errors, backend `Error` logs and background 5xx
    on passing executions, all stored), *assertion-light* (from `step-analysis.ts`) and *catalog method no test
    calls* (from `test_functions`) need no new data (finding 12).

On the demo, the expected change is concrete: *API-only* drops from 8 rows to 0, *reachable, unvisited* loses
`/users/invite`, three fragile gaps appear for the dark-mode test's nodes, *control nobody exercises* raises the
controls none of the ten tests uses, and most of the 25 ungrouped gaps find a feature.

## Part 2: new inputs

Ordered by cost. Each becomes an origin on nodes or edges (D2) and names the detectors it feeds.

**Already stored, not joined**

| Input | Adds | Feeds |
|---|---|---|
| Locator index and locator snapshots | control reach, operated vs checked | control nobody exercises, the check prior |
| `expect` steps and their matchers | an assertion map per page and control: visible-only, text, value, count | assertion-light, the check prior before any probe |
| Console errors, backend logs, background 5xx on passing runs | the app misbehaved and the test still passed | passed with errors |
| Function catalog (`test_functions`) | page-object methods per URL pattern | catalog method no test calls; cheaper drafts |
| CODEOWNERS | `owns` edges | gaps routed to a team; coverage per owner |
| Failure clusters and their fixing commits | escape history per file, not per scanned commit | exposure |
| Bug reports from the extension | escapes per page, with steps | escaped defect (already wired), exposure |

**One capture or setting change**

| Input | Adds | Feeds |
|---|---|---|
| Navigation list per test (Part 1) | page reach along the journey | single covering, reachable unvisited |
| ARIA snapshots on more states (after a dialog or menu opens) | controls the settle-time inventory misses | control nobody exercises |
| Front-end router manifest (Nuxt, Next, SvelteKit, React Router route lists) | declared **pages**, not only API routes | declared, never hit, for pages |
| OpenAPI `tags`, `operationId`, `x-owner` | feature and owner for declared routes | feature grouping, ownership |
| GraphQL operation names (from the request body's `operationName`, the name only) | one route node per operation instead of one `POST /graphql` hub | every route detector, for GraphQL apps |
| Feature-flag states per execution (OpenFeature hook, or the flag cookie or storage key in `page_state`) | which flag states the suite ran | the matrix detector |
| Response shapes ([`api-contract-drift.md`](api-contract-drift.md)) | the fields a route returns | field-level checks: a `drop-field` probe names a field nobody asserts |

**An integration a team already runs** (D6)

| Input | Adds | Feeds |
|---|---|---|
| Production route counts from the instrumentation packages, or an access-log summary upload | usage per route | exposure; *most used, least tested* |
| Error monitoring (Sentry, Datadog, OpenTelemetry error spans) grouped by route or transaction | real production failures per node | escape history; *fails in production, no test reaches it* |
| Tracker stories and acceptance criteria (the Jira binding) | intents per ticket | intent without a test; ticket coverage |
| Product analytics funnels (PostHog, Amplitude) | the top user journeys as page sequences | journey coverage: the share of the top journeys some test follows end to end |

**Research**

- Server-side coverage on the nightly job (`NODE_V8_COVERAGE` for Node, coverlet for .NET) as `file` nodes with
  origin `coverage`, the server half of code reach.
- Unit-level mutation reports (Stryker) imported per file, so a handler pseudo-tested end to end but protected by
  unit tests is not reported twice.

## Part 3: indicators

Two families. The first describes the suite; the second describes the map. Every indicator shows its denominator
and its origin (D3).

### How well the suite covers the application

| Indicator | Definition | Denominator known when |
|---|---|---|
| Declared surface reached | reached / declared routes and pages, per feature | a manifest, OpenAPI document or router manifest exists |
| Error paths exercised | documented non-2xx codes observed under test / documented codes | OpenAPI responses exist |
| Checked share | reached routes with a noticed probe / reached routes | always (probes are counted) |
| Not-noticed rate | not-noticed probes / applied probes | always; the first record's entry condition for server probes |
| Trusted redundancy | nodes by number of trusted tests: 0, 1, 2, 3 or more | always |
| Rendered elements operated | per page, operated / checked only / untested interactive elements | the page is rendered (the overlay's own numbers) |
| Assertion depth | per page, share of assertions that check a value, not visibility | always |
| Change coverage | changed files reached / changed files, per pull request, and the trend | an SCM diff exists |
| Uncovered changes acted on | uncovered files that gained a test in the same pull request / uncovered files | the first record's M1 success measure, not measured today |
| Exposure-weighted protection | Σ exposure × protection / Σ exposure over declared nodes | a declared surface exists |

### How far the map can be trusted

| Indicator | Definition | What a bad value means |
|---|---|---|
| Detector precision | for / (for + against) verdicts, per detector (shipped) | the detector is noisy on this project |
| Leave-one-test-out recall | remove one test's reach edges in memory, recompute, check that every node only it reached is raised | a detector misses what it exists to find |
| Benchmark precision and recall | the web-dashboard model labeled with ground truth: each node marked *visited mid-journey*, *sent by a click*, *only an untrusted test*; precision and recall per detector | a code change made the detectors worse |
| Reach agreement | for tests with code reach on: handler files a reached route maps to that the test also executed, and the reverse | the convention mapping is wrong for this framework |
| Convention hit rate | conventional handler files that exist at the run's ref | the file-routing convention does not apply |
| Map completeness | reached pages with an inventory, routes with a handler, controls with a reach decision, nodes with an owner | which setup step would wake which detector |
| Key cardinality | nodes added per run, per kind | an id leaking into keys, as the query does today |
| Probe inconclusive rate | inconclusive / probes, per fault and route | the plan targets requests that never fire |
| Escape lift | escapes (bug reports, tracker bugs, production errors) on nodes flagged as gaps / escapes on unflagged nodes, per node count | above one, gaps predict escapes; near one, the ranking is not worth its screen |
| Time to a decision | runs until a new node gets a reach decision | new surface stays unexamined |

Escape lift is the validity measure the first record asked for and never defined: the Google study it cites found
predictions alone change nothing, so the map has to show that what it flags is where defects land.

**A map health panel** on the Gaps tab lists the completeness numbers with the setup step behind each ("turn on
the page inventory: wakes three detectors"), the way the setup checklist lists capabilities.

**The benchmark** extends `tests/unit/demo-test-map.test.ts`: the model labels each node with its ground truth, and
the test reports precision and recall per detector against it. Today it would read a precision of 0 of 8 for *API-only route*;
after Part 1, the detector raises none of them. A detector change that lowers a number fails the test until the fixture
(`PIWI_UPDATE_DEMO_TEST_MAP=1`) and the labels say why.

## Part 4: the extension

The Tested elements overlay (`apps/extension/src/content/coverage-overlay.ts`) evaluates the locator index on the
live page: operated, checked, untested and brittle, with *Copy locator* as its one action. It does not read the Test
Map, and its page keys were made equal to the map's precisely so the two could be joined
([`adr/locator-stability-and-pages.md`](../adr/locator-stability-and-pages.md)).

1. **Gaps on the page.** A read endpoint returns the Test Map slice of one page key: its gaps, its controls' reach,
   the routes it loads and their probe outcomes, the pages it links to and whether a test visits them. The overlay
   draws gap classes over its own boxes: a blind-spot control, a link to an unvisited page, a control whose request
   a probe broke unnoticed (through the `triggers` edges of Part 1), an element only an untrusted test reaches.
2. **Draft the missing test from the element.** An untested element gets *Record a test*: the extension's recorder
   starts from the gap's draft (the path from the nearest reached page, the catalog methods, the `piwi:` annotations),
   the assertion suggester proposes the check, and the result goes to the editor
   ([`record-from-the-ide.md`](record-from-the-ide.md)) or the clipboard. When the test lands, the gap closes and
   the verdict counts for its detector.
3. **The page as a source.** With consent per project, the overlay posts what the page shows when a person opens it:
   controls and links by role and accessible name, templated and capped as the page inventory is, under origin
   `explored`. Dialogs, menus, other roles and other data states then become surface the suite has never seen, marked
   *seen by a person, never by a test*. This is the first record's guided exploration with a person in the loop and
   no automation against the application.
4. **A probe by hand.** The DevTools panel already delays or fails a request on the tab (*Slow down or fail a
   request*). From a route in the slice, *Break it here* applies the probe's fault to that request and records what the
   page did: a screenshot and the console, filed as a resilience finding with the person's verdict.
5. **States and matrix.** The overlay counts elements in the DOM it sees; per page it can also list the states the
   tests reached (the locator index's `arrival` flags and pages) against the states the person opened, and filter
   the index by viewport, so *no test reaches the menu on mobile* shows where it happens.
6. **One rule for numbers.** The overlay's "41% of 34 interactive elements" is a percentage over a surface it fully
   sees. The map adopts the same rule (D3) and the overlay's numbers become the *rendered elements operated*
   indicator.

## Part 5: larger bets, each with an entry condition

| Bet | What it adds | Entry condition |
|---|---|---|
| Probe-validated generation | an agent drafts the test for a gap and keeps it only if it notices the probe the gap was about, the mutation-guided rule of the first record's reference 19 | Part 1 shipped and benchmark precision above 80 percent |
| Cross-project map | a dependency node in one project is a route node in another on the same instance; join them into a service-level map with contract coverage | two projects on one instance share a host in their spans |
| Release readiness per feature | exposure-weighted protection and its trend per feature, in the quality report | exposure is computed for node gaps (Part 1, item 6) |
| Redundancy, read backwards | nodes many trusted tests reach and every probe noticed: candidates for a smaller selection | the test-selection reach map reads the same edges |
| Named features for ungrouped surface | URL clustering with a proposed name, confirmed by a person | Part 1, item 5 leaves more than ten ungrouped nodes on a project |

## Delivery

1. Substrate, without new captures: items 3, 4, 8, 9, 10 and 11 of Part 1, with the demo fixture regenerated.
2. Page reach from navigations and control reach from the locator index (items 1 and 2), the reporter's wire change
   with them.
3. Feature grouping and hubs, exposure for node gaps, query-free route keys and their migration (items 5 to 7).
4. The indicators of Part 3, the map health panel, and the labeled benchmark.
5. The extension's read slice and gap layer, then *Record a test* (Part 4, items 1 and 2).
6. The page as a source and the probe by hand (Part 4, items 3 and 4), behind a per-project opt-in.
7. Inputs of Part 2, cheapest first: OpenAPI tags, router manifests, GraphQL operations, then the integrations.

## Risks

- **More edges, more rows.** Page reach per navigation and control reach multiply `reaches` edges by the journey
  length. The size rules of the first record (pattern keys, templated names, caps) apply unchanged; the key
  cardinality indicator watches them.
- **Locator-to-control mapping is heuristic.** A CSS chain resolves through a snapshot of one execution; the edge
  carries that origin and a confidence, and *control nobody exercises* reads only confident edges.
- **Explored surface can be personal.** Role and accessible name only, templated, never values; the same rule the
  page inventory follows, and off unless a project turns it on.
- **Indicators invite targets.** A percentage over a declared surface becomes a goal. Each indicator shows its
  denominator, and none feeds a gate.

## Open questions

1. Should *API-only route* survive Part 1 at all, or fold into a property of the route node?
2. Is the hub threshold a share of tests, a share of features, or both?
3. Does explored surface count toward *declared, never hit*, or only toward its own detector?
4. Where does escape lift live: per project on the Gaps tab, or per instance on the admin page next to precision?
5. Should the benchmark labels live in the model module, or in a separate fixture a contributor can extend?

## Not in this plan

- Line or branch coverage of any kind as a headline number.
- Automatic test generation without a person or an agent reviewing the draft.
- Production probes of any level.
