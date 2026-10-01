#!/usr/bin/env node
/**
 * Captures screenshots of user-facing features against a real dev server — the
 * standard closing step for UI work: every change that adds or visibly reworks
 * a screen gets a scene here, and the captured images go into the final report
 * (see the "Feature screenshots" rule in AGENTS.md).
 *
 * Usage (from application/):
 *   node scripts/take-feature-screenshots.mjs                 # all scenes
 *   node scripts/take-feature-screenshots.mjs <scene> …       # just these
 *   node scripts/take-feature-screenshots.mjs --tag docs      # every docs illustration
 *   node scripts/take-feature-screenshots.mjs --list          # scenes, tags and output files
 *   node scripts/take-feature-screenshots.mjs --check         # docs images vs. scenes, no capture
 *   node scripts/take-feature-screenshots.mjs --url http://localhost:3002
 *   node scripts/take-feature-screenshots.mjs --freeze-now 2026-08-02T09:00:00Z
 *   node scripts/take-feature-screenshots.mjs <scene> --out ../docs/public/screenshots
 *   node scripts/take-feature-screenshots.mjs --route /test-run-cases/37 --expand --height 2400
 *
 * Without --url the script boots its own dev server on port 3050 and tears it
 * down at the end; a missing dev DB is created and seeded first. With --url it
 * drives the server you point it at.
 *
 * `--route <path>` captures one page without registering a scene — the way to
 * look at any screen while verifying a change. It gets the same server, the
 * same hydration and settle waits, and writes `.screens/route-<slug>.png`.
 * `--expand` unfolds every collapsed section first; `--width` and `--height`
 * size the viewport (the dashboard scrolls inside a panel, so a taller viewport
 * is how more of a page gets into one image); `--name` picks the file stem.
 *
 * Every scene declares a `mode`: `web` (the default) captures the dashboard as
 * a browser serves it, `desktop` captures the Tauri shell — the server runs
 * with `NUXT_PUBLIC_DESKTOP=true` and a mocked Tauri IPC bridge is injected
 * into the page, so no shell build is needed. A desktop scene can shape what
 * the mock answers (linked folder, inspection result). A run covering both
 * modes boots one server per mode, web first.
 *
 * Output goes where the scene's `out` says: `screens` → `.screens/` (gitignored
 * report artifacts) and `docs` → `apps/docs/public/screenshots/` (committed
 * illustrations). `--out <dir>` overrides both.
 */

import { createRequire } from 'module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { drawAnnotations, clearAnnotations } from './screenshot-annotations.mjs';
import { resolveChromium, startServer, waitForPortFree } from './lib/dev-server.mjs';
import { waitForHydration, settlePage } from './lib/page-waits.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..');
const DOCS_SHOTS_DIR = join(APP_DIR, '..', 'docs', 'public', 'screenshots');

/** Where a scene's images land. `screens` is gitignored; `docs` is committed. */
const OUT_TARGETS = {
  screens: join(APP_DIR, '.screens'),
  docs: DOCS_SHOTS_DIR,
};

const DEFAULT_VIEWPORT = { width: 1280, height: 860 };

/**
 * A real Playwright 1.63 trace recorded with `snapshots: { dom, aria, screen }`,
 * ingested by the failing-step-evidence scene so the timeline can show the page
 * captured at the failing step. The seeded demo traces predate 1.63, so this
 * feature can only be driven from a genuine snapshot-bearing trace.
 */
const TRACE_SNAPSHOT_FIXTURE = join(APP_DIR, 'tests', 'fixtures', 'trace-aria-screen-1.63.zip');
const TRACE_SNAPSHOT_CASE = {
  title: 'checkout — cancel is gone after paying',
  location: 'tests/checkout.spec.ts:12:3',
  retries: 0,
};

/** POST to the server, retrying while the dev server compiles the API route on its first hit. */
async function postRetrying(request, base, path, options) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await request.post(`${base}${path}`, options);
      if (res.ok()) return res;
      last = new Error(`${path} → ${res.status()}`);
    } catch (error) {
      last = error;
    }
  }
  throw last ?? new Error(`could not POST ${path}`);
}

/**
 * Start a run, push one failing case with a marked failing step, and upload the
 * 1.63 trace fixture for it. Returns its executionId. Retries the pushes while
 * the dev server compiles the API routes on first hit.
 */
async function ingestTraceSnapshotCase(request, base) {
  const trace = readFileSync(TRACE_SNAPSHOT_FIXTURE);
  const traceHash = createHash('sha256').update(trace).digest('hex');
  const post = (path, options) => postRetrying(request, base, path, options);

  const started = await (
    await post('/api/test-runs/start', {
      data: { projectName: 'trace-snapshots', startTime: new Date().toISOString() },
    })
  ).json();
  const { runId, streamToken } = started;

  await post(`/api/test-runs/${runId}/events`, {
    data: {
      streamToken,
      testCases: [
        {
          type: 'complete',
          ...TRACE_SNAPSHOT_CASE,
          status: 'failed',
          duration: 2000,
          error:
            "TimeoutError: locator.click: Timeout 1500ms exceeded.\n  - waiting for getByRole('button', { name: 'Cancel' })",
          steps: [
            { title: 'Navigate to "data:text/html"', category: 'navigation', duration: 40, startTime: 0 },
            { title: 'Fill "a@b.test"', category: 'input', duration: 20, startTime: 50 },
            { title: 'Click "Pay now"', category: 'click', duration: 30, startTime: 80 },
            { title: 'Click "Cancel"', category: 'click', duration: 1500, startTime: 120, failed: true },
          ],
        },
      ],
    },
  });

  const upload = await post(`/api/test-runs/${runId}/case-files`, {
    multipart: {
      streamToken,
      testCase: JSON.stringify(TRACE_SNAPSHOT_CASE),
      trace_hash: traceHash,
      trace: { name: 'trace.zip', mimeType: 'application/zip', buffer: trace },
    },
  });
  return (await upload.json()).executionId;
}

/**
 * A test whose beforeEach hook failed, as the reporter records it from
 * Playwright 1.63 (taken from a real run): the hook and its fixtures under
 * `Before Hooks`, the failing click inside the hook, the capture's own
 * attachments and the teardown under `After Hooks`. Start times are offsets
 * from the test's start, in ms.
 */
const HOOK_FAILURE_CASE = { title: 'renames the profile', location: 'tests/profile.spec.ts:9:3', retries: 0 };
const HOOK_FAILURE_ERROR =
  "TimeoutError: locator.click: Timeout 1500ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Edit profile' })\n\n    at tests/profile.spec.ts:6:62";
const HOOK_FAILURE_TIMEOUT = { message: 'TimeoutError: locator.click: Timeout 1500ms exceeded.' };
const HOOK_FAILURE_STEPS = [
  {
    title: 'Before Hooks',
    category: 'hook',
    depth: 0,
    at: 0,
    duration: 1637,
    failed: true,
    error: HOOK_FAILURE_TIMEOUT,
  },
  {
    title: 'beforeEach hook',
    category: 'hook',
    depth: 1,
    at: 0,
    duration: 1637,
    failed: true,
    error: HOOK_FAILURE_TIMEOUT,
    location: 'tests/profile.spec.ts:4:8',
  },
  { title: 'Fixture "piwiCapture"', category: 'fixture', depth: 2, at: 6, duration: 0 },
  { title: 'Fixture "context"', category: 'fixture', depth: 2, at: 6, duration: 13 },
  { title: 'Create context', category: 'other', depth: 3, at: 7, duration: 6 },
  { title: 'Fixture "page"', category: 'fixture', depth: 2, at: 20, duration: 59 },
  { title: 'Create page', category: 'other', depth: 3, at: 20, duration: 59 },
  {
    title: 'Navigate',
    subtitle: '/account',
    category: 'navigation',
    depth: 2,
    at: 80,
    duration: 51,
    location: 'tests/profile.spec.ts:5:16',
  },
  {
    title: 'Click',
    subtitle: "getByRole('button', { name: 'Edit profile' })",
    category: 'action',
    depth: 2,
    at: 132,
    duration: 1505,
    failed: true,
    error: HOOK_FAILURE_TIMEOUT,
    params: { locator: "getByRole('button', { name: 'Edit profile' })" },
    location: 'tests/profile.spec.ts:6:62',
  },
  { title: 'After Hooks', category: 'hook', depth: 0, at: 1638, duration: 138 },
  { title: 'Fixture "page"', category: 'fixture', depth: 1, at: 1678, duration: 0 },
  { title: 'Fixture "context"', category: 'fixture', depth: 1, at: 1678, duration: 88 },
  { title: 'Close context', category: 'other', depth: 2, at: 1748, duration: 18 },
  { title: 'Fixture "piwiCapture"', category: 'fixture', depth: 1, at: 1766, duration: 4 },
  { title: 'Attach "piwi-locators"', category: 'attach', depth: 2, at: 1767, duration: 0 },
  { title: 'Attach "piwi-network"', category: 'attach', depth: 2, at: 1769, duration: 0 },
  { title: 'Worker Cleanup', category: 'hook', depth: 0, at: 1776, duration: 59 },
  { title: 'Fixture "browser"', category: 'fixture', depth: 1, at: 1777, duration: 56 },
];

/**
 * Report one run through the streaming API — start, one completed case, finish
 * — and return its id and the case's executionId. `metadata` is the run's
 * (its `scm` block is what the cluster page's "What changed" line reads).
 */
async function ingestRun(request, base, { projectName, metadata, testCase, startTime }) {
  const post = (path, options) => postRetrying(request, base, path, options);
  const started = await (
    await post('/api/test-runs/start', {
      data: { projectName, startTime: new Date(startTime).toISOString(), totalTests: 1, metadata },
    })
  ).json();
  const { runId, streamToken } = started;
  await post(`/api/test-runs/${runId}/events`, {
    data: { streamToken, testCases: [{ type: 'complete', ...testCase }] },
  });
  const failed = testCase.status !== 'passed';
  await post(`/api/test-runs/${runId}/finish`, {
    data: {
      streamToken,
      status: failed ? 'failed' : 'passed',
      duration: testCase.duration,
      totalTests: 1,
      passedTests: failed ? 0 : 1,
      failedTests: failed ? 1 : 0,
    },
  });
  const run = await (await request.get(`${base}/api/test-runs/${runId}`)).json();
  return { runId, executionId: run.testCases?.[0]?.executionId ?? null };
}

/** The hook-failure case, its steps placed at `startTime`. */
function hookFailureCase(startTime) {
  return {
    ...HOOK_FAILURE_CASE,
    status: 'failed',
    duration: 1835,
    error: HOOK_FAILURE_ERROR,
    steps: HOOK_FAILURE_STEPS.map(({ at, ...step }) => ({ ...step, startTime: startTime + at })),
  };
}

/** The hook-failure execution both widths of its scene open, reported once per session. */
let hookFailureExecution;

function reportHookFailure(request, base) {
  hookFailureExecution ??= (async () => {
    const startTime = Date.now() - 5_000;
    const { executionId } = await ingestRun(request, base, {
      projectName: 'profile-e2e',
      testCase: hookFailureCase(startTime),
      startTime,
    });
    if (!executionId) throw new Error('the hook-failure run has no execution');
    return executionId;
  })();
  return hookFailureExecution;
}

/**
 * A test that probes an optional dialog inside a `try`/`catch`, then fails on a
 * strict mode violation inside a `test.step`, as the reporter records it from
 * Playwright 1.63 (taken from a real run): the caught probe carries its error
 * and the reporter's `recovered` mark. Start times are offsets from the test's
 * start, in ms.
 */
const CAUGHT_ERROR_CASE = {
  title: 'saves the report and checks the download link',
  location: 'tests/downloads.spec.ts:3:5',
  retries: 0,
};
const CAUGHT_ERROR_PROBE = {
  message:
    "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('dialog').getByRole('button', { name: 'Confirm' })\nExpected: visible\nTimeout: 500ms\nError: element(s) not found",
  location: '/work/shop/tests/downloads.spec.ts:15:27',
};
const CAUGHT_ERROR_FATAL = {
  message:
    "Error: expect(locator).toBeEnabled() failed\n\nLocator: locator('.carousel').getByRole('link', { name: '' })\nExpected: enabled\nError: strict mode violation: locator('.carousel').getByRole('link', { name: '' }) resolved to 2 elements:\n    1) <a href=\"/files/1\"></a> aka getByRole('link').first()\n    2) <a href=\"/files/2\"></a> aka getByRole('link').nth(1)",
  location: '/work/shop/tests/downloads.spec.ts:26:77',
};
const CAUGHT_ERROR_STEPS = [
  {
    title: 'Set content',
    category: 'other',
    depth: 0,
    at: 0,
    duration: 23,
    location: '/work/shop/tests/downloads.spec.ts:4:14',
  },
  {
    title: 'Expect "toBeVisible"',
    subtitle: "getByRole('dialog').getByRole('button', { name: 'Confirm' })",
    category: 'assertion',
    depth: 0,
    at: 29,
    duration: 509,
    failed: true,
    recovered: true,
    error: CAUGHT_ERROR_PROBE,
    location: '/work/shop/tests/downloads.spec.ts:15:27',
  },
  {
    title: 'Click',
    subtitle: "getByRole('button', { name: 'Save' })",
    category: 'action',
    depth: 0,
    at: 539,
    duration: 32,
    location: '/work/shop/tests/downloads.spec.ts:22:52',
  },
  {
    title: 'Check the download link',
    category: 'test.step',
    depth: 0,
    at: 572,
    duration: 19,
    failed: true,
    error: CAUGHT_ERROR_FATAL,
    location: '/work/shop/tests/downloads.spec.ts:24:3',
  },
  {
    title: 'Expect "toBeEnabled"',
    subtitle: "locator('.carousel').getByRole('link', { name: '' })",
    category: 'assertion',
    depth: 1,
    at: 574,
    duration: 17,
    failed: true,
    error: CAUGHT_ERROR_FATAL,
    location: '/work/shop/tests/downloads.spec.ts:26:77',
  },
];

/** The caught-error execution both widths of its scene open, reported once per session. */
let caughtErrorExecution;

function reportCaughtError(request, base) {
  caughtErrorExecution ??= (async () => {
    const startTime = Date.now() - 5_000;
    const { executionId } = await ingestRun(request, base, {
      projectName: 'downloads-e2e',
      testCase: {
        ...CAUGHT_ERROR_CASE,
        status: 'failed',
        duration: 640,
        error: `${CAUGHT_ERROR_FATAL.message}\n\n    at tests/downloads.spec.ts:26:77`,
        steps: CAUGHT_ERROR_STEPS.map(({ at, ...step }) => ({ ...step, startTime: startTime + at })),
      },
      startTime,
    });
    if (!executionId) throw new Error('the caught-error run has no execution');
    return executionId;
  })();
  return caughtErrorExecution;
}

/**
 * A cluster whose runs record their commits but no repository URL: a passing
 * run at one commit, then the hook failure at the next. Reported once per
 * session, so both widths of its scene show the same cluster in the same state.
 */
let noRepositoryCluster;

function reportNoRepositoryCluster(request, base) {
  noRepositoryCluster ??= (async () => {
    const scm = (commit, commitMessage) => ({
      scm: { commit, branch: 'main', author: 'Ada Lovelace', commitMessage },
    });
    const passedAt = Date.now() - 60 * 60_000;
    await ingestRun(request, base, {
      projectName: 'storefront-no-remote',
      metadata: scm('3f9c2e1a7b4d5c6e8f0a1b2c3d4e5f6a7b8c9d0e', 'feat: checkout with saved cards'),
      testCase: { ...HOOK_FAILURE_CASE, status: 'passed', duration: 1400, steps: [] },
      startTime: passedAt,
    });
    const failedAt = Date.now() - 5_000;
    const { runId } = await ingestRun(request, base, {
      projectName: 'storefront-no-remote',
      metadata: scm('b7e41d09c2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7', 'refactor(profile): rename the edit button'),
      testCase: hookFailureCase(failedAt),
      startTime: failedAt,
    });
    // The run's cluster is written when the run finishes; give it a moment.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      const groups = await (await request.get(`${base}/api/test-runs/${runId}/failure-groups`)).json();
      const clusterId = groups.items?.[0]?.clusterId;
      if (clusterId) return clusterId;
    }
    throw new Error(`run ${runId} has no failure cluster`);
  })();
  return noRepositoryCluster;
}

/** Surfaces a scene can be captured against. */
const MODES = ['web', 'desktop'];

/** localStorage key `@nuxtjs/color-mode` reads the stored theme preference from. */
const COLOR_MODE_KEY = 'nuxt-color-mode';

/** Stroke widths of the split seam, authored against a 1280px-wide capture. */
const SEAM_REFERENCE_WIDTH = 1280;
const SEAM_SHADOW_WIDTH = 4;
const SEAM_HIGHLIGHT_WIDTH = 1.5;

/**
 * Lay the dark capture over the light one, clipped to the triangle below the
 * top-right → bottom-left diagonal, and draw the seam along it. Both captures
 * must come from the same viewport and scroll position so they align exactly.
 */
