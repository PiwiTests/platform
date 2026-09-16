# Dashboard app — agent guide

Rules for working inside `apps/application/` (the Nuxt 4 app, its Nitro server, the demo SPA and the MCP server).
Read [`../AGENTS.md`](../AGENTS.md) first for repo-wide conventions, and [`ARCHITECTURE.md`](ARCHITECTURE.md) when you
need the map of what lives where.

Everything below is a **rule or an invariant** — something you cannot infer by reading the code you happen to open.

## Layout & imports

- `app/` — Vue pages, components, composables, utils. Components live in domain subfolders and are auto-imported
  **without a folder prefix** (`pathPrefix: false`), so names must be globally unique.
- `server/` — Nitro API (`server/api/`), routes (`server/routes/`), utils, database, scheduled tasks.
- `shared/` — types, constants and pure helpers shared by app + server + demo. Import as `#shared/...` — **never**
  relative paths or `~~/shared/...`.
- `app/demo/` — the in-browser mirror of the server, used by the demo SPA.
- Cross-package pure logic lives in `@piwitests/core` (`packages/core/`) and is re-exported through thin `shared/*`
  shims so `#shared/...` paths never change. Do **not** put app-only (Nuxt/Drizzle/server) or reporter-only
  (Node-dependent) code there — `packages/core/tests/boundary.test.ts` enforces zero deps and no `node:` imports.

### Never duplicate logic between server and demo

`server/` and `app/demo/api/` mirror each other (same schema, same persist logic). Any helper that would otherwise
live in both must be extracted into `server/utils/` (the demo imports it via `~~/server/utils/...`) or `shared/`, and
imported by both. Exceptions only where the implementations genuinely differ (error handling, auth).

## Database

- Drizzle ORM, two dialects: SQLite via libSQL (default) and PostgreSQL via postgres.js, selected at runtime by
  `PIWI_DATABASE_URL`.
- **`server/database/schema.ts` is a conditional re-export only** — never edit it to add a table or column. Edit
  **both** `schema.sqlite.ts` and `schema.pg.ts`, then `npm run db:generate && npm run db:generate:pg`.
- ⚠ **Never hand-write a migration file or edit `_journal.json`** — always generate. A hand-made migration is silently
  skipped by the migrator.
- Dates are stored as Unix timestamps in SQLite.
- **Large per-case text payloads MUST go through `case_payloads`** (content-addressed, deduped per project):
  `upsertCasePayloads` on write, `inlineCasePayloads` / `resolveCasePayloadContents` on read (`server/utils/case-payloads.ts`).
  Never add a new fat inline text column to `test_runs_cases`. Legacy inline columns stay readable (readers coalesce
  payload → inline) and the demo writer keeps writing inline, which permanently exercises that fallback. GC lives in
  `server/utils/retention.ts`.

## Authentication & authorization

- **Roles are a TypeScript string enum** (`Role` in `shared/types.ts`): `ADMINISTRATOR`, `REPORTER`, `USER`. Use
  `Role.ADMINISTRATOR` — never raw string literals. When a DB `User` has `role: string`, cast: `user.role as Role`.
- **Auth is optional**, enabled by `PIWI_AUTH_ENABLED=true`. When disabled `requireAuth()` returns a virtual admin, so
  every endpoint keeps working.
- Two methods when enabled: session cookie (browser) or API key (Bearer / `X-API-Key`, `pd_` prefix).

### Per-route roles are declared once, in the route meta (MUST follow)

A route's `defineRouteMeta` declares who may call it via `openAPI['x-required-roles']`, and that single literal drives
**both** the `/docs` display and enforcement — `requireAuth(event)` reads the roles from the compiled route metas
(`server/utils/route-required-roles.ts`, matched with rou3 exactly as Nitro dispatches).

```typescript
defineRouteMeta({ openAPI: { tags: ['Projects'], summary: '…', 'x-required-roles': ['administrator', 'reporter'] } });

export default eventHandler(async (event) => {
  await requireAuth(event); // no roles argument — the meta drives it
});
```

- **It MUST be a string-literal array.** Nitro's meta extractor only folds inline `ObjectExpression` / `ArrayExpression`
  / `Literal` nodes, so a variable, function call or `Role.ADMINISTRATOR` enum member is silently dropped. Values must
  equal the `Role` enum's strings (`administrator` / `reporter` / `user`).
- Conventions: sign-in-only routes declare all three roles (renders "Any signed-in user"); a subset excluding `user`
  renders as elevated; public or token-authenticated routes omit the field — a lookup miss means "authenticated, any role".
- `requireAuth(event, roles)` still exists as an **explicit override** for handlers computing their own authorization
  (e.g. `users/[id].patch.ts` self-or-admin); the meta then documents but does not drive it.
- Streaming endpoints (`start`, `events`, `finish`, `case-files`) use **stream-token** auth instead of `requireAuth`.

### Project-level permissions

A project-assignment layer sits atop roles (`project_assignments`; per-project ids or global with `projectId = null`).

- `ADMINISTRATOR` → all projects, never filtered. `REPORTER` / `USER` → only assigned projects. No assignment = no access.
- `server/utils/project-access.ts`: `getProjectScope(db, user)` → `'all' | Set<number>`; `requireProjectAccess(event, projectId, roles?)`
  combines role + scope.
