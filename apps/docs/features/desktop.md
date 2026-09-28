---
title: Desktop app
description: "The whole dashboard as a local desktop app: no Docker or Node, local test runs from the window, and one-click MCP setup for AI assistants."
lang: en-US
---

# Desktop app

<Needs desktop />

The desktop app runs the **entire dashboard on your machine**, with no Docker, no `npx` and no server to set up. It
bundles the same server as the Docker image in a native window, keeps your data in a local folder, and adds what only
a local app can do: run your tests from the window, reproduce a failure in a clean checkout, bisect to the commit that
broke it, and wire your AI assistants in one click. It suits a single developer running Playwright locally.

## What it does

- **Receives your local runs** with no URL or token in your Playwright config.
- **Links a project to its checkout**, so a run page can re-run the failed tests here.
- **Reproduces and bisects** a failure in a throwaway worktree, leaving your working tree alone.
- **Imports** a blob report or trace dropped on the window.
- **Connects AI assistants** to its MCP server by writing their config for them.

Everything binds to `127.0.0.1`: nothing is exposed to the network, and the app never accepts results from other
machines. For a shared, always-on server, run the [Docker image](/operate/deployment).

## Where it is

Download the installer from the [latest release](https://github.com/PiwiTests/platform/releases/latest):

| OS | Installer |
|----|-----------|
| **Windows** | `.exe` (per-user, no admin) or `.msi` (per-machine) |
| **macOS** (Apple silicon) | `.dmg` |
| **Linux** (x86-64) | `.AppImage`, `.deb` or `.rpm`, each needing a system WebKitGTK (`webkit2gtk-4.1`) |

The installers are **unsigned**, so the OS warns on first launch. On macOS, right-click the app, then **Open** twice;
on Windows, **More info** then **Run anyway** in SmartScreen. Linux shows no prompt.

Data lives in the OS app-data folder (`%APPDATA%\io.piwitests.dashboard\.data` on Windows,
`~/Library/Application Support/io.piwitests.dashboard/.data` on macOS, `~/.local/share/io.piwitests.dashboard/.data`
on Linux): `piwi.db` (SQLite) and `storage/`. **Settings → Storage → Data location** and the tray's **Open data
folder** show it. Back it up by copying the folder while the app is closed.

The window navigates like a browser: back and forward buttons sit at the top of the sidebar, and the mouse side
buttons and trackpad swipes work. Closing the window quits the app unless you turn on **Run in background** in the
tray menu; **Start on login** launches it hidden into the tray. While the window is in the background, your
[notifications](/features/notifications) arrive as OS notifications, with an unread count on the dock icon or in the
tray tooltip.

## Sending results to it

While the app runs, the reporter finds it by itself: a config with only a `projectName` reports here. The app writes
its address and a local access token to `~/.piwi/desktop.json`, and the reporter reads that file only when neither
the config nor the environment sets a server URL or an API key, so a project pointed at a shared dashboard, or a CI
job, is never redirected. [Finding the desktop app automatically](/guide/reporter#finding-the-desktop-app-automatically)
has the details.

When the tests run as another user or in a container, **Settings → Storage → Send results to this app** gives the
address (port 3000 unless it is taken) and the token to configure by hand. Keep the token in `PIWI_API_KEY` rather
than in the config: binding to `127.0.0.1` keeps other machines out, the token keeps out other local processes and
browser pages.

A dashboard link opened in your browser, such as the reporter's `View run:` line, opens in the app instead.

## Projects from local folders

**Projects → New project → Choose folder…** creates a project from a checkout on this machine. The app detects the
name it would report under and checks the setup (a Playwright config, Playwright installed, the reporter wired in);
anything missing is a warning, and `npx @piwitests/reporter init` in the folder fixes it. The link to the folder
stays on this machine, under **project page → Edit → Local folder**, with the same checks and **Change** and
**Unlink**. Linking a folder offers to import the runs already in its `blob-report/` and `test-results/` folders, and
[Open in IDE](/features/ide-integration) resolves source links against it when no workspace root is set.

## Running tests from the app

**Run locally**, on a run page or an execution page, re-runs the failed tests on this machine with the folder's own
Playwright and the app's bundled Node. The first time, it asks you to link the project to its folder.

- **The arrow next to the button** holds the options: headless, headed, the Playwright inspector or UI mode; tests
  by `file:line`, title or file; a forced trace; `--repeat-each` up to 1,000 times. The last choice becomes the
  project's one-click default, and **Run with options…** shows the exact command.
- **Runs keep going while you browse.** Output streams into the **Local runs** tray, a sidebar pill keeps it one
  click away, and stopping is always explicit. Leaving the app with runs active asks first.
- **More places to run from:** **Reproduce locally** on a test case (the test 20 times with a trace, for a flaky
  test) and **Run affected locally** on a failure cluster.
- **Wrong folder?** When none of the tests exist in the linked folder, the button opens the dialog to fix the link.

The run uses your project's own Playwright config, so its reporter sends the results here like a run from your
terminal, and the tray entry links to the new run as soon as it checks in. The folder needs `@playwright/test`
installed and the reporter in its config; the **Local folder** checks show both.

### Reproducing a failure and finding the breaking commit

The [reproduce and bisect](/features/fix-plans#reproduce-and-bisect) recipe of a fix plan can run here, against the
linked folder, **without touching your checkout**:

- **Reproduce here** checks out the failing commit in a throwaway
  [`git worktree`](https://git-scm.com/docs/git-worktree), installs its dependencies (reusing your `node_modules`
  when the lockfile is unchanged) and the browser if missing, and runs the failing test with that commit's own
  Playwright.
- **Find the breaking commit here** bisects step by step between the last green commit and the failing one, with live
  progress (*step 3 of ~7*) and a **Stop** that kills the test and what it started, resets the bisect and removes
  the worktree. The first bad commit is linked to your SCM host and recorded on the failure cluster.

It needs `git` and your package manager on this machine, and bisects one repository. The application under test has
to build from the same checkout: a Playwright `webServer` starts it at each commit, or set a **start command** and a
readiness URL under the linked folder's settings.

## Importing local files

Drop a Playwright blob report or trace (`.zip`) on the window, or open one with **Open with → Piwi Dashboard**, and
pick the project: the file is imported from disk, several traces can form one run, and the app never becomes your
default `.zip` handler. Imports behave as on the [import page](/guide/importing-runs): idempotent, and they never
trigger notifications, AI diagnosis or regression signals.

## Connecting AI assistants

The app serves the [MCP server](/features/mcp) with three local tools a hosted instance cannot offer:
`import_local_report` (a local `.zip` into a project), `read_local_source` (the file on disk now, not at failure
time) and `apply_locator_fix` (a recommended locator fix applied to the file, previewed by default). It registers as
`piwi-desktop`, so it sits beside a hosted Piwi in the same client.

The **MCP server** page detects Claude Code, Claude Desktop, Cursor, VS Code, Windsurf and Gemini CLI, and connects
each in one click by writing a `piwi-desktop` entry, with the address and token, into the client's own config file.
It keeps a backup of the file, touches only that entry, never rewrites a config that is not plain JSON (it shows the
snippet instead), and rewrites the entry at each launch if the port changed. Claude Desktop, which takes only local
commands, is pointed at the app's built-in bridge (`piwi-desktop mcp-stdio`), so no token is copied; the app has to be
running for it. Restart the client after connecting.

## Updates

**Settings → About → Updates** checks for a newer release, downloads it and applies it on restart. The app also
checks at startup and shows a system notification when one is out; a checkbox on that card turns it off. The `.exe`
updates silently, without admin rights; the `.msi` asks for them. Downloads are verified against the project's signing
key. A build without that key, such as a dev build, says so; install the latest release over it, which keeps your
data.

## Limits

- **One machine, one user.** The app accepts results only from this machine; a team needs the
  [Docker image](/operate/deployment).
- **Unsigned installers**, so the first launch needs the steps above.
- **Local runs need the checkout**: a linked folder with Playwright installed, and `git` for reproduce and bisect.

## Related

- [Reporter](/guide/reporter#finding-the-desktop-app-automatically): how the reporter finds the app
- [MCP server](/features/mcp): the tools the assistants get
- [Fix plans, reproduce & bisect](/features/fix-plans): the recipes the app runs
- [Importing runs](/guide/importing-runs): the same import from the dashboard
