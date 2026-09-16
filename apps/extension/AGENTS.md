# Piwi Picker — Agent Instructions

Browser extension (Chrome/Edge, Manifest V3) that reuses the monorepo's locator engine
(`@piwitests/core`) and shared picker overlay (`@piwitests/picker-dom`) to pick ranked,
stable Playwright locators from the live page. The picking/recording features are
standalone (no server, no permissions beyond `activeTab`/`scripting`/`storage`, plus the
one-origin-at-a-time `optional_host_permissions` grant recording needs — see below);
**connecting to a Piwi instance is opt-in** and adds exactly one thing: matching a
recording against a project's own function catalog. See "Connected mode" below.

Published on the Chrome Web Store as
[Piwi Picker](https://chromewebstore.google.com/detail/piwi-picker/pakhnokpjboejcghgcmkjlpnogfjihhe)
(`pakhnokpjboejcghgcmkjlpnogfjihhe`) — that listing is how Chrome *and* Edge users install it.
Uploads are manual per release; `PUBLISHING.md` has the loop, and the Edge Add-ons and Firefox
AMO listings that are still outstanding.

## What it is

- `manifest.json` — MV3 manifest. Standing permissions stay at `activeTab` + `scripting` +
  `storage` — no static host permissions, no `<all_urls>`, no remote code. `optional_host_permissions`
  (`http://*/*`, `https://*/*`) is declared but **granted nothing by default** — the popup
  requests a single origin (`https://<the-recorded-site>/*`) from `chrome.permissions.request`
  only when the user clicks "Record actions", inside that click's own gesture. Adding a new
  *standing* permission here is still a deliberate, reviewed decision, not a default.
  `browser_specific_settings.gecko.id` is Firefox's required stable add-on ID (Chromium ignores
  the key); don't change it once the add-on is published to AMO — a new ID creates a separate
  add-on rather than an update, orphaning existing installs. See `PUBLISHING.md`.
- `src/content/` — content scripts, each a standalone entry injected on demand. Most are
  injected via `chrome.scripting.executeScript({ files: [...] })` from the popup (never
  `<all_urls>` static injection, never the `func:` stringify-and-inject form — a normal file
  injection can import `@piwitests/core`/`@piwitests/picker-dom` directly, since nothing needs
  to survive `Function.prototype.toString()` here, unlike the packages/reporter/dashboard pickers).
  `record-panel.ts` is the one exception: it's also registered dynamically
  (`chrome.scripting.registerContentScripts`, scoped to the granted origin) so it re-attaches
  itself on every navigation for the lifetime of a recording — see `background/index.ts`.
- `src/background/` — the service worker. Handles the `chrome.commands` keyboard shortcut
  (the toolbar icon opens the popup instead, which injects content scripts itself) and the
  recorder's start/stop messages (`piwi-start-recording` / `piwi-recording-stopped`, plus the
  `chrome.permissions.onAdded` fallback that starts a recording when the grant prompt closed
  the popup — see below) — the only places `chrome.scripting.registerContentScripts`/
  `unregisterContentScripts` and `chrome.action.*` are called from, since content scripts can't
  reach either API.
- `src/popup/` — the toolbar popup. Plain TypeScript + DOM, no UI framework — keep it that
  way unless the popup's own complexity genuinely outgrows it. Has a config (gear) button
  (`chrome.runtime.openOptionsPage()`) and, once connected, an **Active project** select that
  shows/overrides which mapped project applies to the current tab.
- `src/options/` + `options.html` — the connected-mode settings page: instance URL, API key,
  and a **Project mappings** table (URL pattern with wildcards → project, ordered, first match
  wins). Same plain TypeScript + DOM approach as the popup. Opened via
  `chrome.runtime.openOptionsPage()`, never linked to from a content script.
- `src/shared/` — code shared between content scripts, background, popup, and options.

