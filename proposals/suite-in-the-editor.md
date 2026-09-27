# The suite in the editor

A plan to bring what Piwi knows about a suite to the place a developer changes code: the terminal before a push, the
pull request, VS Code, and the JetBrains IDEs (WebStorm, Rider, IntelliJ IDEA). **Track A** predicts, from a diff,
which test locators the change breaks, and rewrites them. **Track B** records which application source files each test
executes, so any file can answer "which tests reach me?". **Track C** is one editor service that holds the logic, and
**Tracks D and E** are thin clients for VS Code and the JetBrains IDEs.

**Status.** Proposed 2026-09-27. Nothing is built. Track A needs no capture change. Track B adds an opt-in capture, one
payload column on `test_runs_cases` and one table. Tracks C–E add a workspace package, a VS Code extension and a
JetBrains plugin, and a commitlint scope (`ide`); a catalog of what the editors can do after their first release
follows the tracks. New wire fields, endpoints, a CLI command and a published extension
API freeze at 1.0 (one new D entry in [`1.0-stabilization.md`](1.0-stabilization.md)).

**Summary.** Tested elements answers "which tests reach this element?" on the live page. This plan answers the same
question where the change is made, before anything runs. Renaming a button breaks every test that finds it by its name,
and today the developer learns that from a red CI run twenty minutes later. Track A reads the diff, lists the strings
it removes or renames (a label, an `aria-label`, a test id, a placeholder, a translation), and matches them against
every chain in the project's locator index with Playwright's own text rules. Each broken chain comes with its tests,
its call sites, and, for a rename, the same chain with the new string, applied in place with `--fix`. Track B makes
"which tests reach this file?" answerable for application code, not only test code: an opt-in capture records the
source files whose functions ran during each test, from Chromium's JavaScript coverage. It is stored per test and
feeds test selection's impact-from-diff, change coverage, and the editors. Track C is a language server (`@piwitests/
editor`) built on `@piwitests/core`. VS Code and the JetBrains IDEs both run it, so both show the same thing: the
health of each test and the tests behind each locator line, a warning on the line that renames a string tests depend
on with a quick fix that updates them, and "reached by 12 tests" on application files.

## What the reader gets

```
$ npx @piwitests/reporter preflight
piwi preflight · Acme Mugs · main · 212 locators from 48 tests · diff against HEAD

2 locators this change breaks
  src/components/CheckoutButton.vue:14   "Pay now" → "Pay"
    getByRole('button', { name: 'Pay now' })          click · 3 tests · likely
      tests/pages/checkout.page.ts:31     → getByRole('button', { name: 'Pay' })
  src/locales/en.json:88                 "Apply coupon" removed (key checkout.coupon.apply)
    getByText('Apply coupon')                        click · 1 test · likely
      tests/coupon.spec.ts:12             no replacement: the string is gone

9 tests reach the changed files · run them: npx @piwitests/reporter preflight --run
Apply the 1 rewrite: npx @piwitests/reporter preflight --fix
```

```
CheckoutButton.vue  (VS Code or WebStorm)
  Reached by 6 tests · 1 flaky · last failed 2 days ago · Run them            ← file summary
  12 │   <button class="pay" @click="pay">
  13 │-    Pay now
  14 │+    Pay                ⚠ 3 tests find this button by "Pay now"         ← warning on the changed line
                             Quick fix: Update 1 locator in checkout.page.ts
checkout.page.ts
  31 │  this.pay = page.getByRole('button', { name: 'Pay now' })
                  3 tests · click · passed 48/50                             ← locator line summary
  40 │  this.row = page.locator('.cart-row').nth(2)   ⚠ brittle: position, CSS class
                             Quick fix: getByRole('row', { name: /Mug/ }) (as of the last passing run)
