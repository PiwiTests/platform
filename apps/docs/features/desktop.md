---
title: Desktop app
lang: en-US
---

# Desktop app

<Needs desktop />

The Piwi Dashboard desktop app runs the **entire dashboard on your machine** — no
Docker, no `npx`, no server to set up. It bundles the same server that ships as
the Docker image, wraps it in a native window, and keeps your data in a local
folder. It's ideal for a single developer who runs Playwright locally and wants
permanent history, flaky scoring, failure clustering, and locator healing without
standing up a server.

> Everything binds to `127.0.0.1` — the app is local-only and nothing is exposed
> to the network.

The window navigates like a browser without looking like one: **back/forward
buttons** sit at the top of the sidebar, and the mouse side buttons and
trackpad swipe gestures your OS uses for history work too.

## Download

Grab the installer for your OS from the [latest release](https://github.com/PiwiTests/platform/releases/latest):

| OS | Installer |
|----|-----------|
| **Windows** | `.msi` |
| **macOS** (Apple silicon) | `.dmg` |

Linux is not packaged yet — use [Docker or `npx`](/operate/deployment) there.

### Unsigned builds

Until code-signing certificates are in place the installers are **unsigned**, so
your OS shows a first-run warning:

- **macOS:** right-click the app → **Open** → **Open** (once).
- **Windows:** SmartScreen → **More info** → **Run anyway**.

## Where your data lives

Open **Settings → Storage → Data location** to see the exact paths, or use the
tray menu's **Open data folder**. By default everything sits under the OS
app-data directory:

| OS | Location |
|----|----------|
| **Windows** | `%APPDATA%\io.piwitests.dashboard\.data` |
| **macOS** | `~/Library/Application Support/io.piwitests.dashboard/.data` |

That folder holds `piwi.db` (SQLite) and `storage/` (reports, traces,
attachments). Back it up by copying the folder while the app is closed.

## Running in the background

By default, closing the window quits the app. From the tray icon you can enable:

- **Run in background** — closing the window keeps the server running in the
  tray, so submitting more results is instant and reopening is immediate.
- **Start on login** — launch the app (hidden, into the tray) when you log in.

While the window is hidden or unfocused, subscribed
[notifications](/features/notifications) (the bell on a project page) show as **native
OS notifications**, and each one bumps an unread count on the dock icon
(macOS/Linux) and in the tray tooltip. Focusing the window clears it.

## Sending results to it

While the app is running, the reporter finds it by itself — no URL and no token
in your config:

```typescript
['@piwitests/reporter', { projectName: 'my-project' }]
```

The app publishes its address and access token to `~/.piwi/desktop.json`
(`%USERPROFILE%\.piwi\desktop.json` on Windows) while it runs, rewriting the file
on each launch and deleting it on quit. The reporter reads it **only** when your
config and environment set no `serverUrl` and no `apiKey`, so a project already
pointed at a shared dashboard — or a CI job with `PIWI_API_KEY` set — is never
redirected here. See [Finding the desktop app automatically](/guide/reporter#finding-the-desktop-app-automatically).

### Configuring it by hand

Discovery needs the tests and the app to run as the same user on the same
machine. When they don't — a container, a different account, or a config that
already sets `serverUrl` — open **Settings → Storage → Send results to this app**
to copy the token and a ready-made snippet:

```typescript
['@piwitests/reporter', {
  serverUrl: 'http://localhost:3000',
  projectName: 'my-project',
  apiKey: 'pd_…', // from Settings → Storage (or the PIWI_API_KEY env var)
}]
```

The token is a **local secret** — prefer the `PIWI_API_KEY` env var over
committing it. The app uses port **3000** by default (falling back to another
local port only if 3000 is already taken — the window's address bar shows the
actual one).

> **Why a token?** The server binds `127.0.0.1`, which blocks other machines —
> but loopback alone doesn't stop *other local processes* or *web pages open in
> your browser* from reaching it. The token means only the app itself and tools
> you've handed it to (your reporter) can submit or read. Accepting results from
> *other machines* over the network is intentionally not supported in the desktop
> build — run the [Docker image](/operate/deployment) for a shared, always-on server.

## Projects from local folders

Runs create projects automatically, but the desktop app can also start from
the code: **Projects → New project → Choose folder…** picks a checkout on this
machine, detects the name it would report under (the `projectName` in its
Playwright config, else the `package.json` name, else the folder name), and
checks the setup — Playwright config present, Playwright installed, the
[reporter](/guide/reporter) installed and wired into the config. Anything missing is
a warning, not a blocker: create the project anyway and run
`npx @piwitests/reporter init` in the folder when you're ready. The chosen folder is linked to the new project
automatically.

The link itself is a per-machine setting, managed with the rest of the project
settings: **project page → Edit → Local folder** shows the folder, the same
setup checks, and the **Change**/**Unlink** actions. The project page shows the
link's status — `ready`, `needs setup`, or `missing` when the folder is gone —
and jumps there. The link never leaves this machine.

## Running tests from the app

A failing run is one click from a local retry. On a run page (or a single
execution page), **Run locally** re-runs the failed tests on this machine —
immediately, with the options you used last time. The app executes the folder's
*own* Playwright with the app's bundled Node — nothing extra to install — and
the output streams into the **Local runs** tray in the corner of the window.

- **First use:** a dialog asks you to link the Piwi project to its checkout —
  the folder that contains the tests. Link it any time under
  [**Edit → Local folder**](#projects-from-local-folders). The link stays on
  this machine; it is never sent anywhere.
- **The arrow next to the button** holds everything else: run headless, headed,
  under the Playwright inspector or in UI mode; select tests by `file:line`,
  title or file; force trace recording; `--repeat-each` up to 1000× for flake
  reproduction. Whatever you pick becomes the new one-click default for that
  project. **Run with options…** opens the full dialog with the exact command
  preview.
- **The button is also the run's status:** it shows progress while tests run
  and the result when they finish; clicking it opens the tray. Runs keep going
  while you browse other pages — closing the tray or navigating never kills
  anything. Stopping is always explicit, from the tray; a toast reports the
  result when a run ends, an OS notification does when the window is in the
  background, and leaving the app while runs are active — closing the window,
  quitting from the tray, or restarting for an update — asks first.
- **More places to run from:** a test case's evolution page has **Reproduce
  locally** (matched by title, ×20 with a trace — the flake-hunting preset,
  without touching your saved defaults), and a failure cluster's test evidence
  has **Run affected locally** for every test in the cluster.
- **Wrong folder?** If none of the tests exist in the linked folder (usually a
  project linked to a different checkout), the button opens the dialog instead
  of spawning a run that would die with a module-resolution error — fix the
  link there, or run anyway if your Playwright config resolves specs elsewhere.

Results flow back automatically: the run executes your project's regular
Playwright config, so the Piwi reporter in it reports to this app through the
[discovery file](#sending-results-to-it), exactly like a run started from your
terminal. As soon as the reporter checks in, the run's tray entry links
straight to the new run — **Live in Piwi** — and while anything is running a
pill in the sidebar keeps the tray one click away from every page.

Two prerequisites, both usually already true for a project that reports to
Piwi: the linked folder has `@playwright/test` installed (`node_modules`
present — monorepos with a hoisted root install work too), and its Playwright
config includes the Piwi reporter. Both show in the
[**Local folder** checks](#projects-from-local-folders), and the run dialog
warns up front when no Playwright installation is found.

The linked folder also completes [Open in IDE](/features/ide-integration): when no
workspace root is configured there, source links resolve against the linked
folder automatically.

### Reproducing a failure and finding the breaking commit

The [Reproduce and bisect section](/features/fix-plans#reproduce-and-bisect) of the toolbox shows
a copy-paste recipe on every build. Inside the app it can also run that recipe —
and drive the whole `git bisect` — for you, against the linked folder, **without
touching your checkout.**

- **Reproduce here** checks out the failing commit in a throwaway
  [`git worktree`](https://git-scm.com/docs/git-worktree) under the app's data
  dir, installs (reusing your `node_modules` when the lockfile is unchanged,
  otherwise `npm ci` / `pnpm install --frozen-lockfile` / `yarn install`),
  installs the browser if it is missing, and runs exactly the failing test — each
  phase a header in the **Local runs** tray. Your working tree, uncommitted
  changes and installed browsers are left alone. The commit's *own* Playwright
  version is used (the point of a checkout), not the run's pin.
- **Find the breaking commit here** drives a real bisect step by step between the
  last green commit and the failing one — not `git bisect run`, so you get live
  progress (*step 3 of ~7 — `a1b2c3d` — testing…*), a **Stop** that actually
  stops (it kills the test and any browsers or dev server it started, resets the
  bisect and removes the worktree), and a clean result: the first bad commit, with
  its subject, author and date, linked to your SCM host and recorded on the
  cluster so it survives a reload and reaches the [fix plan](/features/mcp).

**The honest limits:** `git`, and your package manager, must be installed on this
machine (the app ships only Node). Piwi reproduces and bisects **one** repository
— when your app under test lives in another repo, its history is not part of the
bisect. And a bisect only means something when the app is built from the same
checkout: if your Playwright config has a `webServer`, Playwright starts the app
at each commit and you are done; if it targets an external URL instead, set a
**start command** (e.g. `npm run dev`) and a readiness URL under the linked
folder's settings, and the app starts it in the worktree before each step.

## Importing local files

Drop a Playwright **blob report** or **trace** (`.zip`) anywhere on the app
window and an import dialog opens: pick the project, and each archive is
imported straight from its path on disk — nothing is uploaded anywhere.
Several traces dropped together can be gathered into a single run.

The same dialog opens when the OS hands files to the app: **Open with →
Piwi Dashboard** in your file manager, dropping archives on the dock icon
(macOS), or launching the app with file arguments. The app registers as an
*optional* opener for `.zip` files — it never takes over your system's default
archive handler.

Semantics match the [import page](/guide/importing-runs): idempotent by content
hash, and imports never trigger notifications, AI diagnosis or regression
signals.

## Connecting AI assistants

The app exposes the same [MCP server](/features/mcp) as every Piwi deployment — and on
this machine it can also do the wiring. The **MCP server** page detects
installed clients — Claude Code, Claude Desktop, Cursor, VS Code, Windsurf and
Gemini CLI — and connects each with one click:

- The `piwi` entry is written into the client's **own config file**, with the
  app's URL and access token filled in; a backup copy is kept next to the file,
  and only that one entry is ever added, updated or removed.
- A config that is not plain JSON (comments, trailing commas) is never
  rewritten — the page says so and shows the copy-paste snippet instead.
- Written entries embed this app's address, which can change when port 3000 is
  taken — on every launch the app checks the clients it configured and
  rewrites any entry that drifted.
- **Claude Desktop** is wired differently, because its config file accepts only
  servers started as a local command — a URL entry there is reported as invalid
  and ignored. It is pointed at this app's own built-in bridge instead
  (`piwi-desktop mcp-stdio`), which speaks MCP over stdin/stdout and forwards to
  the local endpoint. Nothing to install, no Node, and no token written into
  Claude's config: the bridge looks the address up when it runs, so that entry
  never drifts. The app has to be **running** for Claude Desktop to reach it —
  keep *Run in background* (or *Start on login*) on if you want it always
  available.

Restart the client after connecting; most MCP clients read their config at
startup.

## Updates

**Settings → About → Updates** checks GitHub releases for a newer version,
downloads it in the background, and applies it when you restart the app.

Update support exists only in releases built with the project's update
signing key — the app verifies every download against the matching public key
before installing anything. A build without that key (a dev build, or a
release made before the key existed) says so on the card; update it by
downloading the [latest release](https://github.com/PiwiTests/platform/releases/latest)
installer, which keeps your data (the data folder lives outside the app).

## Building from source

See [`apps/desktop/README.md`](https://github.com/PiwiTests/platform/blob/main/apps/desktop/README.md)
for the local build steps (Node 24+, the Rust toolchain, and the Tauri system
dependencies).