- **Route `:id` is the project id** → `requireRouteId(event, 'id', label)` then `requireProjectAccess`.
- **Scoped by a child entity** (run, case, cluster, test-run-case, diagnosis) → `requireResolvedProjectAccess(event, id, resolveXProjectId, notFoundLabel, roles?)`.
  It resolves the project, 404s a missing entity, then authorizes, and returns `{ db, projectId, user }` so no second
  `getDatabase()` is needed.
- List handlers take `scope` (`listProjects(db, scope)`, `getProjectMenu`, `getRecentTestRuns`, `searchProjectsTestRunsCases`);
  an empty set returns `[]` immediately.
- Write endpoints: existing project → `scopeAllows(scope, projectId)`; creating a new project → only when `scope === 'all'`.
- Plain `requireAuth` is only for endpoints with no project scoping. Role and scope refusals both 403 with an explicit message.

### OpenAPI annotations

Every endpoint gets a `defineRouteMeta({ openAPI: … })` block — non-negotiable, it is what feeds `/_openapi.json` and
`/docs`. Public endpoints declare `security: []`; everything else inherits the root-level
`security: [{ bearerAuth: [] }, { sessionCookie: [] }]` from `nuxt.config.ts` (whose `meta` is cast `as any` to allow
those fields — intentional).

## UI conventions

### Reuse the shared primitives

`app/components/shared/` holds the building blocks — **prefer them over re-implementing**. `SectionCard` /
`CollapsibleSectionCard` (headers + folding), `EmptyState` / `LoadingState` / `ErrorState`, `StatTile` + `StatTileGrid`
(never hand-rolled tile markup), `FilterToolbar`, `TableScroller`, `NavbarActions`, `BreadcrumbNav`, `ChartCard`,
`DurationValue`, `ErrorText` (never print a raw error string — it carries ANSI codes), `DiffPatch` / `DiffFile`, `HelpHint`, `DocLink`, `EnvManagedBadge` / `EnvManagedAlert`,
`SettingsField`, `OpenInIdeLink`. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for what each one does.

### Responsive / mobile (MUST follow)

The app must be usable at **~375 px with no horizontal page scroll**. Write mobile-first (stacked/narrow default, add
`sm:`/`md:`/`lg:` upward) and **never hide data** with `max-sm:hidden` — hide decorations only. For wide tables use
either a `md:hidden` card list + `hidden md:block` table (preferred for dense tables, see `ProjectTrendTable`) or a
`TableScroller`. On fixed-height detail layouts the mobile view must scroll as one document — never `overflow-hidden`
clipping a tall summary; `DetailPageLayout` handles this. **Verify new or changed screens at 375 px before committing.**

### Feature screenshots (MUST follow)

Every change that adds or visibly reworks user-facing UI ends with screenshots of the result: add or update a scene in
the `SCENES` registry of `scripts/take-feature-screenshots.mjs`, run it (`node scripts/take-feature-screenshots.mjs
<scene>` — it boots its own dev server, or pass `--url` to reuse one), and attach the captured images to your final
report or PR. Scenes tagged `desktop` write to `.screens/`, which is **gitignored — those images are a report artifact,
never committed**; the scene, kept current, is what's committed.

**Always send those screenshots to the user in the conversation too — not only attach them to the PR.** A user-facing
change is never reported as done without the pictures. When the change alters existing UI, send the before and the
after; capture both narrow (~390 px) and wide (~1280 px) when the change is about layout or responsiveness.

Scenes tagged `docs` are the exception: they write the committed illustrations in `apps/docs/public/screenshots/`, so
the scene name _is_ the image name and `npm run app:screens:docs` regenerates every one of them.

**Every scene declares the surface it captures** via `mode`: `web` (the default) is the dashboard as a browser serves
it; `desktop` is the Tauri shell — the server runs with `NUXT_PUBLIC_DESKTOP=true` and the built-in mocked Tauri bridge
is injected, so no shell build is needed (shape the mock per scene with `link` / `inspection`). Pick `web` for anything
a browser user sees: desktop-only chrome such as the sidebar's back/forward pair would otherwise misrepresent the app
in a full-viewport capture. A run covering both modes boots one server per mode, web first.

| Command                          | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `npm run app:screens -- <scene>` | Capture one scene (add `--url` to drive a server you already have) |
| `npm run app:screens:docs`       | Regenerate every committed docs illustration                       |
| `npm run app:screens:check`      | Fail if a docs image has no scene, or a scene's image is missing   |
| `npm run app:screens -- --list`  | Every scene with its mode, tags and the files it writes            |

**Target elements, not DOM shape.** A scene points at a `data-shot="…"` attribute placed on the container the image is
actually about (`of: '[data-shot="flaky-table"]'`), never at an XPath or nth-child path. Treat the attribute list as a
small API the harness depends on: add one when a scene needs it, keep the name describing the content, and do not
remove one without updating the scene. Capture waits on `settle()` (fonts, network, nothing still loading) rather than
on a timeout, and a capture that would not fit the viewport is an **error naming the viewport to use** — never a
silently cropped image.

`--freeze-now <iso>` pins the browser clock so relative timestamps stop moving and two runs produce byte-identical
PNGs; combine it with a freshly seeded database when a diff needs to mean a real UI change.

Annotations (boxes, arrows, numbered steps, callouts, spotlights, redactions) come from `scripts/screenshot-annotations.mjs`
— an in-repo SVG overlay, no runtime dependency. A scene with an `annotate` list writes both the plain image and a
`-annotated` one, so a docs page can choose. The label text is baked into the PNG, so keep it short and expect a
recapture to change it.

### Inline help (MUST follow)