```

- Track A alone gives `piwi preflight` in a terminal or a pre-push hook, a section in the pull-request comment for the
  breaks CI did not run into, rename-aware locator healing, and an MCP tool so an agent checks its own UI change.
- Track B adds the tests that reach any application file, in preflight, in test selection and in change coverage.
- Tracks C–E add all of it to the editors, live as you type.

## What exists

- **The locator index.** `GET /api/projects/:id/locator-index?branch=` (`server/api/projects/[id]/locator-index.get.ts`,
  built by `getLocatorIndex` in `server/utils/locator-usages.ts`) serves every chain a project's tests used, with each
  use's test, actions, call sites (`file:line:col`, relative to the directory the reporter ran in), Playwright
  projects, branches and pages (`LocatorIndex` in `packages/core/src/locator-index.ts`). Caps: 200,000 rows and 20,000
  locators, with `truncated` set. It needs a `pd_…` key in `X-API-Key`. The extension caches it for 60 seconds.
- **Chains are parsed in core.** `parseLocatorChain`, `scanLocatorChain`, `locatorCallValues` and `renderLocatorChain`
  (`packages/core/src/locator-chain.ts`); `extractLocatorExpressions` reads locators out of test source
  (`locator-index.ts`). `assessLocatorChain` judges stability (`locator-stability.ts`).
- **Playwright's text rules exist once, in the extension.** `attributeMatcher` and `nameTest`
  (`apps/extension/src/content/locator-engine.ts`) and `textMatcher` (`engine-aria.ts`) implement case-insensitive
  substring, exact and regex matching with Playwright's whitespace normalization, and the engine is checked against real
  Playwright (`locator-engine.spec.ts`). They are pure string functions.
- **Snapshots keep an element's anchors.** `locator_snapshots` stores, per test and call site, the element's tag, text
  (80 characters) and `CAPTURED_ATTRIBUTES` (id, class, name, data-testid, placeholder, alt, title, aria-label,
  aria-labelledby, role, type, href…), its accessible name, and up to ten ranked `alternatives` from the last passing
  run. There is no branch column.
- **A line edit exists.** `buildLocatorEdit` (`apps/application/shared/locator-edit.ts`) replaces one locator call on a
  source line. Auto-heal PRs and the fix plan use it.
- **A locator-break detector exists, unused.** `detectLocatorBreakAhead` (`shared/handlers/scenario-gaps.ts`) takes
  `{ removedAttr, filePath, callSites }`. It has no production caller: the change-coverage path does not carry hunks.
- **Change coverage drops the patch.** `provider.fetchChanges(base, head)` returns `ChangedFile` with an optional
  `patch` (100 KB per file, 300 files), but only the file name and line counts reach `shared/handlers/change-coverage.ts`.
  A changed file reaches a test through a snapshot call-site file, the spec file itself, or a Nuxt/Nitro convention
  (`fileRouteTarget`, `filePageTarget` in `shared/graph.ts`) matched to `reaches` edges.
- **Test selection's impact knows only test-side files.** `resolveImpact` (`server/utils/selection-impact.ts`) maps a
  changed file to tests through the spec file and `test_source_frames` of each test's latest execution. Frames are
  recorded only for failed tests, from the error stack (at most four in-project frames), so they are test and helper
  files. An unmapped source file widens the result to the whole suite. `piwi select impact --base <ref>` and
  `piwi run impact --base <ref>` run `git diff --name-only <base>`.
- **Server files are partly known.** The Nitro instrumentation reports the matched route's handler file on its root
  span (`piwi.handler`); the Test Map stores `handled-by` edges from route to handler file, and `reaches` edges from test
  to route (`server/utils/graph-ingest.ts`). ASP.NET Core reports no handler.
- **The Test Map already plans client code reach.** Its design record lists "sampled V8 coverage" as a later, opt-in
  item (`proposals/scenario-gaps.md`, "New data", item 8): Chromium coverage resolved through source maps into `file`
  nodes with origin `coverage`, on one scheduled job, always called observed reach and never coverage. Its entry
  condition is about gaps; this plan gives it a second reason (impact, preflight and the editors) and designs it.
- **The CLI.** `packages/reporter/src/cli/index.ts` dispatches `init`, `skills`, `gate`, `report`, `select`, `run`,
  `probe` and `ai`. Connection is `--server-url`/`PIWI_DASHBOARD_URL`, `--api-key`/`PIWI_API_KEY`,
  `--project`/`PIWI_PROJECT_NAME`, resolved through `/api/projects/menu` (`internal/support/selection-client.ts`).
  Exit codes: 0 ok, 1 the test run failed or the gate was violated, 2 could not resolve. The reporter (not the CLI) also
  discovers a running desktop app through `~/.piwi/desktop.json`.
- **The pull-request comment.** `buildPrComment` (`shared/pr-feedback.ts`) renders, in order: counters, selection,
  split locks, new failures, pre-existing, flaky, new clusters, fixed, uncovered changes (`renderChangeCoverage`, at
  most 10 listed), then the notes. GitHub, GitLab and Bitbucket.
- **Healing sources.** `prior-run`, `fingerprint`, `cross-test`, `element-match`, `aria-snapshot`
  (`LocatorHealingSource` in `packages/core/src/locator-healing-types.ts`).
- **No editor integration exists.** Open in IDE builds `vscode://file/…` and `jetbrains://…/navigate/reference` links
  (`app/utils/ide-links.ts`); nothing runs inside an editor. No parser is a declared dependency anywhere
  (`@vue/compiler-sfc`, `@babel/parser` and `oxc-parser` are present only transitively). `@piwitests/core` has no
  dependencies.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Break prediction runs where the diff is: in the CLI and the editor, against the index fetched from the instance. The server runs it only on the pull-request diff it already fetches. | The source never leaves the machine for a local check. The index is already served to the extension with the same key. |