async function compositeSplit(lightBuffer, darkBuffer) {
  const { width, height } = await sharp(lightBuffer).metadata();
  const scale = width / SEAM_REFERENCE_WIDTH;

  const clip = Buffer.from(
    `<svg width="${width}" height="${height}">` +
      `<polygon points="${width},0 ${width},${height} 0,${height}" fill="#fff"/>` +
      `</svg>`,
  );
  const darkTriangle = await sharp(darkBuffer)
    .ensureAlpha()
    .composite([{ input: clip, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const seam = Buffer.from(
    `<svg width="${width}" height="${height}">` +
      `<line x1="${width}" y1="0" x2="0" y2="${height}" stroke="rgba(0,0,0,0.35)" stroke-width="${SEAM_SHADOW_WIDTH * scale}"/>` +
      `<line x1="${width}" y1="0" x2="0" y2="${height}" stroke="rgba(255,255,255,0.85)" stroke-width="${SEAM_HIGHLIGHT_WIDTH * scale}"/>` +
      `</svg>`,
  );

  return sharp(lightBuffer)
    .composite([{ input: darkTriangle }, { input: seam }])
    .png()
    .toBuffer();
}

/** A scene's mode, defaulting to the web dashboard. */
function sceneMode(scene) {
  return scene.mode ?? 'web';
}

/**
 * Images in the docs screenshot directory that this harness does not produce,
 * so `--check` does not report them as orphans. Everything else in there must
 * have a scene.
 *
 *   - the remaining gallery images come from the live-demo capture described in
 *     `apps/docs/AGENTS.md` ("Marketing screenshots");
 *   - `demo-live-run-poster.png` is written by `record-demo-video.mjs`, with
 *     the video it stands in for.
 */
const EXTERNAL_DOCS_IMAGES = new Set([
  'demo-live-run-poster.png',
  'failure-clusters-tab.png',
  'flaky-tests.png',
  'projects.png',
]);

/** The steps of the coupon report the repro-request scene shows. */
const REPRO_SCENE_STEPS = (() => {
  const origin = 'https://staging.shop.test';
  const byTestId = (id) => ({
    tagName: 'button',
    role: null,
    accessibleName: null,
    testId: id,
    text: null,
    alternatives: [{ locator: `getByTestId('${id}')`, method: 'getByTestId', score: 95 }],
  });
  const step = (action, extra) => ({
    action,
    target: null,
    value: null,
    redacted: false,
    pageUrl: `${origin}/cart`,
    timestamp: 1,
    ...extra,
  });
  return {
    v: 1,
    title: 'Coupon not applied to the total',
    origin,
    recordedAt: 1,
    note: null,
    steps: [
      step('goto', { value: `${origin}/cart` }),
      step('fill', {
        target: { ...byTestId('coupon'), tagName: 'input', role: 'textbox', accessibleName: 'Coupon' },
        value: 'SPRING10',
      }),
      step('click', { target: { ...byTestId('apply'), role: 'button', accessibleName: 'Apply' } }),
      step('assert', {
        target: { ...byTestId('cart-total'), tagName: 'p' },
        assertion: {
          matcher: 'toHaveText',
          expected: 'Total: 42',
          actual: 'Total: 40',
          negated: false,
          note: 'the coupon is ignored',
        },
      }),
    ],
  };
})();

/** What the mocked `desktop_inspect_folder` reports unless a scene overrides it. */
const READY_INSPECTION = {
  path: '/home/dev/code/acme-checkout',
  exists: true,
  packageName: '@acme/checkout',
  suggestedName: 'checkout-web',
  playwrightConfig: 'playwright.config.ts',
  playwrightInstalled: true,
  reporterInstalled: true,
  reporterConfigured: true,
  configuredProjectName: 'checkout-web',
};

/**
 * Scenes: one entry per user-facing feature (or state of it) worth showing.
 *
 * The common case is declarative — a route, an element to capture, done:
 *
 *   { name: 'locator-healing', tags: ['docs'], out: 'docs',
 *     route: '/test-run-cases/13',
 *     expand: ['[data-shot="alternative-locators"]'],
 *     of: '[data-shot="alternative-locators"]', pad: 12 }
 *
 * `run` takes over for anything irregular and calls `shoot(label?)` per capture.
 *
 * Context passed to `run`:
 *   page     — Playwright page, already at `route` with hydration settled
 *   base     — server origin, e.g. http://localhost:3050
 *   shoot    — (label?, opts?) => save `<file>[-<label>].png`; opts.of / opts.pad
 *              override the scene's, opts.clip / opts.fullPage / opts.mask pass
 *              through to Playwright
 *   goto     — (path) => navigate, wait for hydration, settle
 *   settle   — (opts?) => fonts loaded, network quiet, nothing still loading
 *   openTab  — (name, opts?) => click a tab and assert it actually opened
 *   expand   — (selector) => unfold a collapsible section, assert it unfolded
 *   annotate — (shapes) => draw the annotation overlay (see screenshot-annotations.mjs)
 *   clear    — () => remove the overlay, for a clean capture of the same page
 *
 * Scene options:
 *   description — one line, shown by --list
 *   mode        — 'web' (default) or 'desktop'; picks the server the scene runs
 *                 against, and whether the mocked Tauri bridge is injected
 *   tags        — ['docs'] / ['desktop']; --tag selects on these
 *   out         — 'screens' (default) or 'docs'
 *   file        — output basename, default `<name>.png`
 *   outputs     — every file the scene writes; defaults to `file` plus the
 *                 `-annotated` variant when the scene annotates. --check reads it
 *   route       — initial path (default '/')
 *   prepare     — ({ base, request }) => put the server in the state the shot
 *                 needs, before the page loads; `request` is Playwright's API
 *                 client, so a scene can call an endpoint the UI does not
 *   viewport    — default 1280×860
 *   colorScheme — 'light' | 'dark'
 *   split       — capture the scene twice and composite a light/dark diagonal,
 *                 light above the top-right → bottom-left seam, dark below
 *   deviceScaleFactor — capture at N× (pair with `outputWidth` for crisp text)
 *   outputWidth — resize the written PNG to this width
 *   expand      — selectors of collapsible sections to unfold before capturing
 *   of          — selector (or array of them) to capture instead of the viewport
 *   pad         — padding in CSS px around `of`
 *   annotate    — annotation shapes; the scene then writes a `-annotated` image too
 *   charts      — wait for chart geometry to render before capturing
 *   link        — desktop mode: mocked linked folder for `desktop_get_project_link` (or null)
 *   inspection  — desktop mode: mocked `desktop_inspect_folder` answer (default READY_INSPECTION)
 *   importableRuns — desktop mode: archives `desktop_find_importable_runs` reports (default [])
 *   pickedFiles — desktop mode: archives the native import picker returns (default [])
 */
/** Ticks the row checkboxes of the `count` newest runs in project 1's runs list that are not kept. */
async function selectNewestRuns(page, count) {
  const kept = await (await page.request.get(new URL('/api/projects/1/kept-runs', page.url()).href)).json();
  const keptIds = new Set((kept.items ?? []).map((r) => r.id));
  const boxes = page.locator('[data-shot="runs-table"] input[aria-label^="Select run #"]:visible');
  let ticked = 0;
  for (const box of await boxes.all()) {
    if (ticked === count) break;
    const id = Number((await box.getAttribute('aria-label'))?.replace('Select run #', ''));
    if (keptIds.has(id)) continue;
    await box.check();
    ticked++;
  }
}

/**
 * Selects project 1's three newest runs, deletes the selection and runs
 * `capture` while the second run is still being deleted. Every DELETE is
 * answered in the browser and none reaches the server: the second is held
 * until the capture is done, and the scene waits for the modal to close so no
 * request is left in flight when the context closes.
 */
async function captureRunsDeleteProgress(page, capture) {
  let deletes = 0;
  let releaseHeld = () => {};
  await page.route('**/api/test-runs/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deletes += 1;
    if (deletes === 2) await new Promise((resolve) => (releaseHeld = resolve));
    await route.fulfill({ json: { success: true } });
  });
  const dialog = page.getByRole('dialog');
  try {
    await selectNewestRuns(page, 3);
    await page.locator('[data-shot="runs-table"]').getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete 3 runs' }).click();
    await dialog.getByText('1 of 3 done', { exact: false }).waitFor();
    // The elapsed clock shows once a second has passed; a frozen clock never gets there.
    await dialog
      .getByText('running for', { exact: false })
      .waitFor({ timeout: 3000 })
      .catch(() => {});
    await capture();
  } finally {
    releaseHeld();
    await dialog.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  }
}

/**
 * Confirms the deletion of project 1 in its Delete modal, holds it mid-way and
 * runs `capture`: the progress poll answers with a deletion a third of the way
 * through its runs, and the DELETE request is held, then aborted before the
 * scene ends — a request still held when the context closes reaches the server.
 * Waits on the rendered steps, not on `settle()`, which the held request would
 * never let finish.
 */
async function captureProjectDeleteProgress(page, capture) {
  let abortHeld = async () => {};
  await page.route('**/api/projects/1', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    return new Promise((resolve) => {
      abortHeld = () => route.abort().then(resolve);
    });
  });
  await page.route('**/api/projects/1/deletion', (route) =>
    route.fulfill({ json: { progress: { phase: 'runs', totalRuns: 1280, runsDeleted: 412 } } }),
  );
  try {
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog');
    const input = dialog.getByRole('textbox');
    await input.fill((await input.getAttribute('placeholder')) ?? '');
    await dialog.getByRole('button', { name: 'Delete project' }).click();
    await dialog.getByText('412 of 1,280 deleted').waitFor();
    // The elapsed clock reads "Starting…" for its first second; a frozen clock keeps it there.
    await dialog
      .getByText('Running for', { exact: false })
      .waitFor({ timeout: 3000 })
      .catch(() => {});
    await capture();
  } finally {
    await abortHeld();
  }
}

/**
 * Classifies project 1's flaky tests from their recorded failures, so every row
 * shows the root cause the classifier derives rather than the seeded label.
 */
async function classifyFlakyTests({ base, request }) {
  const flaky = await (await request.get(`${base}/api/projects/1/flaky-tests`)).json();
  for (const test of flaky.items ?? []) {
    await request.post(`${base}/api/projects/1/flaky-classify`, { data: { testCaseId: test.testCaseId } });
  }
}

/** A global email channel, a weekly schedule on it and one *Run now*, once per server. */
async function prepareReportSchedule({ base, request }) {
  const schedules = await (await request.get(`${base}/api/reports/schedules`)).json();
  if (schedules.items?.length) return;
  const channels = await (await request.get(`${base}/api/channels`)).json();
  let channel = channels.items?.find((c) => c.type === 'email');
  if (!channel) {
    const created = await request.post(`${base}/api/channels`, {
      data: { name: 'Team mail', type: 'email', config: { address: 'team@example.com' } },
    });
    channel = (await created.json()).channel;
  }
  const schedule = await (
    await request.post(`${base}/api/reports/schedules`, {
      data: {
        name: 'Weekly executive report',
        dashboard: 'executive',
        cadence: 'weekly',
        anchor: 1,
        at: '08:00',
        channelIds: [channel.id],
      },
    })
  ).json();
  await request.post(`${base}/api/reports/schedules/${schedule.id}/run`);
}

/**
 * A Bug type's create screen as the fields endpoint returns it: Severity and a
 * Team are required, Components and Fix versions are optional, Priority has a
 * Jira default.
 */
const JIRA_SCREEN_FIELDS = [
  {
    id: 'customfield_10050',
    name: 'Severity',
    required: true,
    hasDefault: false,
    kind: 'option',
    options: [
      { id: '10100', label: 'Critical' },
      { id: '10101', label: 'Major' },
      { id: '10102', label: 'Minor' },
    ],
    typeName: 'select',
  },
  {
    id: 'customfield_10001',
    name: 'Team',
    required: true,
    hasDefault: false,
    kind: 'raw',
    options: null,
    typeName: 'atlassian-team',
  },
  {
    id: 'components',
    name: 'Components',
    required: false,
    hasDefault: false,
    kind: 'option-array',
    options: [
      { id: '10200', label: 'Checkout' },
      { id: '10201', label: 'Payments' },
    ],
    typeName: 'components',
  },
  {
    id: 'fixVersions',
    name: 'Fix versions',
    required: false,
    hasDefault: false,
    kind: 'option-array',
    options: [{ id: '10300', label: '2.5.0' }],
    typeName: 'fixVersions',
  },
  {
    id: 'priority',
    name: 'Priority',
    required: false,
    hasDefault: true,
    kind: 'option',
    options: [{ id: '3', label: 'Medium' }],
    typeName: 'priority',
  },
];

/** An open sample issue's transitions: Resolve leads to Done through a screen requiring a Resolution. */
const JIRA_OPEN_SAMPLE = {
  issue: { key: 'CHK-128', status: 'To Do' },
  transitions: [
    { id: '21', name: 'Start progress', toStatus: 'In Progress', toStatusCategory: 'indeterminate', fields: [] },
    {
      id: '31',
      name: 'Resolve',
      toStatus: 'Done',
      toStatusCategory: 'done',
      fields: [
        {
          id: 'resolution',
          name: 'Resolution',
          required: true,
          hasDefault: false,
          kind: 'option',
          options: [
            { id: '1', label: 'Fixed' },
            { id: '2', label: "Won't fix" },
            { id: '3', label: 'Duplicate' },
          ],
          typeName: 'resolution',
        },
        {
          id: 'fixVersions',
          name: 'Fix versions',
          required: false,
          hasDefault: false,
          kind: 'option-array',
          options: [{ id: '10300', label: '2.5.0' }],
          typeName: 'fixVersions',
        },
      ],
    },
  ],
};

/** A done sample issue's transitions: Reopen has no screen. */
const JIRA_DONE_SAMPLE = {
  issue: { key: 'CHK-97', status: 'Done' },
  transitions: [{ id: '11', name: 'Reopen', toStatus: 'To Do', toStatusCategory: 'new', fields: [] }],
};

/** The project defaults the required-fields scenes show: a Severity and a component. */
const JIRA_FIELD_DEFAULTS = {
  customfield_10050: { value: { id: '10101' }, label: 'Major' },
  components: { value: [{ id: '10200' }], label: 'Checkout' },
};

/** The db-managed connection the required-fields scenes bind; its dead port means no Jira is contacted. */
let jiraSceneConnectionId = 0;

async function prepareJiraSceneConnection({ base, request }) {
  const list = await (await request.get(`${base}/api/integrations/connections`)).json();
  const existing = list.connections?.find((c) => c.provider === 'jira' && c.managedBy === 'db' && c.name === 'Jira');
  if (existing) {
    jiraSceneConnectionId = existing.id;
    return;
  }
  const created = await request.post(`${base}/api/integrations/connections`, {
    data: {
      provider: 'jira',
      name: 'Jira',
      baseUrl: 'http://127.0.0.1:9',
      credentials: { email: 'you@example.com', apiToken: 'screenshot-token' },
    },
  });
  jiraSceneConnectionId = (await created.json()).connection.id;
}

/**
 * Answers the Jira pickers and the create screen in the page, so a scene shows
 * the required-fields UI for project CHK and its Bug type without a Jira.
 */
async function routeJiraScreen(page) {
  await page.route('**/api/integrations/connections/*/projects', (route) =>
    route.fulfill({ json: { projects: [{ id: '1', key: 'CHK', name: 'Checkout' }] } }),
  );
  await page.route('**/api/integrations/connections/*/projects/*/issue-types', (route) =>
    route.fulfill({
      json: {
        issueTypes: [
          { id: '10004', name: 'Bug' },
          { id: '10006', name: 'Task' },
        ],
      },
    }),
  );
  await page.route('**/api/integrations/connections/*/projects/*/issue-types/*/fields', (route) =>
    route.fulfill({ json: { fields: JIRA_SCREEN_FIELDS } }),
  );
  await page.route('**/api/integrations/connections/*/assignable*', (route) => route.fulfill({ json: { users: [] } }));
}

// The evidence-footer scene seeds its own fixtures-free project; `prepare`
// records the execution id it submits so `run` can open that page.
let footerExecId = 0;

const SCENES = [
  // ── Report artifacts (gitignored `.screens/`) ─────────────────────────────
  {
    name: 'sidebar-latest-run',
    description:
      "The sidebar's project status badges: one hovered (its title names the latest run it opens), then that run after a click",
    route: '/',
    viewport: { width: 1280, height: 900 },
    async run({ page, shoot, settle }) {
      const badge = page.locator('[data-shot="sidebar-latest-run"]').first();
      await badge.waitFor({ timeout: 60000 });
      await settle();
      await badge.hover();
      await shoot('hover');
      await badge.click();
      await page.waitForURL(/\/test-runs\/\d+/, { timeout: 60000 });
      await settle();
      await shoot('run');
    },
    outputs: ['sidebar-latest-run-hover.png', 'sidebar-latest-run-run.png'],
  },
  {
    name: 'analytics-scope-bar',
    description:
      'The Filters block on Analytics: Period, Runs and Tests groups, the period picker open with comparison and buckets',
    route: '/analytics?period=last-90d',
    viewport: { width: 1280, height: 1000 },
    async run({ page, shoot, settle }) {
      await page.getByTestId('analytics-period').waitFor({ timeout: 60000 });
      await page.getByTestId('analytics-scope-line').waitFor({ timeout: 60000 });
      await settle();
      await page.getByTestId('analytics-period').click();
      await page.getByText('Compare with').waitFor({ timeout: 15000 });
      await shoot();
    },
  },
  {
    name: 'analytics-scope-bar-mobile',
    description:
      'The Filters block at 375 px: folded to a summary of the active filters, then open, no horizontal scroll',
    route: '/analytics',
    viewport: { width: 375, height: 900 },
    async run({ page, shoot, settle }) {
      const summary = page.getByTestId('analytics-filters-summary');
      // The comparison in the summary comes from a client-side fetch, so the page has hydrated once it shows.
      await summary.filter({ hasText: ' vs ' }).waitFor({ timeout: 60000 });
      await settle();
      await shoot('folded', { of: '[data-shot="analytics-scope-bar"]', pad: 8 });
      await page.getByTestId('analytics-filters-toggle').click();
      await page.getByTestId('analytics-period').waitFor({ timeout: 15000 });
      await settle();
      await shoot('open', { of: '[data-shot="analytics-scope-bar"]', pad: 8 });
    },
    outputs: ['analytics-scope-bar-mobile-folded.png', 'analytics-scope-bar-mobile-open.png'],
  },
  {
    name: 'analytics-headline',
    description:
      'Analytics, the Overview dashboard: the headline tiles above the portfolio, and the pass rate over time',
    route: '/analytics',
    viewport: { width: 1280, height: 2400 },
    async run({ page, shoot, settle }) {
      await page.getByTestId('stat-test-pass-rate').waitFor({ timeout: 60000 });
      await page.locator('[data-shot="analytics-metric"] svg').first().waitFor({ timeout: 60000 });
      await settle();
      await shoot('tiles', { of: '[data-shot="analytics-headline"]', pad: 12 });
      await shoot('trend', { of: '[data-shot="analytics-metric"]', pad: 12 });
    },
    outputs: ['analytics-headline-tiles.png', 'analytics-headline-trend.png'],
  },
  ...[
    { name: 'quality-report-preview', width: 1280, height: 1800 },
    { name: 'quality-report-preview-mobile', width: 375, height: 1400 },
  ].map(({ name, width, height }) => ({
    name,
    description: `Export on the analytics page: the executive quality report previewed, at ${width} px`,
    route: '/analytics',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      const preview = page.getByTestId('report-view');
      await page.getByTestId('stat-test-pass-rate').waitFor({ timeout: 60000 });
      await settle();
      // Hydration can lag the first paint on a dev server; retry the click until the dialog opens.
      for (let attempt = 0; attempt < 20 && !(await preview.isVisible()); attempt++) {
        await page.getByRole('button', { name: 'Export' }).first().click();
        await preview.waitFor({ timeout: 3000 }).catch(() => {});
      }
      await preview.locator('svg').first().waitFor({ timeout: 60000 });
      await settle();
      await shoot();
    },
  })),
  ...[
    { name: 'quality-report-download-menu', width: 1280, height: 1000 },
    { name: 'quality-report-download-menu-mobile', width: 375, height: 1000 },
  ].map(({ name, width, height }) => ({
    name,
    description: `The quality report preview with its download menu open (PDF, HTML, Markdown, Excel, JSON) and each section's Excel button, at ${width} px`,
    route: '/analytics',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      const preview = page.getByTestId('report-view');
      await page.getByTestId('stat-test-pass-rate').waitFor({ timeout: 60000 });
      await settle();
      for (let attempt = 0; attempt < 20 && !(await preview.isVisible()); attempt++) {
        await page.getByRole('button', { name: 'Export' }).first().click();
        await preview.waitFor({ timeout: 3000 }).catch(() => {});
      }
      await preview.locator('[data-testid^="report-section-xlsx-"]').first().waitFor({ timeout: 60000 });
      await settle();
      await page.getByTestId('report-download').click();
      await page.getByRole('menuitem', { name: 'Excel' }).waitFor();
      await shoot();
    },
  })),
  // The Reports page and a snapshot: `prepare` makes a channel, a weekly
  // schedule and one run of it, so the page has a snapshot to list.
  ...[
    { name: 'report-schedules', width: 1280, height: 860, docs: true },
    { name: 'report-schedules-mobile', width: 375, height: 900, docs: false },
  ].map(({ name, width, height, docs }) => ({
    name,
    description: `The Reports page: report snapshots and schedules, at ${width} px`,
    ...(docs ? { tags: ['docs'], out: 'docs' } : {}),
    prepare: prepareReportSchedule,
    route: '/reports',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      await page.getByTestId('schedule-list').waitFor({ timeout: 60000 });
      await page.getByTestId('snapshot-list').waitFor({ timeout: 60000 });
      await settle();
      await shoot();
    },
  })),
  ...[
    { name: 'report-snapshot', width: 1280, height: 1600 },
    { name: 'report-snapshot-mobile', width: 375, height: 1600 },
  ].map(({ name, width, height }) => ({
    name,
    description: `A report snapshot on /reports/:id, at ${width} px`,
    prepare: prepareReportSchedule,
    route: '/reports',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      await page.getByTestId('snapshot-list').getByRole('link').first().click({ timeout: 60000 });
      await page.getByTestId('report-view').locator('svg').first().waitFor({ timeout: 60000 });
      await settle();
      await shoot();
    },
  })),
  // The share scenes need share links on: run them with PIWI_SHARE_LINKS_ENABLED=true (the harness's own
  // server inherits the environment), or against a --url server that has it.
  ...[
    { name: 'report-share-link', width: 1280, height: 900 },
    { name: 'report-share-link-mobile', width: 375, height: 1000 },
  ].map(({ name, width, height }) => ({
    name,
    description: `A report snapshot's share dialog with a minted link and its badge, at ${width} px`,
    prepare: prepareReportSchedule,
    route: '/reports',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      await page.getByTestId('snapshot-list').getByRole('link').first().click({ timeout: 60000 });
      await page.getByTestId('report-view').locator('svg').first().waitFor({ timeout: 60000 });
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await page.getByRole('button', { name: 'Create link' }).click({ timeout: 30000 });
      await page.getByTestId('minted-badge').getByRole('img').waitFor({ timeout: 30000 });
      await settle();
      await shoot();
    },
  })),
  ...[
    { name: 'live-dashboard-link', width: 1280, height: 900 },
    { name: 'live-dashboard-link-mobile', width: 375, height: 1000 },
  ].map(({ name, width, height }) => ({
    name,
    description: `The live dashboard links dialog of the seeded Checkout team dashboard, at ${width} px`,
    route: '/analytics/d/1',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      await page.locator('[data-shot="dashboard"]').waitFor({ timeout: 60000 });
      await page.getByRole('button', { name: 'More dashboard actions' }).click();
      await page.getByRole('menuitem', { name: 'Live dashboard links' }).click();
      await page.getByRole('button', { name: 'Create link' }).click({ timeout: 30000 });
      await page.getByTestId('minted-badge').getByRole('img').waitFor({ timeout: 30000 });
      await settle();
      await shoot();
    },
  })),
  ...[
    { name: 'saved-dashboard', width: 1280, height: 1500, docs: true },
    { name: 'saved-dashboard-mobile', width: 375, height: 1600, docs: false },
  ].map(({ name, width, height, docs }) => ({
    name,
    description: `The seeded shared Checkout team dashboard on /analytics/d/1, at ${width} px`,
    ...(docs ? { tags: ['docs'], out: 'docs' } : {}),
    route: '/analytics/d/1',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      await page.locator('[data-shot="dashboard"]').waitFor({ timeout: 60000 });
      await page.locator('[data-shot="analytics-note"]').waitFor({ timeout: 60000 });
      await settle();
      await shoot();
    },
  })),
  // Trend depth: one scene per new widget, tab and control, at 1280 and 375 px.
  ...[
    { shot: 'analytics-suite-growth', route: '/analytics?projects=1', what: 'the suite growth widget' },
    { shot: 'analytics-flaky-debt', route: '/analytics?projects=1', what: 'the flaky debt widget' },
    { shot: 'analytics-time-to-fix', route: '/analytics?projects=1', what: 'the time to fix widget' },
    { shot: 'analytics-headline', route: '/analytics?projects=1', what: 'the headline tiles with their target marks' },
    { shot: 'analytics-ownership', route: '/analytics/d/engineering', what: 'the ownership widget' },
    { shot: 'analytics-movers', route: '/analytics/d/engineering', what: 'the movers widget' },
    {
      shot: 'analytics-environment-comparison',
      route: '/analytics/d/engineering?projects=2',
      what: 'the environment comparison widget',
    },
    { shot: 'test-case-trend', route: '/test-cases/1?tab=trend', what: 'the Trend tab of a test' },
    {
      shot: 'cluster-occurrence-trend',
      route: '/failure-clusters/3',
      what: 'a failure cluster’s occurrences over time',
    },
    { shot: 'project-targets', route: '/projects/1?tab=settings', what: 'the project targets form' },
    {
      shot: 'project-url-patterns',
      route: '/projects/1?tab=settings',
      what: 'the browser extension URL patterns of a project, with the origins its suite visited',
    },
  ].flatMap(({ shot, route, what }) =>
    [
      { suffix: '', width: 1280 },
      { suffix: '-mobile', width: 375 },
    ].map(({ suffix, width }) => ({
      name: `${shot}${suffix}`,
      description: `${what[0].toUpperCase()}${what.slice(1)}, at ${width} px`,
      route,
      viewport: { width, height: 1800 },
      of: `[data-shot="${shot}"]`,
      async run({ page, shoot, settle }) {
        const target = page.locator(`[data-shot="${shot}"]`).first();
        await target.waitFor({ timeout: 90000 });
        await target.scrollIntoViewIfNeeded();
        await settle();
        await shoot();
      },
    })),
  ),
  ...[
    { name: 'project-url-patterns-empty', width: 1280 },
    { name: 'project-url-patterns-empty-mobile', width: 375 },
  ].map(({ name, width }) => ({
    name,
    description: `The browser extension URLs of a project whose runs recorded no baseURL, saying why nothing is suggested, at ${width} px`,
    route: '/projects/2?tab=settings',
    viewport: { width, height: 1000 },
    of: '[data-shot="project-url-patterns"]',
    async run({ page, shoot, settle }) {
      const card = page.locator('[data-shot="project-url-patterns"]');
      await card.getByTestId('url-pattern-no-suggestions').waitFor({ timeout: 90000 });
      await card.scrollIntoViewIfNeeded();
      await settle();
      await shoot();
    },
  })),
  ...[
    { name: 'chart-export-menu', width: 1280 },
    { name: 'chart-export-menu-mobile', width: 375 },
  ].map(({ name, width }) => ({
    name,
    description: `The export menu of a chart (copy as PNG, download Excel), at ${width} px`,
    route: '/analytics?projects=1',
    viewport: { width, height: 900 },
    async run({ page, shoot, settle }) {
      const card = page.locator('[data-shot="analytics-suite-growth"]');
      await card.waitFor({ timeout: 90000 });
      await card.scrollIntoViewIfNeeded();
      await settle();
      await card.getByTestId('chart-export').click();
      await page.getByRole('menuitem', { name: 'Download Excel' }).waitFor();
      await shoot();
    },
  })),
  ...[
    { name: 'dashboard-editor', width: 1280, height: 1200, docs: true },
    { name: 'dashboard-editor-mobile', width: 375, height: 1400, docs: false },
  ].map(({ name, width, height, docs }) => ({
    name,
    description: `The dashboard editor on the seeded wasted-CI dashboard, a widget menu open, at ${width} px`,
    ...(docs ? { tags: ['docs'], out: 'docs' } : {}),
    route: '/analytics/d/2?edit=1',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      await page.getByTestId('add-widget-button-0').waitFor({ timeout: 60000 });
      await page.locator('[data-shot="analytics-metric-display"]').first().waitFor({ timeout: 60000 });
      await settle();
      await page.getByTestId('widget-menu-wasted-by-browser').click();
      await page.getByRole('menuitem', { name: 'Configure' }).waitFor();
      await shoot();
    },
  })),
  // *Rename…* on Manage dashboards: the seeded wasted-CI dashboard's name and description.
  ...[
    { name: 'dashboard-rename', width: 1280, height: 800 },
    { name: 'dashboard-rename-mobile', width: 375, height: 800 },
  ].map(({ name, width, height }) => ({
    name,
    description: `Manage dashboards, then Rename… on a saved dashboard, at ${width} px`,
    route: '/analytics/dashboards',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      const dialog = page.getByTestId('rename-dashboard');
      await page.getByTestId('dashboard-row-2').waitFor({ timeout: 60000 });
      await settle();
      for (let attempt = 0; attempt < 20 && !(await dialog.isVisible()); attempt++) {
        await page
          .getByTestId('dashboard-row-2')
          .getByRole('button', { name: /^Actions:/ })
          .click();
        await page
          .getByRole('menuitem', { name: 'Rename…' })
          .click({ timeout: 3000 })
          .catch(() => {});
        await dialog.waitFor({ timeout: 3000 }).catch(() => {});
      }
      await settle();
      await shoot();
    },
  })),
  ...[
    { name: 'report-schedule-form', width: 1280, height: 900 },
    { name: 'report-schedule-form-mobile', width: 375, height: 900 },
  ].map(({ name, width, height }) => ({
    name,
    description: `Schedule… on the analytics page: the schedule form, at ${width} px`,
    route: '/analytics',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      const form = page.getByTestId('schedule-form');
      await page.getByTestId('stat-test-pass-rate').waitFor({ timeout: 60000 });
      await settle();
      for (let attempt = 0; attempt < 20 && !(await form.isVisible()); attempt++) {
        await page.locator('button[title="Schedule a quality report of this scope"]').first().click();
        await form.waitFor({ timeout: 3000 }).catch(() => {});
      }
      await page.getByTestId('schedule-name').fill('Weekly executive report');
      await settle();
      await shoot();
    },
  })),
  // *Send to* in the schedule form: each channel with who receives it (`-picker`,
  // the list open), then the recipients of the picked channel under it.
  ...[
    { name: 'report-schedule-recipients', width: 1280, height: 1000 },
    { name: 'report-schedule-recipients-mobile', width: 375, height: 1000 },
  ].map(({ name, width, height }) => ({
    name,
    description: `Schedule… then Send to: who each channel reaches, and the picked channels' recipients, at ${width} px`,
    prepare: prepareReportSchedule,
    route: '/analytics',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      const form = page.getByTestId('schedule-form');
      await page.getByTestId('stat-test-pass-rate').waitFor({ timeout: 60000 });
      await settle();
      for (let attempt = 0; attempt < 20 && !(await form.isVisible()); attempt++) {
        await page.locator('button[title="Schedule a quality report of this scope"]').first().click();
        await form.waitFor({ timeout: 3000 }).catch(() => {});
      }
      await page.getByTestId('schedule-name').fill('Weekly executive report');
      await page.getByTestId('schedule-channels').click();
      const option = page.getByRole('option', { name: /Email to/ }).first();
      await option.waitFor({ timeout: 30000 });
      await settle();
      await shoot('picker');
      await option.click();
      await page.keyboard.press('Escape');
      await page.getByTestId('schedule-recipients').waitFor({ timeout: 30000 });
      await settle();
      await shoot();
    },
  })),
  // *Preview* in the schedule form, sending to the email channel `prepare` makes.
  ...[
    { name: 'report-schedule-preview', width: 1280, height: 1400 },
    { name: 'report-schedule-preview-mobile', width: 375, height: 1000 },
  ].map(({ name, width, height }) => ({
    name,
    description: `Schedule… then Preview: the email the schedule would send now, at ${width} px`,
    prepare: prepareReportSchedule,
    route: '/analytics',
    viewport: { width, height },
    async run({ page, shoot, settle }) {
      const form = page.getByTestId('schedule-form');
      await page.getByTestId('stat-test-pass-rate').waitFor({ timeout: 60000 });
      await settle();
      for (let attempt = 0; attempt < 20 && !(await form.isVisible()); attempt++) {
        await page.locator('button[title="Schedule a quality report of this scope"]').first().click();
        await form.waitFor({ timeout: 3000 }).catch(() => {});
      }
      await page.getByTestId('schedule-name').fill('Weekly executive report');
      await page.getByTestId('schedule-channels').click();
      await page
        .getByRole('option', { name: /Email to/ })
        .first()
        .click();
      await page.keyboard.press('Escape');
      await page.getByTestId('schedule-preview-open').click();
      await page.getByTestId('schedule-preview-email').waitFor({ timeout: 60000 });
      await settle();
      await shoot();
    },
  })),
  {
    name: 'test-case-locators',
    description:
      'Test case page: the Locators section, from the latest execution, with how many tests share each chain',
    route: '/test-cases/1',
    viewport: { width: 1280, height: 1800 },
    async run({ page, shoot, settle }) {
      await page
        .locator('[data-shot="execution-locators"] ol')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[data-shot="test-case-locators"]', pad: 12 });
    },
  },
  ...['', '-mobile'].map((suffix) => ({
    name: `screen-views${suffix}`,
    description: suffix
      ? 'Screen tab at phone width: the views of the page at the failure, the strip wrapping onto two rows'
      : 'Screen tab: one strip of views of the page at the failure (Screenshot, DOM, Accessibility tree, Visual diff, Page diff, Video) over the files',
    route: '/test-run-cases/37',
    viewport: suffix ? { width: 390, height: 1400 } : { width: 1280, height: 1100 },
    of: '[data-shot="evidence-card"]',
    pad: suffix ? 8 : 12,
    async run({ page, shoot, settle }) {
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Screen', exact: true })
        .click();
      // The strip is whole once the diffs have reported.
      await page
        .getByRole('tablist', { name: 'Screen view' })
        .getByRole('tab', { name: 'Page diff' })
        .waitFor({ timeout: 30_000 });
      await settle();
      await shoot();
    },
  })),
  {
    name: 'screen-dom-picker',
    description: 'Screen tab: the DOM view → Open in picker, the locator picker over the same page',
    route: '/test-run-cases/37',
    viewport: { width: 1280, height: 1000 },
    async run({ page, shoot, settle }) {
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Screen', exact: true })
        .click();
      await page.getByRole('tablist', { name: 'Screen view' }).getByRole('tab', { name: 'DOM', exact: true }).click();
      await page.locator('iframe[title="DOM at the failure"]').waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: 'Open in picker' }).click();
      await page.getByText('Rendered from the failure-time DOM snapshot').waitFor({ timeout: 15000 });
      await page.getByText('Initializing picker').waitFor({ state: 'detached', timeout: 15000 });
      await settle();
      await shoot();
    },
  },
  {
    name: 'locator-usage-drawer',
    description: 'Who uses this? drawer: the call sites and tests that use a locator, with the command that runs them',
    route: '/test-run-cases/711',
    viewport: { width: 1280, height: 1000 },
    async run({ page, shoot, settle, openTab }) {
      await openTab('Locators');
      const card = page.locator('[data-shot="execution-locators"]');
      await card
        .getByRole('button', { name: /tests?$/ })
        .first()
        .click();
      const drawer = page.locator('[data-shot="locator-usage-drawer"]');
      await drawer.getByText(/ call sites?$/).waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: /^Run these/ }).click();
      await drawer.getByText('Run them').waitFor({ timeout: 15000 });
      await settle();
      await shoot();
    },
  },
  {
    name: 'project-locators',
    description:
      'Project Locators page: pasted locators checked against the locator index (exact, similar, unused), the tests reaching them, the branch select',
    route: `/projects/1/locators?q=${encodeURIComponent(
      ["getByLabel('Email')", "getByText('Order confirmed!')", "getByTestId('coupon')"].join('\n'),
    )}`,
    viewport: { width: 1280, height: 1400 },
    async run({ page, shoot, settle }) {
      await page
        .locator('[data-shot="locator-check-tests"]')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot();
    },
  },
  {
    name: 'project-locators-mobile',
    description: 'Project Locators page at phone width',
    route: `/projects/1/locators?q=${encodeURIComponent(["getByLabel('Email')", "getByTestId('coupon')"].join('\n'))}`,
    viewport: { width: 390, height: 1400 },
    async run({ page, shoot, settle }) {
      await page
        .locator('[data-shot="locator-check-tests"]')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot();
    },
  },
  {
    name: 'scenario-gaps-tab',
    description: 'Gaps tab: gaps and findings grouped by feature, ranked, with class, factors and inbox verbs',
    route: '/projects/1?tab=gaps',
    viewport: { width: 1280, height: 1500 },
    async run({ page, shoot, settle }) {
      await page
        .locator('[data-shot="gaps-panel"]')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[data-shot="gaps-panel"]', pad: 12 });
    },
  },
  {
    name: 'scenario-gaps-feature-map',
    description:
      'Feature map: the project graph folded per feature, colored by worst gap, linked where features share nodes',
    route: '/projects/1?tab=gaps',
    viewport: { width: 1280, height: 1100 },
    async run({ page, shoot, settle }) {
      await page
        .locator('[data-shot="feature-map"] svg')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[data-shot="feature-map"]', pad: 12 });
    },
  },
  {
    name: 'scenario-gaps-graph',
    description: 'Feature-graph view: the ego picture around a gap node over the inspector list of its neighbors',
    route: '/projects/1?tab=gaps',
    viewport: { width: 1280, height: 1100 },
    async run({ page, shoot, settle }) {
      await page
        .locator('[data-shot="gaps-panel"]')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      // Open the graph from the first gap's "view in the graph" button.
      await page.locator('[data-shot^="gap-"]').first().getByRole('button', { name: 'View', exact: false }).click();
      await page
        .locator('[data-shot="feature-graph"] svg')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[data-shot="feature-graph"]', pad: 12 });
    },
  },
  {
    name: 'scenario-gaps-home-inbox',
    description: 'Home: the accepted-but-unwritten scenario-gaps inbox queue',
    route: '/',
    viewport: { width: 1280, height: 1400 },
    async run({ page, shoot, settle }) {
      await page
        .locator('[data-shot="gaps-inbox"]')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[data-shot="gaps-inbox"]', pad: 12 });
    },
  },
  {
    name: 'storage-analysis',
    description: 'Settings → Storage: usage KPIs, storage over time, by file kind and top projects',
    route: '/settings/storage',
    viewport: { width: 1280, height: 1700 },
    async run({ page, shoot, settle }) {
      // The dashboard fetches client-side; wait for a KPI to resolve before capture.
      await page
        .getByText('Total storage')
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[data-shot="storage-analysis"]', pad: 12 });
    },
  },
  {
    name: 'localization-settings',
    description:
      'Settings → Localization: the per-viewer format override and the admin instance default, with a live preview',
    route: '/settings/localization',
    viewport: { width: 1280, height: 1100 },
    async run({ page, shoot, settle }) {
      // Both cards fetch the instance default client-side; wait for the preview
      // line to resolve before capturing.
      await page
        .getByText('Preview:')
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[data-shot="localization-settings"]', pad: 12 });
    },
  },
  {
    name: 'user-api-keys',
    description: 'The API keys manager (shared ApiKeysManager) — here in the Users admin modal',
    route: '/settings/users',
    viewport: { width: 1100, height: 1000 },
    async run({ page, shoot, settle }) {
      // The screenshot server runs with auth off, so every user's keys are
      // manageable; open the first user's modal. The same component backs the
      // Account page (Settings → Account → API keys), which needs auth enabled.
      await page.getByRole('button', { name: 'Manage API keys' }).first().click();
      await page.getByRole('dialog').waitFor();
      await settle();
      await shoot(undefined, { of: '[role="dialog"]', pad: 0 });
    },
  },
  {
    name: 'permission-grid-mobile',
    description:
      'Settings → Permissions at phone width: the user column stays pinned while the projects scroll sideways',
    route: '/settings/permissions',
    viewport: { width: 390, height: 1100 },
    async run({ page, shoot, settle }) {
      await page.locator('[data-shot="permission-grid"] table').waitFor({ timeout: 15000 });
      await settle();
      await shoot();
    },
  },

  // ── Docs illustrations (committed) ────────────────────────────────────────
  {
    name: 'execution-locators',
    description: 'Execution Locators tab: every locator the test used, in order, with how many tests share each chain',
    tags: ['docs'],
    out: 'docs',
    route: '/test-run-cases/711',
    viewport: { width: 1280, height: 1400 },
    async run({ page, shoot, settle, openTab }) {
      await openTab('Locators');
      await page
        .locator('[data-shot="execution-locators"] ol')
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[data-shot="evidence-card"]', pad: 12 });
    },
  },
  {
    name: 'permission-grid',
    description:
      'Settings → Permissions: every user against every project by role, the hovered cell’s row and column highlighted',
    tags: ['docs'],
    out: 'docs',
    route: '/settings/permissions',
    viewport: { width: 1280, height: 900 },
    async run({ page, shoot, settle }) {
      const cell = page.getByRole('checkbox', { name: 'Priya (API & UI team) — E2E Checkout' });
      await cell.waitFor({ timeout: 15000 });
      await settle();
      // The crosshair follows focus as well as the pointer. Focus survives the
      // capture's re-layout, where a stationary pointer would land on another cell.
      await cell.focus();
      await shoot(undefined, { of: '[data-shot="permission-grid"]', pad: 12 });
    },
  },
  {
    name: 'integrations-settings',
    description: 'Settings → Integrations: the Jira card with a connected system and a test button',
    tags: ['docs'],
    out: 'docs',
    // Run with the server's Jira env vars set (PIWI_JIRA_BASE_URL / PIWI_JIRA_EMAIL
    // / PIWI_JIRA_API_TOKEN) so the environment-managed Jira connection appears;
    // no network call is made just to render the page.
    route: '/settings/integrations',
    viewport: { width: 1280, height: 1000 },
    of: '[data-shot="integrations-settings"]',
    pad: 12,
  },
  {
    name: 'jira-connect-form',
    description:
      'Settings → Integrations: the Jira connect form with a pasted board URL, scoped-token steps and a sign-in check',
    tags: ['docs'],
    out: 'docs',
    // Run with PIWI_SECRET_KEY set, or the form opens on the "cannot store a token" notice.
    // The check endpoint would call the typed site, so the scene answers it with a
    // canned Cloud site and sign-in; no Atlassian host is contacted.
    route: '/settings/integrations',
    viewport: { width: 1280, height: 1700 },
    async run({ page, shoot, settle }) {
      await page.route('**/api/integrations/connections/check', async (route) => {
        const body = route.request().postDataJSON();
        const result = {
          baseUrl: body.baseUrl,
          site: {
            ok: true,
            reachable: true,
            deploymentType: 'Cloud',
            title: 'Jira',
            reportedUrl: null,
            cloudId: '8f1c2b7e-4d3a-4b6f-9a51-2c0e7d9b3f10',
          },
        };
        if (body.credentials?.apiToken) {
          result.auth = { ok: true, account: { id: 'acct-1', displayName: 'Piwi Bot' }, tokenKind: 'scoped' };
          result.projects = { ok: true, count: 3, keys: ['CHK', 'PAY', 'WEB'], hint: null };
        }
        await route.fulfill({ json: result });
      });
      await page.getByRole('button', { name: 'Connect Jira' }).first().click();
      const form = page.locator('[data-shot="jira-connection-form"]');
      await form.waitFor();
      await page.getByTestId('jira-site').fill('https://your-team.atlassian.net/jira/software/projects/CHK/boards/1');
      await page.getByTestId('jira-site-check').waitFor();
      await form.getByText('Scoped token', { exact: true }).click();
      await form.getByLabel('Account email').fill('piwi-bot@example.com');
      await form.getByLabel('API token', { exact: true }).fill('screenshot-token');
      await form.getByRole('button', { name: 'Check sign-in' }).click();
      await page.getByTestId('jira-credential-check').waitFor();
      await settle();
      await shoot(undefined, { of: '[data-shot="jira-connection-form"]', pad: 12 });
    },
  },
  {
    name: 'create-issue-modal',
    description: 'Create issue modal on a cluster: title, fields, include toggles and the fix-plan preview',
    tags: ['docs'],
    out: 'docs',
    // A db-managed Jira connection makes the entry points appear; its base URL
    // points at a dead local port so the dedupe search fails fast (no real Jira).
    async prepare({ base, request }) {
      const list = await (await request.get(`${base}/api/integrations/connections`)).json();
      if (!list.connections?.some((c) => c.provider === 'jira')) {
        await request.post(`${base}/api/integrations/connections`, {
          data: {
            provider: 'jira',
            name: 'Jira',
            baseUrl: 'http://127.0.0.1:9',
            credentials: { email: 'you@example.com', apiToken: 'screenshot-token' },
          },
        });
      }
    },
    route: '/failure-clusters/10',
    viewport: { width: 1280, height: 1100 },
    async run({ page, shoot, settle }) {
      await page.locator('[data-shot="cluster-create-issue"]').first().click();
      await page.getByRole('dialog').waitFor();
      // The preview renders once the draft resolves.
      await page
        .getByText('What happened')
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      await settle();
      await shoot(undefined, { of: '[role="dialog"]', pad: 0 });
    },
  },
  {
    name: 'cluster-issue-chip',
    description: 'Cluster state line with the known-issue chip and the Open in Jira action',
    tags: ['docs'],
    out: 'docs',
    // Pin a Jira issue to the cluster so its key shows on the state line.
    async prepare({ base, request }) {
      const list = await (await request.get(`${base}/api/integrations/connections`)).json();
      if (!list.connections?.some((c) => c.provider === 'jira')) {
        await request.post(`${base}/api/integrations/connections`, {
          data: {
            provider: 'jira',
            name: 'Jira',
            baseUrl: 'http://127.0.0.1:9',
            credentials: { email: 'you@example.com', apiToken: 'screenshot-token' },
          },
        });
      }
      const links = await (await request.get(`${base}/api/links?entityType=failure_cluster&entityId=10`)).json();
      if (!links.links?.some((l) => l.provider === 'jira')) {
        await request.post(`${base}/api/links`, {
          data: {
            entityType: 'failure_cluster',
            entityId: 10,
            url: 'http://127.0.0.1:9/browse/PROJ-128',
            title: 'Checkout button is disabled',
          },
        });
      }
    },
    route: '/failure-clusters/10',
    viewport: { width: 1280, height: 700 },
    of: '[data-shot="cluster-state"]',
    pad: 12,
  },
  {
    name: 'project-integration-binding',
    description: 'Project → Settings → Issue tracker: the binding form with policies and owner routes',
    tags: ['docs'],
    out: 'docs',
    // A db-managed Jira connection makes the binding form appear; its base URL
    // points at a dead local port so no real Jira is contacted.
    async prepare({ base, request }) {
      const list = await (await request.get(`${base}/api/integrations/connections`)).json();
      if (!list.connections?.some((c) => c.provider === 'jira')) {
        await request.post(`${base}/api/integrations/connections`, {
          data: {
            provider: 'jira',
            name: 'Jira',
            baseUrl: 'http://127.0.0.1:9',
            credentials: { email: 'you@example.com', apiToken: 'screenshot-token' },
          },
        });
      }
    },
    route: '/projects/2?tab=settings',
    viewport: { width: 1280, height: 1600 },
    of: '[data-shot="project-integration-binding"]',
    pad: 12,
  },
  {
    name: 'create-issue-required-fields',
    description: 'Create issue modal asking for the fields Jira requires, one filled from the project default',
    tags: ['docs'],
    out: 'docs',
    // The draft is answered as for a project bound to CHK / Bug with a Severity
    // default; the pickers and the create screen come from routeJiraScreen.
    prepare: prepareJiraSceneConnection,
    route: '/failure-clusters/7',
    viewport: { width: 1280, height: 1100 },
    async run({ page, shoot, settle }) {
      await routeJiraScreen(page);
      await page.route('**/api/integrations/issue-draft*', async (route) => {
        const draft = await (await route.fetch()).json();
        await route.fulfill({
          json: {
            ...draft,
            connectionId: jiraSceneConnectionId,
            projectKey: 'CHK',
            issueType: '10004',
            fieldValues: JIRA_FIELD_DEFAULTS,
          },
        });
      });
      await page.locator('[data-shot="cluster-create-issue"]').first().click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('[data-shot="create-issue-fields"]').waitFor({ timeout: 15000 });
      await dialog.getByTestId('create-issue-missing').waitFor();
      await settle();
      await shoot(undefined, { of: '[role="dialog"]', pad: 0 });
    },
  },
  {
    name: 'binding-jira-fields',
    description:
      "Project → Settings → Issue tracker: the Jira fields the issue type requires, with the project's defaults",
    // The binding is answered as bound to CHK / Bug with a Severity and a
    // component default; the pickers and the create screen come from routeJiraScreen.
    prepare: prepareJiraSceneConnection,
    route: '/projects/2?tab=settings',
    viewport: { width: 1280, height: 1600 },
    async run({ page, goto, shoot }) {
      await routeJiraScreen(page);
      await page.route('**/api/projects/2/integrations', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const binding = await (await route.fetch()).json();
        await route.fulfill({
          json: {
            ...binding,
            connectionId: jiraSceneConnectionId,
            projectKey: 'CHK',
            issueType: '10004',
            fieldDefaults: JIRA_FIELD_DEFAULTS,
          },
        });
      });
      await goto('/projects/2?tab=settings');
      await page.locator('[data-shot="binding-jira-fields"] [data-field-id="customfield_10001"]').waitFor();
      await shoot(undefined, { of: '[data-shot="binding-jira-fields"]', pad: 12 });
    },
  },
  {
    name: 'binding-transition-fields',
    description:
      "Project → Settings → Issue tracker: the fix and reopen transitions checked against the project's issues, with the resolution the fix transition requires",
    // The binding is answered as bound to CHK / Bug with both transitions set;
    // the transitions of an open and a done sample issue are canned, so no Jira
    // is contacted.
    prepare: prepareJiraSceneConnection,
    route: '/projects/2?tab=settings',
    viewport: { width: 1280, height: 1800 },
    async run({ page, goto, shoot }) {
      await routeJiraScreen(page);
      await page.route('**/api/integrations/connections/*/projects/*/transitions*', (route) => {
        const done = new URL(route.request().url()).searchParams.get('from') === 'done';
        route.fulfill({ json: done ? JIRA_DONE_SAMPLE : JIRA_OPEN_SAMPLE });
      });
      await page.route('**/api/projects/2/integrations', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const binding = await (await route.fetch()).json();
        await route.fulfill({
          json: {
            ...binding,
            connectionId: jiraSceneConnectionId,
            projectKey: 'CHK',
            issueType: '10004',
            policies: {
              ...binding.policies,
              commentOnFix: true,
              transitionOnFix: true,
              fixTransitionId: 'Done',
              fixTransitionFields: { resolution: { value: { id: '1' }, label: 'Fixed' } },
              commentOnRegression: true,
              reopenTransitionId: 'To Do',
              reopenTransitionFields: {},
            },
          },
        });
      });
      await goto('/projects/2?tab=settings');
      await page.locator('[data-shot="transition-fields-open"] [data-field-id="resolution"]').waitFor();
      await page.locator('[data-shot="transition-fields-done"] [data-testid="transition-check"]').waitFor();
      await shoot(undefined, { of: '[data-shot="binding-sync-policies"]', pad: 12 });
    },
  },
  {
    name: 'locator-healing',
    description: 'Locator fix: ranked replacements and a recommended fix in the toolbox',
    tags: ['docs'],
    out: 'docs',
    // Execution 533 is a strict-mode locator-resolution failure with pre-captured
    // alternatives; its next step is "replace the locator", so the toolbox opens
    // the Locator fix section with the panel in full.
    route: '/test-run-cases/533',
    viewport: { width: 1280, height: 1300 },
    of: '[data-shot="alternative-locators"]',
    pad: 12,
  },
  {
    name: 'gather-evidence',
    description: 'Failing execution: the header, the headline and the evidence tabs on one screen (dark)',
    tags: ['docs'],
    out: 'docs',
    // Execution 37 carries an attachment, a trace and a visual diff, so the
    // evidence cards are populated rather than empty. The height takes in the
    // failing step's page views at the foot of the steps table.
    route: '/test-run-cases/37',
    viewport: { width: 1560, height: 1800 },
    colorScheme: 'dark',
  },
  {
    name: 'run-timeline',
    description: 'Per-worker run timeline: hook sections over each test, wasted waits switched on (dark)',
    tags: ['docs'],
    out: 'docs',
    route: '/test-runs/2?tab=workers',
    viewport: { width: 1600, height: 1000 },
    of: '[data-shot="run-timeline"]',
    pad: 12,
    colorScheme: 'dark',
    async run({ page, shoot, settle }) {
      await page.getByRole('switch', { name: 'Show waits' }).click();
      await settle();
      await shoot();
    },
  },
  {
    name: 'ai-diagnosis',
    description: 'Failure cluster page: the AI diagnosis card at the foot of the cluster page (dark)',
    tags: ['docs'],
    out: 'docs',
    // Cluster 10 ships a stored, "diagnosis-verified" diagnosis in the demo seed.
    route: '/failure-clusters/10',
    viewport: { width: 1600, height: 1600 },
    of: '[data-shot="cluster-diagnosis"]',
    pad: 12,
    colorScheme: 'dark',
    // The stored diagnosis renders with or without a provider, but run this
    // scene with the server's AI env vars set (PIWI_AI_PROVIDER / PIWI_AI_API_KEY
    // / PIWI_AI_MODEL) so the illustration shows the configured panel (Re-diagnose
    // and History, no "not configured" line); the model is never called because
    // cluster 10's diagnosis is already stored in the demo seed.
  },
  {
    name: 'flaky-detection',
    description: 'Flaky tests tab: composite score, failure rate, retry passes, flip counts',
    tags: ['docs'],
    out: 'docs',
    route: '/projects/1?tab=flaky-tests',
    // Wide enough that the table lays out without its horizontal scroller —
    // the Root cause and Last flake columns the caption promises are the first
    // ones a narrower viewport cuts off.
    viewport: { width: 1800, height: 1000 },
    of: '[data-shot="flaky-table"]',
    pad: 12,
    prepare: classifyFlakyTests,
  },
  {
    name: 'run-changes',
    description: 'Run Changes tab: one baseline, new failures, fixed, slower/faster and commits since',
    tags: ['docs'],
    out: 'docs',
    route: '/test-runs/2?tab=changes',
    viewport: { width: 1280, height: 1560 },
    of: '[data-shot="run-changes"]',
    pad: 12,
  },
  {
    name: 'performance-trends',
    description: 'Performance tab: duration trend chart above the slowest-tests table',
    tags: ['docs'],
    out: 'docs',
    route: '/projects/1?tab=performance',
    viewport: { width: 1400, height: 1480 },
    charts: true,
    of: ['[data-shot="performance-trend"]', '[data-shot="slowest-tests"]'],
    pad: 12,
  },
  {
    name: 'failure-clusters',
    description: 'Run page Tests tab grouped by failure cluster, failures first',
    tags: ['docs'],
    out: 'docs',
    // The run's Tests tab opens grouped by cluster on a red run; each group
    // header names the cluster and its triage status, with the failing rows
    // beneath and the passing tests folded away.
    route: '/test-runs/2',
    viewport: { width: 1280, height: 1000 },
    of: '[data-shot="failure-clusters"]',
    pad: 12,
  },
  {
    name: 'test-case-detail',
    description: 'Test history: facts line, duration trend with the execution strip, recent executions',
    tags: ['docs'],
    out: 'docs',
    route: '/test-cases/1',
    viewport: { width: 1280, height: 1600 },
    charts: true,
    of: '[data-shot="test-case-detail"]',
    pad: 8,
  },
  {
    name: 'home',
    description: 'Home overview, light/dark diagonal split (docs gallery hero)',
    tags: ['docs'],
    out: 'docs',
    route: '/',
    viewport: { width: 1280, height: 720 },
    // Captured at 2x and written at the width the featured tile actually gets,
    // so the hero is never upscaled and its text stays crisp.
    deviceScaleFactor: 2,
    outputWidth: 1152,
    split: true,
    async run({ page, shoot, settle }) {
      // The seeded data has partial runs, which the default filter hides behind
      // a full-width notice. Show them so the hero leads with the dashboard's
      // own numbers; the choice rides in a cookie, so the split's reloads keep it.
      const showThem = page.getByRole('button', { name: 'Show them' });
      if (await showThem.count()) {
        await showThem.first().click();
        await settle();
      }
      await shoot();
    },
  },
  {
    name: 'project-detail',
    description: 'Project detail: run trend bars over the filtered run history (docs gallery)',
    tags: ['docs'],
    out: 'docs',
    route: '/projects/1',
    viewport: { width: 1280, height: 720 },
    charts: true,
  },
  {
    name: 'performance',
    description: 'Performance tab: per-run duration trend over the slowest tests (docs gallery)',
    tags: ['docs'],
    out: 'docs',
    route: '/projects/1?tab=performance',
    viewport: { width: 1280, height: 720 },
    charts: true,
  },

  // ── README tour ───────────────────────────────────────────────────────────
  // The README shows these six in a two-column grid, so every one is a whole
  // screen at the same size and theme; a crop of one panel would leave the
  // grid's rows uneven. `--tag readme` recaptures the set.
  ...[
    {
      name: 'tour-run-clusters',
      description: 'Run page: the Tests tab of a red run grouped by failure cluster',
      route: '/test-runs/2',
    },
    {
      name: 'tour-ai-diagnosis',
      description: 'Failure cluster page scrolled to its stored AI diagnosis',
      // Needs a configured provider, or the card offers "Re-diagnose (configure
      // AI)": start the server with PIWI_AI_PROVIDER=anthropic and any
      // PIWI_AI_API_KEY. The stored diagnosis means no model is ever called.
      route: '/failure-clusters/10',
      scrollTo: '[data-shot="diagnosis-result"]',
      scrollOffset: 16,
    },
    {
      name: 'tour-execution',
      description: 'Failing execution: headline, most likely cause, next step and the evidence tabs',
      route: '/test-run-cases/37',
    },
    {
      name: 'tour-locator-healing',
      description: 'Broken locator: ranked replacements from the last passing run',
      route: '/test-run-cases/533',
      scrollTo: '[data-shot="alternative-locators"]',
    },
    {
      name: 'tour-analytics',
      description: 'Analytics: headline numbers and the health of every project',
      route: '/analytics',
      scrollTo: '[data-shot="analytics-headline"]',
      scrollOffset: 64,
      charts: true,
    },
    {
      name: 'tour-test-history',
      description: "Test history: one test's executions across every run",
      route: '/test-cases/1',
      charts: true,
    },
  ].map(({ scrollTo, scrollOffset = 72, ...scene }) => ({
    ...scene,
    tags: ['docs', 'readme'],
    out: 'docs',
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 2,
    outputWidth: 1280,
    colorScheme: 'light',
    ...(scrollTo && {
      async run({ page, shoot, settle }) {
        const target = page.locator(scrollTo).first();
        await target.waitFor({ timeout: 90000 });
        // The dashboard scrolls inside its content panel, not the document, so
        // scrollIntoView would shift the whole layout: scroll that panel until
        // the section sits `scrollOffset` px under its top, heading in view.
        await target.evaluate((node, offset) => {
          let panel = node.parentElement;
          while (
            panel &&
            !(panel.scrollHeight > panel.clientHeight && /auto|scroll/.test(getComputedStyle(panel).overflowY))
          )
            panel = panel.parentElement;
          panel?.scrollBy(0, node.getBoundingClientRect().top - panel.getBoundingClientRect().top - offset);
        }, scrollOffset);
        await settle();
        await shoot();
      },
    }),
  })),

  // ── Feature states (report artifacts) ─────────────────────────────────────
  {
    name: 'run-kept',
    description: 'Run page of a kept run: the Kept mark in the header and who kept it, in Details',
    // Seeded run #1 is the v2.4.0 release run, kept by its release marker.
    route: '/test-runs/1',
    viewport: { width: 1280, height: 520 },
    async run({ page, shoot, settle }) {
      await page.locator('[data-shot="run-kept"]').waitFor();
      await shoot('header', { of: '[data-shot="run-header"]', pad: 8 });
      await page.getByRole('button', { name: 'Details' }).click();
      await settle();
      await shoot('details');
    },
  },
  {
    name: 'run-keep-modal',
    description: 'Run page menu: Keep forever… asks for an optional reason',
    route: '/test-runs/2',
    viewport: { width: 1280, height: 720 },
    async run({ page, shoot, settle }) {
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Keep forever…' }).click();
      await page.getByRole('dialog', { name: 'Keep run #2 forever' }).waitFor();
      await settle();
      await shoot();
    },
  },
  {
    name: 'project-delete-progress',
    description: 'Project menu › Delete: the modal following a running deletion, phase by phase with the run count',
    route: '/projects/1',
    viewport: { width: 1280, height: 720 },
    async run({ page, shoot }) {
      await captureProjectDeleteProgress(page, () => shoot(undefined, { of: '[role="dialog"]', pad: 0 }));
    },
  },
  {
    name: 'project-delete-progress-mobile',
    description: 'The project deletion progress modal at phone width',
    route: '/projects/1',
    viewport: { width: 390, height: 844 },
    async run({ page, shoot }) {
      await captureProjectDeleteProgress(page, () => shoot());
    },
  },
  {
    name: 'runs-selection',
    description: 'Project runs table: three runs selected, with Compare waiting for two and Delete for the selection',
    route: '/projects/1',
    viewport: { width: 1280, height: 1400 },
    async run({ page, shoot }) {
      await selectNewestRuns(page, 3);
      await shoot(undefined, { of: '[data-shot="runs-table"]', pad: 8 });
    },
  },
  {
    name: 'runs-delete-progress',
    description: 'Deleting three selected runs: one done, one running, one waiting, with the count and the clock',
    route: '/projects/1',
    viewport: { width: 1280, height: 720 },
    async run({ page, shoot }) {
      await captureRunsDeleteProgress(page, () => shoot(undefined, { of: '[role="dialog"]', pad: 0 }));
    },
  },
  {
    name: 'runs-delete-progress-mobile',
    description: 'The run deletion progress modal at phone width',
    route: '/projects/1',
    viewport: { width: 390, height: 844 },
    async run({ page, shoot }) {
      await captureRunsDeleteProgress(page, () => shoot());
    },
  },
  {
    name: 'kept-runs-table',
    description: 'Project runs table: lock on kept runs, and the Kept runs only view reaching past the loaded window',
    route: '/projects/1',
    viewport: { width: 1280, height: 1400 },
    async run({ page, shoot, settle }) {
      await page.locator('[data-shot="kept-runs-toggle"]').waitFor();
      await shoot('all', { of: '[data-shot="runs-table"]', pad: 8 });
      await page.locator('[data-shot="kept-runs-toggle"]').click();
      await settle();
      await shoot('kept-only', { of: '[data-shot="runs-table"]', pad: 8 });
    },
  },
  {
    name: 'kept-runs-table-mobile',
    description: 'Project runs cards at phone width: the lock on kept runs and the Kept runs only toggle',
    route: '/projects/1',
    viewport: { width: 390, height: 1400 },
    async run({ page, shoot, settle }) {
      await page.locator('[data-shot="kept-runs-toggle"]').waitFor();
      await page.locator('[data-shot="kept-runs-toggle"]').click();
      await settle();
      await shoot(undefined, { of: '[data-shot="runs-table"]', pad: 4 });
    },
  },
  {
    name: 'kept-runs-storage',
    description: 'Settings › Storage cleanup card: how many runs are kept and what their files hold',
    route: '/settings/storage',
    viewport: { width: 1280, height: 1600 },
    async run({ page, shoot }) {
      await page.locator('[data-shot="kept-runs-note"]').waitFor();
      await shoot(undefined, { of: '[data-shot="cleanup-card"]', pad: 8 });
    },
  },

  {
    name: 'attempt-diff',
    description: 'Attempts tab: every attempt, and what differed between the failing and passing attempt',
    // Execution 21 is a flaky test that passed on retry, so the Attempts tab holds a diff.
    route: '/test-run-cases/21',
    viewport: { width: 1280, height: 1000 },
    of: '[data-shot="attempts-diff"]',
    pad: 12,
    async run({ shoot, openTab }) {
      await openTab('Attempts');
      await shoot();
    },
  },
  {
    name: 'execution-history',
    description: 'Execution page opened straight onto its History tab (duration trend + executions)',
    route: '/test-run-cases/229?tab=history',
    viewport: { width: 1280, height: 1000 },
    charts: true,
    of: '[data-shot="execution-history"]',
    pad: 12,
  },
  {
    name: 'run-trend',
    description: 'Test runs tab: per-run stacked result bars with day ticks and markers',
    route: '/projects/1',
    viewport: { width: 1400, height: 900 },
    charts: true,
    of: '[data-shot="run-trend"]',
    pad: 12,
  },
  {
    name: 'run-skip-kinds',
    description: 'Run page: the count bar draws skipped and fixme in two greys; the Tests list filters by tag',
    route: '/test-runs/2',
    viewport: { width: 1280, height: 900 },
    async run({ page, shoot, settle }) {
      await shoot('header', { of: '[data-shot="run-header"]', pad: 12 });
      await page.getByRole('button', { name: '1 fixme' }).first().click();
      await settle();
      await shoot('fixme-filter');
      await page.getByRole('button', { name: '1 fixme' }).first().click();
      await page.getByRole('combobox', { name: 'Search tests' }).fill('tag:critical');
      await page.keyboard.press('Escape');
      await settle();
      await shoot('tag-filter');
    },
  },
  {
    name: 'run-skip-kinds-dark',
    description: 'Run page header in dark mode: the fixme grey stays the lighter, more visible one',
    route: '/test-runs/2',
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
    of: '[data-shot="run-header"]',
    pad: 12,
  },
  {
    name: 'run-skip-kinds-mobile',
    description: 'Run page at phone width: the two skipped greys and the search box above the wrapped status chips',
    route: '/test-runs/2',
    viewport: { width: 390, height: 1400 },
  },
  {
    name: 'catalog-filters',
    description:
      'Project Tests catalog: the search box and status chips, and the list header grouping by file and describe block with a filter on',
    route: '/projects/1?tab=tests',
    viewport: { width: 1280, height: 1100 },
    async run({ page, shoot, settle }) {
      await shoot('flat', { of: '[data-shot="test-cases-catalog"]', pad: 12 });
      await page.getByRole('combobox', { name: 'Group tests by' }).click();
      await page.getByRole('option', { name: 'File + Describe' }).click();
      await page.getByRole('button', { name: 'Skipped', exact: true }).click();
      await settle();
      await shoot('grouped-filtered', { of: '[data-shot="test-cases-catalog"]', pad: 12 });
      // Leave the group-by cookie as the next capture expects it.
      await page.getByRole('combobox', { name: 'Group tests by' }).click();
      await page.getByRole('option', { name: 'None' }).click();
    },
  },
  {
    name: 'test-search',
    description:
      'Run Tests tab search: the qualifiers on focus, a file: value completed, the matches marked in the list, and the same box on the project catalog',
    route: '/test-runs/2',
    viewport: { width: 1280, height: 900 },
    async run({ page, shoot, settle }) {
      const search = page.getByRole('combobox', { name: 'Search tests' });
      await page.keyboard.press('Control+f');
      await search.waitFor();
      await shoot('qualifiers');
      await page.keyboard.type('file:car');
      await page.getByRole('option').first().waitFor();
      await shoot('completion');
      await page.keyboard.press('Enter');
      await page.keyboard.type('discount');
      await page.keyboard.press('Escape');
      await settle();
      await shoot('highlighted');
      await page.goto(page.url().replace(/\/test-runs\/.*$/, '/projects/1?tab=tests&q=describe%3ACart'));
      await settle();
      await shoot('catalog', { of: '[data-shot="test-cases-catalog"]', pad: 12 });
    },
  },
  {
    name: 'test-search-mobile',
    description: 'Run Tests tab at phone width: the search box completing a describe: value above the status chips',
    route: '/test-runs/2',
    viewport: { width: 390, height: 1100 },
    async run({ page, shoot }) {
      await page.getByRole('combobox', { name: 'Search tests' }).click();
      await page.keyboard.type('describe:');
      await page.getByRole('option').first().waitFor();
      await shoot();
    },
  },
  {
    name: 'runs-table-skip-kinds',
    description: 'Project runs table: each run bar splits its skipped tests into skipped and fixme',
    route: '/projects/1',
    viewport: { width: 1400, height: 1500 },
    of: '[data-shot="runs-table"]',
    pad: 12,
  },
  {
    name: 'run-live-activity',
    description: 'Run page while live: each still-running row shows the step its worker is on',
    route: '/projects',
    viewport: { width: 1280, height: 900 },
    async prepare({ request, base }) {
      // Start a streaming run; the events are pushed after the page subscribes
      // to the run stream (the in-memory bus only delivers to live subscribers).
      const started = await (
        await request.post(`${base}/api/test-runs/start`, {
          data: { projectName: 'web-dashboard', startTime: new Date().toISOString() },
        })
      ).json();
      this.runId = started.runId;
      this.streamToken = started.streamToken;
    },
    async run({ page, base, shoot, goto }) {
      await goto(`/test-runs/${this.runId}`);
      // The dev server compiles an API route on its first hit, which can take a
      // while; retry the push until it lands, then let the rows render. One
      // completed row sits above the running ones so the shot shows the live
      // step readout in contrast with a finished test.
      const events = [
        {
          type: 'begin',
          title: 'guest checkout keeps the cart',
          location: 'tests/checkout.spec.ts:5:3',
          workerIndex: 0,
          startedAt: Date.now() - 9_500,
          browser: { projectName: 'chromium' },
        },
        {
          type: 'complete',
          title: 'guest checkout keeps the cart',
          location: 'tests/checkout.spec.ts:5:3',
          status: 'passed',
          duration: 8_400,
          workerIndex: 0,
          startedAt: Date.now() - 9_500,
          browser: { projectName: 'chromium' },
        },
        {
          type: 'begin',
          title: 'purchase flow submits the order',
          location: 'tests/checkout.spec.ts:12:5',
          workerIndex: 0,
          startedAt: Date.now(),
          browser: { projectName: 'chromium' },
        },
        {
          type: 'step-begin',
          title: 'Click',
          subtitle: "getByRole('button', { name: 'Place order' })",
          location: 'tests/checkout.spec.ts:14:5',
          stepCategory: 'pw:api',
          parentTitle: 'purchase flow submits the order',
          workerIndex: 0,
          startedAt: Date.now(),
        },
        {
          type: 'begin',
          title: 'filters apply to the product grid',
          location: 'tests/catalog.spec.ts:8:3',
          workerIndex: 1,
          startedAt: Date.now(),
          browser: { projectName: 'chromium' },
        },
        {
          type: 'step-end',
          title: 'clicking "Apply filters"',
          location: 'tests/catalog.spec.ts:11:5',
          stepCategory: 'pw:api',
          status: 'passed',
          duration: 240,
          parentTitle: 'filters apply to the product grid',
          workerIndex: 1,
          startedAt: Date.now(),
        },
        {
          type: 'step-begin',
          title: 'waiting for the result count to be visible',
          location: 'tests/catalog.spec.ts:13:5',
          stepCategory: 'expect',
          parentTitle: 'filters apply to the product grid',
          workerIndex: 1,
          startedAt: Date.now(),
        },
      ];
      let pushed = false;
      for (let attempt = 0; attempt < 5 && !pushed; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          const res = await page.request.post(`${base}/api/test-runs/${this.runId}/events`, {
            data: { streamToken: this.streamToken, testCases: events },
          });
          pushed = res.ok();
        } catch {
          // Route still compiling — retry.
        }
      }
      if (!pushed) throw new Error(`could not push step events to run ${this.runId}`);
      // The card and grid layouts both carry the testid; wait for the visible
      // one (the grid row at this width, not the `md:hidden` card copy).
      await page.locator('[data-testid="live-step"]:visible').first().waitFor({ timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await shoot();
    },
  },

  {
    name: 'step-params',
    description: "Whole-test steps table: a step's muted subtitle and its open Parameters disclosure",
    route: '/projects',
    viewport: { width: 1280, height: 2400 },
    of: 'table',
    pad: 12,
    async run({ page, base, goto, shoot }) {
      // Find a failing execution whose steps carry the 1.63 params shape, then
      // open its Timeline tab, expand every step, and open a Parameters disclosure.
      const projects = await (await page.request.get(`${base}/api/projects`)).json();
      const projectList = Array.isArray(projects) ? projects : (projects.items ?? projects.projects ?? []);
      let execId = null;
      outer: for (const project of projectList) {
        const detail = await (await page.request.get(`${base}/api/projects/${project.id}`)).json();
        for (const run of detail.testRuns ?? []) {
          const runDetail = await (await page.request.get(`${base}/api/test-runs/${run.id}`)).json();
          for (const c of runDetail.testCases ?? []) {
            if (c.status !== 'failed' || !c.executionId) continue;
            const exec = await (await page.request.get(`${base}/api/test-run-cases/${c.executionId}`)).json();
            if ((exec.steps ?? []).some((s) => s && s.params && Object.keys(s.params).length > 0)) {
              execId = c.executionId;
              break outer;
            }
          }
        }
      }
      if (!execId) throw new Error('no execution with 1.63 step params found for the step-params scene');
      await goto(`/test-run-cases/${execId}`);
      await page.getByRole('tab', { name: /^Timeline/ }).click();
      const whole = page.getByRole('button', { name: 'Whole test' });
      if (await whole.count()) await whole.click();
      const disclosure = page.locator('table [data-testid="step-params"]:visible').first();
      await disclosure.getByText(/Parameters/).click();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      await shoot();
    },
  },

  {
    name: 'page-diff',
    description: 'Screen tab: the Page diff view, the structural diff of the failing page',
    // Execution 37 (checkout) has a green ARIA sample and a failing one that
    // renames the "Pay" button and disables it — a legible one-line diff.
    route: '/test-run-cases/37',
    viewport: { width: 1280, height: 1200 },
    of: '[data-shot="screen-evidence"]',
    pad: 12,
    async run({ page, shoot, settle }) {
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Screen', exact: true })
        .click();
      const toggle = page.getByRole('tablist', { name: 'Screen view' }).getByRole('tab', { name: 'Page diff' });
      await toggle.waitFor({ state: 'visible', timeout: 30_000 });
      await toggle.click();
      await settle();
      await shoot();
    },
  },
  ...[
    { view: 'Screenshot', suffix: '' },
    { view: 'DOM', suffix: '-dom' },
    { view: 'Accessibility tree', suffix: '-aria' },
  ].map(({ view, suffix }) => ({
    name: `failing-step-evidence${suffix}`,
    description: `Timeline tab: the page at the failing step on its ${view} view, in the step's block`,
    viewport: { width: 1280, height: 1600 },
    of: 'table',
    pad: 12,
    async prepare({ request, base }) {
      this.executionId = await ingestTraceSnapshotCase(request, base);
    },
    async run({ page, goto, settle, shoot }) {
      await goto(`/test-run-cases/${this.executionId}`);
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Timeline', exact: true })
        .click();
      const tab = page
        .locator('table')
        .getByRole('tablist', { name: 'Page at the failing step' })
        .getByRole('tab', { name: view, exact: true });
      await tab.waitFor({ state: 'visible', timeout: 30_000 });
      await tab.click();
      if (view === 'DOM') await page.locator('table iframe[title="DOM at the failure"]').waitFor({ timeout: 15000 });
      await settle();
      await shoot();
    },
  })),
  {
    name: 'failing-step-picker',
    description: "Timeline tab: Open in picker on the failing step's page, the picker over the DOM of that moment",
    viewport: { width: 1280, height: 1000 },
    async prepare({ request, base }) {
      this.executionId = await ingestTraceSnapshotCase(request, base);
    },
    async run({ page, goto, settle, shoot }) {
      await goto(`/test-run-cases/${this.executionId}`);
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Timeline', exact: true })
        .click();
      await page.locator('table').getByRole('button', { name: 'Open in picker' }).click();
      await page.getByRole('dialog').locator('iframe[title="DOM snapshot"]').waitFor({ timeout: 15000 });
      await page.getByText('Initializing picker').waitFor({ state: 'detached', timeout: 15000 });
      await settle();
      await shoot();
    },
  },
  {
    name: 'failing-step-evidence-mobile',
    description: "Failing step's page at phone width, on its Screenshot view",
    viewport: { width: 390, height: 1800 },
    of: '[data-shot="failing-step-evidence"]',
    pad: 12,
    async prepare({ request, base }) {
      this.executionId = await ingestTraceSnapshotCase(request, base);
    },
    async run({ page, goto, settle, shoot }) {
      await goto(`/test-run-cases/${this.executionId}`);
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Timeline', exact: true })
        .click();
      await page.locator('[data-shot="failing-step-evidence"]').waitFor({ state: 'visible', timeout: 30_000 });
      await settle();
      await shoot();
    },
  },
  {
    name: 'failing-step-evidence-fallback',
    description:
      "Failing step evidence on a pre-1.63 trace: the run's failure screenshot bound to the failing step, with the failure-time DOM and tree as views",
    route: '/projects',
    viewport: { width: 1280, height: 2000 },
    of: 'table',
    pad: 12,
    async run({ page, base, goto, settle, shoot }) {
      // Find a failed execution whose steps carry a failing step and whose case
      // has an image attachment — the seeded demo traces predate 1.63, so the
      // failing step falls back to the run's failure screenshot.
      const projects = await (await page.request.get(`${base}/api/projects`)).json();
      const projectList = Array.isArray(projects) ? projects : (projects.items ?? projects.projects ?? []);
      let execId = null;
      outer: for (const project of projectList) {
        const detail = await (await page.request.get(`${base}/api/projects/${project.id}`)).json();
        for (const run of detail.testRuns ?? []) {
          const runDetail = await (await page.request.get(`${base}/api/test-runs/${run.id}`)).json();
          for (const c of runDetail.testCases ?? []) {
            if (c.status !== 'failed' || !c.executionId) continue;
            const exec = await (await page.request.get(`${base}/api/test-run-cases/${c.executionId}`)).json();
            const hasFailedStep = (exec.steps ?? []).some((s) => s && s.failed);
            const hasImage = (exec.attachments ?? []).some(
              (a) => (a.contentType ?? '').startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(a.path ?? ''),
            );
            if (hasFailedStep && hasImage) {
              execId = c.executionId;
              break outer;
            }
          }
        }
      }
      if (!execId)
        throw new Error('no failed execution with a failing step and an image attachment for the fallback scene');
      await goto(`/test-run-cases/${execId}`);
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Timeline', exact: true })
        .click();
      await page
        .locator('table')
        .getByText('Page at the failing step')
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
      await settle();
      await shoot();
    },
  },
  ...['', '-mobile'].map((suffix) => ({
    name: `hook-failure-timeline${suffix}`,
    description: suffix
      ? 'The hook-failure timeline at phone width: the Setup section as stacked cards'
      : 'Timeline tab of a test whose beforeEach failed: the Setup section open on the failing click, Teardown folded',
    route: '/projects',
    viewport: suffix ? { width: 375, height: 2400 } : { width: 1280, height: 1800 },
    of: '[data-shot="evidence-card"]',
    pad: suffix ? 8 : 12,
    async prepare({ request, base }) {
      this.executionId = await reportHookFailure(request, base);
    },
    async run({ page, goto, settle, shoot }) {
      await goto(`/test-run-cases/${this.executionId}`);
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Timeline', exact: true })
        .click();
      await page
        .locator('[data-shot="evidence-card"] button[aria-expanded="true"]:visible', { hasText: 'Setup' })
        .first()
        .waitFor({ timeout: 30_000 });
      await settle();
      await shoot();
    },
  })),
  ...['', '-mobile'].map((suffix) => ({
    name: `caught-error-timeline${suffix}`,
    description: suffix
      ? 'The timeline at phone width: a probe the test caught greyed out, the failing assertion in red'
      : 'Timeline tab of a test that caught a probe then failed: the probe greyed out as caught, the failing assertion red',
    route: '/projects',
    viewport: suffix ? { width: 375, height: 2400 } : { width: 1280, height: 1400 },
    of: '[data-shot="evidence-card"]',
    pad: suffix ? 8 : 12,
    async prepare({ request, base }) {
      this.executionId = await reportCaughtError(request, base);
    },
    async run({ page, goto, settle, shoot }) {
      await goto(`/test-run-cases/${this.executionId}`);
      await page
        .getByRole('tablist', { name: 'Evidence sections' })
        .getByRole('tab', { name: 'Timeline', exact: true })
        .click();
      await page
        .locator('[data-shot="evidence-card"]')
        .getByText('Error caught, the test continued')
        .filter({ visible: true })
        .first()
        .waitFor({ timeout: 30_000 });
      await settle();
      await shoot();
    },
  })),
  ...['', '-mobile'].map((suffix) => ({
    name: `what-changed-no-repository${suffix}`,
    description: suffix
      ? 'The cluster situation block at phone width, for runs without a repository URL'
      : 'Cluster situation block for runs that record commits but no repository URL: the range, why, the docs, the git log',
    route: '/projects',
    viewport: suffix ? { width: 375, height: 1200 } : { width: 1280, height: 900 },
    of: '[data-shot="situation-block"]',
    pad: suffix ? 8 : 12,
    async prepare({ request, base }) {
      this.clusterId = await reportNoRepositoryCluster(request, base);
    },
    async run({ page, goto, settle, shoot }) {
      await goto(`/failure-clusters/${this.clusterId}`);
      await page
        .locator('[data-shot="what-changed"]', { hasText: 'since the last passing run' })
        .waitFor({ timeout: 60_000 });
      await settle();
      await shoot();
    },
  })),
  {
    name: 'timeline-type-filter',
    description: 'Timeline tab: the type chips with Network hidden, and the line naming the failed request it hides',
    // Execution 241 (the login API test) interleaves four requests with its
    // steps, the login a 500 — hiding Network names that failed request.
    route: '/test-run-cases/241',
    viewport: { width: 1280, height: 1200 },
    of: '[data-shot="evidence-card"]',
    pad: 12,
    async run({ page, openTab, settle, shoot }) {
      await openTab('Timeline');
      await page
        .getByRole('group', { name: 'Show on the timeline' })
        .getByRole('button', { name: /^Network/ })
        .click();
      await page.getByTestId('timeline-hidden-summary').waitFor({ state: 'visible', timeout: 10_000 });
      await settle();
      await shoot();
    },
  },
  ...[
    { suffix: '', viewport: { width: 1280, height: 1400 } },
    { suffix: '-dark', viewport: { width: 1280, height: 1400 }, colorScheme: 'dark' },
    { suffix: '-mobile', viewport: { width: 375, height: 2000 } },
  ].map(({ suffix, viewport, colorScheme }) => ({
    name: `evidence-source${suffix}`,
    description: `Source tab: the failing helper line and its caller, syntax-highlighted${suffix ? ` (${suffix.slice(1)})` : ''}`,
    // Execution 1 fails inside a helper whose snippet opens mid-JSDoc, so the
    // capture also shows the comment tail read as a comment.
    route: '/test-run-cases/1',
    viewport,
    colorScheme,
    of: '[data-shot="evidence-card"]',
    pad: suffix === '-mobile' ? 8 : 12,
    async run({ openTab, settle, shoot }) {
      await openTab(/^Source/);
      await settle();
      await shoot();
    },
  })),
  {
    name: 'timeline-type-filter-mobile',
    description: 'Timeline tab at phone width: the type chips wrap, Network hidden, the hidden line under them',
    route: '/test-run-cases/241',
    viewport: { width: 375, height: 1800 },
    of: '[data-shot="evidence-card"]',
    pad: 12,
    async run({ page, openTab, settle, shoot }) {
      await openTab('Timeline');
      await page
        .getByRole('group', { name: 'Show on the timeline' })
        .getByRole('button', { name: /^Network/ })
        .click();
      await page.getByTestId('timeline-hidden-summary').waitFor({ state: 'visible', timeout: 10_000 });
      await settle();
      await shoot();
    },
  },
  {
    name: 'setup-companion-tools',
    description: 'Setup page: the companion-tools card below the capability ladder',
    route: '/setup',
    viewport: { width: 1280, height: 2600 },
    of: '[data-shot="companion-tools"]',
    pad: 12,
  },
  {
    name: 'wizard-fast-path',
    description: 'Get-started wizard: the one-command init fast path above the manual steps',
    route: '/setup',
    viewport: { width: 1280, height: 2600 },
    of: '[data-shot="wizard-fast-path"]',
    pad: 12,
  },
  {
    name: 'mcp-agent-skills',
    description: 'MCP page: the agent-skills section with the install command',
    route: '/mcp',
    viewport: { width: 1280, height: 2400 },
    of: '[data-shot="mcp-agent-skills"]',
    pad: 12,
  },
  {
    name: 'mcp-desktop-tools',
    description: 'MCP page (desktop app): the local-only tools a hosted instance cannot offer',
    tags: ['desktop'],
    mode: 'desktop',
    route: '/mcp',
    viewport: { width: 1000, height: 1000 },
    of: '[data-shot="mcp-desktop-tools"]',
    pad: 12,
  },
  {
    name: 'mcp-tool-modules',
    description: 'MCP page: the tool catalog grouped by module with the Core tools only switch',
    route: '/mcp',
    viewport: { width: 1280, height: 5300 },
    of: '[data-shot="mcp-tool-modules"]',
    pad: 12,
  },

  // ── Flake suspects and the lab ───────────────────────────────────────────
  // Test case 9 is the checkout project's flaky test, whose seeded failures
  // wait on a slow `GET /api/cart`; a seeded Flake Lab experiment reproduced it
  // with a delay on that route.
  {
    name: 'flakiness-tab',
    description:
      'A flaky test’s Flakiness tab: suspects with their counts, conditions and lab results, context and experiments',
    tags: ['desktop'],
    route: '/test-cases/9?tab=flakiness',
    viewport: { width: 1280, height: 1400 },
    of: '[data-shot="flakiness-tab"]',
    pad: 12,
  },
  {
    name: 'flakiness-tab-dark',
    description: 'A flaky test’s Flakiness tab (dark)',
    tags: ['desktop'],
    route: '/test-cases/9?tab=flakiness',
    viewport: { width: 1280, height: 1400 },
    of: '[data-shot="flakiness-tab"]',
    pad: 12,
    colorScheme: 'dark',
  },
  {
    name: 'flakiness-tab-mobile',
    description: 'A flaky test’s Flakiness tab at phone width',
    tags: ['desktop'],
    route: '/test-cases/9?tab=flakiness',
    viewport: { width: 390, height: 2200 },
  },
  // Project 3's pagination test ran the whole lab: a reproduction, a verify
  // that still failed and one that held; its two modal tests are untested.
  {
    name: 'flake-lab-tab',
    description: 'A project’s Flake Lab tab: each flaky test’s lab state and next command, and the newest experiments',
    tags: ['desktop'],
    route: '/projects/3?tab=flake-lab',
    viewport: { width: 1280, height: 1400 },
    of: '[data-shot="flake-lab"]',
    pad: 12,
  },
  {
    name: 'flake-lab-tab-mobile',
    description: 'A project’s Flake Lab tab at phone width',
    tags: ['desktop'],
    route: '/projects/3?tab=flake-lab',
    viewport: { width: 390, height: 2400 },
  },
  {
    name: 'flaky-list-suspects',
    description: 'The flaky list with each test’s top suspect and the reproduced badge',
    tags: ['desktop'],
    route: '/projects/1?tab=flaky-tests',
    viewport: { width: 1400, height: 1000 },
    of: '[data-shot="flaky-table"]',
    pad: 12,
  },
  {
    name: 'flaky-list-suspects-dark',
    description: 'The flaky list with each test’s top suspect and the reproduced badge (dark)',
    tags: ['desktop'],
    route: '/projects/1?tab=flaky-tests',
    viewport: { width: 1400, height: 1000 },
    of: '[data-shot="flaky-table"]',
    pad: 12,
    colorScheme: 'dark',
  },

  // ── Bug reports ──────────────────────────────────────────────────────────
  {
    name: 'bug-report-page',
    description: 'A bug report sent from Piwi Picker: what was expected, where it stands, and its steps',
    tags: ['desktop'],
    route: '/bug-reports/1',
    viewport: { width: 1280, height: 900 },
  },
  {
    name: 'bug-report-spec',
    description: 'A bug report’s Spec tab: the failing test to commit, rendered with the project’s settings',
    tags: ['desktop'],
    route: '/bug-reports/1?tab=spec',
    viewport: { width: 1280, height: 1100 },
    of: '[data-shot="bug-report-spec"]',
    pad: 12,
  },
  {
    name: 'bug-report-mobile',
    description: 'The same bug report at phone width',
    tags: ['desktop'],
    route: '/bug-reports/1',
    viewport: { width: 375, height: 1100 },
  },
  {
    name: 'bug-report-step-shots',
    description: 'A bug report’s evidence: the page as each step began, the step’s element outlined',
    tags: ['desktop'],
    viewport: { width: 1280, height: 1000 },
    async prepare({ base, request }) {
      // A report sent as Piwi Picker sends one, with a screenshot of each step: committed docs images stand in.
      const target = (role, name, testId = null) => ({
        tagName: role === 'textbox' ? 'input' : 'button',
        role,
        accessibleName: name,
        testId,
        text: null,
        alternatives: [
          testId
            ? { locator: `getByTestId('${testId}')`, method: 'getByTestId', score: 100 }
            : { locator: `getByRole('${role}', { name: '${name}' })`, method: 'getByRole', score: 90 },
        ],
      });
      const at = (step) => ({ redacted: false, pageUrl: '/cart', timestamp: step });
      const steps = [
        { action: 'goto', target: null, value: '/cart', ...at(0) },
        { action: 'fill', target: target('textbox', 'Search'), value: 'checkout', ...at(1) },
        { action: 'click', target: target('button', 'Failure clusters'), value: null, ...at(2) },
        { action: 'click', target: target('button', 'Locators'), value: null, ...at(3) },
      ];
      const images = [
        { step: 1, png: 'flaky-tests.png', box: { x: 300, y: 64, width: 380, height: 36 } },
        { step: 2, png: 'failure-clusters-tab.png', box: { x: 476, y: 150, width: 132, height: 36 } },
        { step: 3, png: 'execution-locators.png', box: { x: 300, y: 112, width: 120, height: 32 } },
      ];
      const form = new FormData();
      const stepShots = [];
      for (const image of images) {
        const source = join(__dirname, '..', '..', 'docs', 'public', 'screenshots', image.png);
        const { data, info } = await sharp(readFileSync(source))
          .jpeg({ quality: 60 })
          .toBuffer({ resolveWithObject: true });
        const file = `steps/${String(image.step + 1).padStart(3, '0')}.jpg`;
        stepShots.push({
          step: image.step,
          file,
          box: image.box,
          viewport: { width: info.width, height: info.height },
          takenAt: image.step,
        });
        form.append('stepShot', new Blob([data], { type: 'image/jpeg' }), file.replace(/^steps\//, ''));
      }
      const report = {
        v: 1,
        steps: {
          v: 1,
          title: 'Search results lose their filter',
          origin: 'https://shop.example',
          recordedAt: 0,
          note: null,
          steps,
        },
        evidence: {
          console: [],
          consoleDropped: 0,
          requests: [],
          requestsDropped: 0,
          screenshots: [],
          screenshotNote: 'none was taken',
          outline: null,
          stepShots,
        },
        context: { origin: 'https://shop.example', pageKey: '/cart', path: '/cart', time: Date.now() },
      };
      form.append('report', JSON.stringify(report));
      const sent = await request.post(`${base}/api/projects/1/bug-reports`, { multipart: form });
      this.reportId = (await sent.json()).id;
    },
    async run({ page, goto, shoot }) {
      await goto(`/bug-reports/${this.reportId}?tab=evidence`);
      await shoot(undefined, { of: '[data-shot="bug-report-step-shots"]', pad: 12 });
      await page.setViewportSize({ width: 390, height: 1600 });
      await shoot('mobile', { of: '[data-shot="bug-report-step-shots"]', pad: 12 });
    },
  },
  {
    name: 'bug-report-list',
    description: 'A project’s bug reports',
    tags: ['desktop'],
    route: '/projects/1/bug-reports',
    viewport: { width: 1280, height: 700 },
    of: '[data-shot="bug-report-list"]',
    pad: 12,
  },

  // ── Failure headline (report artifacts) ──────────────────────────────────
  {
    name: 'failure-headline',
    description: 'Failing execution: the situation block — headline, most likely, situation and next step',
    tags: ['desktop'],
    // Execution 37 is clustered with a sibling in its run, so the situation
    // sentence carries the cluster link next to the regression badge.
    route: '/test-run-cases/37',
    viewport: { width: 1280, height: 900 },
    of: '[data-shot="situation-block"]',
    pad: 12,
  },
  {
    name: 'failure-headline-mobile',
    description: 'The same situation block at phone width',
    tags: ['desktop'],
    route: '/test-run-cases/37',
    viewport: { width: 375, height: 812 },
    of: '[data-shot="situation-block"]',
    pad: 8,
  },

  // ── Failure page clarity (report artifacts) ───────────────────────────────
  // The first screen of each detail page in its default state, at wide and phone
  // width, the visual side of the `app:measure` legibility numbers.
  // Full-viewport, nothing expanded.
  {
    name: 'execution-clarity',
    description: 'Execution page first screen, default state (1280×800 clarity baseline)',
    route: '/test-run-cases/37',
    viewport: { width: 1280, height: 800 },
  },
  {
    name: 'execution-clarity-mobile',
    description: 'The same execution page first screen at phone width',
    route: '/test-run-cases/37',
    viewport: { width: 390, height: 800 },
  },
  {
    name: 'cluster-clarity',
    description: 'Failure cluster page first screen, default state (1280×800 clarity baseline)',
    route: '/failure-clusters/10',
    viewport: { width: 1280, height: 800 },
  },
  {
    name: 'cluster-clarity-mobile',
    description: 'The same cluster page first screen at phone width',
    route: '/failure-clusters/10',
    viewport: { width: 390, height: 800 },
  },

  // ── Desktop shell (report artifacts) ──────────────────────────────────────
  {
    name: 'desktop-repro-request',
    description: 'A repro request from Piwi Picker, waiting in the desktop window for the developer (desktop shell)',
    tags: ['desktop'],
    mode: 'desktop',
    route: '/setup',
    viewport: { width: 1280, height: 1000 },
    link: { path: '/home/dev/shop', exists: true },
    async run({ page, shoot, settle }) {
      // The desktop event stream delivers the request; outside the shell the
      // repro endpoints do not exist, so the stream is answered here.
      const request = {
        id: 'a1b2c3d4e5f60718',
        title: 'Coupon not applied to the total',
        steps: REPRO_SCENE_STEPS,
        options: { headed: true, trace: true, project: null, repeatEach: 1 },
        bugReportId: 37,
        instanceUrl: 'https://piwi.acme.test',
        status: 'waiting',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        projectId: null,
        verdict: null,
        runId: null,
      };
      await page.route('**/api/desktop/events', (route) =>
        route.fulfill({
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify({ type: 'repro-request', request })}\n\n`,
        }),
      );
      await page.reload();
      await page.getByRole('dialog', { name: 'Run a bug report with Playwright' }).waitFor();
      await page.getByText('/home/dev/shop').first().waitFor();
      await settle();
      await shoot();
    },
  },
  {
    name: 'desktop-nav',
    description: 'Back/forward pair in the sidebar header (desktop shell)',
    tags: ['desktop'],
    mode: 'desktop',
    route: '/projects',
    outputs: ['desktop-nav.png', 'desktop-nav-collapsed.png'],
    async run({ page, shoot, settle }) {
      // Navigate away and back — client-side, a reload would reset the router's
      // history markers — so both directions are enabled in the shot.
      await page.getByRole('link', { name: 'Analytics' }).click();
      await page.waitForURL('**/analytics');
      await settle();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.waitForURL('**/projects');
      await settle();
      await shoot();
      await page.getByRole('button', { name: /collapse sidebar/i }).click();
      await settle();
      await shoot('collapsed', { clip: { x: 0, y: 0, width: 320, height: 560 } });
    },
  },
  {
    name: 'ai-claude-cli',
    description: 'Settings → AI: use the local Claude Code CLI as the provider — no API key (desktop shell)',
    tags: ['desktop'],
    mode: 'desktop',
    route: '/settings/ai',
    viewport: { width: 1000, height: 1100 },
    of: '[data-shot="ai-model-providers"]',
    pad: 12,
    outputs: ['ai-claude-cli.png', 'ai-claude-cli-selected.png'],
    async run({ page, shoot, settle }) {
      // The status card sits at the top of the providers section and probes the
      // real `claude` on this machine (installed + signed-in; no tokens spent).
      // Wait for that probe to resolve before capturing.
      await page.getByText('billed to your Claude Code sign-in').first().waitFor();
      await page.getByText('Checking for the Claude CLI…').waitFor({ state: 'hidden' });
      await settle();
      await shoot();

      // Select the CLI as the diagnosis provider to reveal the no-API-key role
      // form (the provider select carries whatever config is stored).
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: 'Claude Code (local)' }).click();
      await page.getByText('it uses your Claude Code sign-in').first().waitFor();
      await settle();
      await shoot('selected');
    },
  },
  {
    name: 'project-from-folder',
    description: 'New-project modal: start from a local folder (desktop shell)',
    tags: ['desktop'],
    mode: 'desktop',
    link: null,
    inspection: { ...READY_INSPECTION, reporterConfigured: false, configuredProjectName: null },
    route: '/projects',
    outputs: ['project-from-folder-empty.png', 'project-from-folder-picked.png'],
    async run({ page, shoot, settle }) {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByRole('heading', { name: 'Create new project' }).waitFor();
      await settle();
      await shoot('empty');
      await page.getByRole('button', { name: 'Choose folder…' }).click();
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await settle();
      await shoot('picked');
    },
  },
  {
    name: 'project-from-folder-mobile',
    description: 'The same modal at phone width',
    tags: ['desktop'],
    mode: 'desktop',
    link: null,
    inspection: { ...READY_INSPECTION, reporterConfigured: false, configuredProjectName: null },
    viewport: { width: 375, height: 812 },
    route: '/projects',
    async run({ page, shoot, settle }) {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByRole('heading', { name: 'Create new project' }).waitFor();
      await page.getByRole('button', { name: 'Choose folder…' }).click();
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await settle();
      await shoot();
    },
  },
  {
    name: 'edit-local-folder',
    description: 'Project settings: linked folder with setup checks (desktop shell)',
    tags: ['desktop'],
    mode: 'desktop',
    link: { path: READY_INSPECTION.path, exists: true },
    route: '/projects/2/edit',
    of: '#local-folder',
    pad: 8,
    outputs: ['edit-local-folder-ready.png'],
    async run({ page, shoot }) {
      await page.getByRole('button', { name: 'Unlink' }).waitFor();
      await shoot('ready');
    },
  },
  {
    name: 'edit-local-folder-needs-setup',
    description: 'The same card when the folder is missing Piwi wiring',
    tags: ['desktop'],
    mode: 'desktop',
    link: { path: READY_INSPECTION.path, exists: true },
    inspection: {
      ...READY_INSPECTION,
      reporterInstalled: false,
      reporterConfigured: false,
      configuredProjectName: null,
    },
    route: '/projects/2/edit',
    of: '#local-folder',
    pad: 8,
    async run({ page, shoot }) {
      await page.getByRole('button', { name: 'Unlink' }).waitFor();
      await shoot();
    },
  },
  {
    name: 'project-folder-card',
    description: 'Project page: compact linked-folder status card (desktop shell)',
    tags: ['desktop'],
    mode: 'desktop',
    link: { path: READY_INSPECTION.path, exists: true },
    route: '/projects/2',
    async run({ page, shoot, settle }) {
      await page.getByText(READY_INSPECTION.path).first().waitFor();
      await settle();
      await shoot();
    },
  },
  {
    name: 'import-previous-runs',
    description: 'After linking a folder, offer to import the runs already in it (desktop shell)',
    tags: ['desktop'],
    mode: 'desktop',
    link: null,
    importableRuns: [
      {
        path: `${READY_INSPECTION.path}/blob-report/report-1.zip`,
        name: 'report-1.zip',
        size: 2_412_000,
        kind: 'blob',
      },
      {
        path: `${READY_INSPECTION.path}/blob-report/report-2.zip`,
        name: 'report-2.zip',
        size: 1_968_000,
        kind: 'blob',
      },
      {
        path: `${READY_INSPECTION.path}/test-results/checkout-chromium/trace.zip`,
        name: 'trace.zip',
        size: 826_000,
        kind: 'trace',
      },
    ],
    route: '/projects/2?tab=settings',
    async run({ page, shoot, settle }) {
      await page.getByRole('button', { name: 'Choose folder…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('heading', { name: 'Import previous runs' }).waitFor();
      await settle();
      await shoot();
    },
  },
  {
    name: 'import-runs-desktop',
    description: 'Import page: the browse button opens at the linked project folder (desktop shell)',
    tags: ['desktop'],
    mode: 'desktop',
    link: { path: READY_INSPECTION.path, exists: true },
    route: '/projects/2/import',
    async run({ page, shoot, settle }) {
      await page.getByText(`Opens in ${READY_INSPECTION.path}`).waitFor();
      await settle();
      await shoot();
    },
  },
  {
    name: 'notifications-settings',
    description: 'Notifications settings (auth off): SMTP status, channels, subscriptions; plus the project bell',
    route: '/settings/notifications',
    viewport: { width: 1280, height: 1250 },
    outputs: ['notifications-settings.png', 'notifications-settings-bell.png'],
    async prepare({ base, request }) {
      // One channel + subscription so neither section captures empty. Reruns
      // reuse the rows from the previous run instead of duplicating them.
      const list = await (await request.get(`${base}/api/channels`)).json();
      if (!list.items.some((c) => c.name === 'Team Slack')) {
        const ch = await (
          await request.post(`${base}/api/channels`, {
            data: {
              name: 'Team Slack',
              type: 'slack',
              config: { webhookUrl: 'https://hooks.slack.com/services/T/B/x' },
            },
          })
        ).json();
        await request.post(`${base}/api/subscriptions`, {
          data: { channelId: ch.channel.id, projectId: 1, events: ['run.failed', 'cluster.new'] },
        });
      }
    },
    async run({ page, shoot, goto, settle }) {
      await shoot();
      await goto('/projects/1');
      await page.getByTitle('Notification subscriptions for this project').click();
      await page.getByText('Browser notifications').waitFor();
      await settle();
      await shoot('bell');
    },
  },
  {
    name: 'channel-form',
    description: 'Notifications → Add channel: the Slack app steps with a checked URL, then that URL under Teams',
    route: '/settings/notifications',
    viewport: { width: 1280, height: 1100 },
    outputs: ['channel-form-slack.png', 'channel-form-teams.png'],
    async run({ page, shoot, settle }) {
      await page.getByRole('button', { name: 'Add channel' }).click();
      const form = page.locator('[data-shot="channel-form"]');
      await form.waitFor();
      const pick = async (label) => {
        await form.getByRole('combobox').first().click();
        await page.getByRole('option', { name: label, exact: true }).click();
      };
      await pick('Slack webhook');
      await page.getByTestId('slack-webhook-url').fill('https://hooks.slack.com/services/T000/B000/XXXX');
      await settle();
      await shoot('slack', { of: '[data-shot="channel-form"]', pad: 12 });
      // The URL stays when the type changes, so Teams offers to switch back.
      await pick('Microsoft Teams webhook');
      await page.getByTestId('channel-url-check').waitFor();
      await settle();
      await shoot('teams', { of: '[data-shot="channel-form"]', pad: 12 });
    },
  },
  // ── Capabilities opt-out ─────────────────────────────────────────────────
  {
    name: 'setup-ladder-declined',
    description: 'Setup ladder grouped by state, with a declined capability folded under Declined',
    // Decline one instance capability so the folded Declined group appears.
    async prepare({ base, request }) {
      await request.patch(`${base}/api/capabilities`, { data: { decisions: { notifications: 'declined' } } });
    },
    route: '/setup',
    viewport: { width: 1280, height: 1600 },
    async run({ page, shoot, settle }) {
      // Open the folded Declined group so the reconsider control shows.
      await page
        .getByRole('button', { name: /^Declined \(/ })
        .first()
        .click()
        .catch(() => {});
      await settle();
      await shoot('wide', { of: '[data-shot="setup-ladder"]', pad: 12 });
      await page.setViewportSize({ width: 400, height: 1800 });
      await settle();
      await shoot('narrow', { of: '[data-shot="setup-ladder"]', pad: 8 });
    },
  },
  ...[
    { name: 'extension-connect', width: 1280 },
    { name: 'extension-connect-mobile', width: 375 },
  ].map(({ name, width }) => ({
    name,
    description: `The page Piwi Picker opens to be allowed, with the connecting browser and its code, at ${width} px`,
    async prepare({ base, request }) {
      const res = await request.post(`${base}/api/extension/connect`, { data: { browser: 'Chrome', os: 'Windows' } });
      this.userCode = (await res.json()).userCode;
    },
    route: '/',
    viewport: { width, height: 900 },
    of: '[data-shot="extension-connect"]',
    async run({ shoot, settle, goto }) {
      await goto(`/extension/connect?code=${this.userCode}`);
      await settle();
      await shoot();
    },
  })),
  {
    name: 'evidence-fixtures-footer',
    description: 'Execution page evidence card for a project with no captured fixtures: the footer names them',
    // Seed a fixtures-free failing run so the footer (undecided) shows.
    async prepare({ base, request }) {
      await request.post(`${base}/api/test-runs/submit`, {
        data: {
          projectName: 'capability-demo-fixtures-free',
          status: 'failed',
          startTime: new Date().toISOString(),
          duration: 2000,
          totalTests: 1,
          passedTests: 0,
          failedTests: 1,
          skippedTests: 0,
          testCases: [
            {
              title: 'cart totals the line items',
              status: 'failed',
              duration: 800,
              location: 'tests/cart.spec.ts:8:3',
              error:
                'Error: expect(received).toBe(expected)\n\nExpected: 3\nReceived: 2\n    at tests/cart.spec.ts:8:20',
            },
          ],
        },
      });
      const { items } = await (await request.get(`${base}/api/projects`)).json();
      const project = items.find((p) => p.name === 'capability-demo-fixtures-free');
      const detail = await (await request.get(`${base}/api/projects/${project.id}`)).json();
      const run = await (await request.get(`${base}/api/test-runs/${detail.testRuns[0].id}`)).json();
      footerExecId = run.testCases.find((c) => c.status === 'failed').executionId;
    },
    route: '/',
    viewport: { width: 1280, height: 1400 },
    async run({ page, shoot, settle, goto }) {
      await goto(`/test-run-cases/${footerExecId}`);
      await settle();
      await shoot('wide', { of: '[data-shot="evidence-card"]', pad: 12 });
      await page.setViewportSize({ width: 400, height: 1600 });
      await settle();
      await shoot('narrow', { of: '[data-shot="evidence-card"]', pad: 8 });
    },
  },
];

/** Output basename for a scene, before any `shoot()` label. */
function sceneFile(scene) {
  return scene.file ?? `${scene.name}.png`;
}

/** Every file a scene writes — what `--check` matches the docs directory against. */
function sceneOutputs(scene) {
  if (scene.outputs) return scene.outputs;
  const base = sceneFile(scene).replace(/\.png$/, '');
  return scene.annotate ? [`${base}.png`, `${base}-annotated.png`] : [`${base}.png`];
}

function outDirFor(scene, override) {
  if (override) return override;
  return OUT_TARGETS[scene.out ?? 'screens'];
}

/** Mocked Tauri IPC bridge, shaped per scene. Mirrors the real shell's commands. */
function bridgeScript(scene) {
  const inspection = scene.inspection ?? READY_INSPECTION;
  const link = scene.link ?? null;
  const importableRuns = scene.importableRuns ?? [];
  const pickedFiles = scene.pickedFiles ?? [];
  return `
    window.__mockLink = ${JSON.stringify(link)};
    window.__TAURI__ = {
      core: {
        invoke: (cmd, args) => {
          switch (cmd) {
            case 'desktop_pick_folder':
              return Promise.resolve(${JSON.stringify(inspection.path)});
            case 'desktop_inspect_folder':
              return Promise.resolve({ ...${JSON.stringify(inspection)}, path: args.path });
            case 'desktop_find_importable_runs':
              return Promise.resolve(${JSON.stringify(importableRuns)});
            case 'desktop_pick_import_files':
              return Promise.resolve(${JSON.stringify(pickedFiles)});
            case 'desktop_get_project_link':
              return Promise.resolve(window.__mockLink);
            case 'desktop_set_project_link':
              window.__mockLink = args.path ? { path: args.path, exists: true } : null;
              return Promise.resolve(null);
            case 'desktop_open_window':
              return Promise.resolve(null);
            case 'desktop_save_download':
              return Promise.resolve('~/Downloads/' + (args?.filename ?? 'download'));
            case 'desktop_get_service_settings':
              return Promise.resolve({ run_in_background: false, start_on_login: false });
            case 'desktop_check_update':
              return Promise.resolve({ state: 'unsupported' });
            case 'desktop_mcp_clients':
              return Promise.resolve([]);
            default:
              return Promise.resolve(null);
          }
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
      window: { getCurrentWindow: () => ({ label: 'main' }) },
    };
  `;
}

/** Attributes the region capture puts on the page, and takes off again. */
const REGION_ATTR = 'data-shot-region';
const KEEP_ATTR = 'data-shot-keep';

/**
 * Mark the nearest common ancestor of `selectors`, and the ancestor's children
 * that lead to one of them. Returns how many targets were resolved.
 *
 * A region is captured by screenshotting that ancestor with its other children
 * hidden, rather than by clipping the viewport: the dashboard scrolls inside a
 * panel instead of moving the document, so `locator.screenshot()` — which
 * scrolls the element into view and stitches one taller than the viewport — is
 * the only primitive that reliably gets the whole thing.
 */
function markRegion({ selectors, regionAttr, keepAttr }) {
  const targets = selectors.map((s) => document.querySelector(s));
  const missing = selectors.filter((_, i) => !targets[i]);
  if (missing.length > 0) return { missing };

  const ancestorsOf = (el) => {
    const chain = [];
    for (let n = el; n; n = n.parentElement) chain.push(n);
    return chain;
  };
  const chains = targets.map(ancestorsOf);
  const common = chains[0].find((candidate) => chains.every((chain) => chain.includes(candidate)));
  // The common ancestor of a single target is the target itself; step up so the
  // capture has somewhere to put the padding.
  const region = targets.length === 1 ? (common.parentElement ?? common) : common;

  region.setAttribute(regionAttr, '');
  for (const child of region.children) {
    if (targets.some((t) => child === t || child.contains(t))) child.setAttribute(keepAttr, '');
  }
  // A grid item stretches to its row's height by default, which is what leaves
  // blank space under a shortened region. `align-self` fixes that, but in a
  // flex column the same property works on the horizontal axis and would
  // narrow the capture instead — so it is applied only for grid parents.
  const parentDisplay = region.parentElement ? getComputedStyle(region.parentElement).display : '';
  return { missing: [], gridParent: parentDisplay === 'grid' || parentDisplay === 'inline-grid' };
}

function unmarkRegion({ regionAttr, keepAttr }) {
  for (const el of document.querySelectorAll(`[${regionAttr}]`)) el.removeAttribute(regionAttr);
  for (const el of document.querySelectorAll(`[${keepAttr}]`)) el.removeAttribute(keepAttr);
}

/**
 * Fail when the capture target is taller than the viewport.
 *
 * An element screenshot of something that does not fit comes back the full
 * height of the element with everything past the viewport left blank, which
 * looks like a page that simply ends — the quiet kind of wrong this harness is
 * meant to rule out. The message names the viewport that would work.
 */
async function assertFitsViewport(page, locator, sceneName, what) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what} has no bounding box — is it visible?`);
  const viewport = page.viewportSize();
  if (box.height <= viewport.height) return;
  throw new Error(
    `${what} is ${Math.ceil(box.height)}px tall and does not fit the ` +
      `${viewport.width}×${viewport.height} viewport — give scene "${sceneName}" ` +
      `viewport: { width: ${viewport.width}, height: ${Math.ceil(box.height) + 40} }`,
  );
}

/**
 * CSS applied for the capture only: hide everything in the region that is not
 * on the way to a target, and turn `pad` into the region's own padding so the
 * image gets breathing room outside the elements' borders.
 */
function regionStyle(pad, { gridParent = false } = {}) {
  const heightResets = 'height: auto !important; min-height: 0 !important; max-height: none !important;';
  return [
    `[${REGION_ATTR}] > *:not([${KEEP_ATTR}]) { display: none !important; }`,
    // Height resets shrink the region to what the hiding left behind; without
    // them a container stretched to fill its panel hands the capture its own
    // trailing blank space.
    `[${REGION_ATTR}] { padding: ${pad}px !important; margin: 0 !important; ${heightResets} }`,
    gridParent ? `[${REGION_ATTR}] { align-self: start !important; }` : '',
    `[${REGION_ATTR}] > [${KEEP_ATTR}] { ${heightResets} }`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Levenshtein distance, for suggesting what the user meant by an unknown scene. */
function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

function nearestScenes(name) {
  return SCENES.map((s) => ({ name: s.name, d: editDistance(name, s.name) }))
    .filter((s) => s.d <= Math.max(3, Math.floor(name.length / 2)) || s.name.includes(name))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((s) => s.name);
}

function listScenes() {
  const width = Math.max(...SCENES.map((s) => s.name.length));
  for (const scene of SCENES) {
    const tags = (scene.tags ?? []).join(',') || '—';
    const dir = scene.out ?? 'screens';
    console.log(`${scene.name.padEnd(width)}  ${sceneMode(scene).padEnd(7)} [${tags}]  ${scene.description}`);
    console.log(`${' '.repeat(width)}  → ${dir}/${sceneOutputs(scene).join(', ')}`);
  }
}

/**
 * Check the committed docs illustrations against the scene registry: every docs
 * scene must have its image on disk, and every image must have a scene (or be a
 * documented product of the marketing pipeline).
 */
function checkDocsImages() {
  const docsScenes = SCENES.filter((s) => (s.out ?? 'screens') === 'docs');
  const produced = new Map();
  for (const scene of docsScenes) {
    for (const file of sceneOutputs(scene)) produced.set(file, scene.name);
  }

  const onDisk = existsSync(DOCS_SHOTS_DIR) ? readdirSync(DOCS_SHOTS_DIR).filter((f) => f.endsWith('.png')) : [];

  const missing = [...produced.entries()].filter(([file]) => !onDisk.includes(file));
  const orphans = onDisk.filter((f) => !produced.has(f) && !EXTERNAL_DOCS_IMAGES.has(f));
  const staleAllowlist = [...EXTERNAL_DOCS_IMAGES].filter((f) => !onDisk.includes(f));

  for (const [file, scene] of missing) {
    console.error(`missing: ${file} — scene "${scene}" produces it, but it is not committed`);
  }
  for (const file of orphans) {
    console.error(`orphan:  ${file} — no scene produces it; add one, or list it in EXTERNAL_DOCS_IMAGES`);
  }
  for (const file of staleAllowlist) {
    console.error(`stale:   ${file} — listed in EXTERNAL_DOCS_IMAGES but no longer on disk`);
  }

  const problems = missing.length + orphans.length + staleAllowlist.length;
  if (problems === 0) {
    console.log(
      `All good: ${produced.size} image(s) from ${docsScenes.length} scene(s), ` +
        `${EXTERNAL_DOCS_IMAGES.size} from the marketing pipeline.`,
    );
    return true;
  }
  console.error(`\n${problems} problem(s) in ${DOCS_SHOTS_DIR}`);
  return false;
}

function parseArgs(argv) {
  const flags = {
    scenes: [],
    tag: null,
    url: null,
    out: null,
    freezeNow: null,
    list: false,
    check: false,
    route: null,
    width: null,
    height: null,
    expand: false,
    name: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') flags.list = true;
    else if (arg === '--check') flags.check = true;
    else if (arg === '--tag') flags.tag = argv[++i];
    else if (arg === '--url') flags.url = argv[++i];
    else if (arg === '--out') flags.out = resolve(process.cwd(), argv[++i]);
    else if (arg === '--freeze-now') flags.freezeNow = argv[++i];
    else if (arg === '--route') flags.route = argv[++i];
    else if (arg === '--width') flags.width = Number(argv[++i]);
    else if (arg === '--height') flags.height = Number(argv[++i]);
    else if (arg === '--expand') flags.expand = true;
    else if (arg === '--name') flags.name = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`);
    else flags.scenes.push(arg);
  }
  return flags;
}

/**
 * The one-off scene behind `--route`: one page, captured like a registered
 * scene but never listed and never checked against the docs images.
 */
function adHocScene(flags) {
  if (!flags.route.startsWith('/')) throw new Error(`--route needs an absolute path, got "${flags.route}"`);
  for (const [flag, value] of [
    ['--width', flags.width],
    ['--height', flags.height],
  ]) {
    if (value != null && !(Number.isInteger(value) && value > 0)) throw new Error(`${flag} needs a positive integer`);
  }
  const slug =
    flags.route
      .replace(/^\//, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '') || 'home';
  return {
    name: flags.name ?? `route-${slug}`,
    route: flags.route,
    viewport: { width: flags.width ?? DEFAULT_VIEWPORT.width, height: flags.height ?? DEFAULT_VIEWPORT.height },
    expandAll: flags.expand,
    out: 'screens',
  };
}

function selectScenes(flags) {
  const badMode = SCENES.filter((s) => s.mode != null && !MODES.includes(s.mode));
  if (badMode.length) {
    throw new Error(
      `scene(s) with an unknown mode: ${badMode.map((s) => `${s.name} (${s.mode})`).join(', ')} — use ${MODES.join(' or ')}`,
    );
  }
  const unknown = flags.scenes.filter((w) => !SCENES.some((s) => s.name === w));
  if (unknown.length) {
    const hints = unknown
      .map((u) => {
        const near = nearestScenes(u);
        return near.length ? `${u} (did you mean ${near.join(', ')}?)` : u;
      })
      .join('; ');
    throw new Error(`unknown scene(s): ${hints} — see --list`);
  }
  let scenes = flags.scenes.length ? SCENES.filter((s) => flags.scenes.includes(s.name)) : SCENES;
  if (flags.tag) {
    scenes = scenes.filter((s) => (s.tags ?? []).includes(flags.tag));
    if (scenes.length === 0) {
      const known = [...new Set(SCENES.flatMap((s) => s.tags ?? []))].join(', ');
      throw new Error(`no scenes tagged "${flags.tag}" — known tags: ${known}`);
    }
  }
  return scenes;
}

/** Run one scene in its own context; returns the number of images written. */
async function captureScene(browser, scene, { base, outDir, freezeNow }) {
  const context = await browser.newContext({
    viewport: scene.viewport ?? DEFAULT_VIEWPORT,
    colorScheme: scene.colorScheme,
    deviceScaleFactor: scene.deviceScaleFactor,
  });
  if (freezeNow) await context.clock.setFixedTime(freezeNow);
  if (sceneMode(scene) === 'desktop') await context.addInitScript(bridgeScript(scene));
  const page = await context.newPage();
  // A dev server compiles routes on first hit — well past the 30s default.
  page.setDefaultNavigationTimeout(90_000);

  const settle = (opts = {}) => settlePage(page, { charts: scene.charts, ...opts });

  const goto = async (path) => {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);
    await settle();
  };

  /** Unfold a collapsible section, and fail loudly if it has no toggle to click. */
  const expand = async (selector) => {
    const toggle = page.locator(`${selector} [role="button"][aria-expanded]`).first();
    await toggle.waitFor({ state: 'visible', timeout: 20_000 });
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    await page
      .locator(`${selector} [role="button"][aria-expanded="true"]`)
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    await settle();
  };

  /**
   * Unfold every collapsed section on the page. Each click shrinks the set of
   * folded toggles (and may reveal new ones), so the first match is clicked
   * until none is left, with a ceiling so a toggle that never flips cannot
   * loop forever.
   */
  const expandAll = async () => {
    const folded = page.locator('main [role="button"][aria-expanded="false"]');
    for (let i = 0; i < 40 && (await folded.count()) > 0; i++) {
      await folded.first().click();
      await page.waitForTimeout(100);
    }
    await settle();
  };

  /**
   * Open a tab by its visible name and assert it really opened. A renamed or
   * removed tab then fails here instead of capturing whatever screen was
   * already on display.
   */
  const openTab = async (name, { panel } = {}) => {
    const tab = page.getByRole('tab', { name }).first();
    await tab.waitFor({ state: 'visible', timeout: 20_000 });
    await tab.click();
    await page.getByRole('tab', { name, selected: true }).first().waitFor({ timeout: 10_000 });
    if (panel) await page.locator(panel).first().waitFor({ state: 'visible', timeout: 20_000 });
    await settle();
  };

  // Annotations are drawn inside whatever the scene captures, so they stay in
  // register with the content when the capture scrolls to it.
  const annotationHost = typeof scene.of === 'string' ? scene.of : null;
  const annotate = (shapes, opts = {}) => drawAnnotations(page, shapes, { container: annotationHost, ...opts });
  const clear = () => clearAnnotations(page);

  /** Take one screenshot of whatever the scene targets, as a buffer. */
  const capture = async (opts = {}) => {
    const { of: ofOpt, pad: padOpt, ...pwOpts } = opts;
    const of = ofOpt ?? scene.of;
    const pad = padOpt ?? scene.pad ?? 0;
    const common = { animations: 'disabled', caret: 'hide', ...pwOpts };

    if (of && !pad && !Array.isArray(of)) {
      const target = page.locator(of).first();
      await assertFitsViewport(page, target, scene.name, of);
      return target.screenshot(common);
    }
    if (of) {
      const selectors = Array.isArray(of) ? of : [of];
      const { missing, gridParent } = await page.evaluate(markRegion, {
        selectors,
        regionAttr: REGION_ATTR,
        keepAttr: KEEP_ATTR,
      });
      if (missing.length > 0) throw new Error(`capture target(s) not found: ${missing.join(', ')}`);
      // Applied as a real stylesheet rather than screenshot's `style` option so
      // the region can be measured in its captured shape before shooting it.
      const styleTag = await page.addStyleTag({ content: regionStyle(pad, { gridParent }) });
      const region = page.locator(`[${REGION_ATTR}]`);
      try {
        await assertFitsViewport(page, region, scene.name, selectors.join(' + '));
        return await region.screenshot(common);
      } finally {
        await styleTag.evaluate((node) => node.remove());
        await page.evaluate(unmarkRegion, { regionAttr: REGION_ATTR, keepAttr: KEEP_ATTR });
      }
    }
    return page.screenshot(common);
  };

  /** Store a theme preference and reload so the app boots already in it. */
  const setColorMode = async (mode) => {
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [COLOR_MODE_KEY, mode]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHydration(page);
    await settle();
  };

  let written = 0;
  const shoot = async (label, opts = {}) => {
    const stem = sceneFile(scene).replace(/\.png$/, '');
    const file = join(outDir, `${stem}${label ? `-${label}` : ''}.png`);

    let image;
    if (scene.split) {
      await setColorMode('light');
      const light = await capture(opts);
      await setColorMode('dark');
      const dark = await capture(opts);
      image = await compositeSplit(light, dark);
    } else {
      image = await capture(opts);
    }

    // Resizing re-encodes anyway, so pay for the palette here: a dashboard
    // screenshot is mostly flat fills and quantizes to a third of the bytes
    // with no visible loss. Scenes that skip this keep Playwright's own bytes.
    if (scene.outputWidth) {
      image = await sharp(image)
        .resize({ width: scene.outputWidth })
        .png({ palette: true, compressionLevel: 9 })
        .toBuffer();
    }
    writeFileSync(file, image);
    written++;
    console.log(`-> ${file.replace(`${APP_DIR}/`, '').replace(`${APP_DIR}`, '')}`);
  };

  try {
    if (scene.prepare) await scene.prepare({ base, request: context.request });
    await goto(scene.route ?? '/');
    for (const selector of scene.expand ?? []) await expand(selector);
    if (scene.expandAll) await expandAll();
    if (scene.run) {
      await scene.run({ page, base, shoot, goto, settle, openTab, expand, annotate, clear });
    }
    // A declarative scene captures itself; one with `run` has already shot what
    // it wanted, unless it only set up the page for a declarative capture.
    if (!scene.run) await shoot();
    if (scene.annotate) {
      await annotate(scene.annotate);
      await shoot('annotated');
      await clear();
    }
    return written;
  } finally {
    await context.close();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.list) {
    listScenes();
    return;
  }
  if (flags.check) {
    if (!checkDocsImages()) process.exit(1);
    return;
  }

  const scenes = flags.route ? [adHocScene(flags)] : selectScenes(flags);
  const freezeNow = flags.freezeNow ? new Date(flags.freezeNow) : null;
  if (freezeNow && Number.isNaN(freezeNow.getTime())) {
    throw new Error(`--freeze-now needs an ISO timestamp, got "${flags.freezeNow}"`);
  }

  for (const scene of scenes) mkdirSync(outDirFor(scene, flags.out), { recursive: true });
  const browser = await chromium.launch({
    executablePath: resolveChromium(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // Web and desktop scenes need differently-configured servers, so each mode
  // present in the run gets its own; --url drives whatever is already there.
  const byMode = MODES.map((mode) => [mode, scenes.filter((s) => sceneMode(s) === mode)]).filter(
    ([, group]) => group.length > 0,
  );

  const failures = [];
  let written = 0;
  try {
    for (const [mode, group] of byMode) {
      const server = flags.url ? { base: flags.url, stop: () => {} } : await startServer({ mode });
      try {
        for (const scene of group) {
          try {
            written += await captureScene(browser, scene, {
              base: server.base,
              outDir: outDirFor(scene, flags.out),
              freezeNow,
            });
          } catch (err) {
            failures.push(scene.name);
            console.error(`scene ${scene.name} failed: ${err.message}`);
          }
        }
      } finally {
        server.stop();
        if (!flags.url) await waitForPortFree(server.base);
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length) throw new Error(`scenes failed: ${failures.join(', ')}`);
  console.log(`All done! ${written} image(s) from ${scenes.length} scene(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
