#!/usr/bin/env node
/**
 * Generates public/demo/seed.sql – the SQLite seed file loaded by the
 * in-browser demo database.
 *
 * Run with:  node scripts/generate-demo-seed.mjs
 *
 * The script produces a self-contained SQL file with:
 *  1. CREATE TABLE statements (complete current schema)
 *  2. INSERT statements for realistic demo data
 *
 * All failure data derives from the story fixtures in
 * `shared/demo/failure-stories.mjs` — the same module the demo SCM history,
 * the run simulator and the consistency test consume — so every error string,
 * source snippet, line number, suspect commit and suggested-fix patch agrees
 * across the whole demo by construction. Fingerprints are computed with the
 * mirror of the real clustering algorithm (`shared/demo/demo-fingerprint.mjs`),
 * so live simulated failures join the seeded clusters.
 *
 * Generation is deterministic (seeded PRNG): re-running without changes
 * produces byte-identical SQL, keeping the demo staleness hash stable.
 *
 * It also writes public/demo/seed.version.json containing a SHA-256 hash of
 * the generated SQL content.  The Nuxt build reads this hash and exposes it
 * as runtime config so the demo SPA can detect stale IndexedDB data.
 */

import { writeFileSync, mkdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import {
  FAILURE_STORIES,
  DEMO_PROJECTS,
  SCM_REPOS,
  SOURCE_FILES,
  lineOf,
  buildTestSource,
  buildSourceFrames,
  storyByClusterId,
} from '../shared/demo/failure-stories.mjs';
import { demoTestMeta, demoTags, buildAiUsage } from '../shared/demo/demo-test-meta.mjs';
import { computeDemoFingerprint } from '../shared/demo/demo-fingerprint.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Overridable so concurrent callers (e.g. two unit test files regenerating in
// their own beforeAll) can each write to an isolated directory instead of
// racing on the single tracked public/demo/seed.sql.
const OUTPUT_DIR = process.env.PIWI_DEMO_SEED_OUTPUT_DIR || join(__dirname, '../public/demo');
const OUTPUT = join(OUTPUT_DIR, 'seed.sql');

// Canonical demo identities — shared with the runtime app (app/demo/demo-users.ts).
const DEMO_USERS = JSON.parse(readFileSync(join(__dirname, '../app/demo/demo-users.json'), 'utf-8'));

// ── Helpers ────────────────────────────────────────────────────────────────

function ts(isoDate) {
  return Math.floor(new Date(isoDate).getTime() / 1000);
}

function q(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function insert(table, rows) {
  return rows
    .map((row) => {
      const cols = Object.keys(row).join(', ');
      const vals = Object.values(row).map(q).join(', ');
      return `INSERT INTO ${table} (${cols}) VALUES (${vals});`;
    })
    .join('\n');
}

// Deterministic PRNG (mulberry32) so regeneration is reproducible: identical
// inputs → identical seed.sql → identical staleness hash.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x5eed);

// ── Schema (derived from Drizzle migrations) ────────────────────────────────
// Read migrations in journal order so the demo schema always matches the server
// schema automatically — no manual sync needed when columns are added.
// The --> statement-breakpoint markers are Drizzle meta-comments; strip them so
// sql.js only sees plain SQL statements.
const MIGRATIONS_DIR = join(__dirname, '../server/database/migrations');
const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8'));

const SCHEMA = journal.entries
  .sort((a, b) => a.idx - b.idx)
  .map((entry) =>
    readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf-8')
      .replace(/--> statement-breakpoint/g, '')
      .trim(),
  )
  .join('\n\n');

// ── Fingerprints (real algorithm mirror) ───────────────────────────────────
// One fingerprint per story; every per-case error variant of a story MUST hash
// identically (frames are not part of the hash), or the seed aborts.

const storyFingerprints = new Map();
for (const story of FAILURE_STORIES) {
  const fps = await Promise.all(story.failingCases.map((fc) => computeDemoFingerprint(fc.error)));
  for (const fp of fps.slice(1)) {
    if (fp.fingerprint !== fps[0].fingerprint) {
      throw new Error(`Story ${story.key}: per-case error variants produce different fingerprints`);
    }
  }
  storyFingerprints.set(story.clusterId, fps[0]);
}

// ── Demo data ─────────────────────────────────────────────────────────────

// Tags
// Colors come from the curated TAG_COLOR_PALETTE (Tailwind 500 shades) so the
// demo shows the same tag styling users get. Keep them hex — TagBadge accepts
// any CSS color, but hex is what the tag editor stores.
const TAGS = [
  { id: 1, text: 'smoke', color: '#14b8a6', created_at: ts('2025-03-01'), updated_at: ts('2025-03-01') },
  { id: 2, text: 'regression', color: '#6366f1', created_at: ts('2025-03-01'), updated_at: ts('2025-03-01') },
  { id: 3, text: 'critical', color: '#ef4444', created_at: ts('2025-03-15'), updated_at: ts('2025-03-15') },
  { id: 4, text: 'performance', color: '#f59e0b', created_at: ts('2025-04-01'), updated_at: ts('2025-04-01') },
];

// Projects
const PROJECTS = [
  {
    id: 1,
    name: 'e2e-checkout',
    label: 'E2E Checkout',
    description: 'End-to-end tests for the checkout flow',
    created_at: ts('2025-03-01'),
    updated_at: ts('2025-04-25T08:30:00'),
  },
  {
    id: 2,
    name: 'api-integration',
    label: 'API Integration',
    description: 'Integration tests for REST API endpoints',
    created_at: ts('2025-02-15'),
    updated_at: ts('2025-04-25T07:15:00'),
  },
  {
    id: 3,
    name: 'ui-components',
    label: 'UI Components',
    description: 'Visual regression tests for UI components',
    created_at: ts('2025-01-10'),
    updated_at: ts('2025-04-24T16:45:00'),
  },
  {
    id: 4,
    name: 'mobile-safari',
    label: 'Mobile Safari',
    description: 'Mobile Safari browser compatibility tests',
    created_at: ts('2025-04-01'),
    updated_at: ts('2025-04-20T12:00:00'),
  },
  {
    id: 5,
    name: 'web-dashboard',
    label: 'Web Dashboard',
    description: 'Cross-browser tests for the SaaS admin dashboard',
    created_at: ts('2025-02-20'),
    updated_at: ts('2025-04-25T09:10:00'),
  },
];

// Record each project's default branch from its SCM repo, so branch-aware
// baselines, flakiness scoping and the default-branch resolver have real data.
for (const project of PROJECTS) {
  project.default_branch = SCM_REPOS[project.id]?.defaultBranch ?? 'main';
}

// Project-tag associations
const PROJECT_TAGS = [
  { project_id: 1, tag_id: 1 }, // e2e-checkout → smoke
  { project_id: 1, tag_id: 3 }, // e2e-checkout → critical
  { project_id: 2, tag_id: 2 }, // api-integration → regression
  { project_id: 3, tag_id: 1 }, // ui-components → smoke
  { project_id: 3, tag_id: 4 }, // ui-components → performance
  { project_id: 4, tag_id: 2 }, // mobile-safari → regression
  { project_id: 5, tag_id: 2 }, // web-dashboard → regression
  { project_id: 5, tag_id: 3 }, // web-dashboard → critical
];

// ── Timeline markers (dated project events overlaid on the trend charts) ────
// Dated within project 1's run window (newest run 2025-04-25T08:30Z, ~8h apart)
// so they land on the charts. Timestamps are rebased to load time like the runs.

// App settings — the `ai` key marks the demo's simulated provider as configured,
// so the setup page's AI probe reports active, matching the settings surface.
const APP_SETTINGS = [
  {
    key: 'ai',
    value: {
      autoDiagnose: false,
      roles: {
        diagnosis: { provider: 'demo', model: 'demo-simulated', baseUrl: null, apiKey: null },
      },
    },
    updated_at: ts('2025-04-20T09:00:00'),
  },
];
const MARKERS = [
  {
    id: 1,
    project_id: 1,
    occurred_at: ts('2025-04-22T12:00:00Z'),
    label: 'Deployed checkout v2.4.0',
    description: 'Rolled out the new payment provider integration.',
    category: 'deploy',
    environment: null,
    source: 'manual',
    run_id: null,
    created_at: ts('2025-04-22T12:00:00Z'),
    updated_at: ts('2025-04-22T12:00:00Z'),
  },
  {
    id: 2,
    project_id: 1,
    occurred_at: ts('2025-04-20T09:00:00Z'),
    label: 'Enabled strict CSP in production',
    description: 'Tightened the content-security-policy header on the prod storefront.',
    category: 'config',
    environment: 'production',
    source: 'manual',
    run_id: null,
    created_at: ts('2025-04-20T09:00:00Z'),
    updated_at: ts('2025-04-20T09:00:00Z'),
  },
  {
    id: 3,
    project_id: 1,
    occurred_at: ts('2025-04-24T18:30:00Z'),
    label: 'Upstream payment API outage',
    description: 'Third-party sandbox was down for ~40 min; expect failed checkouts.',
    category: 'incident',
    environment: null,
    source: 'manual',
    run_id: null,
    created_at: ts('2025-04-24T18:30:00Z'),
    updated_at: ts('2025-04-24T18:30:00Z'),
  },
];

// ── Test suites & cases (from the fixture module) ──────────────────────────

const TEST_SUITES = [];
const TEST_CASES = [];
let tsId = 1;
let tcId = 1;
const suiteNow = ts('2025-03-01');
const suiteLookup = {}; // projectId → filePath → suiteId
const caseIdsByProject = {}; // projectId → [caseId] (in DEMO_PROJECTS order)
const caseById = new Map(); // caseId → { projectId, file, title, declLine, declColumn }
const caseIdByKey = new Map(); // `${projectId}\x00${file}\x00${title}` → caseId

// Cases that are prone to flake (retry-pass) — their `flaky_root_cause` is set
// coherently instead of at random. Tags and `piwi:` ownership come from the
// shared demo-test-meta module (the same rules the run simulator uses).

const FLAKY_CASES = {
  1: { title: 'should apply discount code', rootCause: 'timing' },
  2: { title: 'GET /search handles empty query', rootCause: 'network' },
  3: { title: 'Table pagination works correctly', rootCause: 'timing' },
  4: { title: 'Pull to refresh triggers reload', rootCause: 'timing' },
  5: { title: 'toggles dark mode', rootCause: 'other' },
};

for (const proj of DEMO_PROJECTS) {
  suiteLookup[proj.id] = {};
  for (const [fp, def] of Object.entries(proj.suites)) {
    suiteLookup[proj.id][fp] = tsId;
    TEST_SUITES.push({
      id: tsId,
      project_id: proj.id,
      file_path: fp,
      suite_path: def.suitePath.join('\x1f'),
      mode: def.mode,
      annotations: JSON.stringify(def.annotations),
      created_at: suiteNow,
      updated_at: suiteNow,
    });
    tsId++;
  }

  caseIdsByProject[proj.id] = [];
  for (const c of proj.cases) {
    const flaky = FLAKY_CASES[proj.id]?.title === c.title ? FLAKY_CASES[proj.id] : null;
    TEST_CASES.push({
      id: tcId,
      project_id: proj.id,
      file_path: c.file,
      suite_path: proj.suites[c.file]?.suitePath.join('\x1f') ?? '',
      suite_id: suiteLookup[proj.id][c.file] ?? null,
      title: c.title,
      flaky_root_cause: flaky?.rootCause ?? null,
      tags: JSON.stringify(demoTags(c.file, proj.cases.indexOf(c))),
      owner: demoTestMeta(c.file, proj.cases.indexOf(c))?.owner ?? null,
      priority: demoTestMeta(c.file, proj.cases.indexOf(c))?.priority ?? null,
      feature: demoTestMeta(c.file, proj.cases.indexOf(c))?.feature ?? null,
      link: null,
      created_at: suiteNow,
      updated_at: suiteNow,
    });
    caseIdsByProject[proj.id].push(tcId);
    caseById.set(tcId, { projectId: proj.id, ...c });
    caseIdByKey.set(`${proj.id}\x00${c.file}\x00${c.title}`, tcId);
    tcId++;
  }
}

/** Story cluster membership: caseId → story, per project. */
const storyByCaseId = new Map(); // caseId → { story, failingCase }
for (const story of FAILURE_STORIES) {
  for (const fc of story.failingCases) {
    const caseId = caseIdByKey.get(`${story.projectId}\x00${story.specFile}\x00${fc.title}`);
    if (!caseId) throw new Error(`Story ${story.key}: failing case not found: ${fc.title}`);
    storyByCaseId.set(caseId, { story, failingCase: fc });
  }
}

// ── Test runs + test_runs_cases ────────────────────────────────────────────

// Simple URL normalizer for seed data (mirrors shared/utils/route.ts)
function seedNormalizeUrl(url) {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    pathname = pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid');
    pathname = pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return url;
  }
}

const TEST_RUNS = [];
const TEST_RUNS_CASES = [];
const NETWORK_REQUESTS = [];
const REPORTS = [];
const FAILURE_CLUSTERS = [];

let runId = 1;
let trcId = 1;
let reportId = 1;
let nrId = 1;

const clusterStats = {};
for (const story of FAILURE_STORIES) {
  clusterStats[story.clusterId] = {
    occurrences: 0,
    firstRunId: null,
    lastRunId: null,
    firstStartMs: null,
    lastStartMs: null,
    // Distinct runs this cluster failed in, newest first. `occurrences` counts
    // retries too, so it cannot be used to find the runs where it went quiet.
    failedRuns: [],
  };
}

// Runs per project. Failure scheduling is story-driven (see below), so there is
// no blanket failure rate — only the flaky (retry-pass) rate is a dial here.
const PROJECT_CONFIGS = {
  1: { numRuns: 20, baseDuration: 145000, baseAvg: 4200, baseP90: 8900, flakyRate: 0.18 },
  2: { numRuns: 18, baseDuration: 82000, baseAvg: 2100, baseP90: 4800, flakyRate: 0.12 },
  3: { numRuns: 15, baseDuration: 310000, baseAvg: 8500, baseP90: 18000, flakyRate: 0.2 },
  4: { numRuns: 8, baseDuration: 190000, baseAvg: 5800, baseP90: 12000, flakyRate: 0.15 },
  5: { numRuns: 12, baseDuration: 210000, baseAvg: 5200, baseP90: 11000, flakyRate: 0.15 },
};

// Base start time (most recent run is at this time, older runs go backwards)
const BASE_START_MS = new Date('2025-04-25T08:30:00Z').getTime();

const ENVIRONMENTS = ['production', 'staging', 'integration', 'development'];
const RUN_GREPS = {
  1: 'checkout|cart',
  2: 'auth|orders',
  3: 'button|modal',
  4: 'navigation',
  5: 'users|reports',
};

// Parallel-worker model for seeded runs: tests are pulled round-robin across a
// fixed pool of workers and run back-to-back per worker (matching the demo
// simulator), so the Workers timeline shows dense rows instead of large gaps.
const SEED_WORKER_COUNT = 4;
const SEED_WORKER_GAP_MS = 200;
/** How long after a test starts its first captured request fires. */
const SEED_FIRST_REQUEST_OFFSET_MS = 120;
/** Idle time between one captured request finishing and the next starting. */
const SEED_REQUEST_GAP_MS = 35;

/**
 * Build realistic `step_events` for a seeded case: before/after hooks, the
 * context/page fixtures, framework-injected waits, and — for wait-heavy cases —
 * an explicit `Wait for timeout` sleep that counts as wasted time under the
 * default wasted-wait patterns. Segment offsets are emitted as absolute epoch ms
 * anchored to the case's start so the timeline can place each segment. Returns
 * the events plus the total wasted ms (sum of the explicit timeout sleeps).
 */
function buildSeedStepEvents(caseStartMs, caseDuration, location, waitHeavy) {
  const events = [];
  let offset = 0;
  const seg = (title, category, duration, status, loc = null) => {
    events.push({ title, category, startedAt: caseStartMs + offset, duration, status, location: loc });
    offset += duration;
  };
  // Each framework segment is a fraction of the test duration, clamped so it
  // stays visible without overflowing short tests.
  const frac = (f, min, max) => Math.max(min, Math.min(max, Math.round(caseDuration * f)));

  seg('Before Hooks', 'hook', frac(0.06, 60, 200), 'passed');
  seg('fixture: context', 'fixture', frac(0.04, 40, 120), 'passed');
  seg('fixture: page', 'fixture', frac(0.03, 30, 90), 'passed');
  // Framework-injected navigation wait — not wasted.
  seg('Wait for load state', 'wait', frac(0.1, 80, 600), 'passed');

  let wastedMs = 0;
  if (waitHeavy) {
    // Explicit author sleep — wasted under DEFAULT_WASTED_WAIT_PATTERNS.
    const timeoutDur = frac(0.18, 400, 2500);
    seg('Wait for timeout', 'wait', timeoutDur, 'wasted', location);
    wastedMs += timeoutDur;
  }
  // Wait for selector — framework-injected, not wasted.
  seg('Wait for selector', 'wait', frac(0.06, 40, 500), 'passed');
  seg('After Hooks', 'hook', frac(0.05, 50, 160), 'passed');

  return { stepEvents: events, wastedMs };
}

/**
 * Scale a project's themed step titles to a case duration, laying each step's
 * absolute `startTime` end-to-end from `caseStartMs` so the failure timeline
 * places them on a real clock rather than estimating from durations.
 */
function buildSteps(proj, caseDuration, caseStartMs) {
  const total = proj.stepTitles.reduce((s, st) => s + st.weight, 0);
  let cursor = caseStartMs;
  return proj.stepTitles.map((st) => {
    const duration = Math.round((st.weight / total) * caseDuration);
    const startTime = cursor;
    cursor += duration;
    return { title: st.title, duration, category: st.category, startTime };
  });
}

/** Themed network requests for one case (jittered durations; story overrides on failures). */
function buildNetwork(proj, storyEntry) {
  const base = proj.network.map((req) => ({
    ...req,
    duration: Math.max(8, Math.round(req.duration * (0.75 + rng() * 0.5))),
  }));
  const overrides = storyEntry?.story.evidence.failingNetwork ?? [];
  for (const over of overrides) {
    const idx = base.findIndex((r) => r.method === over.method && r.url === over.url);
    if (idx >= 0) base[idx] = { ...over };
    else base.push({ ...over });
  }
  return base.map((req) => ({ ...req, serverTraces: buildServerTraces(req) }));
}

/**
 * Synthesize a small server-side span tree for a captured request so the demo
 * shows the X-Piwi-Trace waterfall. Pure arithmetic (no rng) to keep the seed
 * reproducible; span ids are scoped per request. Returns null for static assets.
 */
function buildServerTraces(req) {
  const rt = req.resourceType;
  if (rt && !['fetch', 'xhr', 'document', 'other'].includes(rt)) return null;
  const dur = Math.max(4, Math.round(req.duration ?? 20));
  const status = req.status ?? 200;
  const isErr = status >= 500;
  let path;
  try {
    path = new URL(req.url).pathname;
  } catch {
    path = req.url;
  }
  const spans = [
    {
      id: 'root',
      name: `${req.method} ${path}`,
      kind: 'server',
      startMs: 0,
      durMs: dur,
      status: isErr ? 'error' : 'ok',
      attrs: { 'http.method': req.method, 'http.route': path, 'http.status_code': status },
    },
  ];
  const isApi = !rt || rt === 'fetch' || rt === 'xhr';
  if (isApi && dur >= 12) {
    const leaf = path.split('/').filter(Boolean).slice(-1)[0] || 'rows';
    spans.push({
      id: 'db',
      parentId: 'root',
      name: `SELECT ${leaf}`,
      kind: 'db',
      startMs: Math.round(dur * 0.12),
      durMs: Math.round(dur * 0.4),
    });
  }
  if (isErr) {
    spans.push({
      id: 'handler',
      parentId: 'root',
      name: 'unhandled exception',
      kind: 'internal',
      startMs: Math.round(dur * 0.75),
      durMs: Math.max(2, Math.round(dur * 0.2)),
      status: 'error',
    });
  }
  return spans;
}

/** Themed web vitals; failing pages render slower. */
function buildWebVitals(proj, failing) {
  if (!proj.webVitals) return null;
  const slow = failing ? 1.6 : 1;
  const url = proj.pageState?.url ?? proj.baseUrl ?? 'https://example.com/';
  return {
    navigation: {
      url,
      ttfb: Math.round((90 + rng() * 120) * slow),
      domInteractive: Math.round((700 + rng() * 600) * slow),
      domContentLoaded: Math.round((1000 + rng() * 800) * slow),
      loadComplete: Math.round((1500 + rng() * 1000) * slow),
    },
    paint: {
      firstPaint: Math.round((600 + rng() * 400) * slow),
      firstContentfulPaint: Math.round((800 + rng() * 500) * slow),
    },
    vitals: {
      lcp: Math.round((1200 + rng() * 1400) * slow),
      cls: Math.round(rng() * 0.2 * 10000) / 10000,
      // INP is frequently absent in short tests — mirror that in the seed.
      inp: rng() < 0.6 ? Math.round(80 + rng() * 250) : null,
    },
  };
}

/** Themed page state; failing stories may drop localStorage keys (e.g. an unresolved quote). */
function buildPageState(proj, storyEntry) {
  if (!proj.pageState) return null;
  const drop = new Set(storyEntry?.story.evidence.pageStateDropKeys ?? []);
  return {
    url: proj.pageState.url,
    hash: null,
    historyState: null,
    localStorage: proj.pageState.localStorage.filter((e) => !drop.has(e.key)),
    sessionStorage: proj.pageState.sessionStorage,
    cookies: proj.pageState.cookies,
  };
}

// Serial-group cascade: in one checkout run the first cart test fails, and the
// serial `Cart` describe skips the rest — the tests it blocked link back to it.
// It rides a story-free run so it neither collides with a cluster failure nor
// perturbs the deterministic rng stream the rest of the seed depends on.
const CASCADE_BLOCKER_LOCATION = 'tests/checkout/cart.spec.ts:4:3';
const CASCADE_BLOCKER_ERROR =
  'Error: expect(locator).toHaveText(expected)\n\n' +
  "Locator: getByTestId('cart-count')\n" +
  'Expected string: "1"\n' +
  'Received string: "0"\n' +
  '    at tests/checkout/cart.spec.ts:4:3';
const CASCADE_BLOCKED_TITLES = [
  'should remove item from cart',
  'should update item quantity',
  'should apply discount code',
  'should display cart total correctly',
];

for (const proj of DEMO_PROJECTS) {
  const cfg = PROJECT_CONFIGS[proj.id];
  const caseIds = caseIdsByProject[proj.id];
  const commits = SCM_REPOS[proj.id].commits;
  // Newest runs use the newest commits: run index i (0 = newest) maps onto the
  // commit list in windows, so a story starts failing exactly when its suspect
  // commit lands and "What changed" genuinely correlates.
  const commitWindow = Math.ceil(cfg.numRuns / commits.length);
  const commitIdxForRun = (i) => Math.min(Math.floor(i / commitWindow), commits.length - 1);

  const projectStories = FAILURE_STORIES.filter((s) => s.projectId === proj.id);
  const flakyCaseId = FLAKY_CASES[proj.id]
    ? caseIdByKey.get(
        `${proj.id}\x00${proj.cases.find((c) => c.title === FLAKY_CASES[proj.id].title)?.file}\x00${FLAKY_CASES[proj.id].title}`,
      )
    : null;

  // Decide which stories fire on which runs (deterministic). A story is
  // eligible once its suspect commit has landed (and, for environment-driven
  // stories, only on runs whose browser profile matches); it always fires on
  // the first eligible run (the regression's first appearance), then keeps
  // firing with its configured chance.
  const browserForRun = (i) => proj.browsers[proj.browserRotation[i % proj.browserRotation.length]] ?? proj.browsers[0];
  const eligible = (story, i) => {
    const suspectIdx = commits.findIndex((c) => c.sha === story.suspectSha);
    if (suspectIdx === -1 || commitIdxForRun(i) > suspectIdx) return false;
    const scheme = story.firing.requiresColorScheme;
    if (scheme && browserForRun(i).colorScheme !== scheme) return false;
    return true;
  };
  const firingByRun = new Map(); // runIndex → story[]
  for (const story of projectStories) {
    const eligibleRuns = [];
    for (let i = 0; i < cfg.numRuns; i++) if (eligible(story, i)) eligibleRuns.push(i);
    const oldestEligible = eligibleRuns[eligibleRuns.length - 1];
    for (const i of eligibleRuns) {
      if (i === oldestEligible || rng() < story.firing.chance) {
        if (!firingByRun.has(i)) firingByRun.set(i, []);
        firingByRun.get(i).push(story);
      }
    }
  }

  for (let i = 0; i < cfg.numRuns; i++) {
    // Runs go from newest (i=0) to oldest (i=numRuns-1)
    const startMs = BASE_START_MS - i * (8 * 60 * 60 * 1000 + Math.floor(rng() * 3600000));
    const startTime = Math.floor(startMs / 1000);
    const duration = Math.round(cfg.baseDuration + (rng() - 0.5) * 0.2 * cfg.baseDuration);
    const avgTestDuration = Math.round(cfg.baseAvg + (rng() - 0.5) * 0.15 * cfg.baseAvg);
    const p90TestDuration = Math.round(cfg.baseP90 + (rng() - 0.5) * 0.15 * cfg.baseP90);
    const browser = browserForRun(i);
    const commit = commits[commitIdxForRun(i)];

    const firingStories = firingByRun.get(i) ?? [];
    const failingCaseIds = new Set();
    for (const story of firingStories) {
      for (const fc of story.failingCases) {
        failingCaseIds.add(caseIdByKey.get(`${proj.id}\x00${story.specFile}\x00${fc.title}`));
      }
    }

    let status = failingCaseIds.size > 0 ? 'failed' : 'passed';
    // Occasionally a failure cuts the suite short: trailing (non-failing) tests
    // never execute and the run is interrupted.
    const didNotRunCaseIds = new Set();
    // Why each did-not-run case never executed, keyed by case id. The serial
    // cascade (a `previous-failure`, with a `blocked_by`) is stitched in by a
    // post-processing pass so it can't perturb this loop's rng stream.
    const reasonByCase = new Map();
    const blockedByByCase = new Map();
    if (failingCaseIds.size > 0 && rng() < 0.15) {
      status = 'interrupted';
      for (let j = caseIds.length - 1; j >= 0 && didNotRunCaseIds.size < 3; j--) {
        if (!failingCaseIds.has(caseIds[j])) didNotRunCaseIds.add(caseIds[j]);
      }
      for (const id of didNotRunCaseIds) reasonByCase.set(id, 'max-failures');
    }

    const flakyThisRun =
      status !== 'interrupted' && flakyCaseId && !failingCaseIds.has(flakyCaseId) && rng() < cfg.flakyRate;
    const flakyTests = flakyThisRun ? 1 : 0;
    const failedTests = failingCaseIds.size;
    const didNotRunTests = didNotRunCaseIds.size;
    const passedTests = caseIds.length - failedTests - didNotRunTests;

    const metadata = {
      ci: {
        provider: 'GitHub Actions',
        buildNumber: String(1200 - i),
        jobName: 'test',
        workflow: 'CI',
        buildUrl: `https://github.com/${SCM_REPOS[proj.id].repositoryUrl.split('/').slice(-2).join('/')}/actions/runs/${5100 + proj.id * 100 - i}`,
      },
      scm: {
        commit: commit.sha,
        branch: commit.branch,
        author: commit.author,
        commitMessage: commit.message,
      },
    };

    TEST_RUNS.push({
      id: runId,
      project_id: proj.id,
      status,
      start_time: startTime,
      duration,
      total_tests: caseIds.length,
      passed_tests: passedTests,
      failed_tests: failedTests,
      skipped_tests: 0,
      did_not_run_tests: didNotRunTests,
      flaky_tests: flakyTests,
      avg_test_duration: avgTestDuration,
      p90_test_duration: p90TestDuration,
      environment: ENVIRONMENTS[i % ENVIRONMENTS.length],
      branch: commit.branch && commit.branch !== 'HEAD' ? commit.branch : null,
      label: proj.id === 1 && i === 0 ? 'v2.4.0 release' : null,
      metadata,
      stream_token: null,
      instance_id: null,
      // Newest runs are on a newer Playwright than older ones so the
      // environment-diff card has a real version drift to show for failures
      // whose last pass predates the bump.
      playwright_version: i < 2 ? '1.52.0' : '1.51.0',
      reporter_version: '0.7.0',
      is_full_run: i % 5 !== 4 ? 1 : 0,
      filter_details: i % 5 === 4 ? JSON.stringify({ grep: RUN_GREPS[proj.id] }) : null,
      created_at: startTime,
      updated_at: startTime + Math.floor(duration / 1000),
    });

    // Add an HTML report for the first few runs of each project
    if (i < 3) {
      REPORTS.push({
        id: reportId++,
        test_run_id: runId,
        type: 'report',
        subtype: 'html',
        label: 'HTML Report',
        path: `reports/${proj.id}/${runId}/index.html`,
        size: Math.floor(rng() * 500000) + 100000,
        created_at: startTime,
      });
    }

    // Per-worker virtual clock (ms since run start). Tests run back-to-back on
    // their assigned worker, so timeline rows are dense rather than gappy.
    const runStartMs = startTime * 1000;
    const workerCursorMs = new Array(SEED_WORKER_COUNT).fill(0);

    for (let j = 0; j < caseIds.length; j++) {
      const caseId = caseIds[j];
      const caseDef = caseById.get(caseId);
      const isFailedCase = failingCaseIds.has(caseId);
      const isDidNotRunCase = didNotRunCaseIds.has(caseId);
      const isFlakyCase = flakyThisRun && caseId === flakyCaseId;

      const storyEntry = isFailedCase ? storyByCaseId.get(caseId) : null;
      const story = storyEntry?.story ?? null;
      const noPage = Boolean(story?.evidence.noPageArtifacts);
      // The story behind this case regardless of pass/fail — passing executions
      // seed its green ARIA baseline so a later failure has a page to diff against.
      const storyForCase = storyByCaseId.get(caseId)?.story ?? null;

      const caseStatus = isFailedCase ? 'failed' : isDidNotRunCase ? 'didnotrun' : 'passed';
      const caseDuration = isDidNotRunCase
        ? 0
        : Math.max(500, Math.round(avgTestDuration + (rng() - 0.5) * 0.3 * avgTestDuration));

      const workerIndex = j % SEED_WORKER_COUNT;
      const caseStartMs = runStartMs + workerCursorMs[workerIndex];

      if (story) {
        const stats = clusterStats[story.clusterId];
        stats.occurrences++;
        // Runs are generated newest-first, so the last write wins for "first".
        if (stats.lastRunId === null) {
          stats.lastRunId = runId;
          stats.lastStartMs = startMs;
        }
        stats.firstRunId = runId;
        stats.firstStartMs = startMs;
        // Several cases in the same run share a cluster; record the run once.
        if (stats.failedRuns[stats.failedRuns.length - 1]?.runId !== runId) {
          stats.failedRuns.push({ runId, startMs });
        }
      }

      const steps = buildSteps(proj, caseDuration, caseStartMs);
      // Mark the last step of a failing case as the failed one, so the timeline
      // anchors its window and failure marker on a captured step boundary.
      if (isFailedCase && steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        lastStep.failed = true;
        lastStep.error = { message: (storyEntry.failingCase.error ?? '').split('\n')[0] || 'Test failed' };
      }
      const slowestStep = steps.reduce((a, b) => (a.duration > b.duration ? a : b));

      // Test annotations — failures link to their cluster, the designated slow
      // case is always marked slow (so timeout hygiene can surface it as a stale
      // test.slow() once its durations no longer justify the tripled budget),
      // and one checkout case carries a smoke marker.
      let testAnnotations = null;
      if (isFailedCase && story) {
        testAnnotations = [{ type: 'fixme', description: `Known issue — see cluster ${story.clusterId}` }];
      } else if (flakyCaseId && caseId === flakyCaseId) {
        testAnnotations = [{ type: 'slow' }];
      } else if (proj.id === 1 && j === 0) {
        testAnnotations = [{ type: 'smoke' }];
      }

      // Timeline step events: every executed case shows hooks/fixtures/waits;
      // ~1/3 of long-enough cases also carry an explicit wasted `Wait for timeout`.
      // Did-not-run cases never executed, so they have no step events.
      const waitHeavy = !isDidNotRunCase && caseDuration >= 1500 && j % 3 === 0;
      const { stepEvents, wastedMs } = isDidNotRunCase
        ? { stepEvents: null, wastedMs: 0 }
        : buildSeedStepEvents(
            caseStartMs,
            caseDuration,
            `${caseDef.file}:${caseDef.declLine}:${caseDef.declColumn}`,
            waitHeavy,
          );

      // Themed browser console. Failing cases carry only what the story says a
      // real browser would log (never an echo of the Playwright error); some
      // passing cases carry the project's benign noise.
      let consoleLogs = null;
      if (isFailedCase && story?.evidence.consoleOnFail && !noPage) {
        consoleLogs = story.evidence.consoleOnFail.map((entry, idx) => ({
          type: entry.type,
          text: entry.text,
          timestamp: caseStartMs + Math.round(caseDuration * 0.6) + idx * 40,
          location: entry.location,
        }));
      } else if (!isFailedCase && !isDidNotRunCase && proj.consolePassing && rng() < 0.3) {
        consoleLogs = proj.consolePassing.map((entry, idx) => ({
          type: entry.type,
          text: entry.text,
          timestamp: caseStartMs + 200 + idx * 60,
          location: entry.location,
        }));
      }

      // Effective per-test timeout (ms), stable per test case across runs. Most
      // tests keep a healthy 20s budget that timeout-hygiene never flags (its
      // headroom stays under the 20s floor); the designated slow case keeps a
      // tripled 90s budget it no longer needs, and one non-slow case per project
      // is deliberately oversized at 120s — so the demo shows both opportunity
      // kinds (stale test.slow() and oversized-timeout).
      const isSlowCase = Boolean(flakyCaseId) && caseId === flakyCaseId;
      const isOversizedCase = !isSlowCase && caseId === caseIds[1];
      const caseTimeout = isSlowCase ? 90000 : isOversizedCase ? 120000 : 20000;

      const trcIdVal = trcId++;
      TEST_RUNS_CASES.push({
        id: trcIdVal,
        test_run_id: runId,
        test_case_id: caseId,
        status: caseStatus,
        duration: caseDuration,
        timeout: caseTimeout,
        error: isFailedCase ? storyEntry.failingCase.error : null,
        failure_cluster_id: story?.clusterId ?? null,
        retries: isFlakyCase ? 1 : 0,
        // A flaky case has one failed attempt before the passing final one; a
        // plain case has a single attempt. Mirrors what the reporter collects.
        attempts: JSON.stringify(
          isFlakyCase
            ? [
                { retry: 0, status: 'failed', duration: Math.round(caseDuration / 2), startedAt: caseStartMs },
                { retry: 1, status: 'passed', duration: caseDuration, startedAt: caseStartMs + caseDuration },
              ]
            : [{ retry: 0, status: caseStatus, duration: caseDuration, startedAt: caseStartMs }],
        ),
        // Regression/new-flaky signals are computed after generation from the
        // actual per-case history (see below), like the server does.
        is_new_regression: 0,
        is_new_flaky: 0,
        line: caseDef.declLine,
        column: caseDef.declColumn,
        browser,
        browser_name: browser.projectName ?? null,
        test_annotations: testAnnotations,
        tags: JSON.stringify(demoTags(caseDef.file, j)),
        test_meta: demoTestMeta(caseDef.file, j),
        steps,
        step_events: stepEvents,
        wasted_time_ms: wastedMs,
        slowest_step: slowestStep.title,
        slowest_step_duration: slowestStep.duration,
        web_vitals: isDidNotRunCase || noPage ? null : buildWebVitals(proj, isFailedCase),
        page_state: isDidNotRunCase || noPage ? null : buildPageState(proj, storyEntry),
        ai_usage: isDidNotRunCase || noPage ? null : await buildAiUsage(caseDef),
        console_logs: consoleLogs,
        aria_snapshot:
          isFailedCase && !noPage
            ? story?.aria
            : !isDidNotRunCase && !isFailedCase
              ? (storyForCase?.baselineAria ?? null)
              : null,
        test_source: isFailedCase ? buildTestSource(story, storyEntry.failingCase, caseDef.declLine) : null,
        test_source_frames: isFailedCase ? buildSourceFrames(storyEntry.failingCase) : null,
        worker_index: workerIndex,
        started_at: caseStartMs,
        did_not_run_reason: isDidNotRunCase ? (reasonByCase.get(caseId) ?? null) : null,
        blocked_by: isDidNotRunCase ? (blockedByByCase.get(caseId) ?? null) : null,
        created_at: caseStartMs,
      });

      // Advance this worker's clock so the next test it picks up runs after it.
      workerCursorMs[workerIndex] += caseDuration + SEED_WORKER_GAP_MS;

      if (!isDidNotRunCase) {
        // Requests fire one after another from shortly after the test starts,
        // so the execution page can order them by start time.
        let requestStartMs = caseStartMs + SEED_FIRST_REQUEST_OFFSET_MS;
        for (const req of buildNetwork(proj, storyEntry)) {
          const startTime = requestStartMs;
          requestStartMs += (req.duration ?? 0) + SEED_REQUEST_GAP_MS;
          NETWORK_REQUESTS.push({
            id: nrId++,
            test_runs_case_id: trcIdVal,
            test_run_id: runId,
            method: req.method,
            url: req.url,
            normalized_url: seedNormalizeUrl(req.url),
            status: req.status,
            duration: req.duration ?? null,
            start_time: startTime,
            resource_type: req.resourceType ?? null,
            content_type: req.contentType ?? (req.resourceType === 'document' ? 'text/html' : 'application/json'),
            server_logs: req.serverLogs ?? null,
            server_traces: req.serverTraces ?? null,
          });
        }
      }
    }

    runId++;
  }
}

// ── Serial-group cascade (post-processing, rng-free) ────────────────────────
// Rewrite one story-free-cart checkout run so the first `Cart` test fails and
// the serial group skips the rest — each blocked test linking back (`blocked_by`)
// to the failure. Applied after generation so it can't perturb the deterministic
// rng stream the rest of the seed depends on.
{
  const cartKey = (title) => caseIdByKey.get(`1\x00tests/checkout/cart.spec.ts\x00${title}`);
  const blockerCaseId = cartKey('should add item to cart');
  const blockedCaseIds = CASCADE_BLOCKED_TITLES.map(cartKey);
  const cartCaseIds = new Set([blockerCaseId, ...blockedCaseIds]);

  // Project 1 runs, newest first — the newest run has the smallest id.
  const proj1RunIds = TEST_RUNS.filter((r) => r.project_id === 1)
    .map((r) => r.id)
    .sort((a, b) => a - b);

  for (const targetRunId of proj1RunIds) {
    const cartRows = TEST_RUNS_CASES.filter(
      (row) => row.test_run_id === targetRunId && cartCaseIds.has(row.test_case_id),
    );
    // Only a run where every cart test cleanly passed can host the cascade.
    if (cartRows.length !== cartCaseIds.size) continue;
    if (!cartRows.every((row) => row.status === 'passed' && row.retries === 0)) continue;

    for (const row of cartRows) {
      if (row.test_case_id === blockerCaseId) {
        row.status = 'failed';
        row.error = CASCADE_BLOCKER_ERROR;
        row.attempts = JSON.stringify([
          { retry: 0, status: 'failed', duration: row.duration, startedAt: row.started_at },
        ]);
      } else {
        row.status = 'didnotrun';
        row.duration = 0;
        row.did_not_run_reason = 'previous-failure';
        row.blocked_by = CASCADE_BLOCKER_LOCATION;
        row.attempts = JSON.stringify([{ retry: 0, status: 'didnotrun', duration: 0, startedAt: row.started_at }]);
        // A test that never ran produced no live evidence.
        row.step_events = null;
        row.wasted_time_ms = 0;
        row.web_vitals = null;
        row.page_state = null;
        row.ai_usage = null;
        row.console_logs = null;
        row.test_source_frames = null;
      }
    }

    // Drop the network the blocked (never-run) tests would not have produced.
    const blockedTrcIds = new Set(cartRows.filter((row) => row.test_case_id !== blockerCaseId).map((row) => row.id));
    for (let k = NETWORK_REQUESTS.length - 1; k >= 0; k--) {
      if (blockedTrcIds.has(NETWORK_REQUESTS[k].test_runs_case_id)) NETWORK_REQUESTS.splice(k, 1);
    }

    // Reflect the new outcomes on the run's counters.
    const run = TEST_RUNS.find((r) => r.id === targetRunId);
    run.failed_tests += 1;
    run.did_not_run_tests += blockedCaseIds.length;
    run.passed_tests -= cartCaseIds.size;
    if (run.status === 'passed') run.status = 'failed';
    break;
  }
}

// ── Regression / new-flaky signals ──────────────────────────────────────────
// Mirror the server's computeRegressionSignals: walk each case's executions in
// chronological order; a failure right after a pass is a new regression, and a
// retry-pass right after a clean pass is newly flaky.
{
  const byCase = new Map();
  for (const trc of TEST_RUNS_CASES) {
    if (!byCase.has(trc.test_case_id)) byCase.set(trc.test_case_id, []);
    byCase.get(trc.test_case_id).push(trc);
  }
  for (const rows of byCase.values()) {
    rows.sort((a, b) => a.started_at - b.started_at);
    let prev = null;
    for (const trc of rows) {
      if (trc.status === 'didnotrun') continue;
      if (prev) {
        if (trc.status === 'failed' && prev.status === 'passed') trc.is_new_regression = 1;
        if (trc.status === 'passed' && trc.retries > 0 && prev.status === 'passed' && prev.retries === 0) {
          trc.is_new_flaky = 1;
        }
      }
      prev = trc;
    }
  }
}

// ── Demo media (screenshots, trace, video, visual diff) ────────────────────
// Real binaries live in public/demo/{screenshots,traces,videos} (committed to
// the repo; regenerate with scripts/take-demo-screenshots.mjs and
// scripts/record-demo-media.mjs). Each failure story declares its themed
// evidence files; they are wired to the MOST RECENT failing execution of each
// member case — max(test_runs_cases.id), matching how the cluster detail
// handler picks its evidence row (`recentTestRunsCaseId` in
// shared/handlers/failure-clusters.ts).

const ATTACHMENTS = [];
let attachmentId = reportId;

function fileSize(relPath) {
  try {
    return statSync(new URL(`../public/${relPath}`, import.meta.url)).size;
  } catch {
    console.warn(`⚠ Missing ${relPath} — run the demo media scripts to regenerate it.`);
    return 0;
  }
}

function attach(trc, { type, subtype, label, relPath, metadata = undefined }) {
  ATTACHMENTS.push({
    id: attachmentId++,
    test_runs_case_id: trc.id,
    test_run_id: trc.test_run_id,
    type,
    subtype,
    label,
    path: relPath,
    size: fileSize(relPath),
    ...(metadata !== undefined ? { metadata } : {}),
    created_at: Math.floor(trc.started_at / 1000),
  });
}

/** Most recent execution of a case, optionally filtered. */
function latestTrc(caseId, filter = () => true) {
  let best = null;
  for (const trc of TEST_RUNS_CASES) {
    if (trc.test_case_id !== caseId) continue;
    if (!filter(trc)) continue;
    if (!best || trc.id > best.id) best = trc;
  }
  return best;
}

for (const story of FAILURE_STORIES) {
  const media = story.media ?? {};
  const memberCaseIds = story.failingCases.map((fc) =>
    caseIdByKey.get(`${story.projectId}\x00${story.specFile}\x00${fc.title}`),
  );

  if (media.screenshot) {
    for (const caseId of memberCaseIds) {
      const trc = latestTrc(caseId, (t) => t.failure_cluster_id === story.clusterId);
      if (trc) {
        attach(trc, {
          type: 'attachment',
          subtype: 'screenshot',
          label: 'image/png',
          relPath: `demo/screenshots/${media.screenshot}`,
        });
      }
    }
  }

  const anchorTrc = latestTrc(memberCaseIds[0], (t) => t.failure_cluster_id === story.clusterId);
  if (anchorTrc && media.trace) {
    attach(anchorTrc, { type: 'trace', subtype: 'trace', label: 'trace', relPath: `demo/traces/${media.trace}` });
  }
  if (anchorTrc && media.video) {
    attach(anchorTrc, {
      type: 'attachment',
      subtype: 'video',
      label: 'video/webm',
      relPath: `demo/videos/${media.video}`,
    });
  }
}

// Screenshots on a few PASSING executions, so evidence isn't failure-only and
// the visual diff has a real baseline execution to point at.
const PASSING_SCREENSHOTS = [
  {
    file: 'checkout-order-confirmed.png',
    projectId: 1,
    specFile: 'tests/checkout/checkout.spec.ts',
    title: 'should complete checkout with credit card',
  },
  {
    file: 'checkout-form-filled.png',
    projectId: 1,
    specFile: 'tests/checkout/checkout.spec.ts',
    title: 'should complete checkout with PayPal',
  },
  {
    file: 'cart-summary.png',
    projectId: 1,
    specFile: 'tests/checkout/cart.spec.ts',
    title: 'should display cart total correctly',
  },
  {
    file: 'mobile-form-keyboard.png',
    projectId: 4,
    specFile: 'tests/mobile/forms.spec.ts',
    title: 'Text input shows keyboard on focus',
  },
  { file: 'login-form.png', projectId: 5, specFile: 'tests/admin/login.spec.ts', title: 'signs in with SSO redirect' },
];
const passingShotTrcs = new Map(); // file → trc (for the visual-diff baseline below)
for (const shot of PASSING_SCREENSHOTS) {
  const caseId = caseIdByKey.get(`${shot.projectId}\x00${shot.specFile}\x00${shot.title}`);
  const trc = latestTrc(caseId, (t) => t.status === 'passed');
  if (trc) {
    attach(trc, {
      type: 'attachment',
      subtype: 'screenshot',
      label: 'image/png',
      relPath: `demo/screenshots/${shot.file}`,
    });
    passingShotTrcs.set(shot.file, trc);
  }
}

// ── Demo visual diff ───────────────────────────────────────────────────────
// A real pixelmatch overlay comparing the checkout failure screenshot with the
// passing-state screenshot of the SAME page, generated here (same code path as
// the server) and written to public/demo/screenshots/. The metrics ride the
// files.metadata column so the demo router serves the visual-diff endpoint
// data-driven; the baseline pointers reference the real passing execution the
// baseline screenshot is attached to.
{
  const story = FAILURE_STORIES.find((s) => s.media?.visualDiffBaseline);
  const failingShot = story?.media.screenshot;
  const baselineShot = story?.media.visualDiffBaseline;
  const failingCaseId = story
    ? caseIdByKey.get(`${story.projectId}\x00${story.specFile}\x00${story.failingCases[0].title}`)
    : null;
  const failingTrc = failingCaseId ? latestTrc(failingCaseId, (t) => t.failure_cluster_id === story.clusterId) : null;
  const baselineTrc = baselineShot ? passingShotTrcs.get(baselineShot) : null;

  if (story && failingTrc && baselineTrc) {
    const failingRel = `demo/screenshots/${failingShot}`;
    const baselineRel = `demo/screenshots/${baselineShot}`;
    const overlayRel = 'demo/screenshots/visual-diff-checkout.png';
    try {
      const { default: sharp } = await import('sharp');
      const { default: pixelmatch } = await import('pixelmatch');

      const loadRaw = async (rel) => {
        const abs = new URL(`../public/${rel}`, import.meta.url);
        const { data, info } = await sharp(readFileSync(abs)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return { data: new Uint8Array(data), width: info.width, height: info.height };
      };
      const failing = await loadRaw(failingRel);
      const baseline = await loadRaw(baselineRel);

      const width = Math.max(failing.width, baseline.width);
      const height = Math.max(failing.height, baseline.height);
      const pad = (img) => {
        if (img.width === width && img.height === height) return img.data;
        const out = new Uint8Array(width * height * 4);
        for (let y = 0; y < img.height; y++) {
          out.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * width * 4);
        }
        return out;
      };
      const overlay = new Uint8Array(width * height * 4);
      const changedPixels = pixelmatch(pad(failing), pad(baseline), overlay, width, height, {
        threshold: 0.1,
        includeAA: false,
      });
      const overlayPng = await sharp(Buffer.from(overlay), { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
      // Write beside the other seed artifacts so concurrent generators (e.g. the
      // unit tests) stay inside their PIWI_DEMO_SEED_OUTPUT_DIR instead of
      // rewriting the committed binary.
      const visualDiffPath = join(OUTPUT_DIR, 'screenshots/visual-diff-checkout.png');
      mkdirSync(dirname(visualDiffPath), { recursive: true });
      writeFileSync(visualDiffPath, overlayPng);

      ATTACHMENTS.push({
        id: attachmentId++,
        test_runs_case_id: failingTrc.id,
        test_run_id: failingTrc.test_run_id,
        type: 'visual-diff',
        subtype: 'overlay',
        label: 'Visual diff vs last pass',
        path: overlayRel,
        size: overlayPng.length,
        metadata: {
          changedPixels,
          changedPixelRatio: Math.round((changedPixels / (width * height)) * 10000) / 10000,
          width,
          height,
          dimensionMismatch: failing.width !== baseline.width || failing.height !== baseline.height,
          baselineTestRunsCaseId: baselineTrc.id,
          baselineRunId: baselineTrc.test_run_id,
          failingPath: failingRel,
          baselinePath: baselineRel,
        },
        created_at: Math.floor(failingTrc.started_at / 1000),
      });
    } catch (error) {
      console.warn(`⚠ Could not generate the demo visual diff: ${error}`);
    }
  }
}

// ── Build failure_clusters rows ────────────────────────────────────────────

// Runs are generated newest-first (index 0 is the newest, ids descend as time
// advances), so the first row encountered holds the project's *newest* run and
// the last row its *oldest* — despite the loop-order names below.
const newestRunByProject = {};
const oldestRunByProject = {};
for (const run of TEST_RUNS) {
  if (!(run.project_id in newestRunByProject)) newestRunByProject[run.project_id] = run.id;
  oldestRunByProject[run.project_id] = run.id;
}

const CLUSTER_TRIAGE = {
  1: {
    status: 'open',
    triage_note:
      'Root cause identified: the new payment-provider SDK delays form interactivity on loaded CI runners. A fix landed and the cluster was closed, then regressed — reopened automatically. The fix did not hold; investigating the loaded-runner path again.',
  },
  3: {
    status: 'open',
    triage_note:
      'Investigating — the auth service returns 500 on valid logins since the auth-flow refactor. Server logs show a null dereference in the login handler; fix in review.',
  },
  6: {
    status: 'ignored',
    triage_note:
      'Known issue — three buttons match the unscoped role query on the gallery page. The page intentionally demos multiple variants; the spec needs a name-scoped locator. Not an app bug.',
  },
};

/**
 * Clusters whose fix landed, so the demo shows the loop closing rather than
 * only the failures. All three verdicts appear, because they mean different
 * things: one is corroborated against the diagnosed change, one merely stopped
 * failing (the weaker and more common case), and one did not hold.
 *
 * Cluster 1 is the regression on purpose — it is the cluster a human already
 * marked resolved, so the demo shows triage and evidence disagreeing, which is
 * the reason they are two separate indicators.
 */
const CLUSTER_FIXES = {
  1: { verification: 'regressed', openHours: 14 },
  6: { verification: 'stopped-failing', openHours: 9 },
  10: { verification: 'diagnosis-verified', openHours: 26 },
};

/**
 * The run a fix landed in — a run where the cluster did **not** fail.
 *
 * Runs are generated newest-first, so ids descend as time advances: the run
 * after run 4 is run 3. That inversion is the whole subtlety here.
 *
 * A fix that held landed in the run straight after the cluster's newest
 * failure. A regression is the opposite shape — the cluster went quiet and the
 * failure returned — so its landing run comes from a gap between two failures.
 *
 * Returns null when the cluster still fails in the project's newest run: there
 * is no later run in which anything could have been observed to pass, and
 * claiming a fix anyway is how the demo would end up showing a cluster that is
 * failing and fixed at the same time.
 */
function fixLandedRun(stats, verification, newestRunIdOfProject) {
  if (verification === 'regressed') {
    for (let i = 0; i < stats.failedRuns.length - 1; i++) {
      const newer = stats.failedRuns[i];
      const older = stats.failedRuns[i + 1];
      // More than one id apart means a run in between with no failure.
      if (older.runId - newer.runId > 1) {
        return { runId: newer.runId + 1, startMs: Math.round((newer.startMs + older.startMs) / 2) };
      }
    }
    return null;
  }

  if (stats.lastRunId === null || stats.lastRunId <= newestRunIdOfProject) return null;
  return { runId: stats.lastRunId - 1, startMs: stats.lastStartMs };
}

/** The resolution columns for a cluster, or nothing when no fix can be placed. */
function buildClusterFix(story, stats) {
  const fix = CLUSTER_FIXES[story.clusterId];
  if (!fix) return {};

  const landed = fixLandedRun(stats, fix.verification, newestRunByProject[story.projectId]);
  if (!landed) throw new Error(`Cluster ${story.clusterId} has no run a fix could have landed in`);

  return {
    fix_landed_run_id: landed.runId,
    fix_landed_at: Math.floor(landed.startMs / 1000),
    fix_commit: `demo${String(story.clusterId).padStart(3, '0')}`,
    time_to_resolution_ms: fix.openHours * 3600 * 1000,
    fix_verification: fix.verification,
  };
}

for (const story of FAILURE_STORIES) {
  const stats = clusterStats[story.clusterId];
  const fp = storyFingerprints.get(story.clusterId);
  const triage = CLUSTER_TRIAGE[story.clusterId] || {};
  const createdAt = stats.firstStartMs ? Math.floor(stats.firstStartMs / 1000) : ts('2025-04-20T09:00:00');
  const updatedAt = stats.lastStartMs ? Math.floor(stats.lastStartMs / 1000) : createdAt;
  FAILURE_CLUSTERS.push({
    id: story.clusterId,
    project_id: story.projectId,
    fingerprint: fp.fingerprint,
    signature: fp.signature,
    error_type: fp.errorType,
    selector: fp.selector,
    sample_error: story.failingCases[0].error,
    status: triage.status || 'open',
    triage_note: triage.triage_note || null,
    // A cluster that never fired falls back to the project's run span: first
    // seen = oldest run (highest id), last seen = newest run (lowest id).
    first_seen_run_id: stats.firstRunId ?? oldestRunByProject[story.projectId],
    last_seen_run_id: stats.lastRunId ?? newestRunByProject[story.projectId],
    occurrences: stats.occurrences || 1,
    ...buildClusterFix(story, stats),
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

// ── Demo inbox state — assignee + snooze so the inbox queues are exercisable ──
// The failure inbox's Mine queue matches the signed-in user; assigning an open
// cluster to the default demo user (Avery) gives that queue a row. One open
// cluster is snoozed "until it recurs" so the snooze state, its "Unsnooze"
// action on the cluster page, and the fact that a snoozed cluster leaves every
// queue are all demonstrable. A far-future deadline keeps it snoozed regardless
// of the time-shift applied to the rest of the seed.
{
  const clusterById = new Map(FAILURE_CLUSTERS.map((c) => [c.id, c]));
  const assignMine = clusterById.get(7);
  if (assignMine) assignMine.assignee = DEMO_USERS[0].name;
  const snoozed = clusterById.get(9);
  if (snoozed) {
    snoozed.snoozed_until = Math.floor(Date.UTC(9999, 0, 1) / 1000);
    snoozed.snooze_mode = 'until-recurs';
  }
}

// ── Demo merge suggestions ─────────────────────────────────────────────────
// Two pending pairs (one LLM-judged, one embedding) so the list and both
// actions are exercisable, plus one rejected pair that demonstrates a
// dismissed suggestion. Each pair shares a project; cluster_a_id <
// cluster_b_id as the unique pair index requires.
const MERGE_SUGGESTIONS = [
  {
    id: 1,
    project_id: 2,
    cluster_a_id: 3,
    cluster_b_id: 4,
    score: 0.87,
    method: 'llm',
    llm_confidence: 'high',
    llm_reason:
      'Both failures surface HTTP 5xx responses from the same service tier; the error signatures differ only by endpoint.',
    status: 'pending',
    created_at: ts('2025-04-24T10:00:00'),
    updated_at: ts('2025-04-24T10:00:00'),
  },
  {
    id: 2,
    project_id: 3,
    cluster_a_id: 5,
    cluster_b_id: 6,
    score: 0.74,
    method: 'embedding',
    llm_confidence: null,
    llm_reason: null,
    status: 'pending',
    created_at: ts('2025-04-23T14:30:00'),
    updated_at: ts('2025-04-23T14:30:00'),
  },
  {
    id: 3,
    project_id: 1,
    cluster_a_id: 1,
    cluster_b_id: 2,
    score: 0.58,
    method: 'llm',
    llm_confidence: 'low',
    llm_reason:
      'One failure is a click timeout, the other a renamed field — different root-cause families despite sharing the checkout spec.',
    status: 'rejected',
    created_at: ts('2025-04-22T09:00:00'),
    updated_at: ts('2025-04-22T09:00:00'),
  },
];

// ── Demo quarantine ───────────────────────────────────────────────────────
// Three entries covering the states the tab exists to distinguish: one that has
// earned its way out, one part-way through its streak, and one still failing.
// Without all three the exit ramp looks like a list that only grows.
const QUARANTINED_TESTS = [];
{
  // Runs after the anchor count toward the streak; 4 seeded passes land the
  // entry at "4 / 5" — part-way through the exit ramp, not yet ready.
  const PARTIAL_QUARANTINE_STREAK_RUNS = 4;
  const quarantineSpec = [
    { projectId: 1, streakState: 'ready', reason: 'Times out on CI only — see cluster 1' },
    { projectId: 2, streakState: 'partial', reason: 'Search index warm-up races the assertion' },
    { projectId: 3, streakState: 'failing', reason: 'Pagination flakes under parallel load' },
  ];

  let qId = 1;
  for (const spec of quarantineSpec) {
    const flaky = FLAKY_CASES[spec.projectId];
    if (!flaky) continue;
    const proj = DEMO_PROJECTS.find((candidate) => candidate.id === spec.projectId);
    const caseDef = proj?.cases.find((candidate) => candidate.title === flaky.title);
    if (!caseDef) continue;
    const caseId = caseIdByKey.get(`${spec.projectId}\x00${caseDef.file}\x00${caseDef.title}`);
    if (!caseId) continue;

    // The streak counts executions on runs after the anchor (id > anchor), and
    // ids descend as time advances in the seed, so an anchor on the newest run
    // makes every seeded execution count (release-ready) and an anchor on the
    // oldest run counts none (still failing). The partial entry anchors a few
    // runs short of the oldest so only a handful of passes accumulate.
    const anchorRunId =
      spec.streakState === 'failing'
        ? (oldestRunByProject[spec.projectId] ?? null)
        : spec.streakState === 'partial'
          ? Number(oldestRunByProject[spec.projectId]) - PARTIAL_QUARANTINE_STREAK_RUNS || null
          : (newestRunByProject[spec.projectId] ?? null);

    QUARANTINED_TESTS.push({
      id: qId++,
      project_id: spec.projectId,
      test_case_id: caseId,
      reason: spec.reason,
      source: spec.streakState === 'ready' ? 'proposed' : 'manual',
      quarantined_at_run_id: anchorRunId,
      created_by: null,
      created_at: ts('2025-05-02T09:00:00'),
      released_at: null,
      released_reason: null,
    });
  }

  // A quarantined test whose cluster's fix has verified — the inbox's
  // "Quarantine ready" queue: the failures stopped, so the quarantine is safe to
  // lift. Anchored at that cluster's newest run so the demo shows it release-ready.
  {
    const story = FAILURE_STORIES.find((s) => s.clusterId === 10);
    const failing = story?.failingCases?.[0];
    const caseId = story && failing && caseIdByKey.get(`${story.projectId}\x00${story.specFile}\x00${failing.title}`);
    if (caseId) {
      QUARANTINED_TESTS.push({
        id: qId++,
        project_id: story.projectId,
        test_case_id: caseId,
        reason: 'Held while the pagination fix was verified; the fix landed and held.',
        source: 'manual',
        quarantined_at_run_id: newestRunByProject[story.projectId] ?? null,
        created_by: null,
        created_at: ts('2025-05-02T09:00:00'),
        released_at: null,
        released_reason: null,
      });
    }
  }
}

// ── Demo AI diagnoses ─────────────────────────────────────────────────────
// Five clusters ship with a stored diagnosis; the rest are intentionally left
// undiagnosed so a demo visitor can trigger a live (simulated) streaming
// diagnosis themselves. Patches and suspect commits come from the story
// fixtures, so `patchValidation` genuinely reports "applies" and every cited
// commit exists in the canned SCM history.

const storyFix = (clusterId) => {
  const story = FAILURE_STORIES.find((s) => s.clusterId === clusterId);
  return {
    description: story.diagnosis.fix.description,
    file: story.diagnosis.fix.file,
    code: null,
    patch: story.diagnosis.fix.patch,
  };
};
const storySuspect = (clusterId) => [FAILURE_STORIES.find((s) => s.clusterId === clusterId).suspectSha];

// Two-stage pipeline token accounting shared by all seeded diagnoses.
const demoPipeline = (input, output) => [
  {
    role: 'research',
    model: 'demo-research',
    inputTokens: Math.round(input * 0.6),
    outputTokens: 180,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  },
  {
    role: 'diagnosis',
    model: 'demo-simulated',
    inputTokens: input,
    outputTokens: output,
    cacheCreationInputTokens: Math.round(input * 0.4),
    cacheReadInputTokens: Math.round(input * 0.5),
  },
];
// A patch that cleanly applies against the seeded source files (app/demo/demo-scm.ts).
const appliesPatch = { status: 'applies', filesChecked: 1, filesInPatch: 1, errors: [] };

/** A diagnosis is written shortly after its cluster's latest occurrence. */
const diagnosisTs = (clusterId, minutes) => {
  const cluster = FAILURE_CLUSTERS.find((c) => c.id === clusterId);
  return cluster.updated_at + minutes * 60;
};

const FAILURE_DIAGNOSES = [
  {
    id: 1,
    cluster_id: 1,
    scope: 'cluster',
    status: 'completed',
    provider: 'demo',
    model: 'demo-simulated',
    category: 'infrastructure',
    confidence: 'high',
    summary:
      'Checkout Pay button click times out — the payment form renders slowly on CI and the click races the render.',
    root_cause:
      'The click is interrupted by the 30 000 ms test timeout because the Pay button is present but not yet interactive. A recent commit added a third-party payment SDK fetched before the form is enabled; on a loaded CI runner that pushes interactivity past the timeout. Combined with CI variability this fails intermittently.',
    details: JSON.stringify({
      confidenceScore: 82,
      severity: 'high',
      affectedArea: 'checkout / payment',
      hypotheses: [
        {
          category: 'infrastructure',
          likelihood: 82,
          rootCause:
            'Slow CI runner renders the payment form too late; the click exceeds the 30s test timeout before the button becomes interactive.',
          evidence: [
            'Failure rate correlates with high-load CI runs [recurrenceFlakiness]',
            'The call log shows the button resolved but disabled at click time [executionError]',
          ],
        },
        {
          category: 'test-bug',
          likelihood: 38,
          rootCause: 'The payment helper clicks without an explicit wait for the quote to resolve.',
          evidence: ['No waitForLoadState/waitFor precedes the click in fillPaymentDetails [testSource]'],
        },
      ],
      evidence: [
        'The test timeout interrupts locator.click in both affected tests [executionError]',
        'The SCM diff adds a third-party payment SDK fetched before the form is enabled [scmInvestigation]',
        'The checkout quote request takes 28s on failing runs [networkRequests]',
        'The full call stack from the trace pins the timeout inside the checkout flow helper [traceCallStack]',
        'Recurs on high-load CI runs [recurrenceFlakiness]',
      ],
      investigationSteps: [
        'Re-run the cluster on a low-load runner to confirm CI variability is the driver',
        'Check whether the payment form fires a network-idle event before becoming interactive',
      ],
      preventionTips: [
        'Await page.waitForLoadState("networkidle") before interacting with dynamically loaded payment forms',
        'Add a CI-aware timeout multiplier for payment-related actions',
      ],
      suggestedFix: storyFix(1),
      patchValidation: appliesPatch,
      pipeline: demoPipeline(1240, 380),
      autoSelectedCommits: storySuspect(1),
      selectedCommitShas: null,
      additionalContext: null,
    }),
    error: null,
    input_tokens: 1984,
    output_tokens: 560,
    duration_ms: 2850,
    created_at: diagnosisTs(1, 42),
    updated_at: diagnosisTs(1, 42),
  },
  {
    id: 2,
    cluster_id: 3,
    scope: 'cluster',
    status: 'completed',
    provider: 'demo',
    model: 'demo-simulated',
    category: 'app-bug',
    confidence: 'high',
    summary: 'POST /auth/login returns HTTP 500 — the login handler dereferences a null user after the auth refactor.',
    root_cause:
      'The assertion fails because the endpoint responds 500 instead of 200. A recent auth refactor changed verifyCredentials to return null (rather than throw) for a missing user, and the login handler then reads user.id on the null path — an unhandled exception that surfaces as a 500.',
    details: JSON.stringify({
      confidenceScore: 90,
      severity: 'blocker',
      affectedArea: 'authentication / login',
      hypotheses: [
        {
          category: 'app-bug',
          likelihood: 90,
          rootCause:
            'The login handler dereferences a null user after the auth refactor, throwing and returning HTTP 500.',
          evidence: [
            'Expected 200 / Received 500 in two separate auth test cases [executionError]',
            'Backend server logs show an unhandled TypeError on the request [serverLogs]',
            'The failure started after the auth refactor commit [scmInvestigation]',
          ],
        },
      ],
      evidence: [
        'Received 500 where 200 was expected across two auth tests [executionError]',
        'Server logs capture the 5xx and the null-dereference stack on the failing request [serverLogs]',
        'Began appearing after the "simplify auth flow" commit [scmInvestigation]',
      ],
      investigationSteps: [
        'Inspect the server stack trace behind the 500 on POST /auth/login',
        'Confirm the null-user branch in the refactored handler',
      ],
      preventionTips: [
        'Add integration tests that exercise the auth endpoint with missing/invalid users',
        'Add error monitoring on 5xx responses for the /auth/login route',
      ],
      suggestedFix: storyFix(3),
      patchValidation: appliesPatch,
      pipeline: demoPipeline(980, 310),
      autoSelectedCommits: storySuspect(3),
      selectedCommitShas: null,
      additionalContext: null,
    }),
    error: null,
    input_tokens: 1568,
    output_tokens: 490,
    duration_ms: 2100,
    created_at: diagnosisTs(3, 35),
    updated_at: diagnosisTs(3, 35),
  },
  {
    id: 3,
    cluster_id: 6,
    scope: 'cluster',
    status: 'completed',
    provider: 'demo',
    model: 'demo-simulated',
    category: 'test-flakiness',
    confidence: 'medium',
    summary:
      "Strict-mode violation — getByRole('button') matches multiple button variants rendered on the components page.",
    root_cause:
      "getByRole('button') resolves to 3 elements because the components page now renders primary, disabled and loading variants side by side (added in a recent commit). Playwright's strict mode throws on the ambiguous match; the locator needs scoping by name or container.",
    details: JSON.stringify({
      confidenceScore: 66,
      severity: 'medium',
      affectedArea: 'UI components / button',
      hypotheses: [
        {
          category: 'test-bug',
          likelihood: 66,
          rootCause:
            "getByRole('button') matches 3 rendered button variants; the locator must be scoped by name or container.",
          evidence: [
            'Strict-mode violation resolving to multiple elements [executionError]',
            'The ARIA snapshot shows several button nodes on the page [ariaSnapshot]',
            'Locator healing offers a scoped, higher-stability alternative [locatorHealing]',
          ],
        },
      ],
      evidence: [
        'Deterministic strict-mode violation, not intermittent [recurrenceFlakiness]',
        'Three button elements rendered by design (primary, disabled, loading) [ariaSnapshot]',
        'A name-scoped locator disambiguates the match [locatorHealing]',
      ],
      investigationSteps: [
        'Confirm the page intentionally renders multiple button variants',
        'Pick a scoping strategy (name filter or container) with the component owner',
      ],
      preventionTips: [
        'Scope locators to a container when multiple matches are expected',
        'Add data-testid attributes to disambiguate similar components',
      ],
      suggestedFix: storyFix(6),
      patchValidation: appliesPatch,
      pipeline: demoPipeline(870, 290),
      autoSelectedCommits: storySuspect(6),
      selectedCommitShas: null,
      additionalContext: null,
    }),
    error: null,
    input_tokens: 1392,
    output_tokens: 470,
    duration_ms: 1950,
    created_at: diagnosisTs(6, 55),
    updated_at: diagnosisTs(6, 55),
  },
  {
    id: 4,
    cluster_id: 7,
    scope: 'cluster',
    status: 'completed',
    provider: 'demo',
    model: 'demo-simulated',
    category: 'infrastructure',
    confidence: 'high',
    summary:
      'Mobile page navigation times out — page.goto exceeds 30s on Mobile Safari because the landing page ships a heavy hero image.',
    root_cause:
      'page.goto exceeds the 30 000 ms navigation timeout during the initial load. A recent commit added a full-bleed, unoptimized hero image; on throttled mobile CI networks the load never completes inside the default timeout.',
    details: JSON.stringify({
      confidenceScore: 78,
      severity: 'high',
      affectedArea: 'mobile navigation',
      hypotheses: [
        {
          category: 'infrastructure',
          likelihood: 78,
          rootCause: 'Heavy unoptimized assets push mobile page load past the goto timeout on CI networks.',
          evidence: [
            'Timeout occurs on the main navigation load, not a later interaction [executionError]',
            'Only affects the Mobile Safari browser profile [browserDistribution]',
          ],
        },
        {
          category: 'environment',
          likelihood: 34,
          rootCause: 'CI network throttling specific to the mobile project profile.',
          evidence: ['The hero image request alone takes ~28s on failing runs [networkRequests]'],
        },
      ],
      evidence: [
        'page.goto TimeoutError on the main navigation load [executionError]',
        'Only the Mobile Safari profile is affected [browserDistribution]',
        'The SCM diff adds a large full-bleed hero image [scmInvestigation]',
      ],
      investigationSteps: [
        'Measure page weight and largest-contentful-paint on the mobile profile',
        'Compare goto timing on local mobile emulation vs CI',
      ],
      preventionTips: [
        'Set browser-specific navigation timeouts via Playwright config projects',
        'Optimize landing-page assets for mobile (responsive images, lazy-loading)',
      ],
      suggestedFix: storyFix(7),
      patchValidation: appliesPatch,
      pipeline: demoPipeline(1100, 340),
      autoSelectedCommits: storySuspect(7),
      selectedCommitShas: null,
      additionalContext: null,
    }),
    error: null,
    input_tokens: 1760,
    output_tokens: 520,
    duration_ms: 2650,
    created_at: diagnosisTs(7, 48),
    updated_at: diagnosisTs(7, 48),
  },
  {
    id: 5,
    cluster_id: 10,
    scope: 'cluster',
    status: 'completed',
    provider: 'demo',
    model: 'demo-simulated',
    category: 'app-bug',
    confidence: 'high',
    summary:
      'Users table renders 50 rows instead of 25 — server-driven pagination shipped with the API default page size.',
    root_cause:
      'The row-count assertion fails deterministically: the users endpoint now returns 50 rows per page. The server-driven pagination change replaced the dashboard page size (25) with the API default (50), so the table renders two pages worth of rows and the test correctly catches the regression.',
    details: JSON.stringify({
      confidenceScore: 88,
      severity: 'medium',
      affectedArea: 'users table / pagination',
      hypotheses: [
        {
          category: 'app-bug',
          likelihood: 88,
          rootCause:
            'listUsers now queries with PAGE_SIZE 50 — the API default — instead of the dashboard page size 25.',
          evidence: [
            'Expected 26 rows (header + 25), received 51 — exactly two pages plus the header [executionError]',
            'The users API request returns 50 records [networkRequests]',
            'The pagination change shipped in the suspect commit [scmInvestigation]',
          ],
        },
        {
          category: 'test-bug',
          likelihood: 20,
          rootCause: 'The new page size is intentional and the expected count is stale.',
          evidence: ['No product note accompanies the page-size change [scmInvestigation]'],
        },
      ],
      evidence: [
        'Deterministic 26-vs-51 row count mismatch [executionError]',
        'GET /api/users?page=1 returns 50 records on failing runs [networkRequests]',
        'The "server-driven pagination" commit changed PAGE_SIZE from 25 to 50 [scmInvestigation]',
      ],
      investigationSteps: [
        'Confirm the intended dashboard page size with the design system (table density assumes 25)',
        'Check other tables consuming the same endpoint for the same regression',
      ],
      preventionTips: [
        'Keep page-size constants in one shared module consumed by both API and UI',
        'Assert on user-visible pagination controls in addition to raw row counts',
      ],
      suggestedFix: storyFix(10),
      patchValidation: appliesPatch,
      pipeline: demoPipeline(1010, 330),
      autoSelectedCommits: storySuspect(10),
      selectedCommitShas: null,
      additionalContext: null,
    }),
    error: null,
    input_tokens: 1620,
    output_tokens: 505,
    duration_ms: 2240,
    created_at: diagnosisTs(10, 38),
    updated_at: diagnosisTs(10, 38),
  },
];

// Diagnosis version history — a snapshot of an earlier, lower-confidence take on
// cluster 1 that was superseded when the SCM diff revealed the payment SDK. Powers
// the "previous versions" dropdown on the cluster diagnosis panel.
const FAILURE_DIAGNOSIS_VERSIONS = [
  {
    id: 1,
    diagnosis_id: 1,
    cluster_id: 1,
    scope: 'cluster',
    test_runs_case_id: null,
    status: 'completed',
    provider: 'demo',
    model: 'demo-simulated',
    category: 'test-bug',
    confidence: 'medium',
    summary: 'Earlier take: likely a missing explicit wait in the payment helper before the Pay click.',
    root_cause:
      'Initial assessment attributed the timeout purely to a missing explicit wait in the payment helper, before the SCM diff surfaced the newly added third-party payment SDK that delays interactivity.',
    details: JSON.stringify({
      confidenceScore: 58,
      severity: 'medium',
      affectedArea: 'checkout / payment',
      hypotheses: [
        {
          category: 'test-bug',
          likelihood: 58,
          rootCause: 'The helper clicks the Pay button without waiting for it to become interactive.',
          evidence: ['No waitFor precedes the click [testSource]'],
        },
      ],
      evidence: ['Intermittent timeouts on locator.click [recurrenceFlakiness]'],
      investigationSteps: ['Check CI load at failure time'],
      preventionTips: ['Await the target before interacting'],
      suggestedFix: {
        description: 'Add an explicit wait before clicking the Pay button.',
        file: 'tests/helpers/payment.ts',
        code: null,
        patch: null,
      },
    }),
    error: null,
    input_tokens: 640,
    output_tokens: 210,
    duration_ms: 1700,
    context_sha: null,
    created_at: diagnosisTs(1, -540),
  },
];

// ── Entity links ────────────────────────────────────────────────────────────
const ENTITY_LINKS = [
  {
    id: 1,
    test_run_id: 1,
    test_runs_case_id: null,
    test_case_id: null,
    url: 'https://example.atlassian.net/browse/PROJ-123',
    provider: 'jira',
    key: 'PROJ-123',
    title: 'Checkout flow improvements',
    status_text: null,
    status_color: null,
    metadata: null,
    unfurled_at: null,
    created_by: null,
    // entity_links.created_at/updated_at are timestamp_ms columns — store ms.
    created_at: ts('2025-04-25T08:30:00') * 1000,
    updated_at: ts('2025-04-25T08:30:00') * 1000,
  },
  {
    id: 2,
    test_run_id: null,
    test_runs_case_id: null,
    test_case_id: 1,
    url: 'https://github.com/example/shop-web/issues/456',
    provider: 'github-issue',
    key: '#456',
    title: 'Fix credit card checkout timeout',
    status_text: 'open',
    status_color: 'neutral',
    metadata: null,
    unfurled_at: null,
    created_by: null,
    created_at: ts('2025-04-24T10:00:00') * 1000,
    updated_at: ts('2025-04-24T10:00:00') * 1000,
  },
  {
    id: 3,
    test_run_id: null,
    test_runs_case_id: 5,
    test_case_id: null,
    url: 'https://linear.app/team/issue/TEAM-789/paypal-issue',
    provider: 'linear',
    key: 'TEAM-789',
    title: 'PayPal sandbox timeout investigation',
    status_text: null,
    status_color: null,
    metadata: null,
    unfurled_at: null,
    created_by: null,
    created_at: ts('2025-04-25T09:00:00') * 1000,
    updated_at: ts('2025-04-25T09:00:00') * 1000,
  },
];

// ── Users & project assignments (affectations) ─────────────────────────────
// Seed the canonical demo identities so the project affectation feature is
// usable in the demo (the "act as" switcher in the banner picks one of these).
const USERS = DEMO_USERS.map((u) => ({
  id: u.id,
  username: u.username,
  password: '', // demo identities are switched client-side, never logged in
  role: u.role,
  name: u.name,
  email: u.email,
  email_verified: 1,
  created_at: ts('2025-02-01'),
  updated_at: ts('2025-02-01'),
}));

const PROJECT_ASSIGNMENTS = [];
let assignmentId = 1;
const assignmentCreatedAt = new Date('2025-02-10').getTime(); // timestamp_ms column
for (const u of DEMO_USERS) {
  // Administrators have implicit access to all projects — no assignment rows.
  if (u.role === 'administrator') continue;
  if (u.assignment.global) {
    PROJECT_ASSIGNMENTS.push({
      id: assignmentId++,
      user_id: u.id,
      project_id: null,
      created_by: null,
      created_at: assignmentCreatedAt,
    });
  } else {
    for (const projectId of u.assignment.projectIds) {
      PROJECT_ASSIGNMENTS.push({
        id: assignmentId++,
        user_id: u.id,
        project_id: projectId,
        created_by: null,
        created_at: assignmentCreatedAt,
      });
    }
  }
}

// ── Locator healing snapshots ───────────────────────────────────────────────
// One row per (test_case_id, location) — the same schema as the live server.
// Locations are the real call sites in the fixture sources: the failing
// locators' rows sit exactly where the error's innermost stack frame points
// (`extractErrorLocation` takes the first frame), so the healing ladder's
// exact-location rung hits. `last_seen_*` comes from the actual generated run
// history: a failing locator was last captured on the case's most recent
// PASSING execution; locators that still succeed update on every execution.
function locatorSig(method, strings) {
  return createHash('sha256')
    .update(`${method} ${JSON.stringify(strings)}`, 'utf-8')
    .digest('hex');
}

/** `file:line:col` for a call in an authored fixture source. */
function callSite(file, needle, column, nth = 0) {
  return `${file}:${lineOf(SOURCE_FILES[file], needle, nth)}:${column}`;
}

/** last_seen fields from a case's most recent execution matching `filter`. */
function lastSeen(projectId, specFile, title, filter) {
  const caseId = caseIdByKey.get(`${projectId}\x00${specFile}\x00${title}`);
  const trc = latestTrc(caseId, filter);
  return trc
    ? { last_seen_run_id: trc.test_run_id, last_seen_at: trc.started_at }
    : { last_seen_run_id: null, last_seen_at: BASE_START_MS };
}
const seenOnPass = (pid, file, title) => lastSeen(pid, file, title, (t) => t.status === 'passed');
const seenOnRun = (pid, file, title) => lastSeen(pid, file, title, (t) => t.status !== 'didnotrun');

// Shared alternative lists — each sorted descending by stability score.
const ALT_CHECKOUT_PAY = [
  { locator: "getByTestId('checkout-pay')", method: 'getByTestId', args: { testId: 'checkout-pay' }, score: 100 },
  {
    locator: "getByRole('button', { name: 'Pay now' })",
    method: 'getByRole',
    args: { role: 'button', name: 'Pay now' },
    score: 90,
  },
  { locator: "getByText('Pay now')", method: 'getByText', args: { text: 'Pay now' }, score: 75 },
  { locator: "locator('#checkout-pay')", method: 'locator', args: { selector: '#checkout-pay' }, score: 65 },
];

const ALT_CHECKOUT_EMAIL = [
  { locator: "getByTestId('email-input')", method: 'getByTestId', args: { testId: 'email-input' }, score: 100 },
  { locator: "getByLabel('Email address')", method: 'getByLabel', args: { label: 'Email address' }, score: 85 },
  {
    locator: "getByPlaceholder('your@email.com')",
    method: 'getByPlaceholder',
    args: { placeholder: 'your@email.com' },
    score: 80,
  },
  { locator: "locator('#checkout-email')", method: 'locator', args: { selector: '#checkout-email' }, score: 65 },
];

// Alternatives for the email field that later fails on a label rename (cluster
// #2's showcase). Unlike ALT_CHECKOUT_EMAIL this field has NO data-testid of its
// own — so capture generates an ancestor-scoped alternative (72) from the
// per-field `email-field` wrapper. When the label changes, the two name-based
// alternatives (90/85) go stale and healing recommends the anchored one.
const ALT_CHECKOUT_EMAIL_RENAMED = [
  {
    locator: "getByRole('textbox', { name: 'Email address' })",
    method: 'getByRole',
    args: { role: 'textbox', name: 'Email address' },
    score: 90,
  },
  { locator: "getByLabel('Email address')", method: 'getByLabel', args: { label: 'Email address' }, score: 85 },
  {
    locator: "getByTestId('email-field').getByRole('textbox')",
    method: 'getByRole',
    args: { role: 'textbox', anchorTestId: 'email-field' },
    score: 72,
  },
  { locator: "locator('#checkout-email')", method: 'locator', args: { selector: '#checkout-email' }, score: 65 },
];

const ALT_CARD_NUMBER = [
  { locator: "getByTestId('card-number')", method: 'getByTestId', args: { testId: 'card-number' }, score: 100 },
  { locator: "getByLabel('Card number')", method: 'getByLabel', args: { label: 'Card number' }, score: 85 },
  {
    locator: "getByPlaceholder('1234 5678 9012 3456')",
    method: 'getByPlaceholder',
    args: { placeholder: '1234 5678 9012 3456' },
    score: 80,
  },
  { locator: "locator('#card-number')", method: 'locator', args: { selector: '#card-number' }, score: 65 },
];

const ALT_CARD_EXPIRY = [
  { locator: "getByTestId('card-expiry')", method: 'getByTestId', args: { testId: 'card-expiry' }, score: 100 },
  { locator: "getByLabel('Expiry date')", method: 'getByLabel', args: { label: 'Expiry date' }, score: 85 },
  { locator: "getByPlaceholder('MM / YY')", method: 'getByPlaceholder', args: { placeholder: 'MM / YY' }, score: 80 },
];

const ALT_PAYPAL_BTN = [
  { locator: "getByTestId('paypal-btn')", method: 'getByTestId', args: { testId: 'paypal-btn' }, score: 100 },
  {
    locator: "getByRole('button', { name: 'Continue with PayPal' })",
    method: 'getByRole',
    args: { role: 'button', name: 'Continue with PayPal' },
    score: 90,
  },
  {
    locator: "getByText('Continue with PayPal')",
    method: 'getByText',
    args: { text: 'Continue with PayPal' },
    score: 75,
  },
  { locator: "locator('.paypal-button')", method: 'locator', args: { selector: '.paypal-button' }, score: 30 },
];

const ALT_CART_REMOVE = [
  { locator: "getByTestId('remove-item-btn')", method: 'getByTestId', args: { testId: 'remove-item-btn' }, score: 100 },
  {
    locator: "getByRole('button', { name: 'Remove' })",
    method: 'getByRole',
    args: { role: 'button', name: 'Remove' },
    score: 90,
  },
  { locator: "getByText('Remove')", method: 'getByText', args: { text: 'Remove' }, score: 75 },
  { locator: "locator('.cart-item-remove')", method: 'locator', args: { selector: '.cart-item-remove' }, score: 30 },
];

const ALT_FULL_NAME = [
  { locator: "getByTestId('fullname-input')", method: 'getByTestId', args: { testId: 'fullname-input' }, score: 100 },
  { locator: "getByLabel('Full name')", method: 'getByLabel', args: { label: 'Full name' }, score: 85 },
  {
    locator: "getByPlaceholder('John Smith')",
    method: 'getByPlaceholder',
    args: { placeholder: 'John Smith' },
    score: 80,
  },
  { locator: "locator('#full-name')", method: 'locator', args: { selector: '#full-name' }, score: 65 },
];

const ALT_SAVE_ADDRESS = [
  {
    locator: "getByTestId('save-address-btn')",
    method: 'getByTestId',
    args: { testId: 'save-address-btn' },
    score: 100,
  },
  {
    locator: "getByRole('button', { name: 'Save address' })",
    method: 'getByRole',
    args: { role: 'button', name: 'Save address' },
    score: 90,
  },
  { locator: "getByText('Save address')", method: 'getByText', args: { text: 'Save address' }, score: 75 },
];

// Button strict-mode: the test called getByRole('button') without a name filter,
// resolving to 3 elements (Primary / Disabled / Loading…). Alternatives narrow
// the selector to the primary variant — the same one the diagnosis patch and
// the ARIA snapshot name.
const ALT_BUTTON_STRICT = [
  { locator: "getByTestId('primary-btn')", method: 'getByTestId', args: { testId: 'primary-btn' }, score: 100 },
  {
    locator: "getByRole('button', { name: 'Primary' })",
    method: 'getByRole',
    args: { role: 'button', name: 'Primary' },
    score: 90,
  },
  { locator: "getByText('Primary')", method: 'getByText', args: { text: 'Primary' }, score: 75 },
  { locator: "locator('.btn-primary')", method: 'locator', args: { selector: '.btn-primary' }, score: 30 },
];

const PAY_CLICK_SITE = storyByClusterId(1).captureLocation;
const EMAIL_FILL_SITE = storyByClusterId(2).captureLocation;
const BUTTON_CLICK_SITE = storyByClusterId(6).captureLocation;
const EXPORT_ASSERT_SITE = storyByClusterId(9).captureLocation;

const ALT_EXPORT_CSV = [
  {
    locator: "getByRole('button', { name: 'Export CSV' })",
    method: 'getByRole',
    args: { role: 'button', name: 'Export CSV' },
    score: 90,
  },
  { locator: "getByText('Export CSV')", method: 'getByText', args: { text: 'Export CSV' }, score: 75 },
  { locator: "locator('.export-btn')", method: 'locator', args: { selector: '.export-btn' }, score: 40 },
];

let lsId = 1;
const LOCATOR_SNAPSHOTS = [
  // ── Cluster #1: checkout Pay button (test_case_ids 1 & 2) ─────────────────
  // The click lives in the shared payment helper, so both checkout cases carry
  // a snapshot keyed at the SAME helper call site — exactly where the error's
  // innermost frame points, so the exact-location rung matches immediately.
  ...[
    ['should complete checkout with credit card', 1],
    ['should complete checkout with PayPal', 2],
  ].map(([title, testCaseId]) => ({
    id: lsId++,
    test_case_id: testCaseId,
    location: PAY_CLICK_SITE,
    used_method: 'getByRole',
    used_args: ['button', { name: 'Pay' }],
    used_args_fp: locatorSig('getByRole', ['button', 'Pay']),
    element_tag: 'button',
    element_attrs: {
      id: 'checkout-pay',
      'data-testid': 'checkout-pay',
      accessibleName: 'Pay now',
      center: { x: 640, y: 820 },
    },
    element_text: 'Pay now',
    alternatives: ALT_CHECKOUT_PAY,
    ...seenOnPass(1, 'tests/checkout/checkout.spec.ts', title),
  })),

  // ── Cluster #2: renamed email label (test_case_id 3) ──────────────────────
  // The last passing run captured the email field at its call site; the field
  // has an id and sits inside a per-field `email-field` wrapper (so an
  // ancestor-scoped locator is unique) but no data-testid of its own. When the
  // label later changes, healing flags the name-based alternatives as stale and
  // recommends the surviving `getByTestId('email-field').getByRole('textbox')`.
  {
    id: lsId++,
    test_case_id: 3,
    location: EMAIL_FILL_SITE,
    used_method: 'getByLabel',
    used_args: ['Email address'],
    used_args_fp: locatorSig('getByLabel', ['Email address']),
    element_tag: 'input',
    element_attrs: {
      type: 'email',
      id: 'checkout-email',
      accessibleName: 'Email address',
      center: { x: 640, y: 300 },
      // Captured when the checkout step had four form fields; at failure time
      // the step is restructured (email replaced), so the same-role count no
      // longer matches and no confident rename is possible → stale.
      rolePosition: { role: 'textbox', count: 4, index: 0 },
      ancestors: [
        {
          tag: 'div',
          depth: 1,
          testId: 'email-field',
          role: null,
          ariaLabel: null,
          scopedRoleCount: 1,
          testIdCount: 1,
        },
        {
          tag: 'form',
          depth: 2,
          testId: 'checkout-form',
          role: null,
          ariaLabel: null,
          scopedRoleCount: 4,
          testIdCount: 1,
        },
      ],
    },
    element_text: '',
    alternatives: ALT_CHECKOUT_EMAIL_RENAMED,
    ...seenOnPass(1, 'tests/checkout/checkout.spec.ts', 'should complete checkout with Apple Pay'),
  },

  // ── Additional captures from the credit-card checkout flow (test_case_id 1) ─
  // Shows that the reporter captures every locator action in a run, not just
  // the one that later fails — these populate the test-case detail page. The
  // email fill sits in the spec; the card fields live in the shared helper.
  {
    id: lsId++,
    test_case_id: 1,
    location: callSite('tests/checkout/checkout.spec.ts', "getByLabel('Email address')", 10, 0),
    used_method: 'getByLabel',
    used_args: ['Email address'],
    used_args_fp: locatorSig('getByLabel', ['Email address']),
    element_tag: 'input',
    element_attrs: {
      type: 'email',
      id: 'checkout-email',
      'data-testid': 'email-input',
      placeholder: 'your@email.com',
      autocomplete: 'email',
      accessibleName: 'Email address',
      center: { x: 640, y: 540 },
      // Structural context captured by newer reporters — powers the
      // renamed-element positional match at heal time.
      rolePosition: { role: 'textbox', count: 5, index: 0 },
      ancestors: [
        {
          tag: 'form',
          depth: 2,
          testId: 'checkout-form',
          id: 'checkout',
          role: null,
          ariaLabel: null,
          scopedRoleCount: 5,
          testIdCount: 1,
          idCount: 1,
          roleCount: 1,
        },
      ],
    },
    element_text: '',
    alternatives: ALT_CHECKOUT_EMAIL,
    ...seenOnRun(1, 'tests/checkout/checkout.spec.ts', 'should complete checkout with credit card'),
  },
  {
    id: lsId++,
    test_case_id: 1,
    location: callSite('tests/helpers/payment.ts', "getByLabel('Card number')", 14),
    used_method: 'getByLabel',
    used_args: ['Card number'],
    used_args_fp: locatorSig('getByLabel', ['Card number']),
    element_tag: 'input',
    element_attrs: {
      type: 'text',
      id: 'card-number',
      'data-testid': 'card-number',
      placeholder: '1234 5678 9012 3456',
      autocomplete: 'cc-number',
      center: { x: 640, y: 620 },
    },
    element_text: '',
    alternatives: ALT_CARD_NUMBER,
    ...seenOnRun(1, 'tests/checkout/checkout.spec.ts', 'should complete checkout with credit card'),
  },
  {
    id: lsId++,
    test_case_id: 1,
    location: callSite('tests/helpers/payment.ts', "getByLabel('Expiry date')", 14),
    used_method: 'getByLabel',
    used_args: ['Expiry date'],
    used_args_fp: locatorSig('getByLabel', ['Expiry date']),
    element_tag: 'input',
    element_attrs: {
      type: 'text',
      id: 'card-expiry',
      'data-testid': 'card-expiry',
      placeholder: 'MM / YY',
      autocomplete: 'cc-exp',
      center: { x: 480, y: 660 },
    },
    element_text: '',
    alternatives: ALT_CARD_EXPIRY,
    ...seenOnRun(1, 'tests/checkout/checkout.spec.ts', 'should complete checkout with credit card'),
  },

  // ── Additional captures from the PayPal checkout flow (test_case_id 2) ─────
  {
    id: lsId++,
    test_case_id: 2,
    location: callSite('tests/checkout/checkout.spec.ts', "getByLabel('Email address')", 10, 1),
    used_method: 'getByLabel',
    used_args: ['Email address'],
    used_args_fp: locatorSig('getByLabel', ['Email address']),
    element_tag: 'input',
    element_attrs: {
      type: 'email',
      id: 'checkout-email',
      'data-testid': 'email-input',
      placeholder: 'your@email.com',
      autocomplete: 'email',
      center: { x: 640, y: 540 },
    },
    element_text: '',
    alternatives: ALT_CHECKOUT_EMAIL,
    ...seenOnRun(1, 'tests/checkout/checkout.spec.ts', 'should complete checkout with PayPal'),
  },
  {
    id: lsId++,
    test_case_id: 2,
    location: callSite('tests/checkout/checkout.spec.ts', "getByRole('button', { name: 'Continue with PayPal' })", 16),
    used_method: 'getByRole',
    used_args: ['button', { name: 'Continue with PayPal' }],
    used_args_fp: locatorSig('getByRole', ['button', 'Continue with PayPal']),
    element_tag: 'button',
    element_attrs: {
      'data-testid': 'paypal-btn',
      class: 'paypal-button btn',
      accessibleName: 'Continue with PayPal',
      center: { x: 640, y: 740 },
    },
    element_text: 'Continue with PayPal',
    alternatives: ALT_PAYPAL_BTN,
    ...seenOnRun(1, 'tests/checkout/checkout.spec.ts', 'should complete checkout with PayPal'),
  },

  // ── Cart add-to-cart (test_case_id 6 — should add item to cart) ──────────
  {
    id: lsId++,
    test_case_id: 6,
    location: 'tests/checkout/cart.spec.ts:6:14',
    used_method: 'getByRole',
    used_args: ['button', { name: 'Add to cart' }],
    used_args_fp: locatorSig('getByRole', ['button', 'Add to cart']),
    element_tag: 'button',
    element_attrs: {
      id: 'add-to-cart-btn',
      'data-testid': 'add-to-cart-btn',
      class: 'btn btn-primary add-to-cart',
      accessibleName: 'Add to cart',
      center: { x: 580, y: 390 },
    },
    element_text: 'Add to cart',
    alternatives: [
      {
        locator: "getByTestId('add-to-cart-btn')",
        method: 'getByTestId',
        args: { testId: 'add-to-cart-btn' },
        score: 100,
      },
      {
        locator: "getByRole('button', { name: 'Add to cart' })",
        method: 'getByRole',
        args: { role: 'button', name: 'Add to cart' },
        score: 90,
      },
      { locator: "getByText('Add to cart')", method: 'getByText', args: { text: 'Add to cart' }, score: 75 },
      { locator: "locator('#add-to-cart-btn')", method: 'locator', args: { selector: '#add-to-cart-btn' }, score: 65 },
    ],
    ...seenOnRun(1, 'tests/checkout/cart.spec.ts', 'should add item to cart'),
  },

  // ── Cart remove (test_case_id 7 — should remove item from cart) ──────────
  {
    id: lsId++,
    test_case_id: 7,
    location: 'tests/checkout/cart.spec.ts:13:14',
    used_method: 'getByRole',
    used_args: ['button', { name: 'Remove' }],
    used_args_fp: locatorSig('getByRole', ['button', 'Remove']),
    element_tag: 'button',
    element_attrs: {
      'data-testid': 'remove-item-btn',
      class: 'btn-icon cart-item-remove',
      'aria-label': 'Remove item',
      accessibleName: 'Remove',
      center: { x: 980, y: 320 },
    },
    element_text: 'Remove',
    alternatives: ALT_CART_REMOVE,
    ...seenOnRun(1, 'tests/checkout/cart.spec.ts', 'should remove item from cart'),
  },

  // ── Shipping address form (test_case_id 11 — should fill and save shipping address) ─
  {
    id: lsId++,
    test_case_id: 11,
    location: 'tests/checkout/address.spec.ts:6:10',
    used_method: 'getByLabel',
    used_args: ['Full name'],
    used_args_fp: locatorSig('getByLabel', ['Full name']),
    element_tag: 'input',
    element_attrs: {
      type: 'text',
      id: 'full-name',
      'data-testid': 'fullname-input',
      placeholder: 'John Smith',
      autocomplete: 'name',
      center: { x: 640, y: 280 },
    },
    element_text: '',
    alternatives: ALT_FULL_NAME,
    ...seenOnRun(1, 'tests/checkout/address.spec.ts', 'should fill and save shipping address'),
  },
  {
    id: lsId++,
    test_case_id: 11,
    location: 'tests/checkout/address.spec.ts:7:10',
    used_method: 'getByLabel',
    used_args: ['Street address'],
    used_args_fp: locatorSig('getByLabel', ['Street address']),
    element_tag: 'input',
    element_attrs: {
      type: 'text',
      id: 'street-address',
      'data-testid': 'street-address',
      placeholder: '123 Main St',
      autocomplete: 'street-address',
      center: { x: 640, y: 340 },
    },
    element_text: '',
    alternatives: [
      {
        locator: "getByTestId('street-address')",
        method: 'getByTestId',
        args: { testId: 'street-address' },
        score: 100,
      },
      { locator: "getByLabel('Street address')", method: 'getByLabel', args: { label: 'Street address' }, score: 85 },
      {
        locator: "getByPlaceholder('123 Main St')",
        method: 'getByPlaceholder',
        args: { placeholder: '123 Main St' },
        score: 80,
      },
      { locator: "locator('#street-address')", method: 'locator', args: { selector: '#street-address' }, score: 65 },
    ],
    ...seenOnRun(1, 'tests/checkout/address.spec.ts', 'should fill and save shipping address'),
  },
  {
    id: lsId++,
    test_case_id: 11,
    location: 'tests/checkout/address.spec.ts:9:14',
    used_method: 'getByRole',
    used_args: ['button', { name: 'Save address' }],
    used_args_fp: locatorSig('getByRole', ['button', 'Save address']),
    element_tag: 'button',
    element_attrs: {
      'data-testid': 'save-address-btn',
      class: 'btn btn-primary',
      accessibleName: 'Save address',
      center: { x: 640, y: 540 },
    },
    element_text: 'Save address',
    alternatives: ALT_SAVE_ADDRESS,
    ...seenOnRun(1, 'tests/checkout/address.spec.ts', 'should fill and save shipping address'),
  },

  // ── Cluster #6: button strict-mode violation (test_case_id 27) ────────────
  // The snapshot is keyed at the getByRole call site. The error's frame carries
  // a column (as real captures do), so the ladder resolves via the
  // file:line rung (path-suffix tolerant) and then the locator signature.
  // The captured element is the PRIMARY variant — the same one the ARIA
  // snapshot, the diagnosis patch and the alternatives all name.
  {
    id: lsId++,
    test_case_id: 27,
    location: BUTTON_CLICK_SITE,
    used_method: 'getByRole',
    used_args: ['button'],
    used_args_fp: locatorSig('getByRole', ['button']),
    element_tag: 'button',
    element_attrs: {
      'data-testid': 'primary-btn',
      class: 'btn btn-primary',
      accessibleName: 'Primary',
      center: { x: 320, y: 280 },
    },
    element_text: 'Primary',
    alternatives: ALT_BUTTON_STRICT,
    ...seenOnPass(3, 'tests/ui/button.spec.ts', 'Button primary variant renders correctly'),
  },

  // ── Cluster #9: Export CSV button hidden in dark mode ─────────────────────
  // The locator is never acted on — it only appears in expect(…).toBeVisible()
  // — so this snapshot comes from the reporter's ASSERTION capture, keyed at
  // the expect() call site. On the failing (dark-mode) page the hidden button
  // is absent from the ARIA snapshot, so healing flags the name-derived
  // alternatives as stale, recommends the surviving class selector, and
  // advises adding a data-testid.
  {
    id: lsId++,
    test_case_id: caseIdByKey.get(`5\x00tests/admin/reports.spec.ts\x00exports the monthly report as CSV`),
    location: EXPORT_ASSERT_SITE,
    used_method: 'getByRole',
    used_args: ['button', { name: 'Export CSV' }],
    used_args_fp: locatorSig('getByRole', ['button', 'Export CSV']),
    element_tag: 'button',
    element_attrs: {
      class: 'export-btn',
      accessibleName: 'Export CSV',
      center: { x: 1180, y: 96 },
      // Three buttons at capture time (Toggle theme, Refresh data, Export
      // CSV); only two remain visible on the failing dark-mode page, so the
      // positional rename-rescue is correctly disqualified (count mismatch).
      rolePosition: { role: 'button', count: 3, index: 2 },
    },
    element_text: 'Export CSV',
    alternatives: ALT_EXPORT_CSV,
    ...seenOnPass(5, 'tests/admin/reports.spec.ts', 'exports the monthly report as CSV'),
  },
];

// ── Load-time timestamp rebase ─────────────────────────────────────────────
// Every timestamp above is anchored to a fixed generation-time window, so a
// committed seed would show runs that drift ever further into the past. To keep
// the demo feeling live, the seed shifts every timestamp forward when it runs —
// the first time a visitor opens the demo AND every time they reset the data —
// so the newest run always lands near "now". SQLite evaluates
// `strftime('%s','now')` at seed-run time, so the offset is computed relative to
// the actual moment of the visit, not to when the seed file was built.
//
// `ANCHOR_SEC` is the newest timestamp in the dataset (in seconds). Mapping it
// to the current time and shifting everything else by the same delta keeps the
// data's internal spacing intact and guarantees nothing lands in the future.
function collectAnchorSec() {
  let max = 0;
  // Fold a candidate timestamp into the running max, normalizing to seconds.
  const bump = (v, unit) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const s = unit === 'ms' ? Math.floor(v / 1000) : v;
    if (s > max) max = s;
  };

  // Tables whose created_at/updated_at are second-precision.
  for (const rows of [TAGS, PROJECTS, USERS, TEST_SUITES, TEST_CASES, FAILURE_CLUSTERS, FAILURE_DIAGNOSES]) {
    for (const r of rows) {
      bump(r.created_at, 's');
      bump(r.updated_at, 's');
    }
  }
  for (const r of MERGE_SUGGESTIONS) {
    bump(r.created_at, 's');
    bump(r.updated_at, 's');
  }
  for (const r of APP_SETTINGS) bump(r.updated_at, 's');
  for (const r of FAILURE_DIAGNOSIS_VERSIONS) bump(r.created_at, 's');
  for (const r of TEST_RUNS) {
    bump(r.start_time, 's');
    bump(r.created_at, 's');
    bump(r.updated_at, 's');
  }
  for (const r of REPORTS) bump(r.created_at, 's');
  for (const r of ATTACHMENTS) bump(r.created_at, 's');

  // Millisecond-precision columns.
  for (const r of PROJECT_ASSIGNMENTS) bump(r.created_at, 'ms');
  for (const r of LOCATOR_SNAPSHOTS) bump(r.last_seen_at, 'ms');
  for (const r of ENTITY_LINKS) {
    bump(r.created_at, 'ms');
    bump(r.updated_at, 'ms');
  }
  for (const r of TEST_RUNS_CASES) {
    bump(r.started_at, 'ms');
    bump(r.created_at, 'ms');
    for (const e of r.step_events || []) bump(e.startedAt, 'ms');
    for (const e of r.console_logs || []) bump(e.timestamp, 'ms');
  }
  for (const r of NETWORK_REQUESTS) {
    for (const e of r.server_logs || []) bump(e.timestamp, 'ms');
  }
  return max;
}

const ANCHOR_SEC = collectAnchorSec();
// Delta between load time and the seed's anchor, computed by SQLite when the
// seed runs. Referenced from a temp table so every statement shares one value
// (a second-precision drift between statements would otherwise desync the ms
// columns from their JSON-embedded counterparts and skew the timeline).
const D = '(SELECT delta_sec FROM _rebase)';
const D_MS = `(SELECT delta_sec FROM _rebase) * 1000`;

// Shift a JSON array column's per-element ms timestamp (`$.field`) in place,
// preserving element order (json_each iterates in array order).
const shiftJsonMs = (table, column, field) =>
  `UPDATE ${table} SET ${column} = (SELECT json_group_array(json_set(value, '$.${field}', ` +
  `json_extract(value, '$.${field}') + ${D_MS})) FROM json_each(${table}.${column})) ` +
  `WHERE ${column} IS NOT NULL AND json_valid(${column});`;

const REBASE_SQL = [
  '-- ── Rebase every timestamp to load time (see generator for rationale) ──────',
  `CREATE TEMP TABLE _rebase AS SELECT (CAST(strftime('%s', 'now') AS INTEGER) - ${ANCHOR_SEC}) AS delta_sec;`,
  '',
  '-- Second-precision timestamp columns',
  `UPDATE tags SET created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  `UPDATE projects SET created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  `UPDATE markers SET occurred_at = occurred_at + ${D}, created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  `UPDATE users SET created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  `UPDATE app_settings SET updated_at = updated_at + ${D};`,
  `UPDATE test_suites SET created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  `UPDATE test_cases SET created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  `UPDATE test_runs SET start_time = start_time + ${D}, created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  `UPDATE files SET created_at = created_at + ${D};`,
  // fix_landed_at is nullable; NULL + delta stays NULL, so no guard is needed.
  `UPDATE failure_clusters SET created_at = created_at + ${D}, updated_at = updated_at + ${D}, fix_landed_at = fix_landed_at + ${D};`,
  `UPDATE quarantined_tests SET created_at = created_at + ${D}, released_at = released_at + ${D};`,
  `UPDATE failure_diagnoses SET created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  `UPDATE failure_diagnosis_versions SET created_at = created_at + ${D};`,
  `UPDATE cluster_merge_suggestions SET created_at = created_at + ${D}, updated_at = updated_at + ${D};`,
  '',
  '-- Millisecond timestamp columns',
  `UPDATE test_runs_cases SET started_at = started_at + ${D_MS}, created_at = created_at + ${D_MS};`,
  `UPDATE network_requests SET start_time = start_time + ${D_MS};`,
  `UPDATE project_assignments SET created_at = created_at + ${D_MS};`,
  `UPDATE entity_links SET created_at = created_at + ${D_MS}, updated_at = updated_at + ${D_MS};`,
  `UPDATE locator_snapshots SET last_seen_at = last_seen_at + ${D_MS};`,
  '',
  '-- Millisecond timestamps embedded in JSON columns',
  shiftJsonMs('test_runs_cases', 'step_events', 'startedAt'),
  shiftJsonMs('test_runs_cases', 'console_logs', 'timestamp'),
  shiftJsonMs('network_requests', 'server_logs', 'timestamp'),
  '',
  'DROP TABLE _rebase;',
];

// ── Assemble SQL ───────────────────────────────────────────────────────────
const lines = [
  '-- Piwi Dashboard demo seed',
  '-- Generated by scripts/generate-demo-seed.mjs',
  `-- Generated at: ${new Date().toISOString()}`,
  '',
  'PRAGMA journal_mode = WAL;',
  '',
  SCHEMA,
  '',
  'BEGIN TRANSACTION;',
  '',
  '-- Tags',
  insert('tags', TAGS),
  '',
  '-- Projects',
  insert('projects', PROJECTS),
  '',
  '-- Users (demo identities for the "act as" switcher)',
  insert('users', USERS),
  '',
  '-- Project assignments (affectations)',
  insert('project_assignments', PROJECT_ASSIGNMENTS),
  '',
  '-- App settings (the `ai` key marks the demo provider as configured)',
  insert('app_settings', APP_SETTINGS),
  '',
  '-- Project-tag associations',
  insert('project_tags', PROJECT_TAGS),
  '',
  '-- Timeline markers',
  insert('markers', MARKERS),
  '',
  '-- Test suites',
  insert('test_suites', TEST_SUITES),
  '',
  '-- Test cases',
  insert('test_cases', TEST_CASES),
  '',
  '-- Test runs',
  insert('test_runs', TEST_RUNS),
  '',
  '-- Files (reports)',
  insert('files', REPORTS),
  '',
  '-- Failure clusters',
  insert('failure_clusters', FAILURE_CLUSTERS),
  '',
  '-- Demo AI diagnoses',
  insert('failure_diagnoses', FAILURE_DIAGNOSES),
  '',
  '-- Demo merge suggestions (reference failure_clusters)',
  insert('cluster_merge_suggestions', MERGE_SUGGESTIONS),
  '',
  '-- Diagnosis version history (references failure_diagnoses + failure_clusters)',
  insert('failure_diagnosis_versions', FAILURE_DIAGNOSIS_VERSIONS),
  '',
  '-- Test run cases',
  insert('test_runs_cases', TEST_RUNS_CASES),
  '',
  '-- Files (screenshot/trace/video attachments — reference test_runs_cases, so must come after)',
  insert('files', ATTACHMENTS),
  '',
  '-- Entity links (may reference test_runs_cases, so must come after)',
  insert('entity_links', ENTITY_LINKS),
  '',
  '-- Network requests (child table, references test_runs_cases)',
  insert('network_requests', NETWORK_REQUESTS),
  '',
  '-- Quarantined tests (references test_cases)',
  insert('quarantined_tests', QUARANTINED_TESTS),
  '',
  '-- Locator healing snapshots (references test_cases)',
  insert('locator_snapshots', LOCATOR_SNAPSHOTS),
  '',
  ...REBASE_SQL,
  '',
  'COMMIT;',
];

// Compute the hash from all lines *excluding* the timestamp comment so that
// identical data produces the same hash even across regenerations.  Without
// this, the "New demo data" staleness indicator always appears because every
// `app:seed:demo` run changes the timestamp comment.
const hashLines = lines.filter((l) => !l.startsWith('-- Generated at:'));
const content = hashLines.join('\n');
const hash = createHash('sha256').update(content, 'utf-8').digest('hex');

const versionInfo = { hash, generatedAt: new Date().toISOString() };
const VERSION_OUTPUT = join(OUTPUT_DIR, 'seed.version.json');

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT, content, 'utf-8');
writeFileSync(VERSION_OUTPUT, JSON.stringify(versionInfo, null, 2) + '\n', 'utf-8');

console.log(`✅  Demo seed written to ${OUTPUT}`);
console.log(`✅  Version file written to ${VERSION_OUTPUT}`);
console.log(`   Hash       : ${hash}`);
console.log(`   Projects   : ${PROJECTS.length}`);
console.log(`   Users      : ${USERS.length}`);
console.log(`   Assignments: ${PROJECT_ASSIGNMENTS.length}`);
console.log(`   Tags       : ${TAGS.length}`);
console.log(`   Suites     : ${TEST_SUITES.length}`);
console.log(`   TestCases  : ${TEST_CASES.length}`);
console.log(`   TestRuns   : ${TEST_RUNS.length}`);
console.log(`   TRC rows   : ${TEST_RUNS_CASES.length}`);
console.log(`   NR rows    : ${NETWORK_REQUESTS.length}`);
console.log(`   Reports    : ${REPORTS.length}`);
console.log(`   Attachments: ${ATTACHMENTS.length}`);
console.log(`   Clusters   : ${FAILURE_CLUSTERS.length}`);
console.log(`   Diagnoses  : ${FAILURE_DIAGNOSES.length}`);
console.log(`   DiagVersions: ${FAILURE_DIAGNOSIS_VERSIONS.length}`);
console.log(`   Links      : ${ENTITY_LINKS.length}`);
console.log(`   LocatorSnap: ${LOCATOR_SNAPSHOTS.length}`);
