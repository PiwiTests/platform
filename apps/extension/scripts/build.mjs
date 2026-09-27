// Builds the extension into dist/. Content scripts and the background
// service worker are each built as a standalone IIFE (no shared chunks) via
// Vite's library mode, since chrome.scripting.executeScript({ files: [...] })
// injects them as plain classic scripts with no module resolution — unlike
// popup.html, which is loaded as a normal extension page and gets Vite's
// standard (chunk-splitting-friendly) HTML-entry build.
//
// Exports buildExtension() so dev.mjs can re-run the whole thing on change;
// running this file directly builds once. `--release` makes the build
// reproducible (see `buildExtension`): the store zips are built that way, since
// Firefox reviewers rebuild the source package and diff the result against the
// submitted add-on. `--pseudo` replaces the English catalog with a pseudo-localized
// copy (see `pseudoLocalize`), a development aid that never goes into a release.
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
  ['replay-panel', 'src/content/replay-panel.ts'],
  // Registered the same way for a bug recording's lifetime, in the page's main world (`world: 'MAIN'`): the only
  // place that sees the page's console and its fetch/XHR calls. Imports nothing that touches `chrome.*`.
  ['bug-evidence-main', 'src/content/bug-evidence-main.ts'],
  ['background', 'src/background/index.ts'],
];

/**
 * Values replaced in every bundle. `__PIWI_BUILD_ID__` changes on each build, so
 * the popup and the tools can tell when the background worker still runs an
 * earlier one (see `src/shared/build-id.ts`).
 */
function defines(buildId) {
  return { __PIWI_BUILD_ID__: JSON.stringify(buildId) };
}

async function buildStandalone(name, entry, buildId) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    define: defines(buildId),
    build: {
      outDir,
      emptyOutDir: false,
      lib: { entry: path.join(root, entry), formats: ['iife'], name: `Piwi_${name}`, fileName: () => `${name}.js` },
      rollupOptions: { output: { extend: true } },
    },
  });
}

/**
 * Builds everything into dist/. A dev build stamps the current time, so a
 * rebuild always differs from the worker still running; a release build stamps
 * the manifest version instead, so the same sources always produce the same
 * bytes.
 */
export async function buildExtension({ release = false, pseudo = false } = {}) {
  if (release && pseudo) throw new Error('--pseudo is a development aid: it never goes into a release build');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const buildId = release ? `v${manifest.version}` : new Date().toISOString();

  for (const [name, entry] of STANDALONE_ENTRIES) await buildStandalone(name, entry, buildId);

  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    define: defines(buildId),
    build: {
      outDir,
      emptyOutDir: false,
      rollupOptions: { input: { popup: path.join(root, 'popup.html'), options: path.join(root, 'options.html') } },
    },
  });

  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  cpSync(path.join(root, 'public', 'icons'), path.join(outDir, 'icons'), { recursive: true });
  if (pseudo) writePseudoCatalog();
}

const ACCENTED = {
  a: 'å',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'ƥ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Å',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Î',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Ƥ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/**
 * `Pick an element` → `[Ƥîçķ åñ éļéɱéñţ ·······]`: accented, about a third
 * longer, bracketed, with `$name$` and `$$` left as they are. Loaded in a
 * browser, plain English left on screen is text that bypasses `t()`, and a
 * label cut off is one that will clip in a longer language.
 */
export function pseudoLocalize(message) {
  const parts = message.split(/(\$[A-Za-z0-9_]+\$|\$\$)/);
  const accented = parts.map((part, i) => (i % 2 ? part : part.replace(/[A-Za-z]/g, (c) => ACCENTED[c]))).join('');
  const letters = message.replace(/\$[A-Za-z0-9_]+\$/g, '').length;
  return `[${accented} ${'·'.repeat(Math.max(1, Math.round(letters / 3)))}]`;
}

/** Messages the code reads rather than shows. */
const NOT_PSEUDO = new Set(['common_languageTag']);

function writePseudoCatalog() {
  const file = path.join(outDir, '_locales', 'en', 'messages.json');
  const catalog = JSON.parse(readFileSync(file, 'utf8'));
  for (const [key, entry] of Object.entries(catalog)) {
    // Badges and the store summary have hard length limits.
    if (NOT_PSEUDO.has(key) || key.startsWith('badge_') || key === 'extDescription') continue;
    entry.message = pseudoLocalize(entry.message);
  }
  writeFileSync(file, JSON.stringify(catalog, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const release = process.argv.includes('--release');
  const pseudo = process.argv.includes('--pseudo');
  await buildExtension({ release, pseudo });
  const kind = release ? ' (release)' : pseudo ? ' (pseudo-localized English)' : '';
  console.log(`Built extension${kind} into ${path.relative(process.cwd(), outDir)}`);
}
