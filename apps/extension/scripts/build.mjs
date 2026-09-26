// Builds the extension into dist/. Content scripts and the background
// service worker are each built as a standalone IIFE (no shared chunks) via
// Vite's library mode, since chrome.scripting.executeScript({ files: [...] })
// injects them as plain classic scripts with no module resolution — unlike
// popup.html, which is loaded as a normal extension page and gets Vite's
// standard (chunk-splitting-friendly) HTML-entry build.
//
// Exports buildExtension() so dev.mjs can re-run the whole thing on change;
// running this file directly builds once.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'dist');

/** Every standalone content script / service worker entry, as [output name, source entry]. */
const STANDALONE_ENTRIES = [
  ['pick', 'src/content/pick.ts'],
  ['hover-inspect', 'src/content/hover-inspect.ts'],
  ['locator-console', 'src/content/locator-console.ts'],
  ['multi-pick', 'src/content/multi-pick.ts'],
  ['lint-overlay', 'src/content/lint-overlay.ts'],
  ['assertion-panel', 'src/content/assertion-panel.ts'],
  ['session-panel', 'src/content/session-panel.ts'],
  ['agent-context-panel', 'src/content/agent-context-panel.ts'],
  ['test-function-panel', 'src/content/test-function-panel.ts'],
  ['coverage-overlay', 'src/content/coverage-overlay.ts'],
  // Not injected via `chrome.scripting.executeScript({ files: [...] })` like the others —
  // registered dynamically for the recording's lifetime
  // (`chrome.scripting.registerContentScripts`, see `background/index.ts`) so it re-attaches
  // itself on every navigation across the recording's granted origin. Still built the same
  // standalone-IIFE way: MV3 has no other way to inject a classic script by file path.
  ['record-panel', 'src/content/record-panel.ts'],
  ['background', 'src/background/index.ts'],
];

async function buildStandalone(name, entry) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      lib: { entry: path.join(root, entry), formats: ['iife'], name: `Piwi_${name}`, fileName: () => `${name}.js` },
      rollupOptions: { output: { extend: true } },
    },
  });
}

export async function buildExtension() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const [name, entry] of STANDALONE_ENTRIES) await buildStandalone(name, entry);

  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      rollupOptions: { input: { popup: path.join(root, 'popup.html'), options: path.join(root, 'options.html') } },
    },
  });

  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  cpSync(path.join(root, 'public', 'icons'), path.join(outDir, 'icons'), { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildExtension();
  console.log(`Built extension into ${path.relative(process.cwd(), outDir)}`);
}
