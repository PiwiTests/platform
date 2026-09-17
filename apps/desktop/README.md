# Piwi Dashboard — Desktop app

A [Tauri](https://tauri.app) shell that bundles the **same** Nuxt/Nitro server
shipped as the Docker image and `@piwitests/server`, and runs it locally. No
Docker, no `npx`, no server to set up — double-click and go. Everything binds
`127.0.0.1`; your data lives under the OS app-data directory.

Targets: **Windows (`.msi`)**, **macOS (`.dmg`)**, and **Linux (`.deb` / `.rpm` /
`.AppImage`)**.

## How it works

1. On launch the Rust shell picks a free loopback port, resolves a per-user data
   dir (`app_data_dir()/.data`), and spawns the bundled server as a **Node
   sidecar** (`src-tauri/binaries/node-<triple>` running
   `src-tauri/resources/app-server/.output/server/index.mjs`).
2. It polls `GET /api/health` (200 = database migrated) and then points the
   window at the server via a one-time token bootstrap (`/__piwi/session`).
3. The tray offers **Run in background** (keep serving after the window closes),
   **Start on login**, and **Open data folder**.
4. The dashboard can link a Piwi project to a folder on this machine and run
   `playwright test` there (`src-tauri/src/runner.rs`): the shell resolves the
   folder's own Playwright package, executes it with the bundled Node sidecar,
   and streams output back to the webview as `piwi:local-run` events. Those
   processes die with the shell, so every way out — closing the window, the
   tray's Quit, or an update restart — asks for confirmation first while any
   of them is still running.
5. Archives the OS hands to the app (drag & drop, "Open with", second-launch
   file arguments, macOS open events) are queued shell-side and drained by the
   dashboard over IPC (`desktop_take_pending_open_files` + a `piwi:open-files`
   poke), which imports them by path through the desktop-only
   `/api/desktop/import-local` route.
6. The dashboard's /mcp page can write the `piwi` MCP entry into detected
   clients' config files (`src-tauri/src/mcp_clients.rs`): strict-JSON merge
   of one key with a backup next to the file, and a startup pass that rewrites
   entries whose URL/token drifted after a port change.
7. Native notifications shown while the window is hidden bump an unread badge
   on the dock icon and the tray tooltip (`desktop_set_activity`), cleared
   when the window regains focus.

Local access is gated by a per-launch token (see
`apps/application/server/middleware/desktop-guard.ts`), so only the app — not other
local processes or browser pages — can reach the bundled API.

## Build locally

Prerequisites: Node 24+, the [Rust toolchain](https://rustup.rs), and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```bash
# 1. Build the server bundle (from the repo root)
npm run app:build --workspace=apps/application

# 2. Fetch the Node sidecar for this machine + stage the server (from apps/desktop/)
cd desktop
npm run fetch-node          # downloads the official Node binary for this OS
npm run stage               # copies .output + installs native modules
npx tauri icon ../application/public/logo.svg   # generate icons (once)

# 3. Run in dev, or build an installer
npm run dev                 # launches the app against the staged server
npm run build               # produces the installer for this OS under src-tauri/target
                            # (.msi on Windows, .dmg on macOS, .deb/.rpm/.AppImage on Linux)
```

> The Node sidecar (`src-tauri/binaries/`), the staged server
> (`src-tauri/resources/app-server/`), generated icons, and `src-tauri/target/` are all
> git-ignored build artifacts — CI regenerates them (see
> `.github/workflows/desktop-release.yml`).

## End-to-end tests

`apps/desktop/e2e/` drives the **real** shell webview with Playwright, via
[`tauri-plugin-playwright`](https://crates.io/crates/tauri-plugin-playwright).
This is the only layer that catches runtime issues the compiler can't — most
importantly that the dashboard (served at a loopback origin) may actually call
the shell's native commands, which Tauri gates per-origin via the capabilities.

The plugin is compiled in **only** under the `e2e-testing` cargo feature (never
in shipped installers), and the capability it needs is added at runtime, also
behind that feature. Run it after building + staging the server:

```bash
# from the repo root: build the server the shell will bundle
npm run app:build --workspace=apps/application

# from apps/desktop/: stage the sidecar + server, then run the tests
cd desktop
npm install
npm run fetch-node
npm run stage
npx tauri icon ../application/public/logo.svg   # once
npm run e2e                                      # launches `tauri dev --features e2e-testing`
```

CI runs this on macOS (real webview, no display server needed) on desktop
changes — see `.github/workflows/desktop-e2e.yml`.

## Signing

Installers are **unsigned** unless code-signing secrets are configured, in which
case CI signs (and notarizes on macOS) automatically. Unsigned apps still run —
right-click → Open on macOS, or "More info → Run anyway" on Windows SmartScreen.

## In-app updates

Off until the updater keypair exists; releases build exactly as before without
it. To enable:

1. `npx tauri signer generate` (keep the private key + password secret).
2. Put the **public** key into `src-tauri/tauri.updater.conf.json`.
3. Add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as
   repository secrets.

With the secret present, `desktop-release.yml` applies the
`tauri.updater.conf.json` overlay: bundles gain signed update artifacts,
tauri-action uploads `latest.json` to the release, and the app (whose compiled
config now contains the updater entry) exposes Check for updates in
Settings → About. Builds without the overlay report updates as unsupported —
the plugin is not even registered there (see `src-tauri/src/updates.rs`).
