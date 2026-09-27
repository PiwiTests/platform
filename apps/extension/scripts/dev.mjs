// Watch mode: rebuilds dist/ whenever a source file changes, so a reload in
// chrome://extensions picks up the change without re-running the build by hand.
// Run via `npm run extension:dev`.
//
// Rebuilds everything rather than only the changed entry: a full build is well
// under a second, and the standalone bundles share source files
// (src/shared/**, @piwitests/core, @piwitests/picker-dom), so mapping a changed
// file back to just the bundles that import it would be both slower to get
// right and easy to get subtly wrong.
//
// A change to `scripts/build.mjs` (a new bundle, say, after a pull) loads a
// fresh copy of it before the rebuild, so the watch never keeps building from
// an old list of entries. A change to this file needs a restart.
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Everything the build reads, with the workspace packages the bundles compile
// from source. `dist/` is deliberately absent — watching the build's own
// output would retrigger it forever.
const WATCHED = [
  'src',
  'public',
  'popup.html',
  'options.html',
  'manifest.json',
  'scripts',
  '../../packages/core/src',
  '../../packages/picker-dom/src',
];
const DEBOUNCE_MS = 80;

let timer = null;
let building = false;
let queued = false;
let reloadBuildScript = false;
let buildExtension = (await import('./build.mjs')).buildExtension;

async function rebuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const startedAt = Date.now();
  try {
    if (reloadBuildScript) {
      reloadBuildScript = false;
      buildExtension = (await import(`./build.mjs?t=${Date.now()}`)).buildExtension;
    }
    await buildExtension();
    console.log(`[${new Date().toLocaleTimeString()}] rebuilt in ${Date.now() - startedAt}ms`);
  } catch (error) {
    // Keep watching after a failed build — a syntax error mid-edit shouldn't
    // kill the session; the next save should be able to fix it.
    console.error(`[${new Date().toLocaleTimeString()}] build failed:`, error.message);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      void rebuild();
    }
  }
}

function scheduleRebuild() {
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), DEBOUNCE_MS);
}

await rebuild();

for (const target of WATCHED) {
  watch(path.join(root, target), { recursive: true }, (_event, file) => {
    if (target === 'scripts') {
      if (file === 'dev.mjs') console.log('scripts/dev.mjs changed: restart `npm run extension:dev` to use it.');
      if (file !== 'build.mjs') return;
      reloadBuildScript = true;
    }
    scheduleRebuild();
  });
}

console.log(`Watching ${WATCHED.join(', ')} — Ctrl+C to stop.`);
console.log('Reload the extension at chrome://extensions after a rebuild to pick up changes.');
