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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
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
 *   - `demo-live-run-poster.png` is a frame of the demo video, not a screen;
 *   - `ai-diagnosis.png` needs a configured AI provider, which the dev seed
 *     has no answer for — it stays a live-demo capture.
 */
const EXTERNAL_DOCS_IMAGES = new Set([
  'demo-live-run-poster.png',
  'failure-cluster-triage.png',
  'failure-cluster.png',
  'failure-clusters-tab.png',
  'flaky-tests.png',
  'projects.png',
  'test-run.png',
]);

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
 */
const SCENES = [
  // ── Docs illustrations (committed) ────────────────────────────────────────
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
    // evidence cards are populated rather than empty.
    route: '/test-run-cases/37',
    viewport: { width: 1560, height: 1400 },
    colorScheme: 'dark',
  },
  {
    name: 'run-timeline',
    description: 'Per-worker run timeline with the setup/test/wasted/teardown span filter (dark)',
    tags: ['docs'],
    out: 'docs',
    route: '/test-runs/2?tab=workers',
    viewport: { width: 1600, height: 1000 },
    of: '[data-shot="run-timeline"]',
    pad: 12,
    colorScheme: 'dark',
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
    // No frontend code calls flaky-classify, so Root cause reads "—" for every
    // row until something asks for a classification.
    async prepare({ request, base }) {
      const flaky = await (await request.get(`${base}/api/projects/1/flaky-tests`)).json();
      for (const test of flaky.items ?? []) {
        await request.post(`${base}/api/projects/1/flaky-classify`, { data: { testCaseId: test.testCaseId } });
      }
    },
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

  // ── Feature states (report artifacts) ─────────────────────────────────────
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
          stepCategory: 'pw:expect',
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
    description: 'Screen tab: the Screenshot · Page diff toggle and the structural diff of the failing page',
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
  // width, so the clarity plan's "In numbers" table can be re-read visually after
  // each phase. Full-viewport, nothing expanded — the baseline these phases diff.
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
    name: 'notifications-settings',
    description: 'Notifications settings (auth off): SMTP status, channels, subscriptions; plus the project bell',
    route: '/settings/notifications',
    viewport: { width: 1280, height: 1250 },
    outputs: ['notifications-settings.png', 'notifications-settings-bell.png'],
    async prepare({ base, request }) {
      // One channel + subscription so neither section captures empty. Reruns
      // reuse the rows from the previous run instead of duplicating them.
      const list = await (await request.get(`${base}/api/channels`)).json();
      if (!list.channels.some((c) => c.name === 'Team Slack')) {
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
            case 'desktop_get_project_link':
              return Promise.resolve(window.__mockLink);
            case 'desktop_set_project_link':
              window.__mockLink = args.path ? { path: args.path, exists: true } : null;
              return Promise.resolve(null);
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