| D2 | Anchors are read by a lexical scanner, not a parser: quoted literals, attribute values, text between tags, and the values of changed lines in translation files. | One scanner covers JSX, Vue, Svelte, Angular, Razor and plain HTML, with no new dependency in core. A parser would pin frameworks and versions. |
| D3 | A chain breaks when one of its calls matched a removed string and does not match what replaced it, under Playwright's own rules: substring and case-insensitive by default, whitespace-normalized, exact when `exact: true`, regex when given one. Those rules move from the extension's engine to core. | "`'Pay'` still matches `'Pay now'`" must come out the same in preflight, the overlay and Playwright. |
| D4 | A rewrite is the same chain with the old string replaced by the new one, offered only for a one-to-one rename. Nothing else in the chain changes. A regex argument gets no rewrite. | It keeps the author's method and style. When no single new string replaces the old one, a guess would be worse than "no replacement". |
| D5 | Two confidence levels. **Likely**: the string was an attribute value, tag text or translation value, and (with Track B) a test using the locator reaches the changed file. **Possible**: a bare literal, or no reach data. Preflight lists likely first and folds possible. | Common words ("Save", "Next") appear in many files. Reach is what tells this "Save" from another. |
| D6 | Preflight never fails a push by default. `--strict` makes predicted breaks exit 1. | A prediction is a warning until it is proven. Teams that trust it opt into blocking. |
| D7 | Code reach is opt-in (`captureCodeReach`), Chromium-only, recommended on one scheduled job rather than every run, and sends repository-relative file paths only. It is the Test Map's planned "sampled V8 coverage", under the Test Map's vocabulary: observed reach, never coverage. | JavaScript coverage exists only in Chromium, and costs time. Reach changes slowly, so a nightly sample keeps it current. Paths are no more than the Test Map already stores. |
| D8 | A file counts as reached when at least one of its functions ran, excluding a module's top-level code and code that maps to no source. | Importing a module runs its top level, so counting it would make every eagerly loaded file "reached" by every test. |
| D9 | All editor logic lives in one language server in TypeScript over `@piwitests/core`. VS Code and the JetBrains IDEs are thin clients over it. | One implementation, the same answers in both editors, and the core functions the CLI and the extension already use. |
| D10 | What the language protocol covers goes through it: diagnostics, quick fixes, hover. File and line summaries go through custom requests that each client renders natively (VS Code CodeLens, JetBrains Code Vision). | Not every client renders every protocol feature the same way. Summaries are where the two editors differ most. |
| D11 | The editors read the same settings as the CLI (`PIWI_DASHBOARD_URL`, `PIWI_API_KEY`, `PIWI_PROJECT_NAME`, from the environment or the workspace `.env` that `piwi init` writes), then the desktop app's discovery file, then their own settings with the key in the editor's secret store. | A project set up for the reporter works in the editor with no second setup. |

## Track A — Locator break ahead

### A1. Anchors from a diff

`packages/core/src/diff-anchors.ts` exports `parseUnifiedDiff(text)` and `extractDiffAnchors(files, options)`.

1. **Input.** A unified diff: `git diff --unified=0 <base>` locally, or the provider's per-file `patch` on the server.
   Test files are skipped: a file under the Playwright test directory, or any file that appears as a call-site file in
   the index. A change to a test file changes the locator itself, which the next run records.
2. **Tokens.** For each removed and added line, the scanner reads:
   - quoted literals (`'…'`, `"…"`, and template literals without `${}`);
   - attribute values: `name="v"`, `name='v'`, `name={'v'}`, `:name="'v'"`, `[name]="'v'"`, and `name: 'v'` inside an
     object literal, for the attributes locators use: the project's test id attributes, `id`, `name`, `aria-label`,
     `placeholder`, `alt`, `title`, `role`, `value`, `label`;
   - text between tags on the line (`>Pay now<`, or a line that is only text inside markup), with whitespace collapsed.
3. **Translations.** A changed line in a JSON, YAML, `.properties`, `.po` or `.resx` file under a translations path
   (default globs `**/{locales,locale,i18n,lang,translations}/**`, `**/*.resx`; configurable) gives a `translation`
   token with its key path and value. When a template changes a key (`t('checkout.pay')` → `t('checkout.payNow')`),
   the scanner resolves both keys through the translation files in the working tree (default locale first, configurable)
   and emits their values.
4. **Removed, added, renamed.** Within a hunk, a token on a removed line with no equal token on an added line is
   removed, and the reverse is added. A removed and an added token of the same kind (the same attribute name, both
   text, the same translation key) that are the only such pair in the hunk form a rename `before → after`.
5. **Output.** `DiffAnchor { file, line, kind: 'attribute' | 'text' | 'literal' | 'translation', attribute?, key?,
   before, after? }`. Strings shorter than two characters, pure numbers and strings over 200 characters are dropped.

Not seen: a name built by concatenation or interpolation, a name assembled from several elements
(`<button>Pay <b>now</b></button>`), and a string defined in one file and rendered from another through a variable. The
last one is still found as a `literal` anchor wherever the string is defined, at `possible` confidence.

### A2. Matching against the index

`packages/core/src/locator-text-match.ts` holds `textMatches`, `nameMatches` and `attributeMatches`, moved from the
extension's engine; the engine imports them back. `packages/core/src/locator-break.ts` exports
`predictLocatorBreaks(anchors, index, { testIdAttributes, reach? })`:

| Call | Compared with | Rule |
|---|---|---|
| `getByTestId(v)`, `locator('[data-testid=v]')` and the project's other test id attributes | attribute anchors of those attributes | exact |
| `getByRole(r, { name })` | text, translation, literal, and `aria-label`, `title`, `alt`, `value` anchors | `nameMatches` (substring, case-insensitive; exact with `exact: true`; regex) |
| `getByText(v)`, `filter({ hasText })`, `locator(…, { hasText })` | text, translation, literal anchors | `textMatches` |
| `getByLabel(v)` | text, translation, literal, `aria-label` anchors | `textMatches` |
| `getByPlaceholder`, `getByAltText`, `getByTitle` | `placeholder`, `alt`, `title` anchors, translations, literals | `textMatches` |
| `locator('#id')`, `locator('[name=v]')` | `id`, `name` attribute anchors | exact |

A chain is **broken** when a call's value matched an anchor's `before` and does not match its `after` (or the anchor
has no `after`). A chain whose call matches both (`getByText('Pay')` against `Pay now` → `Pay`) is not broken. The
result is `LocatorBreak { anchor, locator, entry, uses, confidence, rewrite? }`, with the uses carrying tests, actions,
call sites and pages from the index. With code reach (`reach`: the files each test reaches), a break is `likely` only
when one of its tests reaches the anchor's file; without it, attribute, text and translation anchors are `likely` and
literals `possible` (D5).