**A momentary tool must claim the page through `src/shared/tool-session.ts`.** `startTool(id,
teardown)` on entry, `endTool(epoch)` when it finishes; starting one tears down its
predecessor, and Escape cancels the current one. Pass `teardownToolSurfaces` unless the tool
needs something more specific — note it answers the `__piwiPickState`/`__piwiAnchorState`
globals, because a pick-driven flow polls those and only resets its re-entry guard in a
`finally`, so tearing its UI out without an answer strands it for the life of the page. The
recorder deliberately stays outside this: it is a capture mode, and stopping it because
another panel opened would discard a recording in progress.

**Reading `chrome.storage.session` from a content script requires `ensureSessionAccess()`
(`src/shared/session-access.ts`) first.** The background worker widens the access level at
startup, but it is torn down when idle, so a script injected at `document_start` can run
before that has been applied — and the read *throws* rather than returning empty. The helper
pings the worker, which both wakes it and withholds its reply until the widening resolves.
Skipping this is what made the recorder's HUD appear only sometimes.

## Connected mode (recording → your own functions)

The recorder (`record-panel.ts`, `record-capture.ts`, `packages/core/src/recording.ts`,
`function-match.ts`, `codegen.ts`) works fully standalone: record clicks/fills/etc. across
pages, get a raw Playwright spec back. Connecting to a Piwi instance (`options.html` →
instance URL + API key + one or more URL-pattern → project mappings) adds one thing on top:
each mapped project's `test_functions` catalog (`apps/application/shared/handlers/test-functions.ts`)
is fetched once and cached per-project (`src/shared/catalog-cache.ts`, `chrome.storage.local`,
keyed by project id), and `rankFunctionMatches` / `matchFunctionAt` (pure, deterministic,
unit-tested in `packages/core`) match the live recording against whichever project's catalog
applies — ranked live in the HUD, substituted into the generated spec on export. The matcher
never invents a function; it only scores and selects among what the catalog already has.

