# Editor service — agent guide

Rules for working inside `packages/editor/` (`@piwitests/editor`, the Piwi language server). Read
[`../../AGENTS.md`](../../AGENTS.md) first for repo-wide conventions.

## What it is

One language server, bundled into `dist/piwi-language-server.cjs` by `npm run editor:build`, that every editor client
ships and starts over stdio: the VS Code extension and the JetBrains plugin. All editor logic lives here, so the
clients stay thin and both editors give the same answers.

- `src/server.ts` wires the protocol: diagnostics, quick fixes and hover, plus the custom requests of
  `src/protocol.ts` (`piwi/fileSummary`, `piwi/testsForFile`, `piwi/runArgs`, `piwi/status`, `piwi/runStatus`,
  `piwi/failures`, `piwi/trace`, `piwi/mcp`, `piwi/refresh`, the `piwi/setCredentials` notification and the
  `piwi/runStatusChanged` notification it sends). A client renders `piwi/fileSummary` natively (CodeLens, Code
  Vision), `piwi/runStatus` in its status bar, and `piwi/failures` in a list where its LSP client highlights open
  files only (the JetBrains IDEs).
- The latest run on the checked-out branch is read every minute (every 15 seconds while it runs); its failures are
  published as `ci-failure` diagnostics in every file they point to, merged with the analysis of open documents.
- `src/analysis.ts` is the pure half: locators per line, stability findings, replacements, breaks of an unsaved
  change and their call-site edits. Keep new logic here, or in `@piwitests/core` when the CLI or the dashboard needs it
  too; never re-implement a core function.
- `src/context.ts` is one Playwright config of the workspace: its connection, project, branch and cached indexes.
- `src/piwi-client.ts` is the only file that talks to an instance.

## Rules

- **The protocol is a contract.** A client of an older version talks to this server, and a published client's
  commands (`piwi.openInDashboard`, `piwi.runTests`, `piwi.openTrace`) are named in `SummaryLine.command`. A change to `protocol.ts`
  lands with both clients in the same change, and a renamed request or command is a breaking change.
- **Nothing blocks typing.** Requests answer from the cache; fetching happens on the refresh timer, on `piwi/refresh`
  and after `piwi/setCredentials`.
- **The connection order is fixed**: the environment, the workspace `.env`, the desktop app's discovery file, then the
  editor's own settings (`resolveContextConnection`). The API key never leaves the process except in `X-API-Key`, and in the MCP server definition `piwi/mcp` hands the
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
