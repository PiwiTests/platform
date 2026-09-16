# Documentation restructure

An audit of the documentation site (`apps/docs/`), the root `README.md`, `DOCKER_HUB.md` and the package READMEs,
with a proposed layout and a migration plan. State audited: `main` at v0.26.1, on 2026-09-05. Every page was read in
full against the code (`packages/reporter/src`, `apps/application/app`, `apps/application/shared`) and against
`CHANGELOG.md` from 0.11.0 to 0.26.1. Line numbers refer to that state; word counts are `wc -w` on the Markdown source.

**Summary.** The docs are not too long. They are mis-shaped. Twenty-six minor releases landed between July 11 and
August 29, and each feature was written into whichever existing page was nearest. Five pages hold a third of the
words, three pages each carry three to six unrelated features, and roughly thirty-five shipped features have no heading
a reader could find from the sidebar or type into search. The second cause is copying: the same eight blocks (the
fixtures file, the reporter config, the Docker command, the hardening list, the fingerprint definition, the Changes-tab
rule, the locator-healing explanation, the env-var tables) exist in three to thirteen places each, and copies have
already drifted. The fix is structural: five sections that each answer one reader's question, one page per feature
with a fixed skeleton and a word budget, snippets that live in one file every page includes, and two discovery pages
(a feature map and a what's-new list) generated from registries the code already has. The README shrinks to half its
size because it stops restating four docs pages.

What is already right and should not move: the recipes format, `auto-heal.md` (the template every feature page
should follow), the generated configuration reference, `concepts.md` as the vocabulary source, the voice rules, and
the unit test that keeps in-app help links pointing at real headings.

## By the numbers

| Measure | Value |
|---|---|
| Pages on the site | 40 (64,571 words, including the blog post) |
| Share of words in the five largest pages | 31% |
| Minor releases between 0.11.0 and 0.26.1 | 26 in seven weeks |
| `docker run … phenx/piwitests-server` occurrences | 13, across 5 files |
| Copies of the security hardening list | 6, no canonical page |
| Features reachable only by opening the wrong page | about 35 |
| Pages with no screenshot or diagram | 29 of 40 |
| In-app help links that resolve to a page + heading | about 60, guarded by `docs-drift.test.ts` |

| Page | Words | H2 | What it actually contains |
|---|---:|---:|---|
| `reporter.md` | 6,318 | 16 | Install guide + options reference + a 1,736-word locator-healing explanation + 1,071 words of metadata rules |
| `ai-diagnosis.md` | 5,319 | 14 | Clustering (1,301 words, no AI involved) + fix verification + AI setup + SCM internals + locator healing + fix plans, reproduce, bisect |
| `ui-overview.md` | 2,863 | 16 | A "map" with four 335–413-word sections and one 300-word paragraph; the house rule says one paragraph per view |
| `evidence.md` | 2,781 | 6 | Right content, wrong shape: 1,752 words under one H2, bullets of 250 words |
| `extension.md` | 2,725 | 6 | Nine tools as one 1,500-word bullet list with no headings; hosts the whole test-functions catalog, a server feature |
| `ci.md` | 2,558 | 13 | Run in CI + sharding + PR feedback + re-run from dashboard + merge gate (7 of 14 flags) |
| `deployment.md` | 2,496 | 13 | Install + one-click hosting + health + HTTPS + backups + security + resources + troubleshooting + two contributor sections |
| `authentication.md` | 2,275 | 12 | Roles + OAuth internals + project access + API keys + reporter credentials + a fourth copy of the hardening list |
| `desktop.md` | 2,182 | 10 | Install + local runs + bisect + MCP wiring + import + updates |
| `README.md` | 1,860 | 10 | A compressed copy of getting-started, deployment, comparison and the artifacts list |

## How it bloated: five mechanisms

Naming the mechanism matters more than naming the pages, because the layout has to stop each one from recurring.

1. **A feature lands on the nearest page, not on its own.** Quarantine went under Flaky tests, fix plans and bisect
   under AI diagnosis, PR feedback under CI, the test-functions catalog under the browser extension, local runs under
   Desktop app. The sidebar label then no longer says what the page holds. "Reading the results" shows 10 entries for
   about 30 features.
2. **Three page types share one file.** A how-to guide, a reference table and an explanation of internals are
   different documents for different moments. `reporter.md` interleaves all three, so a new user scrolls past 33
   option rows and a power user scrolls past the install steps. The Diátaxis framework (tutorial, how-to, reference,
   explanation) is the standard split; the site already half-uses it with "Recipes", the only task-first group.
3. **Snippets are pasted, not included.** The fixtures file exists five times, the Docker command thirteen, the
   hardening list six, the secret one-liner ten. Nothing forces them to agree, and they no longer do. VitePress
   supports code includes (`<<< @/snippets/fixtures.ts`); the site does not use them.
4. **Changelog and design rationale leak into pages.** "No longer reads keywords alone", "used to go quiet… now every
   run", "the original batch-only behavior", "Backward compatibility", plus commit-selection scoring tables, SSE event
   names, storage dedup layout, DB table names, source paths. Each is true, none helps a reader use the feature, and
   the changelog already holds the history.
5. **Hand-written copies of a generated reference.** `configuration.md` is generated from the env-var registry and
   documents 96 variables. Six other files carry hand-typed tables of the same variables (deployment, storage,
   authentication, notifications, the server README, the Docker Hub page). Only `PORT`, `HOST` and `NODE_ENV` are
   unique to those tables, because the registry lacks a runtime category.

## Findings by area

### README.md

1,860 words. It does its first job well: positioning line, a real screenshot, honest caveats, a working quick start,
a plain "before you expose it". Then it keeps going and becomes a second copy of the docs.

| Section | Problem | Do |
|---|---|---|
| Pick a path + caveats paragraph | Same table as `getting-started.md`, plus a 110-word paragraph on unsigned installers and hosting limits that the linked pages already carry | Keep the five-row table, cut the paragraph to one sentence with a link |
| Quick start, steps 1–4 | Step 4 (fixtures) and the `init` paragraph re-explain `capture-fixtures.md` and `getting-started.md`; the resource figures repeat `deployment.md` | Three steps: run it, add the reporter, run tests. One line for `init`, one line for fixtures, both linked |
| Before you expose it | Copy 1 of 6 of the hardening list | Three bullets, link to the production checklist proposed below |
| A quick tour | Good: six tiles, real screenshots, honest captions | Keep |
| Where this fits | A 120-word restatement of `comparison.md` | One sentence plus link |
| Published artifacts | Good and unique to the README | Keep |
| Documentation | A seven-link list that mirrors the sidebar and will drift from it | Replace with one line: the docs URL and the feature map |
| Project status, Community, Contributing, License | Fine | Keep; merge status and upgrading into one paragraph |

Target: about 900 words, same section order, nothing the docs say better.

### Start here

- `index.md` (847 words) is a good landing page. Its "Where to go next" block already routes by intent (something is
  failing / setting up / vocabulary / CI / team / agents), which is the seed of the section split proposed below. The
  six feature cards stop at "Yours to run"; the last paragraph then lists eight more features in one sentence, which
  is where discovery currently ends.
- `getting-started.md` (1,721 words) carries three install paths in full (Docker, source, REST submit) and a
  "Dashboard navigation" table that duplicates `ui-overview.md`. "Running from source" is contributor material. The
  REST example (60 lines in two shells) is for people not using Playwright, which the roadmap lists as a non-goal.
  Target ≤900 words: pick a path, the `init` command, the twelve-line manual config, first run, one link per next step.
- `concepts.md` (1,456 words) is the right page and the right length, but it holds the branch-aware baseline rule
  (three paragraphs) that `flaky-tests.md` and `ui-overview.md` restate. It should be the single owner of that rule
  and of "Environment" and "Tags & ownership".
- `comparison.md`: the FAQ answers five questions a second time (data safety → `privacy.md`, AI data →
  `ai-diagnosis.md`, Node version → `getting-started.md`, disk/RAM → `deployment.md`, production-ready → README).
  Keep the landscape and the feature table; move the FAQ to a single FAQ page that links rather than answers.
- `privacy.md` is one of the best pages on the site. Its "Secrets at rest" section is copy 5 of the hardening list;
  link it instead.

### Sending results

Seven pages, 15,935 words; `reporter.md` is 40% of that. About 2,300 words of the group describe how to *read*
something in the dashboard (locator healing, PR feedback, selection health, "how it looks in the dashboard", "intent
in the dashboard").

| Page | Finding | Action |
|---|---|---|
| `reporter.md` | Three documents in one. The options table sits at L119–204, between the install steps and the locator-healing explanation. The `ai.*` option group is missing from the table (it is only on `ai-steps.md`); five env vars (`PIWI_BRANCH`, `PIWI_DOTENV_FILE`, `PIWI_DESKTOP_CONFIG`, `PIWI_AI_UPDATE`, `PIWI_SELECTION`) are missing from the env table. The wrapConfig defaulting caveat is stated five times on this page alone. Contains DB table names and `src/internal/config/env.ts`. | Split into a ≤1,500-word install guide, a reference page (options + env + precedence + report types + detected CI platforms), a locator-healing feature page, and a test-metadata reference (tags, `piwi:` annotations, timeout, "didn't run") |
| `capture-fixtures.md` | Best-shaped page in the group. Shows two equivalent setups (`base.extend(piwiFixtures)` and `extendPiwiFixtures(base)`) without saying they are equivalent; the rest of the site uses one or the other at random (five pages each). Row L134 says `inspectOnFailure` "opens the Playwright Inspector"; `reporter.md` L370 says it is Piwi's own overlay, not Playwright's. | Keep as the single home of the snippet; state "two spellings, same result"; fix the inspector contradiction |
| `ci.md` | "What gets detected" lists 13 CI providers with a branch fallback chain; `reporter.md`'s "CI information" lists 6 providers. Two inconsistent lists. PR feedback, re-run from dashboard and the merge gate are dashboard features configured in Settings, not YAML. "A run is stuck as interrupted" is the only documentation of the heartbeat state, hidden under troubleshooting. | Keep as the CI guide (env, providers, sharding, run URL, troubleshooting); move PR feedback + re-run to a feature page; move the gate to the CLI reference with all 14 flags; move "interrupted" to concepts |
| `test-selection.md` | Half the page is about the Selections tab and MCP tools (reading), not sending. The sidebar says "Test selections"; readers type "run only smoke tests", "run a subset", "changed files", "balanced shards". Documents 6 of 13 `select` flags, in prose. | Keep, retitle toward the task, move the tab and MCP sections, list flags in the CLI reference |
| `backend-logs.md` | The install blocks are verbatim copies of the two integration READMEs; three field tables disagree (`stack` vs `StackTrace`, `Critical` only in one). `reporter.md` says `captureServerTraces` reads `X-Piwi-Trace` spans and links here; this page never mentions traces. | Make this page the single owner of the protocol and field table; thin the READMEs to install + link; document or drop the trace header |
| `importing-runs.md` | 17 lines of service-worker and quota internals under "Trying it in the demo". "Administrators only" is buried under Limitations. | Trim; move the prerequisite up |
| `packages/reporter/README.md` | 2,261 words, 36% of `reporter.md`, and stale: 23 option rows vs 33 in the code (missing `captureLocators`, `enabled`, `failOnFlakyTests`, `inspectOnFailure`, `pickLocatorOnFailure`, `runLabel` and four more); "Node 18 / Playwright 1.40" vs `engines >=20` and `^1.61.1`; a "Source layout" section with the wrong path. It is the copy most people read first. | Cut to about 80 lines: what it is, `init`, config, fixtures pointer, corrected requirements, links |

### Reading the results

Ten sidebar entries, roughly thirty features. Three pages are grab-bags: `ai-diagnosis.md` (six topics, of which
clustering, fix verification and fix plans need no model), `flaky-tests.md` (its own intro admits four topics; it also
holds run Changes and Quarantine), `ui-overview.md` (a manual that the house rules say must be a map).

Features a power user cannot find from the sidebar, with where they sit today:

| Feature | Where it hides |
|---|---|
| Quarantine with an exit ramp | Flaky tests → H2 "Quarantine, with a way out" |
| Compare two runs, baseline selector, Changes tab | Flaky tests → H2 "Changes"; also ui-overview and concepts |
| Regression signals (new regression / new flaky badges) | Flaky tests → H2 "Regression signals" |
| Slow tests, timeout opportunities, stale `test.slow()`, network analysis, Web Vitals | Flaky tests → H2 "Performance" |
| Spec health by file | Flaky tests → H2, one sentence, verbatim in ui-overview |
| Fix verification ("Did the fix work?"), three verdicts | AI diagnosis → H2 (needs no AI) |
| Fix plans, reproduce, bisect | AI diagnosis → H2/H3 (needs no AI) |
| Semantic merging, merge suggestions, cluster titles | AI diagnosis → H3 under "Failure clustering" |
| Triage: owner and known-issue link | AI diagnosis → H3 |
| Diagnosis history, staleness, validated patches, model roles, Ollama, Copy prompt | AI diagnosis → H2/H3 at L132–349 |
| Locator healing, the picker, the inspector overlay | Reporter (under "Sending results") → H2 at L328–408; a second copy in AI diagnosis |
| Clues, attempts diff, "why a card is empty", headline parser | Failure evidence → H3s under one 1,752-word H2 |
| Keyboard shortcuts `j/k/o/r/i`, bulk triage, the Setup checklist | UI overview → inside the "Home" paragraph |
| Webhook payload and HMAC signature, direct delivery to the fix author, digest, mute, owner filter | Notifications → H3s and bullets under "Channels" |
| Insights feed, wasted CI time, pass-rate heatmap, browser matrix, regression velocity, slow endpoints | Analytics → bold paragraphs, no headings, so no anchors and no outline |
| Automatic timeline markers (Playwright version changed) | Timeline markers → H2; the page also says markers live on a "Timeline tab" that the app does not have (they open from the Runs chart header) |

Duplication inside the group: the fingerprint definition ×4, the Changes-tab rule ×3, locator healing ×3 with the
same screenshot embedded twice, fix verification ×3, the Fix card ×3, timeouts and `test.slow()` ×4, hand-copied env
tables ×3. `offline-export.md` and `share-links.md` (480 and 550 words) each summarize the other twice; the reader's
question is "file or link?", which is one page.

### Running your instance

`deployment.md` is six pages glued together: Install, Hosted deploy, Production checklist, Backups, Monitoring,
Troubleshooting. Because it owns those H2s, `upgrading.md`, `database.md` and `storage.md` link back into it instead
of owning their topics, and the restore procedure ended up on the upgrading page under "Downgrading is not supported".

- **The hardening list has six copies and no home:** README "Before you expose it", deployment "Security",
  authentication "Security considerations", `SECURITY.md` "Hardening", `DOCKER_HUB.md` "Configuration", privacy
  "Secrets at rest". The secret-generation one-liner appears ten times.
- **Backup, restore and retention are on five pages:** back up on deployment, restore on upgrading, desktop backup on
  desktop, retention as an H3 on storage (linked from six pages), retention prose again on privacy, disk budgeting on
  deployment twice.
- `authentication.md` tells a Docker operator to `cd apps/application && cp .env.example .env` (a source-checkout
  step), spends 450 words on OAuth internals (PKCE, linking rules), and hides the multi-team feature under "Project
  access → Managing assignments".
- `storage.md` repeats four near-identical provider env blocks that the generator already emits, and hosts the
  retention and VACUUM documentation under "Storage management".
- **Factual drift to fix in the same pass:** `chown -R 1001:1001` at deployment L16 vs `chmod 777` at L504;
  `postgres:17-alpine` in deployment and `docker-compose.yml` vs `postgres:16` in `database.md`; "Node 22+" everywhere
  vs "Node 24+" in `packages/server/README.md`; tag examples `0.18.2` and `0.25.0` against 0.26.1.
- **Contributor material still on the site:** "Building locally", "Production build from source" (deployment), "From
  source" and "Source" (extension), "Architecture" (mcp), "How it's built" (analytics).

### Apps & integrations

- `desktop.md` hosts three features that are not "install the app": running tests from the app (600 words),
  reproduce and bisect, one-click MCP wiring. The bisect feature is reachable only via a link from `ai-diagnosis.md`.
- `extension.md` is the longest page with the fewest headings: nine tools (record actions, locator console,
  multi-pick, lint overlay, assertion suggester, session export, copy context for agent, matching functions, test
  functions) as one bullet list, so none is searchable or linkable. L193–215 document the dashboard's
  **test-functions catalog**, a server feature that has no other page; `mcp.md` links here for it.
- `mcp.md` is mostly right (45 tools, verified against the registry). "Agent skills" has a sidebar entry that is an
  anchor into a page whose title says MCP, though skills need no MCP and are installed by the reporter CLI.
  `skills add` is documented only here.
- **The `piwi` CLI has six subcommands and no page.** `init` is on getting-started and mcp, `gate` on ci (7 of 14
  flags), `select`/`run` on test-selection, `ai` on ai-steps, `skills` on mcp. A power user wanting "every flag of
  gate" has nowhere to go.
- `ide-integration.md` is fine. Its HTTPS mixed-content warning is an operator concern that belongs on the production
  checklist too.

### Recipes and the blog

The five recipes are the best pages on the site: one question as the H1, numbered steps, a screenshot per step,
"Requirements, honestly", and always a route for readers who cannot install the thing. They should become the model,
not the exception. Three of them break their own rule that feature pages stay the source of truth: mass-failure
re-explains fingerprint masking, flaky-cleanup re-explains the five root-cause classes with a table, broken-locator
re-documents the two pause-on-failure options with all their caveats. Each should link.

The blog post (5,104 words) is the best product overview that exists anywhere, and it is off the sidebar. It holds
three things that belong on the site as pages, not in a personal essay: the two design rules (the tool proposes, the
developer decides; deterministic first, AI second), the failure loop diagram (gather → group → explain → hand back →
verify), and the ecosystem diagram. Two of the seven diagrams in the repository are used only by the blog post; a
third (the demo architecture) too.

`ROADMAP.md`'s "What Piwi is for" states three jobs in order: keep the history, explain the failures, hand back a fix.
That is the missing top-level structure of the docs. Its "Recently shipped" list is also the most complete and
best-written feature inventory the project has, and it lives in a file named roadmap. Branch-aware runs and baselines,
the headline feature of 0.26, are documented only there: the word "branch" appears in no heading on the site.

### Illustrations

Nineteen screenshots and seven diagrams exist. Eleven pages use a screenshot; the landing page and the recipes use
most of them. Twenty-nine pages have no image at all, including getting-started, ui-overview, concepts, desktop,
extension, mcp, notifications, analytics, test-selection and ai-steps. The screenshot harness (`app:screens`) makes a
new illustration a one-line scene, so this is a backlog, not a tooling problem.

### Shipped but unfindable

Cross-checking the changelog's feature entries since 0.11.0 against the site, by key term:

| Feature (version) | Status on the site |
|---|---|
| Branch as a first-class dimension: filters, per-branch baselines, PR number (0.26) | **No heading.** One sentence in `notifications.md`; full description only in `ROADMAP.md` |
| Live step streaming on running rows (0.26) | **Undocumented** |
| Per-attempt outcomes and attempt chips (0.26) | Mention only: an H3 "Attempts" inside `evidence.md`'s long section |
| Fail on flaky, `failOnFlakyTests` (0.26) | Mention only: one options row |
| Timed-out vs interrupted run statuses (0.26) | Mention only: `ci.md` troubleshooting |
| Global channels, digests, mute (0.26) | Mention only: bullets under Channels |
| Auth rate limiting, `PIWI_TRUST_PROXY` (0.26) | Mention only: one bullet in `authentication.md`, one config row |
| Test functions catalog with object params (0.21) | Wrong page: `extension.md` "Connecting to a Piwi instance" |
| Setup page with capability checklist (0.21) | Mention only: one line in ui-overview |
| `setup_piwi` MCP prompt (0.21) | Mention only: `mcp.md` "Prompts", one paragraph |
| Desktop: environment pre-flight before a local run (0.23) | **Undocumented** |
| Desktop: OpenCode MCP auto-installer (0.21) | **Undocumented** |
| Desktop: unread badge and tray status (0.20) | **Undocumented** |
| AI usage panel and per-role connection tests (0.11) | **Undocumented** |
| Resolved database and storage paths in Settings (0.16) | **Undocumented** |
| Keyboard navigation, skip link, tab URL sync (0.15) | Mention only: one line in ui-overview "Home" |
| Visual diff, environment diff, page state, DOM snapshot (0.12) | Mention only: inline bold inside `evidence.md` bullets |
| Extension: assertion suggester, copy context, lint overlay, record actions, URL→project mapping, session export (0.21) | Mention only: bullets, no headings |
| API: `errorCode` on errors, `{ items }` envelopes (0.26) | Right place: belongs in the generated API reference, not the site |

## The proposed layout

Two readers, two entry points, one site. A new user needs a short ordered path that ends with a first failure
explained. A power user needs three things: a reference they can jump into, a page per feature with a stable
skeleton, and a place that lists everything the product can do with what each thing needs. The current single sidebar
of 38 entries serves neither: the new user sees everything at once, the power user sees titles that hide what they
want.

### Five sections, five sidebars

Use VitePress multi-sidebar (one sidebar per path prefix) with the sections in the top navigation, the way the Vite,
Vitest and Nuxt docs do. Each reader sees 6 to 27 entries, grouped, instead of 38. The sections are ordered by page
type, and inside Features by the three jobs the roadmap already names. *(new)* marks a page that does not exist
today; *(split)* marks a page carved out of an existing one; *(generated)* marks a page built at `docs:gen` time.

**Guide** — new user, read in order, ≤1,000 words each

1. What Piwi does *(new)* — the three jobs, the ecosystem and failure-loop diagrams lifted from the blog, the limits
2. Getting started — trimmed to pick a path, `init`, the manual config, first run
3. Core concepts — single owner of the baseline and branch rules
4. Capture fixtures — single owner of the fixtures snippet
5. Send results from CI — env vars, providers, sharding, run URL, troubleshooting
6. Your first failure, explained *(new)* — a walkthrough of one execution page
7. Where next → the feature map

**Features** — one feature per page, fixed skeleton, ≤1,200 words

- *Keep the history:* Dashboard map · Branches *(new)* · Import past runs · Analytics & timeline markers ·
  Notifications & alerts · Sharing an investigation *(split: offline export + share links)*
- *Explain the failures:* One failing execution · Failure clusters *(split)* · What changed in a run *(split)* ·
  Flaky tests & quarantine · Slow tests & wasted time *(split)* · AI diagnosis · Backend logs
- *Hand back a fix:* Locator healing *(split)* · Fix plans, reproduce & bisect *(split)* · Pull-request feedback &
  re-run *(split)* · CI gate *(split)* · Auto-heal PRs · Test selections & impact · AI steps
- *Use it from elsewhere:* MCP server · Agent skills *(split)* · Desktop app · Local runs from the desktop app
  *(split)* · Browser extension (one H3 per tool, plus a "needs a server?" table) · Test functions catalog *(split)* ·
  Open in IDE

**Operate** — operator, ≤900 words each

Install (Docker, Compose, Kubernetes, npx; one canonical Docker block) · Hosted one-click deploy *(split)* ·
Production checklist *(new)* · Authentication · Project access *(split)* · API keys *(split)* · Database · Storage ·
Retention & cleanup *(split)* · Backup & restore *(new)* · Upgrading · Troubleshooting *(new, consolidated)*

**Reference** — power user, tables, no budget

Reporter options & env vars *(split)* · Piwi CLI *(new)* · Configuration + generator *(generated)* · Test metadata:
tags & annotations *(split)* · Notification events & webhook payload *(split)* · MCP tools *(split)* · Keyboard
shortcuts *(new)* · Feature map *(generated)* · What's new *(generated)* · API docs (in-app, external link)

**Recipes** — anyone with a problem, one question each

The five existing recipes, fixed to link instead of re-explain, plus candidates: "Passes locally, fails in CI",
"Which branch broke it?", "Set up Piwi for a team", "Let an agent fix a test end to end", "A run is stuck as running".

Around 62 pages instead of 40, and fewer words in total: removing copies, internals, contributor material and
changelog phrasing takes an estimated 12,000 to 16,000 words out, and the new pages are mostly moved text. Every
page gets shorter; the site gets more findable. The blog stays in the top navigation.

A worked example. Today a reader who wants "quarantine" sees 38 sidebar entries, none of which says quarantine; they
open Flaky tests, scroll past scoring, classification, impact, stability trend and Changes, and find it as the sixth
H2. Search works only if they already know the word. After: Features → Explain the failures → "Flaky tests &
quarantine"; or the feature map row "Quarantine · needs: nothing · Project → Flaky tab"; or the recipe "Cut costly
flakiness", step 4, which links there.

### The feature map, generated from the app's own registry

The app already has this page. The Setup screen's "What's switched on" list reads
`apps/application/app/utils/setup-capabilities.ts`: twelve capabilities, each with an id, a title, a one-line
summary, how to enable it, and a docs link, plus a companion-tools card for the desktop app, the extension, the CLI,
MCP and the IDE hand-off. The docs have no equivalent, so a power user has no single place to learn what exists.

Extend that registry to every user-facing feature (about 45 rows) with three more fields: what it needs (reporter
only, capture fixtures, an LLM, an SCM token, the desktop app, the extension, admin), where it lives in the UI, and
the docs page. Then generate `features.md` from it at `docs:gen` time, exactly as `configuration.md` is generated
from the env-var registry, and let the Setup page read the same list. The existing drift test already resolves every
`doc:` target against a real heading, so a renamed page fails the build instead of breaking a link.

| Feature | Needs | Where | Docs |
|---|---|---|---|
| Failure clustering | reporter | Run → Failures tab; Project → Failures | Failure clusters |
| Locator healing | fixtures | Execution → Locator fix | Locator healing |
| Quarantine | reporter | Project → Flaky → Quarantine | Flaky tests & quarantine |
| AI diagnosis | LLM key | Cluster → Diagnosis | AI diagnosis |
| Pull-request feedback | SCM token, `PIWI_SITE_URL` | Settings → PR feedback | Pull-request feedback & re-run |
| Reproduce & bisect locally | desktop app | Execution → Run locally | Local runs |
| … | | one row per feature, sorted by the three jobs, generated | |

This one page is the discovery surface for the power user, the "where next" for the guide, and the source of the
README's feature bullets.

### A fixed skeleton for every feature page

`auto-heal.md` already has it: what it does exactly, requirements, enable it, limits. Make it the template and
enforce the budget. The "needs" row becomes a small Vue component (`<Needs fixtures llm />`) so a reader sees the
prerequisites before the first paragraph, the way the recipes spell them out in prose today.

| Part | Content |
|---|---|
| H1 | The feature, in the words a reader types |
| Needs row | Chips: reporter · fixtures · LLM · SCM token · desktop · extension · admin |
| What it does | ≤150 words, one screenshot from the scene harness |
| Where it is | Route and tab, one line, linking the dashboard map |
| How to use it | The guide part; H3 per action |
| Limits | What it does not do, plainly |
| Related | Recipe, reference rows, concepts anchor |
| Budget | 1,200 words; the drift test fails a page over budget |

What leaves the feature pages under this skeleton: algorithm internals (commit-selection scoring, SSE event names,
storage dedup layout), version history ("since 0.19", "no longer"), hand-copied env tables (link the generated
reference), and any explanation of another feature (link it).

### Single-source snippets

Put each shared block in `apps/docs/snippets/` and include it with VitePress code imports. One file, every page.

```
apps/docs/snippets/
  fixtures.ts            base.extend(piwiFixtures)      → 5 copies become 1
  reporter.config.ts     the twelve-line config         → 3 copies
  docker-run.sh          pull, chown, run               → 13 copies across 5 files
  docker-run.ps1         the PowerShell tab
  secret.sh              the randomBytes one-liner      → 10 copies
  init.sh                npx @piwitests/reporter init … → 8 copies

<<< @/snippets/fixtures.ts            in any page
```

The README, `DOCKER_HUB.md` and the two npm READMEs cannot include files. They keep one snippet each, and the drift
test gains a check that those blocks equal the snippet files byte for byte, the same way it already compares the
positioning line across surfaces.

### What's new, generated from the changelog

Power users who upgrade need "what changed and where do I read about it". Today that is spread between
`CHANGELOG.md` (commit subjects), `ROADMAP.md` "Recently shipped" (the best prose) and "since version" asides in
pages. Generate `whats-new.md` at `docs:gen` time from the changelog's feature entries grouped by minor version, and
retire version history from feature pages. A lint in the drift test can reject the phrasings that mark leaked
history: "no longer", "used to", "previously", "since version", "now supports".

### The README

The README has one reader: someone who landed on GitHub and decides in ninety seconds whether to open the demo or the
docs. Everything it says better than the docs stays; everything the docs say better becomes a link.

| Keep, in this order | Words |
|---|---:|
| Logo, positioning line, four links, badges | 60 |
| The live-run poster with its caption | 40 |
| "The problem it solves": four questions, five bullets (from the feature map, not hand-written) | 180 |
| Pick a path: the five-row table, one caveat sentence | 120 |
| Quick start: run it, add the reporter, run tests; one line each for `init` and fixtures | 150 |
| Before you expose it: three bullets, link to the production checklist | 60 |
| A quick tour: the six tiles | 60 |
| Published artifacts table | 120 |
| Status, community, contributing, license, disclaimer | 120 |
| **Total** | **≈ 900** |

Cut: the caveats paragraph on installers and hosting limits, the resource figures, the "Where this fits" section
(one sentence and a link to Why Piwi?), the "Documentation" link list (one line to the docs and the feature map), the
CI paragraph (one sentence), the in-app API docs paragraph.

## Migration plan

Three pull requests, in an order that keeps the site green at each step. The constraint that shapes it: about 60
in-app help links (`help-content.ts`, `setup-capabilities.ts`, `<DocLink>`) resolve to page-plus-heading targets,
concentrated on ai-diagnosis (9 anchors), flaky-tests (5), ui-overview (4) and evidence (3), and
`apps/application/tests/unit/docs-drift.test.ts` fails when one stops resolving. GitHub Pages has no server-side
redirects, so a moved page keeps a stub at the old path with a link and a client-side redirect.

1. **Trim without moving anything.** No URL changes, so no anchor work. Expected: 8,000 words removed, twelve
   factual drifts fixed.
   - Add `apps/docs/snippets/` and replace every pasted copy with an include; add the byte-equality check for README,
     DOCKER_HUB and the npm READMEs.
   - Delete contributor sections, changelog phrasing, algorithm internals and the six hand-copied env tables; add a
     runtime category (`PORT`, `HOST`) to the env-var registry first.
   - Fix the drifts: Node 18/22/24, postgres 16/17, chown vs chmod, the inspector contradiction, the Timeline tab,
     the npm option table, version examples, the two CI-provider lists, the missing `ai.*` options and five env vars,
     the fixtures naming ("Locator fix").
   - Cut `packages/reporter/README.md` to about 80 lines and `DOCKER_HUB.md` to quick start + tags + three security
     vars.
2. **Split and re-home.** URL changes. One commit per split so the drift test names exactly which literal to update.
   - Switch `config.mts` to multi-sidebar with the five sections; move files into `guide/`, `features/`, `operate/`,
     `reference/`, `recipes/`.
   - Split reporter, ai-diagnosis, deployment, flaky-tests, ci, authentication, desktop, extension, storage; create
     the new pages from moved text (Branches, Production checklist, Backup & restore, CLI, Test functions catalog,
     Locator healing, Fix plans, Failure clusters, What changed in a run, Slow tests & wasted time).
   - Update `help-content.ts` and `setup-capabilities.ts` literals in the same commit; leave stubs at old paths.
   - Rewrite ui-overview to ≤900 words; flatten `evidence.md` into H2s; merge offline-export and share-links; fix
     the three recipes that re-explain.
3. **Generate the discovery pages.**
   - Extend `setup-capabilities.ts` into a feature registry with needs, location and doc; generate `features.md`;
     point the Setup page and the README bullets at it.
   - Generate `whats-new.md` from the changelog; add the leaked-history lint and the per-page word budget to the
     drift test.
   - Add the `<Needs>` component and a scene per feature page that has no illustration (29 today);
     `app:screens:check` keeps them honest.
   - Shrink the README to the ~900-word shape above.

Effort, roughly: phase 1 is a day of careful deletion; phase 2 is two to three days because every split touches an
in-app literal; phase 3 is one to two days, most of it the registry.

## What to keep as is

- The recipes, their format, and the "route for readers who can't install the thing" rule. Extend, do not rework.
- `auto-heal.md` as the feature-page template.
- `concepts.md` as the vocabulary owner; give it the baseline and branch rules outright.
- `privacy.md`, `upgrading.md`, `ide-integration.md`, `database.md`, `timeline-markers.md` (after the tab fix):
  single-purpose, right length.
- The generated configuration reference and the generator; the proposal only adds two more generated pages in the
  same pattern.
- The drift test. It is the reason a restructure is safe; the proposal leans on it for three new checks.
- The voice rules in `apps/docs/AGENTS.md`. The restructure adds page-type rules and a budget; it does not change the
  tone.
- The landing page's "Where to go next", which already routes by intent and becomes the guide's opening.

## Appendix A: page-by-page disposition

| Current page | Words | Action | Goes to |
|---|---:|---|---|
| `index.md` | 847 | keep, trim cards | Landing; "Where to go next" links the five sections |
| `getting-started.md` | 1,721 | trim to ≤900 | Guide; drop source install, REST example, navigation table |
| `concepts.md` | 1,456 | keep; own baseline + branch rules | Guide |
| `comparison.md` | 1,203 | keep landscape + table; FAQ → links | Guide → What Piwi does / FAQ |
| `privacy.md` | 941 | keep; link hardening | Operate (also linked from Guide) |
| `reporter.md` | 6,318 | split four ways | Guide: Reporter setup · Reference: options & env · Features: Locator healing · Reference: Test metadata |
| `capture-fixtures.md` | 1,473 | keep; single snippet owner | Guide |
| `ai-steps.md` | 1,549 | keep; move "Intent in the dashboard" | Features → Hand back a fix |
| `ci.md` | 2,558 | split | Guide: Send results from CI · Features: PR feedback & re-run · Reference: CLI (gate) |
| `test-selection.md` | 1,792 | trim; flags → CLI | Features → Hand back a fix |
| `backend-logs.md` | 811 | keep; protocol owner | Features → Explain |
| `importing-runs.md` | 1,434 | trim demo internals | Features → Keep the history |
| `ui-overview.md` | 2,863 | rewrite to ≤900 | Features → Dashboard map |
| `evidence.md` | 2,781 | flatten into H2s; cut internals | Features → One failing execution |
| `ai-diagnosis.md` | 5,319 | split three ways | Failure clusters · AI diagnosis · Fix plans, reproduce & bisect |
| `flaky-tests.md` | 1,416 | split | Flaky tests & quarantine · What changed in a run · Slow tests & wasted time |
| `analytics.md` | 651 | promote widgets to H3; absorb timeline markers | Features → Keep the history |
| `timeline-markers.md` | 508 | fix "Timeline tab"; merge or keep | Analytics & timeline markers |
| `notifications.md` | 1,305 | reorder; payload → reference | Features + Reference: events & webhook |
| `auto-heal.md` | 532 | keep; the template | Features → Hand back a fix |
| `offline-export.md` + `share-links.md` | 1,030 | merge | Features → Sharing an investigation |
| `recipes/*` (6) | 4,832 | keep; fix three; add five | Recipes |
| `deployment.md` | 2,496 | split six ways | Install · Hosted deploy · Production checklist · Backup & restore · Troubleshooting · CONTRIBUTING |
| `upgrading.md` | 740 | keep; restore steps → backup page | Operate |
| `configuration.md` + generator | 3,191 | keep (generated); add runtime + retention categories | Reference |
| `authentication.md` | 2,275 | split | Authentication · Project access · API keys |
| `database.md` | 384 | keep; fix postgres tag | Operate |
| `storage.md` | 685 | split | Storage · Retention & cleanup |
| `desktop.md` | 2,182 | split | Desktop app · Local runs · (MCP wiring → MCP server) |
| `extension.md` | 2,725 | restructure; extract catalog | Browser extension (H3 per tool) · Test functions catalog |
| `ide-integration.md` | 551 | keep | Features → Use it from elsewhere |
| `mcp.md` | 2,271 | trim; extract skills + tool table | MCP server · Agent skills · Reference: MCP tools |
| `blog/how-piwi-was-built.md` | 5,104 | keep; lift two rules + two diagrams into "What Piwi does" | Blog |
| `README.md` | 1,860 | cut to ≈900 | Repository |
| `packages/reporter/README.md` | 2,261 | cut to ≈80 lines; fix requirements | npm |
| `packages/server/README.md` | 331 | fix Node version; drop env table | npm |
| `DOCKER_HUB.md` | 618 | trim to quick start + tags + 3 vars | Docker Hub |
| `integrations/*/README.md` | 932 | thin to install + link | npm / NuGet |

## Appendix B: duplication ledger

| Block | Copies | Where | Owner after |
|---|---:|---|---|
| `docker run … phenx/piwitests-server` | 13 | deployment ×6, README ×2, DOCKER_HUB ×2, getting-started ×2, database ×1; two variants disagree (`-d --name`; chown vs chmod) | `snippets/docker-run` |
| Secret one-liner (`randomBytes(32)`) | 10 | README, deployment, authentication ×2, privacy, SECURITY, DOCKER_HUB, server README, getting-started… | `snippets/secret` |
| Hardening list (auth on, secret key, HTTPS) | 6 | README, deployment, authentication, SECURITY, DOCKER_HUB, privacy | Operate → Production checklist |
| Hand-copied env-var tables | 6 files | deployment, storage, authentication, notifications, server README, DOCKER_HUB | `configuration.md` (generated) |
| wrapConfig trace/screenshot defaulting caveat | 6 | reporter ×5, getting-started | Reporter setup, once |
| Fixtures file | 5 | getting-started, reporter, capture-fixtures, README, backend-logs (+ npm README) | `snippets/fixtures` |
| Fingerprint definition | 4 | concepts, ai-diagnosis, recipes/mass-failure, ui-overview | concepts (short) + Failure clusters |
| Timeouts + `test.slow()` advisor | 4 | flaky-tests, analytics, ui-overview ×2 | Slow tests & wasted time |
| Locator healing explanation | 3 (+ screenshot ×2) | reporter, ai-diagnosis, concepts | Locator healing |
| Changes-tab / baseline rule | 3 | flaky-tests, ui-overview, concepts | concepts (rule) + What changed in a run (view) |
| Fix verification verdicts | 3 | ai-diagnosis, notifications, ci | Failure clusters |
| Fix card description | 3 | ui-overview, evidence, ai-diagnosis | Fix plans |
| Reporter basic config | 3 | getting-started, reporter, npm README | `snippets/reporter.config` |
| Run-URL outputs for CI | 3 | ci, npm README, reporter | Send results from CI |
| CI provider detection list | 2, inconsistent | reporter (6 providers), ci (13) | Send results from CI |
| Reporter options table | 2, npm stale by 10 rows | reporter, npm README | Reference → Reporter options |
| Backend-log field table | 3, disagree | backend-logs, nitro README, aspnetcore README | Backend logs |

## Appendix C: in-app anchors that must survive or be updated in the same commit

From `apps/application/app/utils/help-content.ts`, `apps/application/app/utils/setup-capabilities.ts` and
`<DocLink>` usages; checked by `apps/application/tests/unit/docs-drift.test.ts`.

| Page | Anchors referenced |
|---|---|
| ai-diagnosis | `#failure-clustering` `#did-the-fix-work` `#fix-plans` `#reproduce-and-bisect` `#scm-grounded-context` `#enabling-ai-diagnosis` `#what-a-diagnosis-contains` `#custom-instructions` `#context-limits-and-token-cost` |
| flaky-tests | `#flaky-test-detection` `#changes` `#performance` `#regression-signals` `#quarantine-with-a-way-out` |
| ui-overview | `#home` `#projects` `#project-detail` `#test-run-detail` |
| evidence | `#one-execution-diagnosis-first` `#clues` `#trace-powered-deep-views` |
| reporter | `#live-streaming` `#multiple-reports` `#locator-healing` (7 inbound) `#test-tags` `#installing-via-wrapconfig` `#finding-the-desktop-app-automatically` |
| ci | `#re-run-from-the-dashboard` `#pull-request-feedback` `#blocking-a-merge` |
| authentication | `#user-management` `#api-keys` `#oauth-google-github` `#roles` |
| notifications | `#channels` `#subscriptions` `#smtp-configuration` |
| storage | `#storage-architecture` `#storage-management` `#data-retention` |
| desktop / mcp / extension | `desktop#running-tests-from-the-app` `mcp#agent-skills` `mcp#authentication` `mcp#client-setup` `mcp#what-it-provides` `extension#connecting-to-a-piwi-instance` |
| page-level | `getting-started#fast-path-one-command` `getting-started#using-the-piwi-dashboard-reporter` `capture-fixtures` `importing-runs` `timeline-markers` `offline-export` `share-links` `backend-logs` `test-selection` `ide-integration` `configuration` `desktop` `extension` |