Any new **block-level** shared component with a header MUST accept an optional `help?: HelpTopicKey` prop (typed from
`app/utils/help-content.ts`) and render `<HelpHint v-if="help" :topic="help" />`. Add copy by adding one entry to the
`HELP_TOPICS` registry — never hardcode hint strings at call sites. Document only non-obvious blocks (skip counters,
search boxes, basic CRUD forms, theme switcher). When adding a hint, **remove the always-on prose it replaces** so the
page gets quieter. If a `PIWI_*` env var can override the setting, set `envVars: [...]` (typed `PiwiEnvVarName[]`) so
the popover surfaces it for system admins.

Use `i-lucide-circle-help` for help and reserve `i-lucide-info` for informational/empty-state callouts. A topic's
`title` becomes the accessible name `Help: <title>` — avoid titles that are substrings of nearby button labels, or
Playwright's substring `getByRole('button', { name })` matches both.

### Settings surface (MUST follow)

Settings pages are driven by the `SETTINGS_PAGES` registry in `app/utils/settings-metadata.ts`; `useSettingsNav` and
`useSettingsEnvState` derive from it. To add a page or field: (1) add the env var to `shared/piwi-env-vars.ts`,
(2) add or extend the `HELP_TOPICS` entry with its `envVars`, (3) add the `fields` entry to `SETTINGS_PAGES`,
(4) render with `SettingsField`. Never hand-roll an env-managed `UAlert` or lock icon — use `EnvManagedBadge` /
`EnvManagedAlert`.

### UTable (MUST follow)

- **Always use template slots for cells** — never `cell:` callbacks with `h()` / `resolveComponent()`. The only
  exception is `createSortHeader<T>()` in `header:`. No `import { h, resolveComponent }` in table components for cells.
- Slot naming: `#${accessorKey}-cell="{ row }"` (or `#${id}-cell` for id-only columns); headers `#${accessorKey}-header`.
- Every sortable column uses `createSortHeader<T>('Label')` (`app/utils/index.ts`); non-sortable ones use a plain string.
- Sticky headers: the `sticky` prop + a `max-h-*` class on the table root. Do **not** wrap tables in `overflow-y-auto`.
- Row highlighting: `:meta="{ class: { tr: '…' } }"` — **not** `:row-attrs`, which Nuxt UI v4 dropped.
- Actions column: `{ id: 'actions', header: 'Actions' }` plus right-aligned `#actions-header` / `#actions-cell` slots.
- A table with ≥5 columns needs the mobile treatment from the responsive rule above.

### Typography and emphasis (MUST follow)

A screen is read top to bottom; emphasis tells the reader where to look, and it only works when it is rare. These
rules apply to every block a page opens on and to any card that states facts (the situation block, page headers,
summaries, list rows). Dense tables and code views are exempt only where a rule says so.

- **Four text styles per block, no more**: a heading (`text-lg sm:text-xl font-semibold text-highlighted`, at most
  one per block), a body (`text-sm text-highlighted leading-relaxed`, every sentence), a label (`text-xs font-medium
text-muted`) and a meta style (`text-xs text-muted` — qualifiers, facts, footers). Code — a locator, a path, a
  commit — is the body or meta style in `font-mono`, inheriting the color. Nothing else in the block: no
  `text-toned`/`text-dimmed` mixed with `text-muted`, no italics, no uppercase micro-labels, no `font-semibold` on a
  sentence.
- **Structure with layout, not with styling.** A block with several kinds of lines gets one label column
  (`SituationBlock` renders a `<dl>` with a 6.5 rem label column: _Most likely_, _Situation_, _State_, _Next_), so the
  reader scans labels, not formatting. A badge, a color or a bold span is never what tells two lines apart.
- **One accent color per screen: the primary action.** The solid `color="primary"` button is the only saturated
  element the reader is meant to click. Every other button is `color="neutral"` — `variant="outline"` for a secondary
  action, `variant="ghost"` for a disclosure or a menu trigger. No `warning`, `success` or `soft` buttons for ordinary
  actions.
