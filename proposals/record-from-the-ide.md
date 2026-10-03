# Recording tests from the IDE

A plan to write a Playwright test by using the application: from the IDE, a browser opens with the project's own
Playwright and configuration, the developer clicks and types, and each action appears as code at the caret, in the
file they are editing. The question was whether the IDEs (the JetBrains IDEs first) could do this with the code
generator Piwi Picker already uses, and whether the desktop app is needed. It can, the desktop app is not needed, and
the recorder itself can be reused unchanged: a spike ran Piwi Picker's recorder bundle, as the extension's build
produces it, inside a browser launched by Playwright, and the code was regenerated in Node 2 to 7 ms after each
captured action.

**Status.** Proposed 2026-10-03. Nothing built. The spike in the [appendix](#appendix-the-spike) is the evidence for the
feasibility claims; it is not part of the repository.

**Summary.** VS Code users have a recorder: Microsoft's Playwright extension records into a new file or at the cursor,
through Playwright's own code generator. Users of WebStorm, IntelliJ IDEA and Rider have none: JetBrains' Test
Automation plugin (what remains of Aqua, discontinued in 2025) validates and generates locators in its Web Inspector,
and its documentation describes no recorder of actions. Piwi already holds the parts a recorder needs, and a better
code generator than a recorder starts with: the extension's recorder (ranked locators, each verified to find the element
alone, hovers a click depends on, no password ever written down), the shared converter `renderSpec` (calls to the
project's own page objects and helpers from its function catalog, the locators the suite already uses, a wait for each
new page), and an editor service both IDE plugins run. This plan connects them:

- **Record a test from the IDE**: the editor service launches a browser through the project's own Playwright, with the
  `use` options of its config (`baseURL`, `storageState`, viewport, locale, headers, `testIdAttribute`), and writes
  each action at the caret while recording. No instance, no desktop app, no extension needed.
- **Fix the code generator where a recording from the IDE shows its limits**: iframes, popups, dialogs, downloads,
  uploads, the project's test id attribute, environment variable names that stay stable, imports placed in the file.
- **Edit a recording before it is code**: a step list with every step's other locators, assertions in two clicks, the
  locator at the caret highlighted in the browser.
- **Continue from an existing test**: run a test up to the caret through Piwi's capture fixtures, then record from the
  page it left.
- **Other ways in**: a recording made in the developer's own browser with Piwi Picker, streamed to the IDE as it
  happens; a bug report or a scenario gap opened as a test.

## What the reader gets

In WebStorm, in `tests/checkout.spec.ts`, the caret on an empty line inside `test.describe('checkout', …)`.
**Tools → Piwi → Record a Test Here** (or Alt+Enter, **Record a test here with Piwi**). A popup asks, once per
project, which Playwright project's options to use and where to start (`/`, on the `baseURL` the config names).
Chromium opens at the project's viewport, already signed in from the project's `storageState` file. In the editor, a
new test appears. It is the recorded block: the lines the recording writes, tinted, and rewritten on every action
until it stops.

```
checkout.spec.ts
      ● Recording in Chromium · 6 steps · Stop · Pause · Assert…           ← a line above the block
 12 ▌ test('recorded flow', async ({ page }) => {                          ← tinted: rewritten on every action
 13 ▌   const cartPage = new CartPage(page);
 14 ▌   await page.goto('/');
 15 ▌   await cartPage.addProduct('Red shoes');                             ← a call to the project's page object
 16 ▌   await page.getByRole('link', { name: 'Checkout' }).click();
 17 ▌   await expect(page).toHaveURL(/\/checkout(?:[?#]|$)/);
 18 ▌   await expect(page.getByRole('textbox', { name: 'Coupon' })).toHaveCount(1);
 19 ▌   await page.getByRole('textbox', { name: 'Coupon' }).fill('WELCOME10');
 20 ▌ });
```

The browser shows a small panel: **● Recording into checkout.spec.ts · 6 steps · Assert · Stop**. **Assert** picks an
element and offers the checks that apply to it (`toHaveText`, `toBeVisible`, `toHaveValue`…); the check lands at the
caret like any step. The Piwi tool window lists the steps, each with the locators the recorder verified for its
element: choosing another rewrites that line, deleting a step removes its line.

**Stop**, in the IDE or in the browser, or closing the browser: the block becomes ordinary code, undone in one step.
A brittle locator or a password read from the environment is flagged on its line, with the existing Piwi quick fixes.
Above the test, **Run** runs it once; **Verify ×3** runs it three times, headless, with no retry.

