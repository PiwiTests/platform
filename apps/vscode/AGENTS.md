# VS Code extension — agent guide

Rules for working inside `apps/vscode/` (the Piwi extension for VS Code, published as `piwitests.piwi` to the Visual
Studio Marketplace and Open VSX). Read [`../../AGENTS.md`](../../AGENTS.md) and
[`../../packages/editor/AGENTS.md`](../../packages/editor/AGENTS.md) first.

## What it is

A thin client of the editor service. `npm run vscode:build` builds the service's bundle and copies it to
`dist/piwi-language-server.cjs`, with the recorder's files the service finds next to itself
(`piwi-recorder-launcher.cjs`, `piwi-use-reporter.cjs`, `record-ide.js`, `record-ide-messages.json`: `build.mjs` fails
when one is missing), beside the extension's own bundle (`dist/extension.cjs`, esbuild, `vscode` external).

- `src/extension.ts` starts the service with `vscode-languageclient`, draws `piwi/fileSummary` as CodeLens (a test's
  line as a gutter icon from `media/`, its details in a hover, the `piwi.failingTestBackground` color over a
  failing test and `piwi.failingLineBackground` on the line it failed at: `testDecorations` in `src/glue.ts`) and
  `piwi/runStatus` in the status bar (the tests still failing and those fixed locally since the latest run, from
  `failingTests` and `resolved`, and the run in progress, `live`; a notification that moves only the run in progress
  leaves the CodeLens and the gutter as they are: `runsInFiles`), implements the commands the service names
  (`piwi.openInDashboard`, `piwi.runTests`, `piwi.openTrace`, `piwi.openScreenshot`, `piwi.desktopJob`, from a quick fix or a flaky test's
  lens, which shows `piwi/desktopJobChanged` as notifications with the share button), keeps the API key in `SecretStorage`, and provides Piwi's MCP server through
  `vscode.lm.registerMcpServerDefinitionProvider` where the editor has it (read at runtime: `engines.vscode` stays at
  the oldest version `vscode-languageclient` supports, for Cursor and VSCodium).
- Commands run in a terminal (`runInTerminal`), reused per folder and environment. A test run carries its own ref
  (`RunCommand.ref`, also in its environment). Where shell integration reports commands
  (`window.onDidStartTerminalShellExecution` and `onDidEndTerminalShellExecution`, VS Code 1.93 and later, read at
  runtime like the MCP API), a test run opens a terminal of its own, which replaces the previous run's terminal of that
  folder once its command ended, and the end of its command sends `piwi/commandEnded` with the exit code. Without it,
  the test runs of a folder share one terminal, whose environment keeps the first run's ref, by which the service
  recognizes the later runs as the editor's own through the instance's event stream, and nothing is sent. A
  `piwi/notice` is shown once, as a warning or an information message.
- `src/send-listener.ts` is the Send to editor endpoint: `POST /piwi/send` on `127.0.0.1`, on the port kept in
  global state, with the token from `SecretStorage` (`piwi.sendToken`); **Piwi: Pair with Piwi Picker** starts it and
  copies the pairing address. A recorded flow is rendered by the service (`piwi/renderSteps`) before it is inserted.
- `src/recording.ts` records a test from the editor. **Piwi: Record here** asks `piwi/pageCandidates` for the caret
  (inside a test's body it records `steps`, elsewhere a new `test`); **Piwi: Record a new test file** creates a spec
  first, next to the active test file or in the config's `testDir` (`file`). The start page and the page expression
  (asked when there are several candidates) are kept in `workspaceState`, with the Playwright project, asked only when
  `piwi/record` lists them. Nothing is written before the first `piwi/recordingChanged`; each one then replaces the
  recorded block (first at `RecordResult.placement`), with the import lines the file lacks in the same edit, tinted
  with `piwi.recordingBlockBackground`, a CodeLens above it (the state, the step count, Stop, Pause or Resume), the
  recording in the status bar and its warnings as diagnostics, which stay after Stop until the block is edited. The
  block is followed through the edits around it; typing inside it pauses the recording (Resume writes it again, Keep my
  edits stops). Closing the file or the window stops its recording.
- `src/glue.ts` is the pure half (the status bar item, the MCP configuration to paste, re-indenting an inserted block,
  the recorded block's text, writes and imports, and following it through a change: `writeBlock`, `followBlock`),
  tested without an editor.

## Rules

- **No logic that the JetBrains plugin would need too.** Diagnostics, quick fixes, hover and every answer come from
  the service; this extension renders them. A new feature is a service request first.
- The API key lives in `SecretStorage`, never in settings or a workspace file, **per instance**
  (`piwi.apiKey <url>`, `apiKeySecret` in `src/connect.ts`): workspace settings, which a repository may commit, never
  select another instance's key.
- **Piwi: Connect** (`src/connect.ts`, no VS Code API) asks the instance whether it needs a key, then signs in with the
  browser (the device authorization Piwi Picker uses) or takes a pasted key, then the project. When the desktop app
  runs, it first lists the app beside the instance the workspace names (`connectChoices` in `src/glue.ts`).
- The choice of the desktop app and its project live in `workspaceState` (`piwi.desktop`, `piwi.desktopProject`), on
  this machine only: choosing the app never touches `piwi.serverUrl`, `piwi.project` or the key, so switching back is
  one pick.
- Command ids are part of the protocol: renaming one is a breaking change for the service.
- **One undo step per recording.** The block's writes go through the editor that shows the file: the first one opens
  an undo stop and the later ones join it (`undoStopBefore: false`; the one Stop brings closes it), so one Undo after
  Stop removes the block and its imports. A save during the recording (auto save included) or an edit of the file
  between two writes starts another undo step, and a write while no editor shows the file is a workspace edit, an undo
  step of its own.

## Workflow

```bash
npm run vscode:build              # the service bundle, then the extension bundle
npm run vscode:typecheck
npm run vscode:lint               # :fix to fix
npm run vscode:format             # :check to verify only
npm run vscode:test               # unit tests of src/glue.ts
xvfb-run -a npm run vscode:test:integration   # VS Code (downloaded to .vscode-test/) on a fixture repository
npm run vscode:package            # dist/piwi.vsix
```

The integration suite (`tests/integration/`) starts a stub instance, writes a fixture repository, and drives VS Code
through its public commands (`vscode.executeCodeActionProvider`, `vscode.executeCodeLensProvider`, …), and through the
API `activate` returns (`pageCandidates`, the service's answer for a position).