Which project applies on a given page is resolved by `src/shared/active-project.ts`'s
`resolveActiveProject(settings, override, url)`: a manual per-tab override
(`chrome.storage.session`, set from the popup's **Active project** select) wins if present,
otherwise the first `ConnectionSettings.projectMappings` entry whose `urlPattern` matches the
URL (via `urlMatches`/`globToRegExp` in `packages/core/src/function-match.ts` — the same glob
matcher a catalog entry's own `urlPattern` gate uses). Every consumer that needs "which project
applies here" (record-panel's HUD and review panel, test-function-panel, the popup's select)
calls this one function rather than re-deriving it.

**No recording is ever sent to the instance** — only each mapped project's catalog is
fetched, and only `piwi-client.ts` makes that request, from exactly two contexts:
`src/options/` (on save) and the background worker's `piwi-refresh-catalog` handler.
**Never from a content script**, so the API key never reaches a page's JS context —
`record-panel.ts`/`test-function-panel.ts` read the cache and, when they need fresher data,
ask the worker via `catalog-refresh.ts` rather than fetching themselves. Keep it that way.

Staleness matters here: the catalog used to be written only by the options page's save
handler, so a function added in the dashboard afterwards never reached the extension at all.
The panels now render from cache first (instant, and fine with the instance unreachable) and
revalidate in the background, TTL-guarded by `CATALOG_TTL_MS`; the "Test functions" panel also
has an explicit Refresh that forces past the TTL. `refreshHud` runs on **every captured step**
during a recording — never add a fetch to it; the record panel refreshes once per page load
instead.

The dashboard API sends no CORS headers, and the `X-API-Key` header makes these requests
non-simple, so the browser preflights them. A granted host permission for the instance origin
is what actually makes the fetch work; the options page requests it inside the save/test click
(a service worker has no user gesture and can never request one itself).

`test-function-panel.ts` (+ its pure half, `test-function-scan.ts`) is the other consumer of
the cached catalog: a standalone popup action ("Test functions") that scores every catalog
entry's pattern against the *current* page's live DOM — no recording needed — and reports a
per-step unique/ambiguous/missing verdict rolling up into ready/partial/not-found per function.
It shares `scoreTargetMatch` (`packages/core/src/function-match.ts`) with the recorder's own
live ranking, so a function this reports "ready" is scored exactly the way it would be mid-recording.

Each standalone content-script feature (locator console, multi-pick, lint overlay, assertion
suggester, pick session, agent context, recording, try-it scanning, …) is split into a pure
logic file (e.g. `lint-scan.ts`, `assertion-suggest.ts`, `session-export.ts`,
`record-capture.ts`, `test-function-scan.ts`) and a separate entry-point/UI file (e.g.
`lint-overlay.ts`, `assertion-panel.ts`,
`session-panel.ts`, `record-panel.ts`) that wires picking, DOM, and `chrome.*` calls around
it. Keep new features on this split rather than mixing pure logic into the entry point —
it's what makes the logic half plain-unit-testable (or real-bundle-testable, see below)
instead of needing a live browser for everything.

## Rules

- **No network call from a content script, ever.** Picking/recording talk to no server.
  Connected mode (see above) is opt-in, off by default, confined to `src/options/`
  (`piwi-client.ts`), and fetches only a function catalog — never sends a recording anywhere.
  A future feature that wants to *send* recorded data to an instance needs the same
  explicit-opt-in, clearly-separated treatment, plus a payload preview before the first send.
- **Content scripts are separately-bundled IIFEs, not ES modules.** `scripts/build.mjs`
  builds each one with Vite's library mode specifically so `chrome.scripting.executeScript`
  (or a `registerContentScripts` registration, for `record-panel.ts`) can inject it as a plain
  script. Don't add a shared runtime chunk between them — each must stay self-contained at the
  bundle level (imports are fine at the *source* level; Vite inlines them per entry).
- **Never widen *standing* permissions casually.** `activeTab`/`scripting`/`storage` plus the
  recorder's one-origin-at-a-time optional host permission cover everything today. A feature
  that seems to need more (`debugger`, `contextMenus`, `sidePanel`, a broader or default-granted
  host permission) needs a deliberate call, not a silent addition — see the aria-snapshot
  feature (deferred; would need `debugger` to get the browser's real accessibility tree, which
  contradicts the minimal-permissions goal), the agent-context feature's element summary, which
  deliberately approximates instead of attempting the same real accessibility tree for the same
  reason, and the recorder's own permission design below.
- **The recorder's host permission is requested per-origin, per-recording, from the popup's
  own click handler — never pre-granted, never `<all_urls>`.** `chrome.permissions.request`
  only counts as satisfying a user gesture when called synchronously inside one, so this can't
  move into `background/index.ts` (see `src/popup/main.ts`'s `startRecordingFlow`). But the
  prompt that request shows *takes focus and closes the popup on a first-time grant*, killing
  the code that would have messaged the worker to start — which is why a first recording used
  to need a second click. So the popup parks a `RecordIntent` (origin + tab, in session
  storage) inside that same click, and the worker's `chrome.permissions.onAdded` picks it back
  up when the grant lands and starts the recording itself. Both starts (the popup's own message
  when it *does* survive, and the `onAdded` fallback) funnel through `startRecordingOnce`, which
  dedupes; `decideRecordIntent` (pure, unit-tested) is what keeps the fallback from firing on an
  unrelated grant — the options page granting the instance origin fires the same event — or on a
  stale intent. Recording covers the one origin granted at start; navigating to a different
  origin mid-recording is a known, documented limit (see `apps/docs/extension.md`), not a silent gap
  — a future phase could detect it and prompt to expand, but that also needs a fresh user
  gesture, which the HUD (a content script, no `chrome.permissions` access) can't provide on its
  own either.
- Reuse `@piwitests/picker-dom`'s exports (`installPickerOverlay`, `showAnchorPicker`,
  probe, role-resolution, syntax highlighting) rather than re-deriving picker logic here —
  that package exists so this workspace doesn't become a third hand-synced copy.
- **A locator is always rendered through `highlightLocator`, inside a `.piwi-loc` element,
  in a panel whose `<style>` includes `LOCATOR_SYNTAX_CSS`** — never as bare `textContent`.
  The token colors live in that stylesheet (dark-first, with a light-scheme override) because
  a panel that flips to a white background needs a different palette, which inline colors
  can't express. A chip that stays dark in both schemes — anything floating over the page
  rather than sitting in a panel — adds `piwi-loc-dark` to opt out of the light override.
  Panel text carrying a verdict or accent color (`.verdict`, `.score`, `.unique`, `.warn`, …)
  needs its own `@media (prefers-color-scheme: light)` entry for the same reason.
- **`chrome.storage.session` needs `setAccessLevel` to be reachable from a content script.**
  It defaults to extension-page/service-worker-only access; `src/background/index.ts` widens
  it once at startup (`TRUSTED_AND_UNTRUSTED_CONTEXTS`) specifically so `session-panel.ts` and
  `recording-storage.ts` can read/write it directly from a content script. `chrome.storage.local`
  (connection settings, the catalog cache) has no such restriction.
- **Two different test strategies for content-script logic, pick deliberately.** A function
  built entirely from nested helpers with no imports from `@piwitests/core`'s scoring engine
  (`evaluateLocatorChain`, `derivePattern`, `testCatalogAgainstPage`) can be re-serialized via
  `Function.prototype.toString()` in tests, installing any genuine cross-module dependency as
  a global first. A function that calls `generateAlternatives` (`scanForLintIssues`,
  `suggestAssertions`, `buildAgentContext`, `record-panel.ts`'s `deriveRecordedTarget`) can't
  — that function's own private module-level helpers don't survive reconstruction and aren't
  exported individually. Those are tested by driving the real built bundle
  (`page.addScriptTag`), either reading a well-known `globalThis.__piwiXxx` the entry-point
  bridges a result out to (`lint-overlay.ts`, `assertion-panel.ts`, `agent-context-panel.ts`)
  or, for anything backed by `chrome.storage` (`session-panel.ts`, `record-panel.ts`),
  reading state back out of a stubbed `chrome.storage` installed via `context.addInitScript`
  (see `session-panel.spec.ts`, `record.spec.ts`) — don't reach for reconstruction if the
  feature touches `generateAlternatives` or `chrome.*`.
- **`record.spec.ts`'s cross-page test stubs `chrome.storage` on top of `window.name`, not a
  plain in-memory object.** `context.addInitScript` re-runs on every new document, which would
  reset an in-memory stub on each navigation; `window.name` is one of the few things a real
  browser tab preserves across a same-tab navigation (even cross-origin), so it's the only way
  to fake "storage that survives navigating to the next page" without a real extension
  permission grant in the test.

## Commands

| Command | Purpose |
|---|---|
| `npm run extension:build` | Build `dist/` (content scripts, background, popup, options page, manifest, icons) |
| `npm run extension:dev` | Same build, re-run on every change to `src/`, `public/`, `popup.html`, `options.html`, or `manifest.json` |
| `npm run extension:zip` | Build, then package `dist/` as a store-ready zip (see `PUBLISHING.md`) |
| `npm run extension:typecheck` | TypeScript check |
| `npm run extension:lint` / `extension:lint:fix` | oxlint |
| `npm run extension:format` / `extension:format:check` | oxfmt |
| `npm run extension:test` | Unit tests (Vitest) — pure logic only |
| `npm run extension:test:e2e` | Builds, then drives the real built extension with Playwright (`--load-extension`) |

## Loading it locally

`npm run extension:build`, then in Chrome/Edge: `chrome://extensions` → enable Developer
mode → Load unpacked → select `apps/extension/dist`.

While iterating, use `npm run extension:dev` instead — it rebuilds on save. The browser
still needs a manual reload on the `chrome://extensions` card to pick up a new build (MV3
gives no way to trigger that from outside the browser), so the loop is: save → wait for the
rebuild line → click reload.

Disable the Chrome Web Store copy while a local build is loaded — two installs both claim the
`Ctrl+Shift+E` command, and only one of them gets it, which reads as "my change didn't apply".
