# Editor service — agent guide

Rules for working inside `packages/editor/` (`@piwitests/editor`, the Piwi language server). Read
[`../../AGENTS.md`](../../AGENTS.md) first for repo-wide conventions.

## What it is

One language server, bundled into `dist/piwi-language-server.cjs` by `npm run editor:build`, that every editor client
ships and starts over stdio: the VS Code extension and the JetBrains plugin. All editor logic lives here, so the
clients stay thin and both editors give the same answers.

- `src/server.ts` wires the protocol: diagnostics, quick fixes and hover, plus the custom requests of
  `src/protocol.ts` (`piwi/fileSummary`, `piwi/testsForFile`, `piwi/runArgs`, `piwi/status`, `piwi/runStatus`,
  `piwi/failures`, `piwi/trace`, `piwi/screenshot`, `piwi/mcp`, `piwi/renderSteps`, `piwi/refresh`, `piwi/refreshRun`,
  `piwi/desktopJob`, `piwi/shareDesktopJob`, `piwi/record`, `piwi/stopRecording`, `piwi/recordingCommand`,
  `piwi/pageCandidates`, the `piwi/setCredentials` and `piwi/commandEnded` notifications, and the
  `piwi/runStatusChanged`, `piwi/statusChanged`, `piwi/notice`, `piwi/desktopJobChanged` and `piwi/recordingChanged`
  notifications it sends). A client renders `piwi/fileSummary` natively (CodeLens, Code Vision), `piwi/runStatus` in
  its status bar, and `piwi/failures` in a list where its LSP client highlights open files only (the JetBrains IDEs).
- The latest run on the checked-out branch is read again whenever a run ends, and polled besides (below); while that
  branch has none, the default branch's, else the newest of any branch (`runBranch` and `checkedOut` in
  `piwi/runStatus`).
  Its failures are published as `ci-failure` diagnostics in every file they point to, merged with the analysis of
  open documents. The instance lays over that run the runs of its branch finished since, whole or partial (a test
  re-run from the editor, `piwi run`, the desktop app: `branch-failures?overlays=1`), per test and Playwright project,
  the newest result winning: a failure may be listed from a later run (`source: 'overlay'`, labeled `local run #N`
  when it did not run in CI, `your run #N` when the editor started it), and a failure a later run passed moves to
  `resolved`, which publishes no diagnostic: its test's line says `fixed locally in run #N` with `status: 'passed'`,
  `piwi/failures` lists it as `fixed-locally`, and `piwi/runStatus` counts it in `resolved` beside `failingTests` and
  `overlays`, which the status bars show.
  On a spec, `piwi/fileSummary` gives each test's line its latest result (`status`) and the line its
  call ends on (`endLine`, `callEndLine`), which the clients draw in the gutter and as a background over a failing test.
  A failing test's line also carries `failure`: the line of the test its error's stack goes through (the instance sends
  the frames and the message in `branch-failures`), above which the reason, **Screenshot** and **Trace** are ordinary
  summary lines; the hover on any line of that stack shows the message and the call chain.
  A flaky test's line also carries the Flake Lab lines (`flakeLabLines`, from `GET /api/projects/:id/flake-lab`): its
  flaky rate and top suspect, then `piwi flake` commands run through `piwi.runCommand`, with `--server-url` only when
  the command, run from the config's folder, would find another instance (`withServerUrl`), and, while the desktop app
  runs beside a team instance, the reproduction as a desktop job (`piwi.desktopJob`, kind `flake-lab`).
- Runs are pushed, and the poll is the fallback (`src/run-stream.ts`, `src/run-watch.ts`). One server-sent events
  stream per instance and key (`GET /api/stream`, `InstanceStream`), shared by the contexts that read it, says when a
  run of their project starts or ends; it is opened again after 1 s, doubling to a minute, every five minutes after a
  404 (an instance without the route), not after a 401 or 403 until the credentials change. Half a second after a run
  ends (runs that end together are read once), the context reads its latest run again; while its stream is connected,
  the poll reads it every five minutes, otherwise every minute, every 15 seconds while a run is in progress (`stream`
  and `updatedAt` in `piwi/runStatus`). A run in progress on the context's branch, or the editor's own wherever it
  runs, is `live` in `piwi/runStatus`, counted through its own stream (`GET /api/test-runs/:id/stream`), with at most
  one notification every 300 ms; it goes back to null in the notification that brings the failures read once it
  ended. `piwi/refreshRun` reads the runs alone, not the indexes `piwi/refresh` reads.
