/**
 * check-demo-runtime.mjs
 *
 * Runs the *built* demo SPA the way GitHub Pages serves it — from a sub-path,
 * with its service worker installed — and exercises the flows that only exist
 * once it is running.
 *
 * `app:generate:demo` proves the demo compiles and `check-demo-routes.mjs`
 * proves every server route has a demo handler, but neither loads the page.
 * A demo whose links escape the service worker's scope, whose worker fails to
 * install, or whose handlers throw passes both and is still completely broken.
 *
 * Run from the `application/` directory, after `npm run app:generate:demo`:
 *   node scripts/check-demo-runtime.mjs
 *
 * Exits non-zero on the first failed check.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '.output', 'public');
const PORT = Number(process.env.DEMO_CHECK_PORT || 4173);

// The demo is deployed under /demo/, and that base path is exactly what the
// service worker scopes itself to — serving it at the root would hide the class
// of bug this check exists to catch.
const BASE = '/demo/';
const ORIGIN = `http://localhost:${PORT}`;

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.sql': 'text/plain',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const failures = [];
function check(ok, label, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const path = decodeURIComponent(req.url.split('?')[0]);
      if (!path.startsWith(BASE)) {
        res.writeHead(404).end('outside the demo base path');
        return;
      }
      let file = join(ROOT, path.slice(BASE.length) || 'index.html');
      try {
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      } catch {
        // Deep links have no static file; the SPA shell resolves them client-side.
        file = join(ROOT, 'index.html');
      }
      try {
        const data = await readFile(file);
        res.writeHead(200, {
          'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
          'Service-Worker-Allowed': BASE,
        });
        res.end(data);
      } catch {
        // Headers are only written once the read succeeds, so a missing file
        // can still answer 404 (on Windows a read can fail after a successful
        // stat, e.g. a locked file — the old double writeHead crashed the server).
        if (!res.headersSent) res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

/** Wait until the service worker controls the page, reloading once if needed. */
async function waitForServiceWorker(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = 0; i < 30; i++) {
      if (await page.evaluate(() => Boolean(navigator.serviceWorker?.controller))) return true;
      await page.waitForTimeout(1000);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  return false;
}

async function main() {
  if (!existsSync(ROOT)) {
    console.error(`No build at ${ROOT}. Run "npm run app:generate:demo" first.`);
    process.exit(1);
  }

  // seed.sql is gitignored and generated on demand. Without it the page loads
  // and the worker installs, but every query answers 500 — say which step is
  // missing rather than leaving a bare error to interpret.
  const seedPaths = [join(ROOT, 'demo', 'seed.sql'), join(ROOT, 'seed.sql')];
  if (!seedPaths.some((p) => existsSync(p))) {
    console.error(`No seed at ${seedPaths[0]}. Run "npm run app:seed:demo" and then "npm run app:generate:demo".`);
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');

  const server = await serve();
  console.log(`Serving the built demo at ${ORIGIN}${BASE}\n`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  // A root-relative /api/ URL escapes the service worker's scope and hits the
  // static host instead, so it can never be answered by the in-browser API.
  const escapedApiUrls = new Set();
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(`${ORIGIN}/api/`)) escapedApiUrls.add(url.slice(ORIGIN.length));
  });

  try {
    await page.goto(`${ORIGIN}${BASE}`, { waitUntil: 'domcontentloaded' });
    check(await waitForServiceWorker(page), 'the service worker installs and takes control');

    // The in-browser API must answer under the demo's own base path.
    const menu = await page.evaluate(async () => {
      const r = await fetch('/demo/api/projects/menu');
      return { status: r.status, count: r.ok ? ((await r.json())?.items?.length ?? 0) : 0 };
    });
    check(menu.status === 200, 'the in-browser API answers', `status ${menu.status}`);
    check(menu.count > 0, 'the seeded database has projects', `${menu.count} projects`);

    // Find a cluster to export, rather than hard-coding an id the seed may move.
    const clusterId = await page.evaluate(async () => {
      const menu = await (await fetch('/demo/api/projects/menu')).json();
      for (const p of menu.items ?? []) {
        const clusters = await (await fetch(`/demo/api/projects/${p.id}/failure-clusters`)).json();
        const first = (Array.isArray(clusters) ? clusters : (clusters?.items ?? []))[0];
        if (first?.id) return first.id;
      }
      return null;
    });
    if (!check(clusterId != null, 'the seed contains a failure cluster to export')) throw new Error('no cluster');

    await page.goto(`${ORIGIN}${BASE}failure-clusters/${clusterId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const exportButton = page.getByRole('button', { name: 'Export', exact: true });
    if (!check((await exportButton.count()) === 1, 'exactly one Export button is on the page')) {
      throw new Error(`found ${await exportButton.count()} Export buttons`);
    }

    // The download itself is the point: a root-relative URL would escape the
    // service worker's scope and 404 against the static host.
    await exportButton.click();
    await page.waitForTimeout(400);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: 'ZIP — with all evidence', exact: true }).click(),
    ]);
    const path = await download.path();
    const bytes = path ? (await readFile(path)).length : 0;
    check(bytes > 1000, 'the ZIP export downloads', `${bytes} bytes as ${download.suggestedFilename()}`);
    check(download.suggestedFilename().endsWith('.zip'), 'the download is named as a ZIP');

    // The PDF is generated the same way — entirely in the service worker, with
    // no browser print — so prove it produces a real %PDF document in-browser.
    await exportButton.click();
    await page.waitForTimeout(400);
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: 'PDF — formatted document', exact: true }).click(),
    ]);
    const pdfPath = await pdfDownload.path();
    const pdfBytes = pdfPath ? await readFile(pdfPath) : Buffer.alloc(0);
    check(
      pdfBytes.length > 1000,
      'the PDF export downloads',
      `${pdfBytes.length} bytes as ${pdfDownload.suggestedFilename()}`,
    );
    check(pdfDownload.suggestedFilename().endsWith('.pdf'), 'the download is named as a PDF');
    check(pdfBytes.subarray(0, 5).toString('latin1') === '%PDF-', 'the PDF is a real vector document');

    check(
      escapedApiUrls.size === 0,
      'every API request stays inside the demo base path',
      [...escapedApiUrls].slice(0, 3).join(', '),
    );

    check(pageErrors.length === 0, 'no uncaught page errors', pageErrors[0] ?? '');
  } catch (error) {
    check(false, 'the demo run completed', String(error).split('\n')[0].slice(0, 160));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  if (failures.length) {
    console.error(`✗ ${failures.length} demo runtime check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✓ The built demo runs: service worker, in-browser API and export download all work.');
}

await main();
