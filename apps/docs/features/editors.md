---
title: Editor extensions
description: "Piwi in VS Code: the latest CI failures at their failing lines with the heal as a quick fix, the tests behind each locator and file, brittle locators, and the locators an unsaved change breaks."
lang: en-US
---

# Editor extensions

The Piwi extension for VS Code brings what the dashboard knows about your suite to the line you are editing. It works
in VS Code, Cursor and VSCodium (from the Visual Studio Marketplace or Open VSX). A plugin for the JetBrains IDEs is
next; both run the same editor service, so both show the same answers.

## Install and connect

Install **Piwi** (`piwitests.piwi`) from the extensions view. It starts on a workspace that holds a Playwright config,
and reads the connection the reporter already uses, in this order:

1. `PIWI_DASHBOARD_URL`, `PIWI_API_KEY` and `PIWI_PROJECT_NAME` in the environment;
2. the same variables in the `.env` next to the Playwright config, then at the repository root;
3. the [desktop app](/features/desktop), when it runs;
4. the extension's own settings: run **Piwi: Connect**, give the instance URL and an
   [API key](/operate/api-keys), and pick the project. The key goes to VS Code's secret storage, never to a file.

Nothing from your workspace is sent to the instance: the extension downloads the project's
[locator index](/guide/concepts#locator-index), its [code reach](/features/code-reach) index and the latest run, and
compares them with your files locally.

## CI failures in the Problems panel

The failures of the latest run on the checked-out branch are errors in the Problems panel, at the line that failed:
the call in the error's stack when that file is in your workspace (often a page object), else the `test(…)` line. The
message is the failure's one-line headline. The run is read every minute, every 15 seconds while it runs.

On a failure, the quick fixes are:

- **Heal: use …** — when [locator healing](/features/locator-healing) has a recommendation for the failing locator,
  the same edit an [auto-heal pull request](/features/auto-heal) would make, applied to the line in place.
- **Open the trace** — downloads the execution's trace and opens it in Playwright's trace viewer
  (`npx playwright show-trace`) from the Playwright config's directory.
- **Open the failure in the dashboard** — the execution page, with every piece of [evidence](/features/evidence).

Hover the line for the failure screenshot.

## The status bar

The latest run on the branch: how many tests passed, failed and were flaky, with its progress while it runs. Click it
to open the run. When the extension is not connected, the item says why and runs **Piwi: Connect**.

## The tests behind each line

Lines above the code (CodeLens):

| File | What it shows | Click |
|---|---|---|
| A spec | the tests Piwi knows in it; above each `test(…)`, how often it passed | opens the test in the dashboard |
| A page object or spec | above each locator line, the tests using it, their actions, and how many fail or are flaky | runs those tests |
| An application file | the tests that reach it, from [code reach](/features/code-reach) | runs those tests |

**Piwi: Run the tests that reach this file** runs them in a terminal, with the arguments `piwi run` would use.

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
| Piwi: Connect | Choose the instance, the API key and the project |
| Piwi: Refresh | Fetch the indexes and the latest run again |
| Piwi: Run the tests that reach this file | Run them in a terminal |
| Piwi: Open in dashboard | Open this file's test, or the latest run |
| Piwi: Open the latest run | Open the run the status bar shows |
| Piwi: Copy the MCP server configuration | For editors without the MCP provider API |