The same works without the catalog (raw `page.*` lines instead of `cartPage.addProduct`), and in VS Code with the same
commands; the JetBrains client is built first and gets the most polish. This is the end state of the
[Delivery](#delivery); the first release (PRs 1 and 2) has the block, Stop and the warnings.

## What exists

| Piece | Where | What it gives this plan |
| --- | --- | --- |
| The recorder | `apps/extension/src/content/record-panel.ts` | Capture across pages: clicks, fills, checks, choices, drags, file names, keys, the hovers a click depends on. Each target ranked and verified on the page (`verified-locators.ts`). Passwords, card numbers and one-time codes never captured. |
| The recorder's message path | `apps/extension/src/shared/session-area.ts`, `recording-storage.ts:232` | In Firefox, with no session storage in the page, every read and write is a message, and each captured event is one atomic message (`appendViaBackground`). A Playwright binding can answer exactly these messages. |
| Recording model | `packages/core/src/recording.ts` | `normalizeSteps`, `sessionFromEvents`: raw events to steps. |
| Code generator | `packages/core/src/codegen.ts` | `renderSpec`: escaped values, re-rendered locators, catalog calls, `preferLocators`, `locators: 'stable'`, URL checks, environment values, `format: 'body'`, and `stepLines` (the line each step starts on). |
| Steps document | `packages/core/src/steps.ts` | The portable form of a recording (`v: 1`), parsed field by field. |
| Send to editor | `packages/core/src/editor-send.ts`, `PiwiSendHandler.kt`, `apps/vscode/src/send-listener.ts` | After Stop, Piwi Picker posts a steps document; the IDE renders it with `piwi/renderSteps` and inserts it at the caret. One request, no session, nothing live. |
| Editor service | `packages/editor/src/server.ts`, `context.ts` | One context per Playwright config, with its function catalog and locator index; `piwi/renderSteps` (`server.ts:1481`). It starts no process today. |
| JetBrains plugin | `apps/jetbrains/` | LSP client with custom requests (`PiwiLanguageServer`) and notifications (`PiwiLsp4jClient`), insertion at the caret, the Piwi tool window, the built-in server's handlers. |
| Capture fixtures | `packages/reporter/src/internal/capture/capture-fixtures.ts` | Every locator action and assertion is proxied; its call site (`file:line:col`) is known before it runs (`:1164`, then `:1192`). The failure-time picker already keeps a page open at teardown (`maybeOpenPicker`, `:783`). Opt-in: specs import `test` from `base.extend(piwiFixtures)`. |
| Finding the project's Playwright | `packages/reporter/src/internal/support/playwright-spawn.ts:12` | `resolvePlaywrightCli`: the project's own CLI through `createRequire`. |
| Desktop app | `apps/desktop/src-tauri/src/runner.rs`, `repro.rs`, `worktree.rs` | Runs the linked folder's Playwright with its Node sidecar, in the folder or in throwaway worktrees; bundles no browser. Writes a temporary spec under `<testDir>/piwi-repro/` for a bug report's run. |

What exists elsewhere, for comparison:

- **VS Code, Microsoft's Playwright extension**: **Record new**, **Record at cursor** and **Pick locator**. It starts
  a Playwright browser server and drives Playwright's own recorder through its debug controller, which sends the
  generated code as text (`sourceChanged`). Tests run with reused contexts, so the page a test ends on can be recorded
  on. Playwright's generator writes typed values as literals, passwords included.
- **JetBrains, the Test Automation plugin**: the Web Inspector shows the application, generates CSS, XPath and
  role-based locators for a selected element, and validates the locators in the code. WebStorm runs and debugs
  Playwright tests. No recorder is documented.

## Decisions

1. **The editor service launches the browser, through the project's own Playwright.** Not the extension, not the
   desktop app, not a browser inside the IDE window. The service already runs on the project's Node.js, knows the
   workspace's Playwright configs, holds the catalog and the locator index, and is shared by both IDEs, whose
   guides say a new feature is a service request first. It does so from a child process, the launcher (Part 1.1).
   Loading Piwi Picker itself into a Playwright Chromium (`--load-extension`) was the other candidate: it works only
   in Chromium (branded Chrome dropped the flag in 137), keeps the per-origin permission prompts, and gains nothing
   over loading the recorder directly.
2. **One recorder, two bundles.** The IDE runs the same `record-panel.ts` the extension runs, built a second time as
   `record-ide.js`: same capture and ranking code, a different host. No second capture implementation. Playwright's
   own recorder is not used: its debug controller hands back code as text, not steps, so the catalog, the suite's
   locators, the step list and the stability checks would have nothing to work on; and that controller is internal
   to Playwright.
3. **One code generator.** Recordings from the IDE go through `renderSpec`, like the extension's Copy, `piwi codegen`
   and `piwi/renderSteps`. Each change Part 3 makes to the generator lands in `@piwitests/core` and reaches all four.
4. **The recording session lives in the editor service; the clients render it.** A recording session (one recording:
   its target file and position, its events, its options) is held by the service, which turns the events into code.
   The clients draw the recorded block and the controls around it. The protocol gains two requests and one
   notification (Part 1.4). The service could write the block with the protocol's `workspace/applyEdit`, which both
   clients support (the JetBrains IDEs since 2024.1); it does not, because each client has to group the updates into
   one undo step and draw the controls around the block, which an edit request cannot ask for. Per the service's
   rule, each protocol change lands with both clients; the JetBrains client gets the full interface first, VS Code
   the same commands with less polish.
5. **The recorded block is regenerated whole on every change.** A later step can change earlier lines: a run of steps
   becomes one catalog call once its last step arrives, and a URL check appears once a step lands on another page. So
   the service renders all steps each time and the client replaces the block. `renderSpec` took under 1.1 ms for nine
   steps in the spike.
6. **The browser gets the configuration Playwright resolves, never a parse of it.** The `use` options of the chosen
   project come from Playwright itself: a reporter of about fifteen lines, run with `playwright test --list`, prints
   them from `onBegin` (2.2 s on this repository's config; cached until the config file changes). The JSON reporter
   cannot do it: it leaves `use` out.
7. **Nothing is required beyond the IDE plugin.** A team instance or the desktop app adds data (the catalog, the
   suite's locators, Tested elements) and worktree runs, never a precondition. See
   [With or without the desktop app](#with-or-without-the-desktop-app).
8. **Licenses stay on their side.** `record-ide.js` comes from the extension and the launcher belongs to the editor
   service, both FSL. The capture fixtures (reporter, MIT) only load `record-ide.js` by a path the service gives them
   (Part 5); no FSL code moves into `core`, `picker-dom` or the reporter.

## Part 1 — The recording session (editor service)

### 1.1 The launcher

The launcher is a Node child process of the editor service (`child_process.fork`, one per recording session) that
starts the browser with the project's own Playwright, loads `record-ide.js` into every page, and passes the recorder's
messages to the service. A child, not the service's own process: Playwright keeps a driver process and pipes, a stuck
browser must not stall diagnostics, and **Stop** ends everything by ending the child. It runs in the folder of the
Playwright config, so relative paths (`storageState`) resolve as they do in a test run.

1. **Playwright**: `createRequire(<config folder>)` resolves `playwright-core` or `@playwright/test`, as
   `resolvePlaywrightCli` does. Missing: the session fails with "Playwright is not installed in <folder>".
2. **Options**: the chosen project's `use`, from the reporter described in decision 6, run with the project's CLI.
   The launcher maps them to `browserType.launch` (`channel`, `launchOptions`, `headless: false`) and
   `browser.newContext` (`baseURL`, `viewport`, `deviceScaleFactor`, `isMobile`, `hasTouch`, `userAgent`, `locale`,
   `timezoneId`, `colorScheme`, `storageState`, `extraHTTPHeaders`, `httpCredentials`, `ignoreHTTPSErrors`,
   `permissions`, `geolocation`, `proxy`), and calls `selectors.setTestIdAttribute` with `testIdAttribute`.
3. **The recorder**: `context.exposeBinding('__piwiRecorder', …)` answers the recorder's messages
   (`piwi-session-storage`, `piwi-append-recording-event`, `piwi-ping`, `piwi-tab-zoom`, `piwi-recording-stopped`);
   `context.addInitScript` loads `record-ide.js` at the start of every document, every page of the context.
4. **Events**: each appended event is checked field by field (the page can call the binding too) and sent to the
   service over the IPC channel. The launcher keeps no state the service needs.
5. **Lifecycle**: the browser closing, the page crashing, or Playwright failing ends the session with one sentence. A
   missing browser ("Executable doesn't exist") comes with an action that runs `npx playwright install chromium` in
   the config's folder, through the existing `piwi.runCommand`.

`webServer`, `globalSetup` and fixtures do not run in a fresh browser: only a test run starts them. When the
`baseURL` does not answer, the session says so and offers **Retry**. Recording through the test runner, with all of
them, is Part 5.

### 1.2 `record-ide.js`

A second entry in `apps/extension/scripts/build.mjs`, from the same sources:

- **Host**: the bundle is wrapped so `chrome` is a variable inside it, implemented over the binding: `storage.local`
  and `runtime.sendMessage` go to the launcher, `storage.session` is absent (which selects the existing message path),
  `i18n` reads the extension's catalogs in the IDE's language. The page gets no global `chrome`.
- **Three behaviors differ**, behind a build constant: the recorder runs in the top-level document only, as the
  extension does (until Part 3 adds frames); Stop shows no review panel (the code is already in the editor); the
  browser panel says which file it records into.
- **Same tests**: the extension's e2e suite keeps covering the recorder; the launcher's test (Verification) covers
  the second bundle.

### 1.3 From events to code

The service appends each event to the session and renders:

```ts
renderSpec(sessionFromEvents(events, startedAt), {
  format: session.into === 'steps' ? 'body' : session.into, // 'test' is Part 3, item 3
  title: session.title,
  testImport: testImportOf(targetFile),            // the file's own `test` import, else the project's most used one
  urls: sameOrigin(baseURL, startUrl) ? 'relative' : 'absolute',
  locators: 'stable',
  urlChecks: true,
  catalog: await context.functionCatalog(),        // empty without an instance
  preferLocators: suiteLocators(context.index),    // empty without an instance
});
```

Codegen warnings (`brittle-locator`, `redacted-value`, `file-needed`, `no-locator`) are published as diagnostics on
the lines `stepLines` gives, so both clients show them as they show every Piwi warning, with no new interface.

### 1.4 Protocol

Added to `packages/editor/src/protocol.ts` and mirrored in `Protocol.kt`:

```ts
/** `piwi/record`: open a browser through the project's Playwright and record into a file. */
export interface RecordParams {
  uri: string;
  /** 0-based caret position: where the recorded block starts. */
  line: number;
  character: number;
  /** `steps`: lines of the test the caret is in. `test`: a new test at the caret. `file`: a whole new spec. */
  into: 'steps' | 'test' | 'file';
  /** The Playwright project whose `use` options the browser gets; the first one when absent. */
  project?: string | null;
  /** A path on the `baseURL`, or an absolute URL; the `baseURL` when absent. */
  startUrl?: string | null;
  title?: string | null;
}
export interface RecordResult {
  ok: boolean;
  sessionId?: string;
  /** One sentence for the client to show when it did not start. */
  message: string;
  /** When the config has several projects and none was given: their names, for the client to ask. */
  projects?: string[];
}
export const RECORD_REQUEST = 'piwi/record';

/** `piwi/stopRecording`: stop; the browser closes. */
export interface StopRecordingParams { sessionId: string }
export const STOP_RECORDING_REQUEST = 'piwi/stopRecording';

/** `piwi/recordingChanged` (notification, server to client): the block to write, and the session's state. */
export interface RecordingUpdate {
  sessionId: string;
  state: 'starting' | 'recording' | 'paused' | 'stopped' | 'failed';
  /** The recorded block's lines, unindented; the client indents them like the caret's line. */
  code: string;
  /** Import lines the file needs; the client adds the missing ones at the top. */
  imports: string[];
  steps: Array<{
    /** The step in words, as the extension's review lists it (`describeStepInWords`). */
    words: string;
    /** 0-based line of `code` the step starts on. */
    line: number;
    /** The verified locators of the step's element, best first, and the one written. */
    locators: string[];
    chosen: number;
    /** Set when the step is part of a catalog call. */
    functionName?: string;
  }>;
  /** Why the session stopped or failed, in one sentence. */
  message?: string | null;
}
export const RECORDING_NOTIFICATION = 'piwi/recordingChanged';
```

`piwi/editRecording` (Part 4) and the requests of Parts 4 and 5 follow the same shape. A client command `piwi.record`
lets the service offer a recording from a summary line or a quick fix (an empty test body, a scenario gap).

## Part 2 — The JetBrains client

- **Entry points**: **Tools → Piwi → Record a Test Here**; the editor's context menu; an intention (Alt+Enter) inside
  a spec: **Record a test here** between tests, **Record steps here** inside a test body; **New → Playwright Test
  (Recorded)** in the Project view, which creates the file first.
- **First run in a project**: a popup with the Playwright project (the names `piwi/record` answers with) and the start
  page, prefilled from the last recording, kept in `.idea/workspace.xml` (`PiwiLocalSettings`).
- **The recorded block**: a `RangeMarker` over the block, tinted with a new `PIWI_RECORDING_BLOCK` attribute (beside
  `PIWI_FAILING_TEST`, in `PiwiColorSettingsPage` and both default schemes). Each update replaces the marker's text in
  a write command. A block inlay above it shows the state and **Stop**, **Pause**, **Assert…**, and the status bar
  shows **● Recording**.
- **One undo step**: the updates are applied as one command group, so a single Undo after Stop removes the whole
  recording. The platform's command grouping (`CommandProcessor` with one group id) is the first candidate; a short
  platform test settles it before the rest is built (Risks).
- **Typing in the block while recording** pauses the updates and says so on the inlay: **Resume** (the block is
  written again from the steps) or **Keep my edits** (the session stops, the code stays as edited).
- **Imports**: `imports` lines missing from the file are added after its last import, in the same command.
- **After Stop**: the tint and the inlay go; the warnings stay as diagnostics; Code Vision above the test offers
  **Run** and **Verify ×3** (Part 4.5).
- **Rider and IntelliJ IDEA Ultimate** get the same, through the same LSP API; nothing here is WebStorm-only.

## Part 3 — Improvements to the recorder and the code generator

Each item lands in `@piwitests/core` or the recorder, so the extension's Copy, `piwi codegen` and Send to editor get it
too. The first four are needed by recordings from the IDE; the others are what a recording from the IDE reaches that
the extension never did.

1. **The project's test id attribute.** The probe (`packages/picker-dom/src/probe.ts:71`) and `generateAlternatives`
   (`packages/core/src/locator-generation.ts:239`) read `data-testid` only, and the recorder builds its engine without
   the project's attributes (`verified-locators.ts:68` takes them, `record-panel.ts` passes none). A project with
   `testIdAttribute: 'data-test'` gets no `getByTestId` for its own test ids, and gets `getByTestId` for any
   `data-testid` its pages carry (a component library's), which its tests then look up as `data-test` and do not
   find. Add a `testIdAttribute` option to generation, the probe and the engine; the launcher passes
   `use.testIdAttribute`, the extension the locator index's `testIdAttributes` when connected.
2. **Environment variable names that do not move.** A password becomes `process.env.PIWI_TEST_VALUE_<step index>`
   (`codegen.ts:345`), so a step added or removed before it renames the variable: in the spike,
   `PIWI_TEST_VALUE_5` became `PIWI_TEST_VALUE_6` when a late step arrived, in code the developer was watching. Name
   the variable from the field (`E2E_PASSWORD` for a field labeled Password, a suffix on a second one), and accept a
   map of names, so a rename in the step list sticks.
3. **Imports as data, and a test without its file.** `format: 'body'` writes the imports a catalog call needs as
   `// Needs: import …` comments (`codegen.ts:591`). Return them in `CodegenResult.imports` as well, for an editor
   that can place them. Add `format: 'test'`: the `test(…)` call alone, for a new test inside an existing file.
4. **`baseURL`-aware URLs.** `piwi/renderSteps` always writes paths (`server.ts:1494`): in a project without a
   `baseURL`, `page.goto('/…')` fails at run time. Write paths only when the recording's origin is the `baseURL`'s,
   relative to the `baseURL`'s own path (`/app/` in `http://host/app/`).
5. **Frames.** The extension records the top-level document only (its registration has no `allFrames`, and its docs
   say "One frame at a time"), so a click in an iframe is not recorded. A host that injects into every frame gets wrong
   code instead: in the spike, a click in a same-origin iframe became
   `await expect(page).toHaveURL(/\/promo(?:[?#]|$)/)` and a `page.getByRole(…)` that cannot reach into the frame.
   Add a frame chain to `RecordedTarget` (each iframe's locator in its parent) and render
   `page.locator('iframe[title="Promo"]').contentFrame().getByRole(…)` (`frameLocator` before Playwright 1.43); a
   frame's events keep the top page's `pageUrl`. In the IDE the launcher computes the chain: the binding names the
   frame that called it, and the frame's element is ranked in its parent by the same bundle.
6. **Popups and new tabs.** The recording model has one page: in the extension, a new tab of the same origin gets the
   recorder and its events join the stream, so its steps are written against `page` (read from the code, not
   reproduced). Give each step a page index and render
   `const page1Promise = page.waitForEvent('popup'); … const page1 = await page1Promise;`. The launcher knows each
   page (`context.on('page')`, `page.opener()`).
7. **Dialogs.** Under Playwright, a dialog nobody handles is dismissed at once, which changes the application's
   behavior during a recording. The launcher handles `page.on('dialog')`: the IDE shows the message with **Accept**,
   **Dismiss** and, for a prompt, a text field; the choice is recorded as `page.once('dialog', …)` before the step that
   opened it.
8. **Downloads** become `const downloadPromise = page.waitForEvent('download'); …; const download = await
   downloadPromise;`.
9. **Uploads with a real file.** The extension writes the chosen files' names, and the spec reads them from the
   folder Playwright runs in (`file-needed`). The launcher intercepts the file chooser (`page.on('filechooser')`); the
   IDE asks for a file from the project (a `fixtures` folder by default), the page gets it, and the step writes
   `setInputFiles(path.join(__dirname, 'fixtures/invoice.pdf'))` relative to the spec.
10. **Other origins.** The extension records one origin, the one it was granted. The launcher has no such limit, so a
    sign-in on an identity provider's domain is recorded with the rest (the spike recorded one).
11. **More matchers**: `toContainText`, `toBeChecked`, `toHaveCount`, `toHaveAttribute` beside the eight of
    `AssertionMatcher`.
12. **The steps document**: frames and pages are new fields. `parseSteps` drops fields it does not know, so an older
    `piwi codegen` would render a document that uses them as wrong code, silently. A document that uses them is
    `v: 2`, which an older reader refuses; any other stays `v: 1`.

## Part 4 — What makes it worth switching to

1. **Edit before it is code.** The Piwi tool window gets a **Recording** tab: each step in words, its locators (the
   recorder keeps up to five, each verified to find the element alone), the function call it is part of, its
   warning. Choosing another locator, deleting a step, or turning a typed value into an environment variable sends
   `piwi/editRecording`; the service re-renders the block. Nothing is parsed back from the code: the steps stay the
   source, as in the bug-report plan.
2. **Assertions in two clicks.** **Assert** in the browser panel and in the inlay picks an element and offers the
   checks that apply to it, from the extension's `suggestAssertions`; the bug recorder's **Mark what's wrong** already
   adds `assert` steps this way. The extension's action recordings get the same button.
3. **The locator at the caret, in the browser.** With a recording browser open, the caret on a locator line outlines
   what it finds there, with a count (`piwi/highlightLocator`, through Playwright's own `locator.highlight()` and
   `count()`). **Pick in the browser** (`piwi/pickLocator`) runs the extension's picker and replaces the locator at the
   caret with the chosen candidate, or inserts it.
4. **Start where the tests start.** The browser opens signed in from the project's `storageState` file when it exists,
   and offers to run the setup project when it does not. A sign-in done during a recording can be saved to that file
   (`context.storageState({ path })`), the Save login for tests feature of the extension, written in place.
5. **Know it passes before committing.** **Run** runs the test as `piwi.runTests` does; **Verify ×3** adds
   `--repeat-each=3 --retries=0` and reports "passed 3 of 3" in a notification. With the desktop app, the same run can
   go to a throwaway worktree as a desktop job.
6. **Record what the suite misses.** With a connection, **Tested elements** outlines, in the recording browser, every
   element a test of the project reaches, from the locator index the service already holds (the extension's
   `coverage-overlay.ts`, built into `record-ide.js`).
7. **Keyboard first.** One shortcut starts a recording at the caret, the same one stops it, and the browser panel's
   buttons have keys.

## Part 5 — Continue from an existing test

The most common case is not a new test: a test reaches the checkout page and the next steps are missing. Recording
from a fresh browser would mean replaying the start by hand. The capture fixtures can hand the page to the recorder at
the right moment instead:

1. The developer puts the caret inside a test and runs **Record from here**. The service starts the run itself, since
   it holds the channel (today the clients run tests, from commands the service builds), with the project's CLI:
   `playwright test <file>:<line> --project=<p> --headed --workers=1 --retries=0 --timeout=0`, and
   `PIWI_RECORD_AT=<file>:<line>`, `PIWI_RECORD_BUNDLE=<path of record-ide.js>`,
   `PIWI_RECORD_CHANNEL=<a named pipe the service listens on>` and `PIWI_ORIGIN=record`.
2. In the worker, the locator proxy compares each action's call site with `PIWI_RECORD_AT` before running it. At the
   first action at or after the caret's line in that file, or when the test ends first (the same `context.close`
   hook as `maybeOpenPicker`), it stops the test's progress: lifts the timeout (`testInfo.setTimeout(0)`), loads the
   bundle into the context (`addInitScript` for the next documents, `evaluate` for the current one), and connects to
   the channel.
3. The session is the same as in Part 1: the events go to the service, the block is written at the caret, without
   the opening `page.goto` a fresh browser needs (a `renderSpec` option), since the page is where the test left it.
4. **Stop** ends the test as skipped (`testInfo.skip()`, "recorded with Piwi"); the lines after the caret never run.
   `PIWI_ORIGIN=record` is a new origin the reporter does not submit, so the run stays out of the project's history.

Everything the test does before the caret runs as it always does: `webServer`, `globalSetup`, the setup project,
`beforeEach` hooks and the project's own fixtures. The same mechanism also gives **Record a test here** a
second mode, through the runner, for a project whose state comes from fixtures rather than a `storageState` file.

It needs the capture fixtures (`import { test } from './fixtures'`, which `piwi init` writes). Without them, the
session says so, offers `piwi init`, and falls back to a fresh browser. Actions that do not go through a locator
(`page.goto`, `page.keyboard`) are seen through Playwright's instrumentation listener, which the resource ledger
already uses (`resource-ledger.ts`), behind the same feature check.

## Part 6 — Other ways in

1. **Recording in your own browser, streamed to the IDE.** Some flows need the developer's own profile: a hardware
   key, a single sign-on that refuses automated browsers. Piwi Picker records there today and sends the result after
   Stop. With **Live to editor** on, the extension's worker forwards each new event to the paired IDE as it is stored
   (it can observe every write through `chrome.storage.onChanged`, and content scripts make no network calls), and
   the IDE opens a recording session whose events come from the extension instead of the launcher. The block, the
   step list and the warnings are the same.
2. **A bug report as a test.** **New Test from Bug Report…** lists the project's reports and renders the chosen one
   into a new spec (`piwi codegen bug:<id>`, with the file's imports), ready to record more steps after it. A report
   sent to the desktop app opens the same way.
3. **A scenario gap as a test.** The dashboard's Gaps tab offers **Record in my IDE**: it calls the IDE's built-in
   server, as **Open in IDE** does (`PiwiOpenHandler.kt`), with the route; the IDE creates a spec and starts a
   recording at that page.
4. **From the desktop app, without an IDE plugin.** The launcher is a Node program the app's sidecar can run as well,
   writing into a linked folder; useful for editors without a Piwi plugin. Later, if asked for.

## With or without the desktop app

| Setup | What a recording gets |
| --- | --- |
| The IDE plugin alone | Everything in Parts 1 to 5: the project's Playwright and options, verified locators, live code, the step list, assertions, frames, popups, dialogs, uploads, continuing a test. Steps are written as `page.*` lines. |
| With a team instance | Also: calls to the project's page objects and helpers (the catalog), the suite's locators preferred, Tested elements in the recording browser, bug reports and gaps as starting points. |
| With the desktop app | The same as a team instance for a linked folder (the app is an instance on this machine); also **Verify** in a throwaway worktree, and bug reports Piwi Picker sends to the app opened as tests. |

The browser never needs the desktop app: the editor service launches it, and the project's Playwright installs its
browsers. The app's own Playwright runs (reproduce, bisect, Flake Lab) already work the same way, with the folder's
CLI and no bundled browser.

## Delivery

Each PR is usable on its own; sizes are relative (S, M, L).

| PR | Content | Size |
| --- | --- | --- |
| 1 | `record-ide.js` (extension build), the launcher, its headless test; both IDE plugins ship the two files | M |
| 2 | Recording sessions in the service, the protocol, the JetBrains client (Part 2), the VS Code client (commands, live block, status bar), docs in `features/editors.md` | L |
| 3 | Part 3, items 1 to 4: test id attribute, stable variable names, imports as data, `baseURL`-aware URLs | M |
| 4 | Part 3, items 5 to 12: frames, popups, dialogs, downloads, uploads, other origins, matchers, steps document v2 | L |
| 5 | The step list (`piwi/editRecording`; JetBrains tab, then a VS Code tree view) | M |
| 6 | Assertions while recording (browser panel and IDE), in the extension too | M |
| 7 | The locator at the caret in the browser, and picking a locator into the code | M |
| 8 | Run and Verify ×3 after Stop; the desktop job variant | S |
| 9 | Continue from an existing test (Part 5): fixture hook, the service's run and channel, **Record from here** | L |
| 10 | Part 6: live stream from Piwi Picker, bug report to test, gap to test (one PR each) | M |

PRs 1 and 2 are the first usable release. PR 3 should follow at once: without it, a project with its own test id
attribute or no `baseURL` gets worse code from the IDE than it expects.

## Verification

- **Core**: unit tests for every `renderSpec` change (frames, pages, dialogs, variable names, imports, URLs) and for
  `parseSteps` refusing a `v: 2` document in the old reader's terms.
- **The launcher**: `packages/editor/tests/launcher.test.ts` starts headless Chromium with the repository's
  Playwright, serves fixture pages through `context.route`, drives them with Playwright's own input (trusted, as a
  person's is), and compares the rendered block with the expected code: the spike, made a test. Frames, popups,
  dialogs, downloads and uploads get a page each.
- **The extension** is unchanged by PR 1 apart from a build entry; its e2e suite must stay green.
- **JetBrains**: a platform test applies a sequence of `RecordingUpdate`s to a document and checks the text, the single
  undo step and the pause on a user edit; the block arithmetic lives in `Glue.kt`, tested without an IDE.
- **VS Code**: the integration suite runs `piwi.record` against a stub that sends updates.
- **By hand**: `./gradlew runIde` with a sandboxed WebStorm on the dashboard's own tests (`run-app` skill for the
  server), recording a flow across two pages with a catalog call.

## Risks

- **The recorder runs in the page's own JavaScript world.** Playwright's init scripts run there, where the extension
  has an isolated world: the page can see the binding and the recorder's globals, and a page that replaces DOM
  methods can disturb capture. The binding validates every event, and the code generator writes nothing a step can
  turn into code. In Chromium, a later step can load the bundle into an isolated world through the DevTools protocol.
- **Firefox and WebKit are unverified.** The spike ran in Chromium only (the others were not installed). The recorder
  is DOM code and both browsers support init scripts and bindings, but each needs the launcher's test before it is
  offered; Chromium is the default either way.
- **Remote development.** With JetBrains Gateway, Dev Containers or Codespaces, the service runs where the code is,
  and a headed browser there has no display (WSLg on Windows 11 is the exception). The session must say so plainly;
  a browser on the developer's machine, reached from the remote service, is a later design.
- **Applications that refuse automated browsers** (`navigator.webdriver` is true under Playwright): some sign-in pages
  do. The project's `storageState` and the Piwi Picker stream (Part 6) are the ways around it.
- **The JetBrains block**: replacing a range on every update while keeping one undo step, the formatter and the user's
  typing is the least certain part of the client. A short platform test of the command grouping comes first in PR 2.
- **Two bundles of one recorder** can drift. They share every source file; the build constant changes three
  behaviors, and both bundles are tested in CI.
- **Playwright versions.** The launcher uses the project's Playwright, so only long-standing APIs (`addInitScript`,
  `exposeBinding`, the reporter API, `--list`); generated code must match the project's version (`contentFrame()`
  from 1.43). The oldest version is the one the reporter supports.
- **Continue from an existing test** depends on the capture fixtures and, for actions without a locator, on Playwright's
  instrumentation listener, an internal API the resource ledger already feature-checks.

## Open questions

1. **Keep a panel in the page, or put every control in the IDE?** Recommendation: keep a small one (Stop, Assert, the
   step count): the developer's eyes are on the browser while recording.
2. **Which browser by default?** Recommendation: Chromium; the project's own browser as a choice once Firefox and
   WebKit pass the launcher's test.
3. **Continue from a test without the capture fixtures**: require them (and offer `piwi init`), or use Playwright's
   reused contexts, as Microsoft's extension does? Playwright 1.63 made `reuseContext` a public option, but turning
   it and `connectOptions` on for one run without editing the config takes internal environment variables
   (`PW_TEST_REUSE_CONTEXT`, `PW_TEST_CONNECT_WS_ENDPOINT`), and taking the reused context over from another client
   an internal method. Recommendation: require the fixtures, look again if users ask.
4. **A command-line recorder** (`piwi record tests/new.spec.ts`) for editors without a plugin: the launcher and the
   bundle are FSL, the reporter that holds the CLI is MIT. Ship it from an FSL package, or not at all?
5. **Names of environment variables for secrets**: from the field's label (`E2E_PASSWORD`), or with a project prefix
   set in the reporter's options?

## Not in this plan

- **A browser inside the IDE window** (JCEF in the JetBrains IDEs): one remote-debugging port for the whole IDE, an
  older Chromium than the tests use, nothing equivalent in VS Code.
- **AI-written steps or assertions**: the generator stays deterministic, as the catalog matcher is.
- **Generating page objects from a recording**: the catalog uses the project's existing ones; writing new classes is a
  separate design.
- **Other languages' Playwright** (Python, Java, .NET): the reporter, the catalog and the generator are TypeScript.

## Defects found while researching this plan

- The recorder ignores the project's test id attribute (Part 3, item 1).
- Environment variable names for secrets follow the step index and change while recording (Part 3, item 2).
- In the extension, a new tab of the recorded origin joins the recording and its steps are written against `page`
  (Part 3, item 6); found by reading the code, not reproduced.
- `piwi/renderSteps` writes paths whatever the project's `baseURL` (Part 3, item 4).

## Appendix: the spike

`record-host.ts`, about 190 lines run with `tsx` against this repository's `node_modules` (Playwright 1.63, headless
Chromium), with `apps/extension/dist/record-panel.js` from `npm run extension:build` (233 KB, unchanged):

1. `context.exposeBinding('__piwiHost', …)` kept the recording state in Node and answered `piwi-session-storage`,
   `piwi-append-recording-event`, `piwi-ping` and `piwi-tab-zoom`.
2. An init script defined a `chrome` object over that binding, without `storage.session`, so the recorder took its
   message path, plus `i18n` from the English catalog.
3. `context.addInitScript({ path: record-panel.js })` loaded the recorder into every document.
4. Fixture pages served by `context.route`: a shop on one origin with a search field and a same-origin iframe, a
   sign-in page on a second origin, an account page back on the first. Playwright's own input drove them.
5. On each append, Node ran `sessionFromEvents` and `renderSpec` with the options of `piwi/renderSteps`.

The last rendered body:

```ts
await page.goto('/');
await page.getByRole('textbox', { name: 'Search' }).fill('red shoes');
await page.getByRole('textbox', { name: 'Search' }).press('Enter');
await expect(page).toHaveURL(/\/promo(?:[?#]|$)/);                       // wrong: the iframe's URL
await expect(page.getByRole('button', { name: 'Claim coupon' })).toHaveCount(1);
await page.getByRole('button', { name: 'Claim coupon' }).click();        // wrong: inside the iframe
await expect(page).toHaveURL(/:\/\/[^/]+\/?(?:[?#]|$)/);
await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(1);
await page.getByRole('link', { name: 'Sign in' }).click();
await expect(page).toHaveURL(/\/login(?:[?#]|$)/);                       // the second origin
await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(1);
await page.getByRole('textbox', { name: 'Email' }).fill('dev@example.com');
await page.getByRole('textbox', { name: 'Password' }).fill(process.env.PIWI_TEST_VALUE_6 ?? '');
await page.getByRole('button', { name: 'Continue' }).click();
await expect(page).toHaveURL(/\/account(?:[?#]|$)/);
await expect(page.getByTestId('add-to-cart')).toHaveCount(1);
await page.getByTestId('add-to-cart').click();
```

What it showed:

- The recorder needed no change: 9 steps across 3 pages on 2 origins.
- From an event in the page to the rendered body in Node: 2 to 7 ms. `renderSpec`: 0.03 to 1.1 ms.
- With `chrome.storage.session` present, the read-then-write of each append lost the two clicks that navigated away
  (Sign in, Continue); the message path, one atomic append, kept them. The launcher must use the message path.
- The iframe's click produced the two wrong lines marked above (Part 3, item 5).
- The password's variable was `PIWI_TEST_VALUE_5` until a late step arrived, then `PIWI_TEST_VALUE_6` (Part 3,
  item 2).
- Not tested: a headed browser, Firefox, WebKit.

A second check read the resolved `use` options of `apps/application/playwright.config.ts` with a short reporter
(`onBegin` prints `config.projects[].use`) run as `playwright test --list --reporter=<file>`: 2.2 s, `baseURL`,
`viewport`, `userAgent`, `deviceScaleFactor`, `extraHTTPHeaders` and `launchOptions` as Playwright resolved them.
`--reporter=json` leaves `use` out.
