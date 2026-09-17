# Desktop app — agent guide

Rules for working inside `apps/desktop/` (the Tauri shell that bundles and runs the dashboard locally). Read
[`../AGENTS.md`](../AGENTS.md) first for repo-wide conventions, and [`README.md`](README.md) for how the shell works,
build prerequisites and the release flow.

## What it is

A [Tauri](https://tauri.app) window around **the same Nuxt/Nitro server** shipped as the Docker image and
`@piwitests/server`. On launch the Rust shell picks a free loopback port, resolves a per-user data dir, spawns the
bundled server as a **Node sidecar**, polls `GET /api/health` until the database is migrated, then points the window at
it through a one-time token bootstrap (`/__piwi/session`). Targets are Windows (`.msi`), macOS (`.dmg`) and Linux
(`.deb` / `.rpm` / `.AppImage`) — all three feature-equivalent and built from the same shell.

## Rules

- **Never fork the server.** The desktop app must keep running the unmodified built server. Anything the shell needs
  from the backend goes in `apps/application/` behind a desktop-aware guard, not into a desktop-only copy.
- **Everything binds `127.0.0.1`.** Local access is gated by a per-launch token enforced by
  `apps/application/server/middleware/desktop-guard.ts` — so only the app, not other local processes or browser pages, can
  reach the bundled API. Any new desktop-only route must stay behind that guard.
- **The reporter discovery file is a cross-package contract.** The shell publishes `{ url, token }` to
  `~/.piwi/desktop.json` while it runs and deletes it on quit; `@piwitests/reporter` reads it from
  `src/internal/config/desktop.ts`, and `src-tauri/src/mcp_stdio.rs` resolves the app's address from it on every
  message. The three ship separately, so changing the path or the shape means changing all of them.
- **`piwi-desktop mcp-stdio` is a published entry point.** Claude Desktop takes only stdio MCP servers, so its
  one-click setup writes that command into `claude_desktop_config.json` on the user's machine. Renaming the argument
  breaks every config already written — it can only be added to, and the bridge must keep speaking newline-delimited
  JSON-RPC on stdin/stdout.
- Front-end code that behaves differently inside the shell uses the `useIsDesktop` / `useTauri` composables and the
  `app/components/desktop/` cards — do not sniff user agents.
- The sidecar layout (`src-tauri/binaries/node-<triple>`, `src-tauri/resources/app-server/.output/`) is what the
  packaging scripts and CI (`desktop-release.yml`, `desktop-e2e.yml`) expect; changing it means updating both.
- Commit scope for changes here is `app` unless the change is CI-only (`ci`) — `desktop` is not in the commitlint
  scope list.

## Commands

```bash
npm run fetch-node   # download the Node sidecar binary for this platform
npm run stage        # build the server and stage it into src-tauri/resources
npm run dev          # tauri dev — run the shell against a staged server
npm run build        # produce the platform installer
npm run e2e          # Playwright smoke test of the shell integration
cargo test --manifest-path src-tauri/Cargo.toml   # the shell's Rust unit tests
```

`build.rs` copies the Node sidecar, the staged server and the app icons into the bundle, and fails when any of them is missing — so `cargo test` needs `fetch-node`, `stage` and
`npx tauri icon ../application/public/logo.svg` to have run first. `desktop-e2e.yml` does all three before it runs the tests.
