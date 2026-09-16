import { createTauriTest } from '@srsholmes/tauri-playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright test fixture that drives the *real* desktop shell.
 *
 * Unlike a typical Tauri app there is no Vite dev server: the Rust shell spawns
 * the bundled Nitro server on a loopback port and points the window at it. So
 * only the real-app ("tauri") mode is meaningful here — there is nothing to mock
 * in a browser. `createTauriTest` launches the app with `npx tauri dev
 * --features e2e-testing` (which embeds the Playwright control plugin) and talks
 * to it over a local socket.
 *
 * Prerequisites the CI job sets up before this runs: the server bundle is built
 * and staged (`fetch-node` + `stage`) and the icons are generated, so `tauri
 * dev` can boot the sidecar and load the dashboard.
 */
export const { test, expect } = createTauriTest({
  // Deliberately empty. The type requires a string, but a *truthy* `devUrl` is
  // not just browser-only: in tauri mode the fixture navigates the webview to it
  // (`window.location.href = devUrl`) the instant the control socket answers a
  // ping — before the shell has driven its own token bootstrap, and often before
  // the native `main` window even exists. The plugin only retries window
  // resolution for ~2s per command, so on a loaded CI runner that premature
  // `eval` loses the race and fails the run with
  // `window 'main' not found after retries (available windows: [])`. An empty
  // (falsy) value skips that navigation entirely and lets the shell load itself.
  devUrl: '',
  tauriCommand: 'npx tauri dev',
  tauriFeatures: ['e2e-testing'],
  tauriCwd: resolve(__dirname, '..'),
  mcpSocket: process.env.TAURI_PLAYWRIGHT_SOCKET ?? '/tmp/tauri-playwright.sock',
  // `tauri dev` may compile on first launch and the shell then waits on the
  // server's health probe (up to ~60s), so allow generous headroom.
  startTimeout: 360,
});
