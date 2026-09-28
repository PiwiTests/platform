// Watch mode: rebuilds dist/ whenever a source file changes, so a reload in
// chrome://extensions picks up the change without re-running the build by hand.
// Run via `npm run extension:dev`.
//
// Rebuilds everything rather than only the changed entry: a full build takes
// about a second, and the standalone bundles share source files
// (src/shared/**, @piwitests/core, @piwitests/picker-dom), so mapping a changed
// file back to just the bundles that import it would be both slower to get
// right and easy to get subtly wrong.
//
// Two things keep a long session from running away:
//
// - A watch event rebuilds only when the path it names has a different mtime or
//   size than when the last build started. fs.watch on Windows also reports
//   access-time changes, and the build reads every input, so without this check
//   each build raised the events that started the next one: one save rebuilt
//   forever. The check itself only stats, which leaves access times alone.
// - Each build runs in its own process. Vite keeps some memory from every build
//   it runs in a process (several MB a rebuild, never released), which adds up
//   over a session; a child process hands all of it back when it exits.
import { spawn } from 'node:child_process';
import { readdirSync, statSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Everything the build reads, relative to this workspace — including the two
// workspaces it bundles from source (their package.json holds the `exports` map
// imports resolve through). `dist/` is deliberately absent — watching the
// build's own output would retrigger it forever.
const WATCHED = [
  'src',
  'public',
  'popup.html',
  'options.html',
  'manifest.json',
  '../../packages/core/src',
  '../../packages/core/package.json',
  '../../packages/picker-dom/src',
  '../../packages/picker-dom/package.json',
];
const DEBOUNCE_MS = 80;

let timer = null;
let building = false;
/**
 * `signature` of every watched path, taken when the last build started — not
 * when it ended, so what was saved while it ran still reads as a change.
 */
let inputs = new Map();

/** A path's kind, mtime and size, or null when it doesn't exist. */
function signature(file) {
  try {
    const stats = statSync(file);
    return `${stats.isDirectory() ? 'dir' : 'file'}:${stats.mtimeMs}:${stats.size}`;
  } catch {
    return null;
  }
}

function snapshotInputs() {
  const signatures = new Map();
  const add = (file) => {
    const current = signature(file);
    if (current !== null) signatures.set(file, current);
    return current;
  };
  for (const target of WATCHED) {
    const base = path.join(root, target);
    if (!add(base)?.startsWith('dir:')) continue;
    let entries = [];
    try {
      entries = readdirSync(base, { recursive: true });
    } catch {
      // A folder removed mid-walk; the missing entries read as a change next time.
    }
    for (const entry of entries) add(path.join(base, entry));
  }
  return signatures;
}

/** Whether `file` changed since the last build started; null (no file name reported) compares every input. */
function changedSinceLastBuild(file) {
  if (file !== null) return signature(file) !== (inputs.get(file) ?? null);
  const current = snapshotInputs();
  return current.size !== inputs.size || [...current].some(([entry, value]) => inputs.get(entry) !== value);
}

function runBuild() {
  return new Promise((resolve, reject) => {
    // stdout only carries build.mjs's "Built extension" line; Vite's warnings
    // and a failed build's error go to stderr.
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'build.mjs')], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `stopped by ${signal}` : `exited with code ${code}`));
    });
  });
}

async function rebuild() {
  if (building) return;
  building = true;
  const startedAt = Date.now();
  try {
    inputs = snapshotInputs();
    await runBuild();
    console.log(`[${new Date().toLocaleTimeString()}] rebuilt in ${Date.now() - startedAt}ms`);
  } catch (error) {
    // Keep watching after a failed build — a syntax error mid-edit shouldn't
    // kill the session; the next save should be able to fix it.
    console.error(`[${new Date().toLocaleTimeString()}] build failed:`, error.message);
  } finally {
    building = false;
  }
  // Watch events are dropped while a build runs; whatever was saved meanwhile
  // shows up here instead.
  if (changedSinceLastBuild(null)) void rebuild();
}

function scheduleRebuild(file) {
  if (building || !changedSinceLastBuild(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), DEBOUNCE_MS);
}

await rebuild();

for (const target of WATCHED) {
  const base = path.join(root, target);
  const isDirectory = statSync(base).isDirectory();
  watch(base, { recursive: true }, (_event, filename) =>
    scheduleRebuild(filename == null ? null : isDirectory ? path.join(base, filename) : base),
  );
}

console.log(`Watching ${WATCHED.join(', ')} — Ctrl+C to stop.`);
console.log('Reload the extension at chrome://extensions after a rebuild to pick up changes.');
