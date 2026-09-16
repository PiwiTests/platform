/**
 * Booting, seeding and tearing down a throwaway dev server, shared by the
 * scripts that drive the running app with Playwright (the feature-screenshot
 * harness and the detail-page measurement). Everything here is server/process
 * plumbing — no browser — so a script that reuses a server it already has
 * (`--url`) never imports it.
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The application workspace root (`scripts/lib/` sits two levels below it). */
export const APP_DIR = join(__dirname, '..', '..');

/** Default port for a booted throwaway server — off 3000 so a dev server can stay up. */
export const DEFAULT_PORT = 3050;

export function resolveChromium() {
  // The sandboxed environments provide a Chromium via PLAYWRIGHT_BROWSERS_PATH;
  // a normal checkout uses Playwright's own download.
  const provided = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (provided && existsSync(join(provided, 'chromium'))) return join(provided, 'chromium');
  return undefined;
}

export function ensureDevDb() {
  if (existsSync(join(APP_DIR, '.data', 'piwi.db'))) return;
  console.log('No dev DB — creating and seeding one (first run only)…');
  if (!existsSync(join(APP_DIR, 'public', 'demo', 'seed.sql'))) {
    execSync('npm run app:seed:demo', { cwd: APP_DIR, stdio: 'inherit' });
  }
  mkdirSync(join(APP_DIR, '.data'), { recursive: true });
  execSync('npm run db:migrate', { cwd: APP_DIR, stdio: 'inherit' });
  execSync('npm run app:seed:dev', { cwd: APP_DIR, stdio: 'inherit' });
}

export async function waitForHealth(base, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server at ${base} did not become healthy within ${timeoutMs / 1000}s`);
}

/**
 * Wait for a stopped server to release the port. Without this a second server
 * fails to bind and the run silently drives the first one, which is still
 * answering.
 */
export async function waitForPortFree(base, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/api/health`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${base} did not shut down within ${timeoutMs / 1000}s`);
}

/**
 * Boot a dev server in `mode`; returns { base, stop }. The desktop UI is enabled
 * for `desktop` only — the sidebar's back/forward pair exists in the Tauri shell
 * alone, and would misrepresent the web app in a full-viewport capture.
 */
export async function startServer({ mode = 'web', port = DEFAULT_PORT } = {}) {
  ensureDevDb();
  const desktop = mode === 'desktop';
  const child = spawn('npx', ['nuxt', 'dev', '--port', String(port)], {
    cwd: APP_DIR,
    env: { ...process.env, NUXT_IGNORE_LOCK: '1', ...(desktop ? { NUXT_PUBLIC_DESKTOP: 'true' } : {}) },
    stdio: 'ignore',
    // Detached puts nuxt in its own process group so stop() can kill the whole
    // tree; on Windows npx needs a shell and group-kill is unsupported anyway.
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
  });
  const stop = () => {
    // Negative pid kills the whole nuxt process group where supported. On
    // Windows child.kill() only terminates the cmd wrapper — the nuxt node
    // process survives and keeps the port bound, so kill the tree explicitly.
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      // already gone
    }
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  const base = `http://localhost:${port}`;
  console.log(`Starting dev server at ${base}${desktop ? ' (desktop UI enabled)' : ''}…`);
  try {
    await waitForHealth(base);
  } catch (err) {
    stop();
    throw err;
  }
  return { base, stop };
}