- **Links inside a sentence keep the sentence's color**: `underline decoration-dotted underline-offset-2
hover:decoration-solid`. `text-primary` links belong in navigation lists and tables, not in prose.
- **Badges are for exceptions, at most two per screen** — the status chip and one exceptional state (_Quarantined_, a
  did-not-run cause). A strength, a confidence, an error type, a tag or a mark such as `@fixme` is plain meta text,
  never a chip. Two red chips on one screen is a bug.
- **Icons only where they carry meaning the text does not**: a status dot, a chevron on a disclosure or a menu, the
  check on a copied button. No icon in front of a label, a heading or a fact.
- **A locator inside a heading or a sentence is plain mono** (`<LocatorCode plain>`, `<FailureHeadline plain>`).
  Syntax highlighting belongs in code views — clue rows, the toolbox, the picker — where it competes with nothing.
- **Say a fact once, in one style.** When the same fact could be a chip and words, keep the words.
- **Measure it.** `npm run app:measure -- --json` reports `distinctTextStyles` inside the situation block. Keep it at
  or under 15 on the execution page and 12 on the cluster page; a change that raises it needs a reason in the PR.

### Other UI rules

- Sentence case headings and labels ("Test runs"), relative dates via date-fns (full timestamp on hover), human-readable
  durations (exact ms on hover), `DurationValue` where a tight `210ms` reads better than "0.21 seconds".
- **Absolute timestamps render client-only**: `prettyDateFormat` output never appears in SSR'd markup (the server host
  and the browser rarely share a time zone). Render the date with `ClientDate`, and wrap title-tooltip spans that bind
  `prettyDateFormat` in `ClientOnly`.
- **Page-level tab strips MUST match the Settings header**: `UDashboardToolbar` + `UNavigationMenu` with
  `highlight` (`settings.vue` is the reference). `DetailPageLayout` already renders it — pages using
  `DetailPageLayout` never touch the strip themselves, and no other page-level strip (UTabs pill, hand-rolled
  tablist) may be introduced. Content-level tab switches inside a card (e.g. an mcp code-client picker) are
  free to differ. The strip is a navigation menu, not an ARIA tablist: panels carry **no** `tabpanel` role,
  the active item carries `aria-current`, and inline `HelpHint`s render beside the strip for the active tab
  (never inside a navigation trigger's label — that nests buttons).
- Add a `title` attribute to any control whose purpose is not obvious from its label.
- **Clickable source paths**: render any repo-relative path or `file:line[:col]` with `OpenInIdeLink`, never a bare
  `<span>`/`<code>`. Pass `filePath` (+ `line`/`column`) or `location`, and thread `projectKey` (the Piwi project **id**)
  and `projectName` when in scope so per-project workspace overrides resolve. IDE preferences are a **per-browser client
  preference** (`useOpenInIde`, `piwi-ide-prefs`) — deliberately not in `SETTINGS_PAGES` and with no `PIWI_*` var, since
  the source lives on the user's machine. Only the JetBrains local-server method is detectable; `vscode://` /
  `jetbrains://` launches are fire-and-forget, so never report a confirmed "opened".
- **Data fetching in tab children**: for self-contained components rendered conditionally, use `watch` + `$fetch` with
  reactive triggers rather than `useFetch({ lazy: true })`, which may not fire before mount. Use `v-if` on tab-switched
  components for clean mount/unmount. Pass props from the page only for data already fetched at page level.
- `DetailPageLayout` renders summary + tab bar + panels; `tabPanelClass` lets a tab with self-scrolling content use
  `overflow-hidden flex flex-col` instead of the default `overflow-y-auto`.

## Environment variables

`shared/piwi-env-vars.ts` is the **single source of truth** for every `PIWI_*` var — name, description, category, type,
enum, default, min/max, `secret`, `relevantWhen`/`requiredWhen`, `since`/`until`, docs anchor. `PiwiEnvVarName`
(`keyof typeof PIWI_ENV_VARS`) is the typed union used everywhere, so a typo is a build error.

**When you add a `PIWI_*` var anywhere (nuxt.config, a server util), add it to `PIWI_ENV_VARS` in the same change with a
`since: '<next release>'` stamp.** `tests/unit/piwi-env-vars.test.ts` fails if a referenced var is unregistered, if a
post-0.14.0 var lacks `since`, or if a recorded `default`/`min`/`max` drifts from the code constants.

Do not enumerate env vars in prose anywhere — link to the registry or the generated
[configuration reference](../apps/docs/AGENTS.md) instead. Two facts worth knowing without opening it: the app runs with **no
env vars set**, and `PIWI_SECRET_KEY` is the master key for AES-256-GCM encryption of DB-stored secrets (AI keys, SCM
tokens) — recommended in production even without auth, falling back to an insecure development default.

### Emitting configuration

Resolved values are rendered into deployment snippets by a family of pure `(entries, opts) => string` emitters:

- `shared/env-format-base.ts` — the shapes (`EnvEntry`, `EmitOptions`), the per-syntax quoting rules and the constants a
  deployment must agree on (`DATA_MOUNT`, `HEALTH_PATH`, default image). No emitter of its own.
- `shared/env-format.ts` — the generic formats (dotenv, shells, compose, `docker run`, Kubernetes, systemd) plus the
  `ENV_OUTPUT_FORMATS` registry, and the **only** module anything outside `shared/` should import.
- `shared/deploy/<provider>.ts` — one module per hosting platform (railway, render, fly, koyeb, coolify), each owning
  that provider's quirks and nothing else.

Adding a provider is: a new `shared/deploy/*.ts`, an entry in `ENV_OUTPUT_FORMATS`, a re-export from `env-format.ts`,
and — if it should ship a committed manifest — a line in `scripts/generate-deploy-manifests.mjs`. These are stateless
functions selected through a data registry, deliberately not classes: there is no per-provider state to hold, and the
registry already provides the polymorphism a factory would.

Modules under `shared/` import each other with `#shared/...` specifiers, never relative paths — that is what lets the
same files load unchanged in Vite, Vitest and plain Node (the generator script relies on the `imports` map in
`package.json`).

## Adding the usual things

- **API endpoint** — a file under `server/api/` using `eventHandler()` + `getDatabase()`, with a `defineRouteMeta`
  `openAPI` block (including `x-required-roles`) and the right access helper from the authorization rules above.
- **Page** — a Vue file in `app/pages/` built on `<UDashboardPanel>`; register it in the nav links array in
  `app/layouts/default.vue` if it belongs in the sidebar.
- **Component** — a Vue file in the matching `app/components/` subfolder. Auto-import has no folder prefix, so the name
  must be unique repo-wide; follow the reuse and responsive rules below.
- **Unit test** — `tests/unit/*.test.ts` (Vitest). **E2E test** — `tests/*.spec.ts` (Playwright), with any project name
  registered in `shared/test-project-names.ts`.