- The editor's own run: `piwi/runArgs` and `piwi/runSelection` give each command a ref (`ed-` and 8 hex characters),
  in its environment as `PIWI_ORIGIN_REF` beside `PIWI_ORIGIN=editor` and in `RunCommand.ref`; the Flake Lab lines
  and the fix plan's verification carry `PIWI_ORIGIN=editor` alone. The service looks for the run carrying it
  (`latest-run?origin=editor&ref=`, every 2 s for two minutes, or a `run-started` whose metadata names it) and keeps
  it in `PiwiContext.ownRuns` for its lifetime: its failures read `your run #N` and are `source: 'own'` in
  `piwi/failures`. A client says when the command ended (`piwi/commandEnded`, with its exit code): the service reads
  the run once more and, when no run carries the ref 5 s later, sends `piwi/notice`; the instance is not asked for the
  ref again. A later run carrying it, a rerun of the command (the Run tool window's Rerun, a VS Code terminal reused
  without shell integration), is the editor's own once the instance's stream announces it, whatever was found before;
  the service keeps the refs of the 50 latest commands.
- `src/analysis.ts` is the pure half: locators per line, stability findings, replacements, breaks of an unsaved
  change and their call-site edits. Keep new logic here, or in `@piwitests/core` when the CLI or the dashboard needs it
  too; never re-implement a core function.
- `src/context.ts` is one Playwright config of the workspace: its connection, project, branch and cached indexes.
- `src/piwi-client.ts` is the only file that talks to an instance; it opens the event streams `src/run-stream.ts` reads.
- `src/desktop-jobs.ts` passes a failure of the team instance to the desktop app as a job (`@piwitests/core/desktop-job`,
  with the token of the app's discovery file), polls its verdict and shares a bisect's first bad commit on the instance
  with the editor's key. A `flake-lab` job carries the test's reproduce plan, read from the instance with recording on
  (`source=desktop`, this machine's name); the app runs it with `piwi flake --plan <file> --json` against itself, and
  sharing posts the arms' counts, with the plan's conditions, to the experiment the instance recorded. It is offered on
  a flaky test's line and on a failure whose test has an untested suspect (`hasUntestedSuspect`). The job names commits,
  tests and lab conditions, never code; the app runs it only after a click in its window.
- `src/recorder/` records a test from the editor. `piwi/record` reads the `use` options Playwright resolves for the
  file's config (`project-options.ts`: the project's own Playwright CLI, `playwright test --list` with
  `piwi-use-reporter.cjs` and a filter no spec matches, cached until the config changes), picks the project (a config
  with several asks, through `projects`), the start page and the page expression, and forks the launcher in the
  config's folder (`sessions.ts`). The launcher (`launcher.ts`) resolves the project's Playwright at run time (never
  bundled; `playwright.ts`: in the project's own `node_modules`, the test runner's package first, as for the CLI),
  opens the browser with the project's options (`context-options.ts`: `headless: false` unless
  `PIWI_RECORDER_HEADLESS=1`, Chromium's translation feature disabled, an explicit allowlist of context options, a
  missing `storageState` file left out and said so), exposes the binding before loading `record-ide.js` into every
  page, answers the recorder over it
  (`host-state.ts`: the storage areas and messages of the IDE bundle's `chrome`, every event through core's
  `parseCaptureEvent`; only the main frame of the page it opened first records, every other frame and page, such as a
  popup or a cross-origin iframe, is answered as outside a recording), and reports over its IPC channel (`ipc.ts`).
  The events render all the steps with `renderSpec` and the whole block goes in `piwi/recordingChanged`, in order: at
  once, or, within the update interval of the latest update (`UPDATE_INTERVAL_MS`, longer after a slow rendering),
  together once it is over; a pause, from the editor or the recorder's bar (`piwi-recording-paused`, both ways through
  the launcher), records nothing until resume and says `paused` in an update, resume sends the latest again; Stop in
  the editor or in the
  browser, closing the browser or closing the file ends the session with a last update, sent at once, and closes the
  browser. `page-candidates.ts` reads the file's text alone (a scanner in the style of `callEndLine`, no TypeScript):
  the page expressions at a caret (`piwi/pageCandidates`, also the default of `piwi/renderSteps` given a `line`), the
  context there (`test`, `function`, `class` or `file`, which `piwi/record` checks against `into`), the names declared
  before it (a page object already declared is not instantiated again), where the block goes and how it is indented,
  and the module the file's `test` comes from. `imports.ts` reads the names a file's import statements bind, with the
  same scanner: the imports of an update and of `piwi/renderSteps` hold only the lines the file's text lacks.