`detectLocatorBreakAhead` in `scenario-gaps.ts` becomes a thin adapter over `predictLocatorBreaks`, so the Test Map's
change-time detectors and preflight share one function.

### A3. The rewrite

For a rename, the call's string argument is rewritten: equal to `before` (after whitespace normalization, ignoring case
when the call is not exact) → `after` verbatim; containing `before` → `before` replaced by `after` inside it. The chain
is rendered with `renderLocatorChain`. `buildLocatorEdit` moves to `packages/core/src/locator-edit.ts` (the app
re-exports it) and makes the line edit at each call site. When the call site's line does not hold the literal (the
string comes from a constant or a helper argument), preflight lists the test files that contain the literal
(`git grep -n --fixed-strings`) as "edit by hand" instead of editing.

### A4. `piwi preflight`

`packages/reporter/src/cli/preflight.ts`, registered in `cli/index.ts`:

```
npx @piwitests/reporter preflight [--base <ref>] [--branch <name>] [--fix] [--run] [--strict] [--json]
```

1. `--base` defaults to `HEAD` (uncommitted changes). A pre-push hook passes `--base @{upstream}`. `--branch` picks
   the index to compare with (default: the project's default branch).
2. It fetches the locator index (existing endpoint) and caches it in `.piwi/locator-index.json`, keyed by project and
   branch, so it works offline on the last good copy with a warning, as `piwi run` does with its selection cache.
3. It runs A1–A3 and prints the breaks, likely first, with at most 20 listed and a count of the rest.
4. It asks `POST /api/projects/:id/selections/impact` for the tests that reach the changed files and prints the count.
   `--run` runs them, plus the tests that use the broken locators, through the same spawn path as `piwi run`.
5. `--fix` applies the rewrites whose call-site lines hold the literal, and prints each edited file.
6. Exit codes: 0, or 1 with `--strict` when a likely break is left unfixed, or 1 when `--run`'s tests fail; 2 when the
   index cannot be fetched and there is no cache.

Call-site paths are relative to the directory the reporter ran in. Preflight finds the Playwright config
(`playwright.config.{ts,js,mjs,cjs}`) from the working directory upward and resolves call sites against it;
`--test-root` overrides. A husky recipe goes in the docs, on one line, portable to Windows.

### A5. The pull request and healing

1. **Keep the patch.** `computeRunChangeCoverage` (`server/utils/scm/change-coverage.ts`) keeps each file's `patch`,
   runs `extractDiffAnchors` and `predictLocatorBreaks` against the index of the pull request's base branch, and stores
   the result on the run's change coverage as `locatorBreaks`.
2. **The comment.** `renderLocatorBreaks` in `shared/pr-feedback.ts` adds a section after Uncovered changes, at most 10
   listed. A break whose tests failed in this run is left out (its failure is listed above with its fix); a break whose
   tests ran and passed is left out (the tests were updated). What remains is what this run did not exercise: tests
   outside the selection, another shard set, or a nightly suite. The section follows the Test Map's capability like
   Uncovered changes.
3. **Rename-aware healing.** A new healing source `diff-rename` (`LocatorHealingSource`) is offered first when a failing
   execution's chain and call site appear in its run's `locatorBreaks` with a rewrite. Its confidence is high, so an
   auto-heal pull request can use it. The evidence line names the diff: "`Pay now` became `Pay` in
   CheckoutButton.vue:14".

### A6. For agents

- MCP tool `predict_locator_breaks { projectId, diff, branch? }` returns the breaks and their edits. An agent sends its
  own working diff; the tool runs the same core function server side.
- The `run-the-right-tests` skill gains a first step: run `piwi preflight --fix` after a UI change, then run the tests it
  names.

## Track B — Code reach

### B1. Capture

In the capture fixtures, with `captureCodeReach` on (`PIWI_CAPTURE_CODE_REACH`, off by default, forced off with
`collectPerformanceMetrics: false`, the same bridge as `capturePageInventory`):

1. On the first instrumented page of a Chromium test, `page.coverage.startJSCoverage({ resetOnNavigation: false })`;
   at teardown, `stopJSCoverage()`. Other browsers record nothing.
2. For each script entry, the reporter works out original files, in this order:
   - **A module served by path.** A URL whose path names a file (Vite's `/src/components/Pay.vue`, `/@fs/<absolute>`),
     with the query dropped. The path is tried against the roots in `codeReachRoots` (default: the Playwright config's
     directory and the repository root) and kept if the file exists.
   - **A bundle with a source map.** The `sourceMappingURL` comment at the end of the entry's `source` (an inline
     `data:` URL, or a URL fetched once per worker through the page's request context, 20 MB cap, 5 s timeout). A small
     VLQ decoder in core (`packages/core/src/source-map.ts`) maps each executed function's start offset to an original
     source; `webpack://<ns>/./` and similar prefixes are stripped before resolving against the roots.
3. A file counts when a function whose start maps into it ran (count > 0), excluding the script's top-level function and
   functions that map to no source (D8). `node_modules` and files outside the repository are dropped.
4. Paths are made relative to the repository root (`git rev-parse --show-toplevel`, once per worker) and sorted. At most
   2,000 files per test. The list goes out as the `piwi-code-reach` attachment and the `codeReach` wire field.

Decoded maps and the file list of each script are cached per worker by script URL and content hash, so a bundle shared
by every test is decoded once.

### B2. Storage and the index

1. **Per execution.** A content-addressed payload through `case_payloads`, with a `code_reach_payload_id` column on
   `test_runs_cases`, following the page-inventory and locator-pages checklist in `apps/application/AGENTS.md`
   (attachment, collected and wire types, serializer, submit and upload handlers, `persist-run-cases.ts`, retention's
   `payloadUnreferenced`).
2. **Per test.** Table `code_reach (project_id, test_case_id, branch, file, origin, last_seen_run_id, last_seen_at)`,
   unique on `(test_case_id, branch, file)`, indexed on `(project_id, file)`. `origin` is `client` (from B1) or `server`
   (the handler files of the routes the test reached, from the Test Map's `reaches` and `handled-by` edges, so a Nitro
   backend gets server reach with no new capture). Built on ingest the way `locator_usages` is: rows for the test's
   latest execution on that branch replace the previous ones. A run without code reach (the option off, or a
   non-Chromium project) leaves the client rows as they were, so a nightly sample serves the whole day.
3. **In the Test Map.** When the Test Map is on, the client rows are also written as `file` nodes with origin `coverage`
   and `reaches` edges from the test, which is the item its design record planned. The `code_reach` table stays the
   source of truth, so impact and the editors work when a project declines the Test Map.
4. **Endpoints.** `GET /api/projects/:id/code-reach?file=&branch=` lists the tests that reach one file (suffix match, as
   `pathsMatch` does). `GET /api/projects/:id/code-index?branch=` serves the whole map for editors:
   `{ files: string[], tests: LocatorIndexTest[], reach: Array<{ file: number, tests: number[], origin }>, builtAt,
   truncated }`, with tests shaped as in the locator index.

### B3. What it feeds

- **Test selection.** `resolveImpact` reads `code_reach` beside `test_source_frames`. A changed code file inside a
  directory the project's code reach has seen, and reached by no test, maps to no test and is listed as unreached; it no
  longer widens the result to the whole suite. Files outside those directories widen as today.
- **Change coverage.** A fourth reach path: a changed file reached by a test through `code_reach`.
- **Preflight and the editors.** Confidence (D5), "N tests reach the changed files", and the file summaries of Track C.

## Track C — The editor service

A new workspace package, `packages/editor` (`@piwitests/editor`), a language server over stdio built with
`vscode-languageserver` and bundled into one file with esbuild. Both clients ship that file, so nothing is installed in
the user's project.

1. **Connection** (D11). It reads the environment and the workspace `.env`, then `~/.piwi/desktop.json`, then the
   client's settings. The project is chosen by name or picked from `/api/projects/menu` on first use.
2. **Roots.** It finds each Playwright config in the workspace; call sites resolve against the config's directory, and
   code reach paths against the repository root. Multi-root workspaces get one context per config.
3. **Data.** The locator index, the code index and the test catalog (`GET /api/projects/:id/test-cases`, with an exact
   `file` filter added), each cached in memory and refreshed on a timer (5 minutes) and on demand. A branch setting
   follows the checked-out branch when the index has it, and the default branch otherwise.
4. **Diagnostics and quick fixes.**
   - In test files: `assessLocatorChain` on each locator the index knows at that line. Brittle is a warning, watch is a
     hint. The quick fix uses the stored alternatives of that call site: those `assessLocatorChain` rates stable,
     picked with `recommendLocatorFix`, labeled "as of the last passing run". They come from a new read endpoint,
     `GET /api/projects/:id/locator-alternatives?file=`.
   - In application files: on open and on each change (debounced 500 ms), the diff of the buffer against `HEAD`,
     through `extractDiffAnchors` and `predictLocatorBreaks`. A break is a warning on the changed line, and its quick fix
     is one workspace edit across the test files (A3).
5. **Hover.** On a locator line: its tests with their last status, the actions, the pages. On a warned line in an
   application file: the broken chains and their call sites.
6. **Custom requests** (D10). `piwi/fileSummary { uri }` returns the lines to show above the file and above each test or
   locator line, with the command each one runs. `piwi/testsForFile { uri }` returns the tests reaching a file.
   `piwi/runArgs { tests }` returns the command line to run tests, as `piwi run` builds it.

## Track D — VS Code

`apps/vscode`, a workspace package with `vscode:build`, `vscode:typecheck`, `vscode:lint`, `vscode:test` and
`vscode:package` scripts, published to the Visual Studio Marketplace and Open VSX (for Cursor and VSCodium).

- Starts the server with `vscode-languageclient`, on workspaces that contain a Playwright config.
- CodeLens from `piwi/fileSummary`: the file summary, each `test(…)`'s health, each locator line's uses. Clicking opens
  the test case in the dashboard or runs the tests in a terminal.
- Commands: **Piwi: Connect**, **Refresh**, **Run the tests that reach this file**, **Open in dashboard**. The API key
  goes to `SecretStorage` when it is not in the environment.
- Tests: unit tests for the client glue, and an integration suite with `@vscode/test-electron` on a fixture workspace
  against a stub instance, in CI under Xvfb.

## Track E — JetBrains IDEs (WebStorm, Rider, IntelliJ IDEA)

`apps/jetbrains`, a Gradle project in Kotlin with the IntelliJ Platform Gradle Plugin. Like `apps/desktop`, it is not an
npm workspace.

- **The server.** The plugin registers the bundled server through the platform's LSP API (`LspServerSupportProvider`)
  and runs it with the project's Node.js interpreter setting. The LSP API is available in WebStorm, Rider, IntelliJ IDEA
  Ultimate and the other commercial JetBrains IDEs; that sets the plugin's compatibility range.
- **What the LSP client renders.** Diagnostics, quick fixes and hover come from the server as they do in VS Code.
- **Native parts.** Code Vision providers (the inlay lines above a file, a test, a locator) call `piwi/fileSummary`.
  Actions mirror the VS Code commands, with a Run configuration for the tests that reach a file. The API key goes to the
  IDE's `PasswordSafe`.
- **Rider.** Rider bundles WebStorm's JavaScript and TypeScript support, so web files behave as in WebStorm. The server
  is registered for the file types A1 reads, including `.cshtml`, `.razor` and `.resx`, so a Rider user editing an
  ASP.NET Core view or its resources gets the same warnings; the ASP.NET Core instrumentation already reports on those
  backends.
- Published to the JetBrains Marketplace, signed in CI. Tests with the platform's test framework on a fixture project.

## What the editors can grow into

Tracks C–E ship the core: health and uses on test and locator lines, brittle warnings, and live break prediction.
Once one service runs in both editors, most of what Piwi knows can reach the line it is about. This is the catalog,
ordered by the moment in a developer's day, each with where its data already lives. Everything goes through the editor
service (D9), so each item is one server feature and two small renderings.

### While writing a test

| Opportunity | What the developer sees | Data |
|---|---|---|
| **Locator completion** | Inside `page.getBy…(`, the chains the suite already uses on the page this test visits, most used first, with their stability | locator index with pages (`uses[].pages`), `assessLocatorChain` |
| **Function completion** | The project's page-object methods and helpers whose URL pattern matches the page, as snippets with their parameters | function catalog (`GET /api/projects/:id/test-functions`) |
| **Send from Piwi Picker** | A locator picked, or a flow recorded, in the browser lands at the cursor, rendered with the project's settings (`format: 'body'`) | the steps converter; a local endpoint the editor opens (VS Code: an HTTP listener in the extension host; JetBrains: a handler on the IDE's built-in server), paired once with a token |
| **Annotations** | Completion for `piwi:owner` (CODEOWNERS entries), `piwi:feature` (the project's features), `piwi:priority`, and tags already in use | `CODEOWNERS` in the workspace, `list_tags`, the Test Map's feature nodes |
| **AI steps** | On `page.piwiLocator('the email field')`, the committed resolution, its stability and last heal on hover; a quick fix inlines it as a plain locator | the committed `__piwi__` artifacts in the workspace, `piwi ai check` |
| **Register a function** | On a page-object method, **Add to the function catalog**, so recordings and the converter call it | `POST /api/projects/:id/test-functions`, or the AI extraction endpoint |

### After CI ran

| Opportunity | What the developer sees | Data |
|---|---|---|
| **CI failures in the Problems panel** | The failures of the latest run on the checked-out branch, at their failing lines, with the clue as the message | latest run per branch (`latest-run`), failed executions, error location and source frames, clues |
| **Heal in place** | On a failing locator, the recommended replacement as a quick fix (the same edit auto-heal pull requests make) | locator healing for the execution, `buildLocatorEdit` |
| **Apply a fix plan** | On a cluster's failure, the validated patch as a previewed workspace edit, then its verify command in a terminal | `GET /api/failure-clusters/:id/fix-plan` |
| **Open the evidence** | From a failing line: the trace in Playwright's trace viewer (downloaded, `npx playwright show-trace`), the failure screenshot on hover, the execution page | traces and screenshots of the execution |
| **Status bar** | The branch's latest run, live while it runs: passed, failing, flaky, the gate verdict | the run event stream, the gate result |
| **Known issue** | On a failing test with a linked ticket, the ticket and its status on hover; **File an issue** otherwise | `entity_links`, `create_issue` |

### Living with a flaky or slow test

| Opportunity | What the developer sees | Data |
|---|---|---|
| **Flaky lens** | Above a flaky test: its score, wasted minutes, root-cause class, and its top suspect once Flake Lab exists, with **Reproduce** (`piwi flake`) and **Verify fix** | flaky list; [`flake-lab.md`](flake-lab.md) |
| **Quarantine** | Above a quarantined test: days in quarantine and the passing streak toward release, with **Release**; **Quarantine** on a flaky one | quarantine endpoints |
| **Timeout advice** | On a test with a stale `test.slow()` or a timeout far above its p95, a quick fix with the suggested value and the time it saves | `GET /api/projects/:id/timeout-opportunities` |
| **Selections** | Which saved selections include this test; **Run selection…** from the command palette | selections resolve and preview |

### While changing application code

| Opportunity | What the developer sees | Data |
|---|---|---|
| **Page summary** | On a page file (Nuxt `pages/**`, and the other conventions the Test Map knows): the tests acting on that page, its locators, and those rated brittle | `filePageTarget`, the locator index's page keys |
| **Handler summary** | On an API handler: the tests that call its route, its p90 in tests, whether a probe found a fault no test noticed | `handled-by` and `reaches` edges, slow endpoints, probes |
| **Gaps where they are** | On a page or handler with open scenario gaps: the gap, and **Draft the missing test**, which opens the draft as a new spec | `list_scenario_gaps`, `draft_scenario` |
| **Uncovered changes** | A gutter mark on changed lines of files no test reaches, before the pull request says so | code reach (Track B), change coverage |
| **API shapes** | On a handler or a `fetch('/api/cart')` call: the response shape the tests observed, its history, **Copy as TypeScript type**; a warning when an edit removes a field tests saw | [`api-contract-drift.md`](api-contract-drift.md) |

### With a bug report

| Opportunity | What the developer sees | Data |
|---|---|---|
| **Bug reports view** | The open reports of the project, with their steps and evidence | [`bug-report-to-failing-test.md`](bug-report-to-failing-test.md) |
| **Write the failing test** | **Add as test** renders the report's committed spec into the bugs folder with the converter | the steps converter, `piwi bug <id> --write` |
| **Run it** | **Run with Playwright** in the desktop app, or in the editor's terminal | desktop repro requests |
| **The spec knows its bug** | Above a test with `piwi:bug 37`: the report's status, ticket, and "looks fixed" when its `test.fail()` spec passed | `piwi:bug`, `expectedStatus` |

### For agents in the editor

- **One-click MCP.** The extension offers to register Piwi's MCP server with the editor's agent (VS Code has an API for
  extensions to provide MCP server definitions; where a JetBrains AI assistant takes MCP servers, the plugin shows the
  entry to add), using the connection it already has.
- **Context for a chat.** **Copy context for agent** on a failing line, as Piwi Picker does for an element: the
  failure, its clue, the healing, the fix plan and the verify command in one block.

### What to add to the first release

Five of these reuse data the first release already fetches or that exists today, and cover the moments developers
reach most often: **CI failures in the Problems panel**, **Heal in place**, **Open the evidence**, the **Status bar**,
and **One-click MCP**. They join PR 6 (VS Code) and PR 7 (JetBrains). **Send from Piwi Picker** follows as its own PR,
since it needs pairing on both sides. The rest arrive with the features they come from.

## Delivery

| PR | Content | Needs |
|---|---|---|
| 1 | Core: `locator-text-match.ts` (moved from the extension), `diff-anchors.ts`, `locator-break.ts`, `locator-edit.ts` (moved from the app); `detectLocatorBreakAhead` as an adapter | — |
| 2 | CLI: `piwi preflight` with `--fix`, `--run`, `--strict`, `--json`, the index cache, docs and the hook recipe | 1 |
| 3 | Server: patches kept in change coverage, `locatorBreaks`, the PR section, the `diff-rename` healing source, `predict_locator_breaks` MCP tool, skill step | 1 |
| 4 | Code reach: capture, source-map decoding in core, attachment and wire, payload, `code_reach`, endpoints, impact and change coverage | — |
| 5 | Editor service: `packages/editor`, `locator-alternatives` endpoint, the catalog `file` filter | 1, 4 for file summaries |
| 6 | VS Code extension, with CI failures in the Problems panel, heal in place, the evidence, the status bar and one-click MCP | 5 |
| 7 | JetBrains plugin, with the same five | 5 |
| 8 | Send from Piwi Picker: pairing, the editors' local endpoints, the extension's **Send to editor** | 6, 7 |

PRs 1–3 ship a working preflight with no capture change. PR 4 is independent of 1–3. Each PR carries its docs. The
rest of [What the editors can grow into](#what-the-editors-can-grow-into) lands with the feature each item comes from.

## File-by-file checklist

### PR 1 — core
- `packages/core/src/locator-text-match.ts` (new): `textMatches`, `nameMatches`, `attributeMatches`, whitespace
  normalization; `apps/extension/src/content/locator-engine.ts` and `engine-aria.ts` import them.
- `packages/core/src/diff-anchors.ts` (new), `locator-break.ts` (new), `locator-edit.ts` (moved); exports in
  `packages/core/package.json`; `apps/application/shared/locator-edit.ts` re-exports.
- `apps/application/shared/handlers/scenario-gaps.ts`: `detectLocatorBreakAhead` over `predictLocatorBreaks`.
- Tests: `packages/core/tests/diff-anchors.test.ts` (JSX, Vue, Svelte, Angular, Razor, JSON, YAML, `.resx`, key
  changes), `locator-break.test.ts` (every row of the A2 table, exact, regex, still-matching renames), the extension's
  engine tests unchanged and green.

### PR 2 — preflight
- `packages/reporter/src/cli/preflight.ts` (new), `cli/index.ts`, `internal/support/selection-client.ts` (index fetch).
- Docs: `apps/docs/features/preflight.md` (new), `reference/cli.md`, `features/locator-usage.md` (link),
  `navigation.ts`, `shared/piwi-features.ts`.
- Tests: CLI tests on a fixture repository with a staged rename, `--fix` output, offline cache, exit codes.

### PR 3 — pull request and healing
- `server/utils/scm/change-coverage.ts`, `shared/handlers/change-coverage.ts` (patch kept, `locatorBreaks`),
  `shared/pr-feedback.ts` (`renderLocatorBreaks`), `server/utils/scm/pr-feedback.ts`.
- `packages/core/src/locator-healing-types.ts` (`diff-rename`), `server/utils/locator-healing.ts`,
  `shared/locator-healing.ts`, the auto-heal eligibility check.
- `shared/mcp-tools.ts`, `server/utils/mcp/tools.ts` (`predict_locator_breaks`),
  `packages/reporter/templates/skills/run-the-right-tests/SKILL.md`.
- Docs: `features/pr-feedback.md`, `features/locator-healing.md`, `features/mcp.md` (generated tool list).

### PR 4 — code reach
- Reporter: `public/options.ts`, `internal/config/env.ts` (`captureCodeReach`, `codeReachRoots`),
  `internal/capture/code-reach.ts` (new), `capture-fixtures.ts`, `attachments.ts`, collected and wire types,
  serializer, `public/reporter.ts`.
- Core: `source-map.ts` (new, VLQ decoding and offset lookup), `wire.ts`.
- App: schema (SQLite and PG) and generated migrations, `persist-run-cases.ts`, `server/utils/code-reach.ts` (new),
  retention, `selection-impact.ts`, change coverage, `code-reach.get.ts` and `code-index.get.ts` (new), demo seed.
- Docs: `guide/capture-fixtures.md`, `guide/privacy.md` (file paths only), `features/test-selection.md`,
  `reference/reporter-options.md` (generated).

### PRs 5–7 — editors
- `packages/editor` (new workspace), `apps/vscode` (new workspace), `apps/jetbrains` (new Gradle project).
- Root `package.json` workspaces, `release-please-config.json` (two entries per new workspace), `commitlint.config.js`
  (scope `ide`), CI jobs in `.github/workflows/ci.yml`, a publish workflow per marketplace.
- Docs: `features/editors.md` (new), `features/ide-integration.md` (link), `AGENTS.md` files for the new apps.

## Verification

1. In a fixture app, change `Pay now` to `Pay` in a component and run `piwi preflight`: one likely break with its three
   tests and the rewrite. `--fix` edits the page object; `--run` passes.
2. Change a translation value instead: the same result, from the locale file.
3. Change `Pay now` to `Pay now!`: `getByRole('button', { name: 'Pay now' })` still matches (substring); no break.
4. Open a pull request with the rename and run only a smoke selection that skips checkout: the comment lists the break.
   Run the full suite: the checkout test fails, the comment leaves it out, and healing offers `diff-rename` first.
5. With code reach on, run the suite on the dogfood dashboard: `code-reach?file=app/components/…` lists the tests that
   render that component; `piwi run impact --base main` after touching it runs those tests, not the whole suite.
6. In VS Code and in WebStorm, open the component: the summary line, the warning on the edited line, the quick fix
   across files. Open a page object: health and uses on locator lines, and a brittle warning with a stored alternative.
7. `npm run reporter:bench` with code reach on and off, to publish its cost next to the option.

## Risks

- **False alarms on common words.** Substring matching and literals find "Save" everywhere. Code reach confirmation,
  the likely/possible split, and folding possible breaks keep the list short; the precision loop the Test Map uses for
  its detectors (muting below 60% after 20 triage verdicts) can apply to this detector too.
- **Missed breaks.** Interpolated and composed names, and strings defined far from where they render, are not seen. The
  output never says "no locator breaks"; it says "no break found in the strings this diff changes".
- **Code reach accuracy.** Top-level exclusion and source-map mapping must be checked on Vite dev, a Vite build, Next.js
  dev and a webpack build before the option is documented as supported; a build without maps and without per-module
  URLs yields nothing, and the docs say so.
- **Cost.** Block coverage slows JavaScript in the page. The option stays off by default, and the bench result is
  published.
- **Editor maintenance.** Two marketplaces, two release trains. Keeping every decision in the server keeps the clients
  small; the JetBrains plugin follows the platform's LSP API, which changes between IDE versions.
- **Index size in the editor.** 20,000 locators fit in memory; the index is fetched in the background and never blocks
  typing.

## Open questions

1. **Tests and application in different repositories.** Preflight then runs in the application's repository, and call
   sites point to the other one. Recommendation: show the breaks with their test-side paths and no `--fix`, and let
   `--test-root` point to a local checkout of the tests.
2. **Branch of the index for a feature branch.** Recommendation: the index of the pull request's base branch, which is
   what the code is about to merge into.
3. **JetBrains IDEs without the LSP API.** IntelliJ IDEA Community and Android Studio. Recommendation: not supported at
   first; the whole plugin is built on the LSP client.
4. **Which JetBrains platform versions.** The LSP API gained features release by release. Recommendation: pick the oldest
   version whose LSP client renders diagnostics, quick fixes and hover, and render everything else natively (D10). Check
   in the same spike that Rider's LSP client serves Razor (`.cshtml`, `.razor`) files, whose editor comes from Rider's
   .NET backend rather than the IntelliJ side.
5. **Ambiguity ahead.** A change that adds a second "Save" button to a page makes a strict click fail. Recommendation:
   later, once code reach can tie a component file to the pages it renders on.

## Not in this plan

- Class-name anchors for brittle CSS locators (`locator('.btn-pay')` against a changed `class`). Easy to add to A1 once
  the text anchors prove precise.
- Running a test from the editor's own test explorer. Playwright's official VS Code extension already does that; this
  plan links to Piwi's history instead.
- AI suggestions in the editor. The MCP server and skills already serve editor agents.
- A language server for other editors (Neovim, Zed). The server speaks the protocol, so a client there is small, but
  none is planned.