- **AI test** — an E2E that needs a model goes against the mock OpenAI-compatible server in `tests/ai-diagnosis.spec.ts`,
  so the main suite stays at zero tokens. `tests/live/` is the only place that talks to a real provider: it is excluded
  from `playwright.config.ts`, has its own config, and runs from `npm run app:test:ai:live`. Assume the live model is
  text-only — that suite pins `PIWI_AI_MAX_IMAGES=0`.

## Extension points

Where to add things in subsystems whose wiring spans several files:

| Change                        | Touch                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Flaky root-cause category     | `classifyFlakyRootCause()` + keyword arrays in `server/utils/flaky-classify.ts`; `rootCause` on `FlakyTest` (`types/api.ts`); `FlakyTestsList.vue` colour map                                                                                                            |
| Flaky impact scoring          | `getProjectFlakyTests` (`shared/handlers/projects.ts`) — sorts by impact desc; `impact`, `wastedCiMinutes`, `avgFailedDurationMs` on `FlakyTest`                                                                                                                         |
| Regression signals            | `computeRegressionSignals()` (`server/utils/compute-regression-signals.ts`), called from `finish.post.ts`; surfaced by `getTestRun` / `getTestRunCase` mappers                                                                                                           |
| A computed AI-context section | Update the `SectionId` union (`ai-context.types.ts`), `DIAGNOSIS_SECTIONS` (`diagnosis-sections.ts`) and `DiagnosisContextCoverage` (`types/api.ts`) **in one batch** before writing the section builder                                                                 |
| Sharding behaviour            | See the sharding invariants below                                                                                                                                                                                                                                        |
| Blob-report import            | `server/utils/blob-report.ts` (parse) + `import-evidence.ts` (recovered evidence); everything after parsing in `shared/handlers/import-runs.ts`; endpoints `test-runs/import[.post]` and `import/check.post.ts`; page `projects/[id]/import.vue` + `useBlobReportImport` |
| Trace-file import             | `server/utils/trace-import.ts` — reconstructs an execution from a trace's `context-options`/`error` events; grouped into one run by the `importGroup` field on `test-runs/import.post.ts`                                                                                |

## Subsystem invariants

These are the rules that a reasonable change would otherwise break.

### SCM providers — one source for hosts and URLs

Provider hosts and web URLs live only in `shared/scm-urls.ts` (`detectScmHost`, `commitUrl`, `compareUrl`,
`fileUrl`, `branchUrl`); provider API calls live only in `server/utils/scm/`. Anything that needs a provider gets it
from `createScmProvider` / `scmProviderForUrl` (or the pure link helpers from `#shared/scm-urls`) — never a hand-written
`github.com` / `gitlab` / `bitbucket.org` host switch or a re-implemented `/commit/<sha>` path. Import the
`ScmProviderName` union from `#shared/scm-urls`; never re-declare `'github' | 'gitlab' | 'bitbucket'`.
`tests/unit/scm-single-source.test.ts` scans `server`, `shared`, `app` and `types` for provider host literals and the
union outside an explicit allow-list, so a new home for either is a visible diff to that list.

### Failure clustering & fingerprints

The grouping key is `computeErrorFingerprint` (`shared/error-fingerprint.ts`) over error type + normalized message +
masked locator. **The stack frame is intentionally NOT hashed** (kept as `topFrameFile` for display) so one root cause
groups across spec files. Add volatile-token masking inside `maskVolatile` (message) / `maskSelector` (locator).

When you change normalization, **bump `FINGERPRINT_VERSION`** and keep the demo mirror
`shared/demo/demo-fingerprint.mjs#computeDemoFingerprint` in sync — a regex-for-regex plain-Node port that exists
because the seed script runs under plain Node and cannot resolve the TypeScript module. A version bump is
**non-destructive**: `reclusterFailureFingerprints()` re-fingerprints existing clusters from their stored `sampleError`
on startup, updating in place or merging collisions via `mergeFailureClusters()`, so triage state survives.
Re-run `npm run app:seed:demo` afterwards.

### Timed-out tests fold into `failedTests`

There is no `timedOutTests` column on `test_runs`. Timed-out cases (`'timedOut'` per-case from Playwright; `'timedout'`
in the declared `TestCaseStatus` union) fold into `failedTests` so `total = passed + failed + skipped + didNotRun`
reconciles and matches the UI. **Every ingest site MUST use the helpers in `shared/utils/test-counts.ts`** —
`sumFailedAndTimedOut(body.failedTests, body.timedOutTests)` for body-field sites (`finish`, `submit`, `upload` + the
demo `app/demo/api/reporter.ts` mirror) or `countFailedFromTally(insertedStatusCounts)` for per-status-tally sites
(`events` + its demo mirror). Never write `failedTests: body.failedTests` directly.

### Locator healing

Ranked replacement locators for a broken selector. Pure generation/scoring/fingerprint logic lives in
`@piwitests/core` (`locator-generation`, `locator-fingerprint`, `locator-healing-types`), re-exported by the `shared/*`
shims for `#shared/...` and bundled into the reporter by tsup. **There is no hand-mirrored copy** —
`tests/unit/reporter-core-identity.test.ts` asserts the reporter re-exports the exact core functions, so a
re-implementation fails the suite.

Rules when touching it:

- **Capture** happens in the reporter fixtures (mirrored by the dogfood `tests/fixtures.ts`). The in-page probe
  `probeElementAttrs` is serialized into the browser via `evaluate`, so it cannot reference module closures: the ARIA
  role maps (`TAG_TO_ROLE` / `INPUT_TYPE_TO_ROLE`) arrive as fields of the `evaluate` argument — **do not re-declare
  them inside the probe**, and have the dogfood fixture import and call it rather than re-inlining.