`npm run editor:build` writes five files to `dist/`, which both clients ship side by side (VS Code in its `dist/`, the
JetBrains plugin in its `server/`); the service finds the others next to its own bundle, or in `PIWI_EDITOR_DIST`
(the `distDir` option of `startServer` in tests):

| File                         | What                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `piwi-language-server.cjs`   | The language server (`src/main.ts`).                                                                               |
| `piwi-recorder-launcher.cjs` | The launcher a recording session forks (`src/recorder/launcher.ts`).                                               |
| `piwi-use-reporter.cjs`      | The Playwright reporter that prints a config's resolved options (`src/recorder/use-reporter.ts`).                  |
| `record-ide.js`              | The recorder's IDE bundle: the browser extension's recorder, built a second time for a browser the launcher opens. |
| `record-ide-messages.json`   | The extension's catalogs for the IDE bundle, by language.                                                          |

The last two come from `buildIdeBundle`, which `build.mjs` imports from `apps/extension/scripts/build.mjs`: the build
needs the extension's sources, and a change to the recorder there changes what the editor clients ship.

## Rules

- **The protocol is a contract.** A client of an older version talks to this server, and a published client's
  commands (`piwi.openInDashboard`, `piwi.runTests`, `piwi.openTrace`, `piwi.openScreenshot`) are named in `SummaryLine.command`. A change to `protocol.ts`
  lands with both clients in the same change, and a renamed request or command is a breaking change.
- **Nothing blocks typing.** The project's indexes, failures, function catalog and vocabulary are fetched on the
  refresh timer, on `piwi/refresh` and after `piwi/setCredentials` (the failures also when a run ends, on the poll and
  on `piwi/refreshRun`), and requests answer from them. What belongs to one
  file (a spec's cases, a file's stored alternatives) or one failure (its healing, fix plan, linked issues, evidence) is
  fetched once, when first needed, and kept: only the diagnostics or the quick fix that need it wait for it.
- **The connection order is fixed** (`resolveContextConnection`): the desktop app while it runs when the editor
  chose it (`desktop` in `piwi/setCredentials`, kept on the user's machine: the app is theirs, so their choice comes
  first); then the named instance (`namedInstance`): the environment, the workspace `.env`, the editor's own settings
  (what Connect saved: explicit, so it comes before an app that only runs); then the desktop app's discovery file.
  The desktop app sits beside a shared instance, never replaces it: `piwi/status` keeps the named instance
  (`instance`) and says whether the app runs (`desktopUrl`), so Connect offers both. With the app chosen, the project
  is `desktopProject`, else the one the app links to the folder holding the Playwright config (`projects` in
  `~/.piwi/desktop.json`), else `PIWI_PROJECT_NAME`; reached because nothing else names an instance, it is
  `PIWI_PROJECT_NAME`, the editor's, else the linked one. The service watches that file, `piwi/statusChanged` tells
  the client when the app starts or quits, and `piwi/desktop` tells Connect what the app offers. A context that
  changes instance forgets everything read from the other one. The reporter keeps its own order. The API key never leaves the process except in `X-API-Key`, and in the MCP server definition `piwi/mcp` hands the
  client for its agent.
- Nothing from the workspace is sent to the instance but file paths it already stores.

## Workflow

```bash
npm run editor:build        # the five files the clients ship (the stdio and launcher tests use them)
npm run editor:typecheck
npm run editor:lint         # :fix to fix
npm run editor:format       # :check to verify only
npm run editor:test         # an in-process JSON-RPC client against a fixture repository and a stub instance
```

`tests/launcher.test.ts` runs the built launcher (`dist/`) with this repository's Playwright and Chromium, headless,
and plays a person's input through a second client attached over the DevTools protocol: run `npm run editor:build`
first (and `npx playwright install chromium` once). It skips, saying why, when either is missing.

The scope for commits here and in the editor clients is `ide`.
