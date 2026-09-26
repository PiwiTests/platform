# Documentation revamp

A plan to reorganize the documentation site (`apps/docs/`). State audited: `main` at v0.39.0 (`cc1b701`),
2026-09-26. Every page was measured section by section; word counts exclude code blocks. First written against
0.37.0 on 2026-09-24; updated after 0.38.0 and 0.39.0, which added the analytics program and the locator index, and revised the same
day to place each recipe in the group it serves.

This proposal replaces the open items of [`docs-restructure.md`](docs-restructure.md) (2026-09-05). That plan's
mechanisms shipped and stay: one sidebar per section, the generated Feature map and What's new pages,
single-source snippets, the `<Needs>` prerequisite chips, the word budget test, and the redirect map in
`public/404.html`.

## Summary

The site is organized by **document type** (Guide, Features, Recipes, Operate, Reference), and each page sits
wherever its feature happened to land. A Piwi feature has a setup part, a dashboard part and a configuration part,
so one feature is spread over three sections, and nothing tells a writer where a new one goes. The last three
releases show it plainly. The Test Map landed in a sidebar group that disagrees with the feature catalog. Four
analytics pages were appended to a flat list that now holds 22 entries. And the site gained about 9,000 hand-written
words in two days.

Something did improve: every new feature in 0.38.0 and 0.39.0 got its own page and stayed within the word budget.
The rules that exist work where they apply. The revamp extends them to the whole site and keeps the URLs:

1. **One taxonomy.** The feature catalog (`apps/application/shared/piwi-features.ts`) drives the Features sidebar,
   the landing page and the All features page (today's Feature map). A feature added to the catalog appears
   everywhere at once.
2. **One type per page**, each with a template and a word budget: setup, feature, recipe, self-hosting, reference.
3. **Every prerequisite has a setup page**, and every `<Needs>` chip links to it. Source control and the AI
   provider have none today, although at least five features need one or the other.
4. **Reference is generated** from the code registries and the changelog wherever they exist: configuration,
   reporter options, MCP tools, metrics, analytics widgets, All features, What's new.
5. **The docs describe what ships.** The dashboard explains its own screens; the site stops describing widgets and
   colors, and stops documenting planned work.

About **10,600 words are deleted** outright and about 3,500 more move to generated pages. The hand-written total goes
from about 82,000 to about 66,000 words, while the site grows from 65 to about 82 pages, each named for one task.
Five pull requests, eight to nine days, and an optional sixth; the first changes a single URL.

## What changed since the first version

The plan was written against 0.37.0. Two releases landed on 2026-09-26.

| Release | What it added | Docs pages |
|---|---|---|
| 0.37.0 | **Test Map and scenario gaps**: one graph per project of what the application exposes and what the tests reach, detectors, a Gaps tab, a pull-request section, probes | `scenario-gaps.md`, 1,693 words, allowlisted over the budget on its first day |
| 0.38.0 | **Locator index** (which tests use each locator chain), runs kept forever, role-based access to settings pages, an evidence timeline filter | `locator-usage.md`; storage, authentication |
| 0.39.0 | **Analytics program**: filters and periods, 32 widgets, saved dashboards, quality reports with schedules and snapshots, report and dashboard share links, a status badge, an AI narrative, Microsoft Teams, OpenMetrics and rollup export, a `piwi report` command, five MCP tools. **Tested elements** in the extension. The permission grid. | `analytics.md` rewritten; `analytics-widgets.md`, `dashboards.md`, `quality-reports.md`, `tested-elements.md`, `operate/metrics.md`; share links, notifications, CLI, MCP, concepts, upgrading |

What `main` already did well:

- **Every new feature got its own page**, and every new page stayed within the 1,200-word budget. The widget list was
  carved out of Analytics instead of growing it, and the UI overview's allowance was lowered.
- **`concepts.md` got the analytics vocabulary in the same change**, and it separates the **quality report** from
  the **run report** (the Playwright HTML report a run carries). That is how a name collision should be handled.
- The new pages carry screenshots from the scene harness.

What the two releases add to the plan:

- **Analytics is now an area of its own**: four feature pages, one operator page and sections of five others. The
  catalog files all of it under "Keep the history", which now holds eleven entries. The plan adds a **Trends and
  reports** group.
- **Two pages copy a code registry by hand.** `analytics-widgets.md` restates the 32 entries of the widget registry
  (`shared/analytics/registry.ts`). The metric catalog (`shared/analytics/metrics.ts`) holds 24 metrics, each with a
  definition that, in the analytics design's own words, "every surface reads"; the docs are the one surface that
  does not. Both become generated reference pages.
- **A third name collision: dashboard.** The docs say "the dashboard" 193 times for the web app, and a **dashboard**
  is now also a saved arrangement of analytics widgets.
- **The locator index feeds two features in two groups.** Who uses a locator sits under "Hand back a fix", Tested
  elements under "Use it from elsewhere", and "reach" now means both a route or page (Test Map) and an element
  (Tested elements). The index and the word get one definition in `concepts.md`.
- **The MCP tool count was edited by hand in four files a second time**, from 50 to 55.
- **Authentication grew to 2,489 words** with the permission grid; Project access becomes its own page.
- **The app's sidebar links to the docs** since 0.38.0, straight to the landing page, so the landing page's entry
  points matter more.

Still open from the first version:

| Finding | 0.37.0 | 0.39.0 |
|---|---|---|
| Test Map terms in `concepts.md` | none | none; only "probe run" was added |
| Instrumentation page covers the route manifest, server spans and server probes | no | no |
| UI overview lists the Gaps tab | no, it says "five tabs" | no, still "five tabs" for six |
| Feature pages missing from the catalog | Issue tracking | Issue tracking and Analytics widgets |
| Unreleased behavior on the scenario gaps page | present | present |
| Dead README link to `features/flaky-tests#performance` | present | present |
| Inbound links to "Your first failure, explained" | 0 | 0 |
| Pages with a `description` front matter | 0 | 0 |

## Where the docs stand

The docs drift test (`apps/application/tests/unit/docs-drift.test.ts`) is what makes a revamp safe: it resolves every
docs link the app builds (`doc:` literals, `<DocLink>` targets, catalog `doc` fields) against a real page and
heading, so a moved section fails the build instead of breaking a help link.

| Measure | Value |
|---|---|
| Pages | 65 |
| Words, total | 97,650 |
| Words, hand-written (generated pages and the blog excluded) | about 82,000 across 60 pages |
| Hand-written words added | about 2,300 from 2026-09-22 to 09-24, about 9,000 from 09-24 to 09-26 |
| Pages of 2,000 words or more | 10, holding 38% of the hand-written words |
| Feature pages allowlisted over the 1,200-word budget | 9 |
| Pages outside `/features/` over 1,500 words, with no budget | 8: reporter (5,727), authentication (2,489), CI (2,372), test selections (1,918), deployment (1,890), getting started (1,834), storage (1,623), importing runs (1,523) |
| Features sidebar | 29 entries in 2 groups; "Reading the results" alone holds 22 |
| Groupings of the same features | 5: top navigation, sidebar groups, the Feature map page, the app's Setup page, the docs agent guide |
| Pages that mention an SCM token | 11, and none explains how to connect one |
| Pages that explain the baseline rule | 3, with 961 words between them |
| Pages that describe the execution page | 2, with about 3,000 words between them |
| Hand-written endpoint paths | 36 lines across 23 pages, though the docs guide says to link the API reference |
| "the dashboard" meaning the web app | 193 occurrences |

## Principles

### 1. One taxonomy, rendered from the catalog

The catalog is the only place features are grouped. `config.mts` imports it (plain TypeScript with no dependencies,
already imported by the docs scripts), keeps the entries whose page is under `/features/`, and renders one sidebar
group per catalog group. The All features page and the landing cards come from the same list. In the feature groups,
**a catalog entry is a page**, not an anchor: one feature, one page, one set of `<Needs>` chips. The 0.38.0 and 0.39.0
pages already follow this; the older pages catch up. Recipes are not features, so they are not catalog entries: a
five-line map in `config.mts` puts each one at the top of the group it serves.

### 2. One type per page

| Type | Answers | Template | Budget |
|---|---|---|---|
| Setup | "How do I switch this on?" | what it enables, steps, how to verify, troubleshooting | 1,500 |
| Feature | "What does it do, how do I use it, what are its limits?" | the `auto-heal.md` template: what it does, where it is, use it, limits, related | 1,500 |
| Recipe | "I have this problem right now." | unchanged | 1,000 |
| Self-hosting | "How do I run the server?" | steps, then the options that matter | 1,500 |
| Reference | "What are all the values?" | tables; `concepts.md` counts as reference | none, generated where a registry exists |

One budget of 1,500 words replaces today's 1,200 words for feature pages only. It covers every section and has no
allowlist. A page that lists the entries of a code registry is reference, and it is generated.

### 3. Every prerequisite has a setup page

The `<Needs>` chips become links to the page that switches the prerequisite on:

| Chip | Setup page | Today |
|---|---|---|
| Reporter | Reporter | exists |
| Capture fixtures | Capture fixtures | exists |
| SCM token | **Source control** (new) | none: 11 pages mention the token; its setup sits inside AI diagnosis and CI |
| AI key | **AI provider** (new) | none: the setup is 667 words inside AI diagnosis; the AI narrative of quality reports needs it too |
| Backend integration | **Backend instrumentation** (renamed from Backend logs) | the page covers one of the instrumentation's four uses |
| Desktop app | Desktop app | exists |
| Browser extension | Browser extension | exists |
| Admin | Authentication, Roles | exists |

### 4. The dashboard explains its screens

Inline help, the Setup page, the MCP page and the in-app API reference already explain the screen in front of the
reader, and they change with the UI. The site explains concepts, tasks and setup, and says where a feature lives in
one line. It does not describe widgets, layouts or colors.

### 5. The docs describe what a default install does today

Planned work goes to `ROADMAP.md`. An experimental feature gets one short section marked **Experimental**, what it
needs, and a link to its proposal.

## The new structure

Top navigation, six items instead of nine: **Guide · Features · Self-hosting · Reference · Blog · Demo**. Home is the
logo, API docs moves into Reference, Recipes into Features.

```
Guide                              /guide/
  Get started     Getting started (three steps) · Your first failure · Core concepts
  Set up          Reporter · Capture fixtures · CI & sharding · Source control (new) · AI provider (new) ·
                  Backend instrumentation (renamed) · Import past runs
  About Piwi      What Piwi does · Why Piwi? · Privacy & data flow

Features                           /features/ and /recipes/, rendered from the catalog; (recipe) marks a recipe
  Keep the history           UI overview · Branches · What changed in a run · Offline export · Share links
  Explain the failures       Regression or flake? (recipe) · Triage a run gone red (recipe) ·
                             Cut costly flakiness (recipe) · Cut the time it costs (recipe) ·
                             Failure evidence · Failure clusters & the inbox · Flaky tests & quarantine ·
                             Slow tests & wasted time · AI diagnosis
  Hand back a fix            Fix a broken locator (recipe) · Locator healing · Who uses a locator ·
                             Fix plans, reproduce & bisect · Auto-heal PRs · Issue tracking (Jira) ·
                             Pull-request feedback & re-run (split from CI) · Test selections (moved) · AI steps (moved)
  Find what your tests miss  Scenario gaps & the Test Map · Uncovered changes in pull requests (split) · Probes (split)
  Trends and reports         Analytics · Dashboards · Quality reports · Timeline markers · Notifications & alerts
  Use it from elsewhere      MCP server · Agent skills (split) · Desktop app · Browser extension · Tested elements ·
                             Test functions catalog · Open in IDE

Self-hosting                       /operate/, label renamed, URLs kept
  Install         Deployment · One-click deploy (split) · Production checklist
  Configure       Authentication · Project access (split) · API keys (split) · Choose what you use (moved) ·
                  Localization · Integrations
  Data            Database · Storage & retention · Backup & restore · Metrics and rollup export
  Upgrade         Upgrading

Reference                          /reference/
  All features (generated, renamed from Feature map) · What's new (generated) ·
  Configuration (generated) and its generator · Reporter options (generated, new) · Test metadata (new) ·
  Piwi CLI · MCP tools (generated, new) · Metrics (generated, new) · Analytics widgets (generated, moved) ·
  Notification events & webhooks (new) · Gap detectors & exposure (new) · Clue rules (new) ·
  Keyboard shortcuts (new) · API docs
```

The main choices:

- **Guide holds the newcomer path and every prerequisite.** The "Set up" group matches the app's own Setup page,
  which asks the same question: how do I connect this? `ai-steps.md` and `test-selection.md` leave `/guide/`
  because they are features; `backend-logs.md` and `importing-runs.md` stay because they get data in.
- **"Trends and reports" is a new catalog group.** It takes Analytics, Dashboards, Quality reports, Timeline markers
  and Notifications out of "Keep the history", which keeps the run history itself. `ROADMAP.md` calls analytics and
  notifications delivery routes rather than jobs, so this group sits beside "Use it from elsewhere" and changes no
  product framing, and it comes after the four jobs, as the roadmap ranks delivery routes. Report schedules deliver
  through notification channels, and markers explain the trend charts, so the five belong together.
- **"Find what your tests miss" is a fourth job.** The product's jobs today are keep the history, explain the
  failures, hand back a fix (`ROADMAP.md`, "What Piwi is for"). The Test Map has its own tab, CLI command, MCP
  tools, a skill, a pull-request section, dashboard widgets and a capability, and it answers a question none of the
  three asks. Its page splits into the three entries the catalog already has. This does change the product framing
  (decision 1).
- **Each recipe opens the group it serves.** A recipe follows one task across several features, so it belongs next to
  them rather than in a group of its own. Today almost nothing leads to the recipes: the app's inline help links to
  none of them, one feature page links to one, and only the landing page links to their index. The Recipes group and
  its index page go. Groups collapse, so only the reader's current group is open.
- **Self-hosting** replaces the label "Operate": it is the standard term for running your own server. The catalog
  group "Run your instance" takes the same name.
- **Integrations keeps its name**, because it matches Settings → Integrations; it and Issue tracking link to each
  other at the top.
- **Four URLs move:** `guide/ai-steps`, `guide/test-selection`, `reference/feature-map` and
  `features/analytics-widgets`, each with a row in `public/404.html`. A fifth row sends the removed recipes index to
  the landing page. Every other change adds a page or keeps one.

### The landing page

Since 0.38.0 the app's sidebar links to this page, so it is where a user lands from inside the product as well as
from search.

- The hero stays; the drift test guards the positioning line.
- **Start in three steps**, right under the hero: run the dashboard (desktop app, Docker or `npx`, as tabs), run
  `npx @piwitests/reporter init --server-url …`, then `npx playwright test` and open the link it prints. The snippets
  already exist.
- **One card per catalog group**, built from each group's title and one-line intro, instead of six hand-picked
  features.
- **Entry points by reader**, three or four links each: *I write Playwright tests*, *Something is red right now*,
  *I run Piwi for a team*, *I report to people who don't open Piwi*, *I connect an agent or automate*. *Something
  is red right now* lists the five recipe questions and replaces the recipes index.
- Cut: "Why this exists" (it opens What Piwi does), the "Also here" paragraph (All features lists everything), four
  of the seven gallery images.

### The Test Map pages

| Page | Content | Needs |
|---|---|---|
| Scenario gaps & the Test Map | what the map and a gap are, the gap classes, the Gaps tab with its feature map and feature graph, the triage verbs, what feeds the map (page inventory, declared surface), what it is not | Reporter |
| Uncovered changes in pull requests | the pull-request section, the commit status, `get_change_coverage`, the warn-only gate flag | Reporter, SCM token |
| Probes | client probes and `piwi probe`, the "not noticed" gap, server probes as one Experimental section | Reporter; backend instrumentation for server probes |
| Reference: gap detectors & exposure | the detector table, the exposure factors, what the graph includes | none |

### The recipes

The five recipes keep their pages and URLs under `/recipes/`. Each one moves to the top of the group it serves and
gets linked from where its question comes up: the "Related" footer of the feature pages it draws on, and the in-app
help on the matching screen.

| Recipe | Group | Linked from the feature pages | Linked from the help topic |
|---|---|---|---|
| Regression or flake? | Explain the failures | What changed in a run, Flaky tests & quarantine, Timeline markers | `run.changes` |
| Triage a run gone red | Explain the failures | Failure clusters & the inbox, AI diagnosis | `cluster.concept` |
| Cut costly flakiness | Explain the failures | Flaky tests & quarantine, Analytics | `project.flaky-tests` |
| Cut the time it costs | Explain the failures | Slow tests & wasted time, Analytics | `project.performance` |
| Fix a broken locator | Hand back a fix | Locator healing, Browser extension, Failure evidence | `locator-healing` |

- **The in-app link needs one small app change.** A help topic carries a single `doc` link today, shown as "Learn
  more". Topics gain an optional `recipe` field, shown as a second link labeled with the recipe's question, and the
  drift test's link check reads that field too.
- **Three recipes re-explain a feature**, against the docs guide's own rule. "Cut costly flakiness" copies the
  five-row table of root-cause classes, "Fix a broken locator" repeats the pause-on-failure options, and "Triage a
  run gone red" repeats the fingerprint masking. Those passages become links.
- **The index page goes.** Its questions move to the landing page, and its table of tools repeats All features.

## What gets removed

Deleted outright, with no copy anywhere: **about 10,600 words**.

| Content | Page | Words now | Action | Removed |
|---|---|---:|---|---:|
| Screen-by-screen manual | `ui-overview.md` | 3,024 | a map, one paragraph per page, keeping the anchors the app links to | 2,100 |
| Second description of the execution page | `evidence.md`, "One execution, diagnosis-first" | 2,108 | the situation block (the headline, most likely cause, situation and next step at the top of a failing execution) is explained once, in Your first failure; clue rules go to reference | 1,300 |
| Getting started detours | `getting-started.md` | 1,250 | cut the from-source install, the REST example, the navigation table, "What is Piwi" and the repeated reporter setup; move capabilities to Self-hosting | 900 |
| Copy of the capture fixtures page | `reporter.md` | 1,021 | a two-line pointer; green page sampling moves to Capture fixtures | 850 |
| Clustering copy and internals | `ai-diagnosis.md`, "Failure clustering" | 1,301 | 250 go to Failure clusters, 250 stay as semantic merging | 800 |
| OAuth internals | `authentication.md` | 966 | keep setup, allowlists and the linking rule | 600 |
| Baseline rule, explained three times | concepts, branches, run changes | 961 | concepts owns it | 550 |
| Commit selection scoring | `ai-diagnosis.md`, "SCM-grounded context" | 892 | 250 stay, 200 go to Source control | 450 |
| Demo internals | `ai-diagnosis.md`, `importing-runs.md` | 401 | one line each | 370 |
| FAQ answers that repeat other pages | `comparison.md` | 504 | links | 350 |
| Copies of locator healing and fix plans | `ai-diagnosis.md` | 332 | links | 330 |
| Streaming internals and "How it works" | `reporter.md` | 471 | keep the switches | 300 |
| Storage architecture internals | `storage.md` | 361 | keep what an operator decides | 260 |
| Recipes index | `recipes/index.md` | 441 | removed; its questions move to the landing page and its tool table repeats All features | 400 |
| Landing duplicates | `index.md` | 250 | cut | 250 |
| Hand-written endpoint paths | 23 pages | 36 lines | link the API docs | 240 |
| Unreleased and planned behavior | `scenario-gaps.md` | 250 | one Experimental section | 190 |
| Second CI provider list | `reporter.md` | 350 | CI & sharding owns it | 150 |
| Second "try it without editing your config" | `reporter.md`, `getting-started.md` | 250 | Reporter owns it | 120 |
| Contributor material | `desktop.md`, `getting-started.md` | 58 | CONTRIBUTING | 58 |
| **Total** | | | | **about 10,600** |

Moved to generated pages: the reporter option and environment variable tables (1,468 words), the MCP tool tables
(about 1,100 words) and the analytics widget list (947 words). Rewriting the remaining long pages to their template
(extension tools, desktop local runs, locator healing, notification channels, the test selection flags that the CLI
reference already lists) takes out about 3,500 more.

| | Now | After |
|---|---:|---:|
| Pages | 65 | about 82 |
| Hand-written words | about 82,000 | about 66,000 |
| Average hand-written page | about 1,370 words | about 900 words |
| Hand-written pages over 1,500 words, reference excluded | 16 | 0 |
| Word budget allowlist | 9 entries | deleted |

The word totals move with every release: two releases added 9,000 words. The rules below are what keep new content
in the right place; the totals only measure the catch-up.

## What gets generated

| Page | Source | Status |
|---|---|---|
| Configuration | `shared/piwi-env-vars.ts` | exists |
| All features | `shared/piwi-features.ts` | exists, renamed from Feature map |
| What's new | `CHANGELOG.md` | exists |
| **Reporter options** | `packages/reporter/src/public/options.ts` (options with JSDoc comments) and `PIWI_ENV_KEYS` in `src/internal/config/env.ts` | new: a script reads the interface with the TypeScript compiler API, the way `generate-configuration.mjs` reads the env registry |
| **MCP tools** | `shared/mcp-tools.ts` (name, description, module, capability) | new: the drift test's "every tool is documented" check becomes true by construction, and the tool count lives on one page |
| **Metrics** | `shared/analytics/metrics.ts` (24 metrics: label, unit, which direction is better, definition) | new: the definitions the Analytics page, the MCP tools, quality reports and the OpenMetrics `HELP` lines already print |
| **Analytics widgets** | `shared/analytics/registry.ts` (32 widgets: title, description, band, whether it follows a test filter) | new, replacing the hand-written page; the band headings stay, so the eight in-app links keep their anchors |
| **Features sidebar and landing cards** | `shared/piwi-features.ts` | new |
| **`llms.txt` and `llms-full.txt`** | every page's title, description and Markdown | new, optional (see Further options) |

Hand-written reference pages that get a drift test instead of a generator, because the code has no registry with
descriptions: **notification events** (every key of `NOTIFICATION_EVENTS` must appear), **Piwi CLI** (every flag in
each command's `--help` text must appear), **gap detectors** and **clue rules** (a test once the detectors and clue
rules have an id list), **keyboard shortcuts**, **test metadata**.

## Rules that keep it this way

The September rules were right; three had a way around them: the budget had an allowlist, the sidebar was placed by
hand, and nothing checked that the catalog lists every feature page. The last two releases show both sides: the
budget held for six new pages, while two feature pages are now missing from the catalog and four were appended to a
flat list. Each rule below is a check in the drift test or a line in the docs agent guide (`apps/docs/AGENTS.md`).

| Rule | Enforced by |
|---|---|
| Every `features/*.md` page is a catalog entry, and every entry in a feature group points to a whole page | test |
| The Features sidebar is rendered from the catalog; nobody places a feature page by hand | `config.mts` |
| Every hand-written page is within its type budget; there is no allowlist | test, replacing `OVER_BUDGET` |
| A page that lists the entries of a code registry is generated from it | agent guide |
| Every page has a `description` front matter; outside recipes, whose H1 is the reader's question, the H1 equals the sidebar label | test |
| Every docs URL in `README.md`, `DOCKER_HUB.md`, `ROADMAP.md` and the package and integration READMEs resolves to a page and heading | test; it catches the dead README link |
| No endpoint path in prose, except `/api/health` and `/api/metrics`; link the API reference | test |
| No "planned", "not yet wired" or "coming soon" in hand-written pages | test, extending the version-history check |
| Every recipe is linked from at least one feature page and one in-app help topic | test |
| A new term goes into `concepts.md` in the change that introduces it | agent guide |
| A new feature adds a catalog entry and one feature page; it never extends another feature's page | agent guide |

## Vocabulary

Terms to add to `concepts.md`, with the meaning the code gives them:

| Term | Meaning |
|---|---|
| Test Map | One graph per project of what the application exposes (pages, controls, links, routes, handlers, dependencies) and which tests reach each of them |
| Scenario gap | A test the suite does not have yet, proposed from the Test Map with its evidence and a next step |
| Gap class | **blind-spot**: nothing reaches it. **false-comfort**: a probe broke it and every test still passed. **fragile**: a single flaky or skipped test reaches it. Server probes add two classes of finding: **unhandled** and **degraded** |
| Detector | A rule that reads the Test Map and the run history and reports one kind of gap |
| Reach | A test reaches a route, a page or an element when a real run observes it doing so: a request, a navigation, or a locator in its steps resolving to the element. Measured from runs, never from instrumented code coverage |
| Locator index | The locator chains each test used in its steps, per branch and per Playwright project; it feeds Who uses a locator and Tested elements |
| Exposure | The score that ranks gaps, from churn, age, escape history and priority |
| Probe | A re-run of a passing test with one injected fault, recording whether the test noticed |
| Declared surface | The routes and pages the application says it has (a manifest, an OpenAPI document), as opposed to the ones tests reached |
| Page inventory | The controls and links the reporter records on passing runs; off by default |

Name collisions to resolve:

- **Feature map.** The docs page becomes **All features**; the Gaps tab keeps "feature map". Docs-only change.
- **Inspector.** The locator inspector overlay keeps the name; the graph's list of adjacent nodes is renamed in the
  UI, for example "Neighbors", the word its description already uses. Product change.
- **Dashboard.** "The dashboard" stays the web app, its installed meaning in 193 places and in the product name.
  The saved arrangement of widgets is written **analytics dashboard** wherever the Analytics pages are not the
  context, and `concepts.md` defines it under that name. Docs-only change.

## Migration plan

Five pull requests and an optional sixth. The site builds green after each one, and the drift test names every in-app
link a change breaks. After PR 1, PR 2 and PR 4 can run in parallel in separate sessions. PR 3 starts once PR 2 is
done, and PR 5 once PR 3 is done, because each edits pages the previous one slims. A PR builds on the previous PR's
branch, so it can start before that PR is merged.

**PR 1: one taxonomy** (built)

- Top navigation (Guide, Features, Self-hosting, Reference, Blog, Demo); Guide sidebar in three groups; Self-hosting
  groups; the Reference list. The navigation is plain data in `.vitepress/navigation.ts`, and the Features sidebar
  and the landing cards are rendered from the catalog.
- Catalog: groups in the order Keep the history, Explain the failures, Hand back a fix, Find what your tests miss,
  Trends and reports, Use it from elsewhere, Self-hosting; Issue tracking and Metrics and rollup export added; each
  title equal to its page's H1. The fourth job is written into `ROADMAP.md` and What Piwi does, in its own commit.
- Each recipe at the top of its group; the recipes index removed and redirected to the landing page.
- Four URLs moved, each with a redirect row: `guide/ai-steps` and `guide/test-selection` to `features/`,
  `features/analytics-widgets` to `reference/`, and the Feature map to `reference/features` (All features).
- Landing page: three steps, one card per catalog group, entry points by reader, the limits paragraph kept.
- `<Needs>` chips link to their setup pages through `FEATURE_NEED_DOCS` in the catalog.
- A `description` on every page, one footer heading ("Related"), and outside recipes an H1 equal to the sidebar
  label; the recipes' titles match their sidebar labels.
- Checks: every `features/` page is in the catalog; every page has a description; every sidebar entry resolves and
  matches its page's H1; every docs URL in the READMEs resolves; the docs links in `shared/`, `FEATURE_NEED_DOCS`
  and the env-var registry resolve. The feature budget counts the page body, not its front matter, and the two
  moved pages are capped at their current size until PR 3 replaces the budget.
- `apps/docs/AGENTS.md` rewritten to these rules.

**PR 2: Guide** (built)

- Getting started in three steps, under 900 words, ending on Your first failure. "Choosing what you use" moves to
  `operate/capabilities.md`.
- New `guide/source-control.md` and `guide/ai-provider.md`, from moved text.
- `backend-logs.md` retitled Backend instrumentation, covering its four uses: backend logs, server spans, the route
  manifest, server probes.
- `reporter.md` under 1,500 words: options and environment variables to the generated page, metadata rules to
  `reference/test-metadata.md`, the fixtures copy removed.
- `ci.md` under 1,500 words: pull-request feedback and re-run move to `features/pr-feedback.md`.
- `concepts.md`: the Test Map terms, reach and the locator index, sole owner of the baseline rule, terms grouped
  under results, failures, analytics and Test Map.
- What Piwi does and Why Piwi?: one statement of the limits; the FAQ answers become links.
- About 15 in-app link updates.

Where the build differs from this plan, and why:

- AI diagnosis keeps a heading with a one-line pointer for each moved section ("Enabling AI diagnosis", "Response
  language", "Context limits (and token cost)"), so old links keep an anchor while the in-app links move to AI provider.
  The research and embedding help topics link `guide/ai-provider#model-roles` and auto-diagnose links
  `#enabling-ai-diagnosis`, rather than the page top. The three `cluster.*` SCM topics keep
  `features/ai-diagnosis#scm-grounded-context`: they are about the diagnosis context, not the token.
- The Reporter options generator reads `options.ts` and `env.ts` with the TypeScript compiler API, both files, since
  `DEFAULTS` is not exported. A default comes from the JSDoc, else from `DEFAULTS`. `apps/docs` pins `typescript@^6`,
  the root's version: TypeScript 7 (the native port) has no compiler API. The generator fails on an option without
  JSDoc; every option already had one.
- Server spans and the route manifest are Nitro-only: the ASP.NET Core package sends `X-Piwi-Trace` only on probe
  requests and serves no manifest. `scenario-gaps.md` says both packages serve `/__piwi/manifest`; PR 3 corrects it
  with the Test Map split.
- The branch-detection chain moved from CI & sharding to Test metadata, so CI & sharding lists what is detected and
  links there.

**PR 3: feature pages** (3 days)

- AI diagnosis under 1,500 words; Failure clusters takes "how failures are grouped" and "Did the fix work?".
- Failure evidence: the situation block leaves (Your first failure explains it), clue rules go to reference.
- UI overview as a map under 900 words, keeping the anchors the app links to, and adding the Gaps tab and the
  Locators and Reports pages.
- The Test Map in three pages plus the detectors reference; the unreleased lines go.
- MCP server: tool tables to the generated page, agent skills to their own page.
- Analytics widgets and Metrics generated from their registries under `/reference/`; the hand-written widget page,
  moved there by PR 1, is replaced.
- Extension, desktop, locator healing and notifications rewritten to the template.
- Each recipe linked from the "Related" footer of the feature pages it draws on; the recipes' re-explanations become
  links. Help topics gain the optional `recipe` field, and five topics link their recipe.
- The budget check switches to one budget per type with no allowlist. With the Test Map and agent skills split,
  the check that every entry in a feature group points to a whole page joins the drift test, and so do the checks
  on endpoint paths and on planned wording, with the pages they clean.
- About 15 in-app link updates.

**PR 4: Self-hosting** (built)

- `operate/one-click-deploy.md` from `deployment.md`; the security list lives only in the production checklist.
- `operate/project-access.md` (with the permission grid) and `operate/api-keys.md` from `authentication.md`; OAuth
  internals cut.
- Storage architecture internals cut; retention and runs kept forever stay on Storage.
- Sidebar groups: Install, Configure, Data, Upgrade; Metrics and rollup export joins Data.
- Built differently from the plan, and why:
  - Storage keeps a short "Storage architecture" section (what is automatic: traces split, compressed and freed when
    unreferenced; failure evidence stored once) rather than losing it, because the app's storage backend help links
    `#storage-architecture`. The page is renamed **Storage & retention** (H1 and sidebar), URL kept.
  - Deployment's Backups section goes too: it copied Backup & restore, and the four operate links to it now point
    there. Deployment's prose is about 1,000 words; code samples take it to about 1,250.
  - "Using the reporter with a username and password" lives on API keys, as the alternative to a key for CI.
  - API keys gets a Self-hosting catalog entry with no need chip: every user manages their own keys under
    Settings → Account, and administrators manage anyone's under Settings → Users. The page says so; the old
    section only named Settings → Users. Project access's location becomes Settings → Permissions.
  - `SECURITY.md` pointed at the old `/deployment` URL with its own three-item list; it now links the checklist.
    The README keeps its three-line "Before you expose it" summary, which already links the checklist.
  - The generated one-click manifests point at `/operate/one-click-deploy` instead of the old `/deployment`.
  - Integrations and Localization gain a Related footer; Integrations links Issue tracking at the top.

**PR 5: remaining reference and checks** (1 day, after PR 3)

- Notification events & webhooks, keyboard shortcuts and clue rules, each with its check; the CLI flag check against
  `--help`.
- The MCP tool count leaves the narrative pages (landing, comparison, README, ROADMAP) and stays on the generated page.
- Optional: `llms.txt` and `llms-full.txt`.

**PR 6, optional: docs served by the instance** (1 to 2 days, see Further options)

In-app links that change (occurrences in the app, the catalog and the capability registry). PR 1 already moved the
links to AI steps, Test selections, Analytics widgets and All features:

| Link today (occurrences) | New target |
|---|---|
| `features/ai-diagnosis#enabling-ai-diagnosis` (5) | `guide/ai-provider` |
| `features/ai-diagnosis#context-limits-and-token-cost` (3) | `guide/ai-provider#context-limits-and-token-cost` |
| `features/ai-diagnosis#scm-grounded-context` (4) | `guide/source-control` where the link sits on an SCM setting, unchanged elsewhere |
| `features/ai-diagnosis#failure-clustering` (2) | `features/failure-clusters#how-failures-are-grouped` |
| `features/mcp#agent-skills` (4) | `features/agent-skills` |
| `guide/ci#pull-request-feedback`, `guide/ci#re-run-from-the-dashboard` (2) | `features/pr-feedback` |
| `features/scenario-gaps#…` (4) | `features/uncovered-changes`, `features/probes`, `features/probes#server-probes` |
| `operate/authentication#project-access`, `#permission-grid`, `#api-keys` (3) | `operate/project-access`, `operate/project-access#permission-grid`, `operate/api-keys` |
| `guide/getting-started#using-the-piwi-dashboard-reporter` (1) | `guide/reporter` |
| `guide/getting-started#declining-a-capability` (docs pages only) | `operate/capabilities` |

Unchanged: every `features/ui-overview#…` anchor, `features/evidence#one-execution-diagnosis-first` and
`#trace-powered-deep-views`, `guide/getting-started#fast-path-one-command`, every link into Analytics, Dashboards
and Quality reports, and every other `operate/…` link.

## Further options

Three larger moves and one measurement. The revamp does not need them; each follows from a principle Piwi already
states.

**Docs served by the instance, matching its version.** Operators pin versions and Piwi is pre-1.0, so a pinned
0.30 instance sends its inline help, and since 0.38.0 its sidebar link, to docs written for 0.39. An air-gapped
instance, which `privacy.md` says works the same as one on the internet, has dead help links. The in-app API reference
already solves both problems for the API: the instance renders it, with no CDN. The same works for the site: build it
a second time with `vitepress build --base /help/`, copy the output into the image (about 3 MB, mostly screenshots),
and let `docsUrl()` and `DOCS_BASE_URL` in `shared/docs.ts` point to `/help/` when the build carries it. The desktop
app gets offline docs with no extra work. The cost: a docs stage in the Docker build, about a minute of build time,
and a docs build failure now fails the image. Best decided before 1.0, when versions start to matter.

**Docs for coding agents.** Piwi ships an MCP server, six agent skills and a `setup_piwi` prompt, and the agents it
targets read documentation too. A 40-line build script can write `llms.txt` (every page's title, description and URL)
and `llms-full.txt` (the hand-written pages as one Markdown file), following the llms.txt convention for publishing
docs to language models. The skills can then point an agent to one URL instead of letting it scrape pages. It needs
only the `description` front matter that PR 1 adds.

**A demo link on every feature page.** The demo is the real app on seeded data. A `demo` field in the catalog, a
route in the seeded demo, would render a "See it in the demo" link beside the `<Needs>` chips and in the All
features table: one click from every feature to the working screen, with nothing to install. A check resolves each
route against the app's pages.

**Search traffic for the recipes.** The docs guide says recipes exist for search queries that never mention Piwi,
and the docs site has no analytics, so nobody knows whether those searches arrive. Google Search Console answers it
without adding anything to the pages: the domain is verified with a DNS record, and its report lists the queries that
led to each page. Whether to register the domain with Google is your call.

## Decisions for you

1. **The Test Map as a fourth job**, "Find what your tests miss". Recommended: it has its own tab, CLI command, MCP
   tools, skill, widgets and capability, and it works on passing runs. It changes "What Piwi is for" in
   `ROADMAP.md`, What Piwi does, the catalog and the landing cards. The alternative keeps three jobs and leaves it
   under "Hand back a fix". While the groups change, two other placements deserve a look: Test selections and AI
   steps sit under "Hand back a fix", where few readers would search for them.
2. **The catalog drives the sidebar, with a "Trends and reports" group and each recipe at the top of the group it
   serves.** Recommended. The group changes no product
   framing, because `ROADMAP.md` already calls analytics and notifications delivery routes. The alternative keeps
   the sidebar hand-written in `config.mts`, with a check that it matches the catalog.
3. **One 1,500-word budget per page type, with no allowlist**, instead of 1,200 words for feature pages with nine
   exceptions. Recommended. The current budget held for the six new pages; the change extends it to every section
   and retires the exceptions.
4. **The three name collisions.** Recommended: rename the docs page to "All features" and write "analytics dashboard"
   for saved dashboards (both docs only), and rename the graph's "inspector" list in the UI (product change).
5. **Docs served by the instance.** Optional; recommended to decide before 1.0.

## Appendix: page disposition

| Page | Words now | Action | Target |
|---|---:|---|---:|
| `index.md` | 617 | three steps, catalog group cards, entry points by reader, the five recipe questions | 550 |
| guide/getting-started | 1,834 | three steps; capabilities move to Self-hosting | 900 |
| guide/first-failure | 931 | the one description of the situation block; linked from Getting started and the landing | 1,000 |
| guide/concepts | 2,132 | adds the Test Map terms, reach, the locator index; owns the baseline rule; reference type | 2,400 |
| guide/reporter | 5,727 | setup only; tables to reference | 1,300 |
| guide/capture-fixtures | 1,491 | sole owner of the fixtures, takes green page sampling | 1,500 |
| guide/ci | 2,372 | pull-request feedback and re-run leave | 1,300 |
| guide/source-control | new | the repository connection and what uses it | 600 |
| guide/ai-provider | new | providers, model roles, streaming, response language, limits, token cost | 900 |
| guide/backend-logs | 906 | retitled Backend instrumentation, with its four uses | 1,000 |
| guide/importing-runs | 1,523 | demo internals cut | 1,100 |
| guide/what-piwi-does | 776 | the jobs, the two rules, the pieces | 800 |
| guide/comparison | 1,284 | the FAQ becomes links | 900 |
| guide/privacy | 1,031 | unchanged | 1,000 |
| guide/ai-steps | 1,363 | moves to features/ | 1,200 |
| guide/test-selection | 1,918 | moves to features/; flags stay in the CLI reference | 1,200 |
| features/ui-overview | 3,072 | a map; adds the Gaps tab and the Locators and Reports pages | 900 |
| features/evidence | 3,691 | situation block and clue rules leave | 1,400 |
| features/failure-clusters | 1,187 | takes grouping and fix verification | 1,500 |
| features/ai-diagnosis | 4,766 | setup, clustering and copies leave | 1,400 |
| features/scenario-gaps | 1,693 | split in three, plus a reference page | 1,000 |
| features/uncovered-changes | new | from scenario-gaps | 450 |
| features/probes | new | from scenario-gaps | 600 |
| features/pr-feedback | new | from ci | 800 |
| features/mcp | 2,087 | tools to reference, skills to their own page | 700 |
| features/agent-skills | new | from mcp and cli | 450 |
| features/extension | 2,486 | one H2 per tool, template | 1,500 |
| features/desktop | 2,265 | template; the copies of Reporter and MCP content go | 1,500 |
| features/locator-healing | 1,930 | template | 1,400 |
| features/notifications | 1,274 | events and payloads to reference | 950 |
| features/branches, run-changes | 1,577 | the baseline rule links to concepts | 1,100 |
| features/analytics, dashboards, quality-reports | 3,547 | move to Trends and reports; "analytics dashboard" where the context is not Analytics | 3,450 |
| features/locator-usage, tested-elements | 2,057 | link each other; the locator index is defined in concepts | 2,000 |
| features/analytics-widgets | 947 | moves to reference, generated | generated |
| other feature pages (10) | 8,100 | descriptions and linked chips only | 8,100 |
| operate/deployment | 1,890 | one-click deploy leaves | 1,100 |
| operate/one-click-deploy | new | from deployment | 700 |
| operate/authentication | 2,489 | project access and API keys leave, OAuth internals cut | 1,000 |
| operate/project-access | new | from authentication, with the permission grid | 650 |
| operate/api-keys | new | from authentication | 400 |
| operate/capabilities | new | from getting-started | 350 |
| operate/storage | 1,623 | architecture internals cut | 1,350 |
| other operate pages (7) | 4,650 | the production checklist takes the one security list | 4,700 |
| recipes/index | 448 | removed, redirected to the landing page | removed |
| recipes (5) | 4,392 | each at the top of its group; re-explanations become links | 4,150 |
| reference/cli | 1,923 | unchanged, flag check added | 1,950 |
| reference/reporter-options | new | generated | generated |
| reference/mcp-tools | new | generated | generated |
| reference/metrics | new | generated | generated |
| reference/test-metadata | new | from reporter | 1,000 |
| reference/notification-events | new | from notifications | 400 |
| reference/gap-detectors | new | from scenario-gaps | 450 |
| reference/clues | new | from evidence | 500 |
| reference/keyboard-shortcuts | new | from ui-overview and failure-clusters | 250 |