- The live input `value` is **deliberately never captured** (secret leak).
- Snapshots ride the wire as the transient per-case `locatorSnapshots` field (`shared/types.ts`, **never a column**);
  every ingest site passes it to `persistRunCases` → the shared `upsertLocatorSnapshots` (`server/utils/locator-healing.ts`,
  used by server **and** demo). **Two invariants live in that helper:** rows are deduped by `(caseId, location)` before
  the batch upsert (a repeated call site otherwise breaks PostgreSQL's `ON CONFLICT DO UPDATE`), and the stale-location
  purge runs **only for cases whose run passed**, so a run that failed early does not delete valid prior-success rows.
- `elementAttrs` inside `upsertLocatorSnapshots` is the **storage whitelist** — a new wire field on
  `LocatorSnapshot.element` (e.g. `rolePosition`, `ancestors`) must be folded in there or it is silently dropped.
  No migration needed.
- Chained alternatives carry the **leaf** method with flat args (`anchorTestId` / `anchorSelector` / `anchorRole`) and
  **never a `name` key** — `fingerprintFromSnapshot` reads the element name from the first `getByRole` alternative's args.
- The signature must hash identically on both sides: capture via `locatorSignature(method, args)`, look up via
  `locatorSignatureFromExpression(expr)` (`shared/locator-healing.ts`).
- **Stale gating:** when the stored fingerprint's name is provably gone from the failing ARIA, `resolveStoredHit` sets
  `priorNameMayBeStale` and excludes the failing locator and old-name-derived alternatives from the recommendation pool
  (an empty pool yields `recommendation: null` — never a stale pick). `LocatorHealingPanel.vue` MUST NOT recompute a
  client-side recommendation when that flag is set; it would resurrect the stale pick.
- Dashboard picks persist via the shared `saveLocatorPick`: the failing locator's identity is re-derived **server-side**
  from the stored error with the same helpers the lookup ladder uses — never trust client-parsed args. A pick that
  cannot be keyed returns `not-persisted` (surfaced as a toast) rather than being silently dropped. Any authenticated
  project member may save one, so the endpoint deliberately carries no role list.
- Re-run `npm run app:seed:demo` after changing the captured or stored shape.

### Sharding

- **runLabel** is detected from CI env vars by `MetadataCollector.detectCiRunLabel()` (reporter) and `detectCiRunLabel()`
  (helpers); users override via `PiwiDashboardOptions.runLabel`; `createGlobalSetup` applies it too.
- When `runLabel` is set, `computeInstanceId(projectName, runLabel)` replaces the `hostname|projectName` key so all
  shards share one instanceId.
- Each shard gets its own stream token, stored in `RunEventBus.runStates[id].shardTokens`. **Any new streaming endpoint
  MUST validate shard tokens alongside the primary one** — check `cachedState.shardTokens?.has(body.streamToken)` as a
  fallback, via `validateAndReviveRun()` with the `isShardToken` callback.
- Server-side merge: `/start`, `/setup` and `/submit` reuse an existing run when `shardTotal > 1` and an active run with
  the same `instanceId` exists; `/finish` accumulates counters with SQL `+` and only sets the final status when
  `shardsFinished === shardTotal`. `cancelInstanceRuns()` skips sharded runs when `isShardedRun: true`.

## Adding a field to test run data

The full chain, in order:

1. `shared/types.ts` — add to the payload(s).
2. Both `schema.sqlite.ts` and `schema.pg.ts` (a large text/JSON field must go through `case_payloads`, not a new
   inline `test_runs_cases` column) → `npm run db:generate && npm run db:generate:pg`.
3. `types/api.ts` — frontend types.
4. All API handlers: `submit`, `upload`, `[id]/events`, `[id].get`, `[id]/stream.get`, `test-cases/[id].get`.
5. `server/utils/persist-run-cases.ts`.
6. **Reporter**: `src/types/collected.ts` (`CollectedTestCase`) + `src/types/wire.ts` (`WireTestCase`), accumulate in
   `src/public/reporter.ts` (`onTestBegin`/`onTestEnd`), project in `src/internal/submit/serializer.ts` —
   `toWireTestCase` for per-case, `serializeRun` for run-level (the single source of truth for the run body, used by
   both `uploadJSON` and `uploadWithFiles`).
7. **Demo**: `scripts/generate-demo-seed.mjs`, `app/demo/api/reporter.ts`, `app/demo/api/test-runs.ts`,
   `app/demo/api/test-cases.ts`, `app/demo/simulator.ts`.
8. UI components that consume it.
9. `npm run app:seed:demo`.

`shared/types.ts` is the wire contract; the server imports it directly. The reporter shares only the **leaf shapes**
via `@piwitests/core/wire` (bundled in, so no monorepo path leaks into the published `.d.ts`) and keeps its own
`WireTestCase`, pinned to the server payloads by `tests/unit/wire-shared-drift.test.ts`. **Never `import`
`apps/application/shared` from the reporter** — use `@piwitests/core`.

## Demo mode

`PIWI_DEMO_MODE=true` builds a fully client-side SPA: a service worker intercepts `/api/` and serves from in-browser
sql.js (WASM SQLite) through Drizzle, persisted in IndexedDB. `app/demo/api/router.ts` dispatches; SW and main thread
share `app/demo/db.client.ts`.

- **`public/demo/seed.sql` is NOT committed** — gitignored, regenerated on demand (`npm run app:seed:demo`, and by CI in
  `docs.yml` before the demo build). Only `seed.version.json` (SHA-256 of the SQL + timestamp) is tracked. Generation is
  deterministic (seeded PRNG), so two runs with no source changes are byte-identical. After editing
  `scripts/generate-demo-seed.mjs` or `shared/demo/failure-stories.mjs`, re-seed and commit the generator plus the
  updated `seed.version.json`; never stage `seed.sql`.
- Staleness detection injects `demoDataVersion` into `runtimeConfig.public`; the layout compares it to the IndexedDB
  copy and offers a "New demo data available" reset.
- The run simulator (`DemoSimulator.vue` + `app/demo/simulator.ts`) replays the reporter's streaming protocol against
  the in-browser endpoints. Failing tests **must reuse a seeded story's exact error text** from
  `shared/demo/failure-stories.mjs` so the simulated failure fingerprints identically and joins the real cluster
  instead of spawning a lookalike — hand-copied error strings must never drift from the fixture source again. Live
  updates flow over a BroadcastChannel (`app/demo/run-events.ts`), not SSE.

### Demo data requirements

Any feature adding a DB column, an API response field or a UI-visible change updates the demo in four places:
`scripts/generate-demo-seed.mjs` (seed the columns), `app/demo/api/` (mirror the response fields), `app/demo/simulator.ts`
(emit new streaming fields), and `apps/docs/` — then `npm run app:seed:demo`.

**`shared/demo/failure-stories.mjs` is the single source of truth for every seeded failure**: one story per cluster
carries the failing spec line, a reporter-faithful error string, the app source files it traces to, and a suggested-fix
patch _derived_ from those same lines — so error, snippet, patch and demo SCM source cannot drift. Locator-centric
stories also carry an authored failure-time DOM snapshot served by `app/demo/api/dom-snapshot.ts` with precedence over
the committed trace ZIPs (whose recorded pages are too bare for the locator picker); the ZIP-parse path stays the
fallback. Demo AI diagnosis is **data-grounded, not canned prose** — rebuilt from the seeded DB and each cluster's real
stats, with suggested patches genuinely `validatePatch`-checked. Demo-only AI/SCM code stays out of `shared/handlers/`
so the canned SCM never enters the server bundle; the one shared piece is the version-snapshot row shape
(`shared/handlers/diagnosis-versions.ts`). `tests/unit/demo-seed-consistency.test.ts` guards the whole chain.

## MCP tool conventions (MUST follow)

MCP tools (`server/utils/mcp/tools.ts`, route `server/routes/mcp.post.ts`, definitions `shared/mcp-tools.ts`) return
JSON consumed by AI coding agents; consistency saves the agent from guessing.

**Authorization** — every handler is `(db, params, ctx)` with `ctx: McpContext = { user, scope }` (the route resolves
`scope = getProjectScope(db, user)` once). Every project- or entity-scoped tool MUST enforce scope: `assertProject(ctx, projectId)`
when the arg _is_ a project id, or `checkEntityScope(db, ctx, id, resolveXProjectId)` for run/case/cluster/diagnosis ids
(`'not-found'` → return null/empty; out of scope → throws). Cross-project feeds filter by `ctx.scope`. Write/triage
tools MUST also call `assertWriteRole(ctx)`.

**Reuse** — prefer a shared handler (`#shared/handlers/*`) over re-querying. When a REST endpoint has inline logic a
tool also needs, extract it to a shared handler and call it from both. Never duplicate.

**Field naming** — `id` only for the top-level entity; `testCaseId` for stable test-case identity; `executionId` for a
per-run execution record (`testRunsCases.id`), spelled `testRunsCaseId` inside `affectedTestCases` / `locatorHealing`;
`runId` for run references in sub-entities; always `filePath` (never `file`) and `startedAt` (never `start`/`runStart`).

**Response shape** — list tools and paginated sub-lists return `{ items, nextCursor }` (`PaginatedResponse<T>` in
`shared/mcp-tools.ts`). `dropNulls()` strips `null`, `''` and `[]` before serialization. Error text truncates to 400
chars via `trunc(msg, 400)`.

**Validation** — `numericParam(raw, name)` for every numeric param; `numericCursor(raw)` for cursors (never
`Number(cursor)` inline); `clampPageSize(raw)` (1–50, default 10); `paginatedItems(items, pageSize, getCursor)` to wrap
a `pageSize + 1` fetch. **`getCursor` must read the POST-map field name** (`r.executionId`, not the pre-map `r.caseId`)
— reading a renamed field yields an `"undefined"` cursor that crashes the next page. In-memory-filtered list paths must
apply the cursor in memory on the same axis as the emitted cursor, or paging loops on page one.

## Running the app locally to verify a change

The step-by-step recipe, the seeded routes worth opening and the pitfalls live in the `run-app` skill
(`.claude/skills/run-app/SKILL.md`) — read it first. The short form: `npm run app:screens -- --route <path> --expand
--height 2400` screenshots any page against a throwaway server it boots and seeds itself, and `npm run app:seed:dev`
followed by `npm run app:dev:bg` gives you a server on port 3000 to iterate against.

When you need to see a change working — a UI tweak, a flow, a screenshot — run a **plain (non-demo) dev server backed by
a dev DB seeded from the demo data**:

```bash
cd apps/application
npm run app:seed:demo                            # 1. generate public/demo/seed.sql (skip if present)
mkdir -p .data && npm run db:migrate             # 2. create + migrate an empty dev DB (.data/piwi.db)
npm run app:seed:dev                             # 3. load sample data (server must be stopped — DB lock)
NUXT_IGNORE_LOCK=1 npx nuxt dev --port 3002      # 4. plain dev server, auth disabled by default
```

`app:seed:dev` creates and migrates a missing or empty dev DB itself, so step 2 is only needed when you want a clean
schema by hand; it is idempotent (`INSERT OR IGNORE`), and to refresh stale rows wipe `.data` and re-run it. It also
copies the committed evidence media (`public/demo/{screenshots,traces,videos}`) into the storage directory under the
`demo/…` paths the seeded rows reference, so the failure pages serve the real screenshot, trace and video through the
file endpoint rather than a broken image. Drive the
app with Playwright — `scripts/take-feature-screenshots.mjs` (`--route`, `--url`) is the working harness, and its
`settlePage` is the wait strategy to copy: the run and execution pages hold an SSE stream open, so a bare
`networkidle` never resolves, and the page scrolls inside a panel, so `fullPage` captures a single viewport.

**Caveats that cost real debugging time:**

- **During development, keep ONE dev server on port 3000 and run Playwright against it** — start it with
  `npm run app:dev:bg` (background, waits for readiness, logs to `.data/dev-server.log`, refuses if the port is
  taken by the desktop app). The Playwright config reuses an existing port-3000 server
  (`reuseExistingServer: !process.env.CI`), and Nuxt's HMR picks up your edits, so you iterate without re-booting
  a server per test run. Watch `dev-server.log` for compile errors (a template error shows up there, not in the
  browser); restart only when the server crashes or you touch `nuxt.config`/server plugins. The feature-screenshot
  harness reuses the same server (`--url`).

- **Do NOT use `PIWI_DEMO_MODE=true` for the dev server.** Demo mode builds the static SPA; it is not a `nuxt dev` flag.
  To verify a change _in the demo_, build it and drive the build:
  `npm run app:generate:demo && npm run app:check:demo:runtime`. That serves `.output/public` from the `/demo/` sub-path
  it is really deployed under, with its service worker installed — the only setup in which base-path, worker-scope and
  demo-handler bugs appear. `app:check:demo` alone only compares route patterns, and stays green while every page is
  broken.
- **Anything the UI opens outside `$fetch` MUST carry `useRuntimeConfig().app.baseURL`** — `window.open`, an `href`, a
  download URL. The demo is served from `/demo/` and its service worker only intercepts that prefix, so a root-relative
  `/api/...` escapes the scope and 404s against the static host. `fileApiUrl` and `getTraceViewerUrl` exist for exactly
  this reason.
- **Test cases live under runs #21+.** Runs #1–20 have 0 cases (their rows target a migration-only table the dev schema
  drops). Query a real id: `node scripts/db-query.mjs "SELECT id FROM test_runs_cases ORDER BY id DESC LIMIT 5"`.
  Clusters with data: #3, #4, #5, #7, #8; project #2 (`api-integration`) owns clusters 3 and 4.
