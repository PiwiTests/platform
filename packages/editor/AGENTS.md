# Editor service — agent guide

Rules for working inside `packages/editor/` (`@piwitests/editor`, the Piwi language server). Read
[`../../AGENTS.md`](../../AGENTS.md) first for repo-wide conventions.

## What it is

One language server, bundled into `dist/piwi-language-server.cjs` by `npm run editor:build`, that every editor client
ships and starts over stdio: the VS Code extension and the JetBrains plugin. All editor logic lives here, so the
clients stay thin and both editors give the same answers.

- `src/server.ts` wires the protocol: diagnostics, quick fixes and hover, plus the custom requests of
  `src/protocol.ts` (`piwi/fileSummary`, `piwi/testsForFile`, `piwi/runArgs`, `piwi/status`, `piwi/runStatus`,
  `piwi/failures`, `piwi/trace`, `piwi/screenshot`, `piwi/mcp`, `piwi/renderSteps`, `piwi/refresh`, `piwi/desktopJob`,
  `piwi/shareDesktopJob`, the `piwi/setCredentials` notification and the `piwi/runStatusChanged`, `piwi/statusChanged`
  and `piwi/desktopJobChanged` notifications it sends). A client renders `piwi/fileSummary` natively (CodeLens, Code
  Vision), `piwi/runStatus` in its status bar, and `piwi/failures` in a list where its LSP client highlights open
  files only (the JetBrains IDEs).
- The latest run on the checked-out branch is read every minute (every 15 seconds while it runs); while that branch
  has none, the default branch's, else the newest of any branch (`runBranch` and `checkedOut` in `piwi/runStatus`).
  Its failures are published as `ci-failure` diagnostics in every file they point to, merged with the analysis of
  open documents. On a spec, `piwi/fileSummary` gives each test's line its latest result (`status`) and the line its
  call ends on (`endLine`, `callEndLine`), which the clients draw in the gutter and as a background over a failing test.
  A failing test's line also carries `failure`: the line of the test its error's stack goes through (the instance sends
  the frames and the message in `branch-failures`), above which the reason, **Screenshot** and **Trace** are ordinary
  summary lines; the hover on any line of that stack shows the message and the call chain.
  A flaky test's line also carries the Flake Lab lines (`flakeLabLines`, from `GET /api/projects/:id/flake-lab`): its
  flaky rate and top suspect, then `piwi flake` commands run through `piwi.runCommand`, with `--server-url` only when
  the command, run from the config's folder, would find another instance (`withServerUrl`), and, while the desktop app
  runs beside a team instance, the reproduction as a desktop job (`piwi.desktopJob`, kind `flake-lab`).
- `src/analysis.ts` is the pure half: locators per line, stability findings, replacements, breaks of an unsaved
  change and their call-site edits. Keep new logic here, or in `@piwitests/core` when the CLI or the dashboard needs it
  too; never re-implement a core function.
- `src/context.ts` is one Playwright config of the workspace: its connection, project, branch and cached indexes.
- `src/piwi-client.ts` is the only file that talks to an instance.
- `src/desktop-jobs.ts` passes a failure of the team instance to the desktop app as a job (`@piwitests/core/desktop-job`,
  with the token of the app's discovery file), polls its verdict and shares a bisect's first bad commit on the instance
  with the editor's key. A `flake-lab` job carries the test's reproduce plan, read from the instance with recording on
  (`source=desktop`, this machine's name); the app runs it with `piwi flake --plan <file> --json` against itself, and
  sharing posts the arms' counts, with the plan's conditions, to the experiment the instance recorded. It is offered on
  a flaky test's line and on a failure whose test has an untested suspect (`hasUntestedSuspect`). The job names commits,
  tests and lab conditions, never code; the app runs it only after a click in its window.

## Rules

- **The protocol is a contract.** A client of an older version talks to this server, and a published client's
  commands (`piwi.openInDashboard`, `piwi.runTests`, `piwi.openTrace`, `piwi.openScreenshot`) are named in `SummaryLine.command`. A change to `protocol.ts`
  lands with both clients in the same change, and a renamed request or command is a breaking change.
- **Nothing blocks typing.** The project's indexes, failures, function catalog and vocabulary are fetched on the
  refresh timer, on `piwi/refresh` and after `piwi/setCredentials`, and requests answer from them. What belongs to one
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
npm run editor:build        # the bundle the clients ship (the stdio test uses it)
npm run editor:typecheck
npm run editor:lint         # :fix to fix
npm run editor:format       # :check to verify only
npm run editor:test         # an in-process JSON-RPC client against a fixture repository and a stub instance
```

The scope for commits here and in the editor clients is `ide`.
