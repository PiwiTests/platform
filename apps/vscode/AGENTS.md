# VS Code extension — agent guide

Rules for working inside `apps/vscode/` (the Piwi extension for VS Code, published as `piwitests.piwi` to the Visual
Studio Marketplace and Open VSX). Read [`../../AGENTS.md`](../../AGENTS.md) and
[`../../packages/editor/AGENTS.md`](../../packages/editor/AGENTS.md) first.

## What it is

A thin client of the editor service. `npm run vscode:build` builds the service's bundle and copies it to
`dist/piwi-language-server.cjs`, beside the extension's own bundle (`dist/extension.cjs`, esbuild, `vscode` external).

- `src/extension.ts` starts the service with `vscode-languageclient`, draws `piwi/fileSummary` as CodeLens and
  `piwi/runStatus` in the status bar, implements the commands the service names (`piwi.openInDashboard`,
  `piwi.runTests`, `piwi.openTrace`), keeps the API key in `SecretStorage`, and provides Piwi's MCP server through
  `vscode.lm.registerMcpServerDefinitionProvider` where the editor has it (read at runtime: `engines.vscode` stays at
  the oldest version `vscode-languageclient` supports, for Cursor and VSCodium).
- `src/send-listener.ts` is the Send to editor endpoint: `POST /piwi/send` on `127.0.0.1`, on the port kept in
  global state, with the token from `SecretStorage` (`piwi.sendToken`); **Piwi: Pair with Piwi Picker** starts it and
  copies the pairing address. A recorded flow is rendered by the service (`piwi/renderSteps`) before it is inserted.
- `src/glue.ts` is the pure half (the status bar item, the MCP configuration to paste, re-indenting an inserted block),
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
through its public commands (`vscode.executeCodeActionProvider`, `vscode.executeCodeLensProvider`, …).