- **Brand icons** (`i-simple-icons-*`) resolve from the iconify CDN at runtime; with no outbound network they render
  blank. Only the `lucide` collection is bundled locally. Environment limitation, not a bug.

## Demo evidence media (committed binaries)

Demo screenshots (`public/demo/screenshots/*.png`), trace ZIPs (`public/demo/traces/*.zip`) and failure videos
(`public/demo/videos/*.webm`) are **real Playwright artifacts**, captured against the small self-contained
app-under-test pages in `scripts/demo-pages.mjs` — never a real app, and never the Piwi dashboard itself (traces embed
full page snapshots, and a screenshot of the _results UI_ is not believable evidence of a failing _test_). Each page
mirrors one story in `shared/demo/failure-stories.mjs` closely enough (headings, labels, button names) that the evidence
reads as the same app the seeded data describes.

- Screenshots: `node scripts/take-demo-screenshots.mjs` — serves the fake pages from a throwaway HTTP server, no dev
  server or seeded DB needed.
- Traces + videos: `node scripts/record-demo-media.mjs` — drives each page with a real interaction reproducing its
  story's failure mode, per the `SCENARIOS` table in the script (add an entry for a new story's media). Traces record
  with `sources: true` so the call-stack evidence view has real content.
- Commit the binaries, then `npm run app:seed:demo` to re-wire the `files` rows with real sizes.
- Playwright must be loaded through `createRequire(import.meta.url)` from the repo-root `node_modules` — an ESM
  `import` from outside the workspace fails. Point at the Chromium in `PLAYWRIGHT_BROWSERS_PATH` when the environment
  provides one instead of a downloaded browser.

The seed generator wires media generically: every story with `media.screenshot`/`trace`/`video` attaches it to the
**most recent failing execution of each member case** (`max(test_runs_cases.id)` per cluster+case, matching how
`shared/handlers/failure-clusters.ts` picks `recentTestRunsCaseId`). A story with no `media` intentionally has none.

## Testing the API by hand

```bash
curl -X POST http://localhost:3000/api/test-runs/submit \
  -H "Content-Type: application/json" \
  -d '{"projectName":"my-project","status":"passed","startTime":"2024-01-01T12:00:00Z","duration":120000,"totalTests":10,"passedTests":9,"failedTests":1,"skippedTests":0,"testCases":[{"title":"should login","status":"passed","duration":1500,"location":"tests/login.spec.ts:10:5"}]}'
```
