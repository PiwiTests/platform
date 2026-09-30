---
title: Editor extensions
description: "Piwi in VS Code and the JetBrains IDEs: the latest CI failures at their failing lines with the heal as a quick fix, the tests behind each locator and file, brittle locators, and the locators an unsaved change breaks."
lang: en-US
---

# Editor extensions

The Piwi extension for VS Code (and Cursor, VSCodium) and the Piwi plugin for the JetBrains IDEs with the LSP API
(WebStorm, IntelliJ IDEA Ultimate, Rider, from 2024.1) bring what the dashboard knows about your suite to the line you
are editing. Both run the same editor service; [JetBrains IDEs](#jetbrains-ides) lists what the plugin draws
differently.

## Install and connect

Install **Piwi** from the extensions view (`piwitests.piwi`) or from **Settings → Plugins** in a JetBrains IDE. It
starts on a workspace that holds a Playwright config, and reads the connection the reporter already uses: the
`PIWI_*` variables in the environment or the workspace `.env`, or the [desktop app](/features/desktop). Otherwise,
run **Piwi: Connect** (**Settings → Tools → Piwi** in a JetBrains IDE) and sign in with the browser:
[Editor connection](./editor-connection) has the steps.

Nothing from your workspace is sent to the instance: the project's
[locator index](/guide/concepts#locator-index), [code reach](/features/code-reach) and latest run are downloaded and
compared with your files locally.

## CI failures in the Problems panel

The failures of the latest run on the checked-out branch (else the default branch) are errors in the Problems panel,
at the line that failed: the call in the error's stack when that file is in your workspace (often a page
object), else the `test(…)` line. The message is the failure's headline. The run is read every minute.

On a failure, the quick fixes are:

- **Heal: use …** — when [locator healing](/features/locator-healing) has a recommendation for the failing locator,
  the same edit an [auto-heal pull request](/features/auto-heal) would make, applied to the line in place.
- **Open the trace** — downloads the trace and opens it with `npx playwright show-trace`.
- **Apply the fix plan, then run its verification** — when the failure's [cluster](/features/failure-clusters) has a
  [fix plan](/features/fix-plans) whose patch applies to your files (or locator rewrites whose lines still read as
  captured): VS Code previews the edit before applying it, then runs the plan's verify command in a terminal.
- **Copy context for agent** — one block with the failure, its locator healing and the cluster's fix plan, for a coding
  agent.
- **Open the failure in the dashboard** — the execution page, with every piece of [evidence](/features/evidence).

Hover the line for the error message, its call chain, the failure screenshot, and the tickets linked to the failure's
cluster or test with their status. Without one, **File an issue** opens the cluster in the dashboard, where issues are
created.

## The status bar

The latest run on the branch: how many tests passed, failed and were flaky, with its progress while it runs. Click it
to open the run. When the extension is not connected, the item says why and runs **Piwi: Connect**.

## The tests behind each line

Lines above the code (CodeLens):

| File | What it shows | Click |
|---|---|---|
| A spec | the tests Piwi knows in it; beside each `test(…)`, its latest result in the gutter, a failing test's body tinted, and on hover how often it passed, its [flaky](/features/flaky-tests) score and root cause, its quarantine, and its selections | opens the test in the dashboard |
| A page object or spec | above each locator line, the tests using it, their actions, and how many fail or are flaky | runs those tests |
| An application file | the tests that reach it, from [code reach](/features/code-reach) | runs those tests |
| A page file (Nuxt `pages/**`) | the tests acting on that page, its locators and how many are brittle | runs those tests |

In a failing test, the line it failed at (in the spec, the line that calls the page object) is tinted darker, with the
reason, **Screenshot** and **Trace** above it.

**Piwi: Run the tests that reach this file** runs them in a terminal, with the arguments `piwi run` would use;
**Piwi: Run selection…** runs one of the project's saved [selections](/features/test-selection).

## Timeouts

A test whose `test.slow()` is no longer needed, or whose timeout is far above its p95, gets a note on its line and a
quick fix: remove the `test.slow()`, or set `test.setTimeout` to the
suggested value.

## Completion

- After `page.` (or `this.page.`) in a spec or a page object: the locator chains your suite already uses on the pages
  this file's tests visit, most used first and brittle ones last.
- At the start of a statement: the [functions](/features/test-functions) of your catalog whose URL pattern matches
  those pages, as a call with a placeholder per parameter.
- In a `piwi:` annotation: the types (`piwi:owner`, `piwi:priority`, `piwi:feature`, `piwi:link`), then the owners your
  `CODEOWNERS` names, the priorities, or the project's features; in `tag: ['@…']`, the tags your tests already use.

## Brittle locators

A locator the [stability rules](/reference/locator-stability) rate brittle is a warning on its line; one worth a
look is a hint. When the capture fixtures stored a stable alternative for that call site on its last passing run, the
quick fix replaces the chain with it.

## The locators a change breaks

In an application file, the unsaved buffer is compared with `HEAD` as you type, the same way
[`piwi preflight`](/features/preflight) compares a diff. A changed line whose string a locator finds its element by is
a warning, with the chains it breaks and their tests on hover, and one quick fix that rewrites every call site.

## Piwi's MCP server for the agent

In VS Code 1.101 and later, the extension provides Piwi's [MCP server](/features/mcp) to the editor's agent with the
connection it already has: it is listed under the MCP servers, and the agent can read failures, flaky tests and
healings. In an editor without that API, **Piwi: Copy the MCP server configuration** puts an `mcp.json` entry on the
clipboard. It holds your API key: paste it into your user settings, not into the repository.

## Commands

| Command | What it does |
|---|---|
| Piwi: Connect, Disconnect | See [Editor connection](./editor-connection) |
| Piwi: Refresh | Fetch the indexes and the latest run again |
| Piwi: Run the tests that reach this file | Run them in a terminal |
| Piwi: Open in dashboard | Open this file's test, or the latest run |
| Piwi: Run selection… | Run one of the project's saved selections |
| Piwi: Open the latest run | Open the run the status bar shows |
| Piwi: Copy the MCP server configuration | For editors without the MCP provider API |
| Piwi: Pair with Piwi Picker | Copy the address Piwi Picker sends to |

## Send from Piwi Picker

A locator picked with the [Piwi Picker](./extension) browser extension, or a flow it recorded, lands at the editor's
cursor:

1. In the editor, run **Piwi: Pair with Piwi Picker** (**Tools → Piwi → Pair with Piwi Picker** in a JetBrains IDE).
   It copies a pairing address, `http://127.0.0.1:<port>/…#<token>`.
2. In Piwi Picker's settings, paste it under **Send to editor** and click **Pair**; the browser asks once for access to
   that local address.
3. A picked locator's row and the recording review then show **Send to editor**. A locator is inserted in the copy
   form you chose; a recording is rendered by the editor as the body of a test, like
   [`piwi codegen --body`](/reference/cli#codegen), with the project's functions and the locators its tests already
   use.

The editor listens on the loopback interface only, and accepts a request only with the token. Nothing goes through the Piwi instance. With several VS Code windows open,
the one that paired receives.

## JetBrains IDEs

The plugin starts the editor service with the project's Node.js interpreter (**Settings → Languages & Frameworks →
Node.js**) once it finds a Playwright config within four folders of the project's (in Rider, the solution's) or of its
Git root; **Tools → Piwi → Refresh** looks again. The IDE's LSP client shows warnings, quick fixes and hover in open
files; the rest is native:

- **The Piwi tool window** names the connection, has Connect and Refresh in its toolbar, and lists the latest run's
  failures, since the IDE highlights open files only. Double-click
  one to open its failing line, where the highlight carries **Heal**, **Open the trace** and the dashboard link.
- **Code Vision** shows the lines above files, locators and failing lines; each test's result is in the gutter.
- **The status bar** shows the latest run; the actions are under **Tools → Piwi**, and **Run the tests that reach this
  file** is also in the editor's context menu.
- **MCP**: **Copy the MCP server configuration** puts an `mcpServers` entry on the clipboard for **Settings → Tools → AI
  Assistant → Model Context Protocol** or another agent. It runs the server through `mcp-remote`, with the key in its
  environment.
- **[Open in IDE](./ide-integration)**: a path clicked in the dashboard opens at its line, with nothing to set.

IntelliJ IDEA Community Edition and Android Studio do not have the LSP API the plugin needs.
