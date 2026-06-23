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
 * It also writes public/demo/seed.version.json containing a SHA-256 hash of
 * the generated SQL content.  The Nuxt build reads this hash and exposes it
 * as runtime config so the demo SPA can detect stale IndexedDB data.
 *
 * The generated files are committed to the repository so `npm run generate:demo`
 * does not need a running server.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(__dirname, '../public/demo/seed.sql');

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

// ── Fingerprint helpers (mirrors shared/error-fingerprint.ts) ──────────────
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX_RE = /\b[0-9a-f]{8,}\b/gi;
const SHORT_HEX_RE = /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{6,7}\b/gi;
const URL_RE = /\bhttps?:\/\/[^\s'"`)]+/gi;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi;

function computeDemoFingerprint(rawError) {
  const FINGERPRINT_VERSION = 2;
  let errorType = 'unknown';
  if (/strict mode violation/i.test(rawError)) errorType = 'strict-mode';
  else if (/\bexpect\(|\.toBe|\.toContain|\.toEqual/.test(rawError)) errorType = 'assertion';
  else if (/Timeout \d+m?s exceeded|TimeoutError/i.test(rawError)) errorType = 'timeout';
  else if (/page\.goto|Navigation failed|net::ERR_/i.test(rawError)) errorType = 'navigation';
  let head = rawError;
  const stackIdx = head.search(/\n\s+at /);
  if (stackIdx !== -1) head = head.slice(0, stackIdx);
  const lines = head
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const messageHead = lines.slice(0, 5).join('\n');
  const masked = messageHead
    .replace(/^(\s*(?:Received|Expected)[^:\n]*:).*$/gm, '$1 <VALUE>')
    .replace(URL_RE, '<URL>')
    .replace(EMAIL_RE, '<EMAIL>')
    .replace(UUID_RE, '<UUID>')
    .replace(LONG_HEX_RE, '<HASH>')
    .replace(SHORT_HEX_RE, '<HASH>')
    .replace(/\d+/g, '<N>');
  const signature = (masked.split('\n')[0] || '').slice(0, 200) || 'Unknown error';
  // The stack frame is no longer part of the fingerprint (see error-fingerprint.ts);
  // the demo mirror does not extract selectors, so the locator field stays empty.
  const input = `v${FINGERPRINT_VERSION}\0${errorType}\0${masked}\0`;
  const hash = createHash('sha256').update(input, 'utf-8').digest('hex');
  return { fingerprint: hash, errorType, signature };
}

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

// ── Demo data ─────────────────────────────────────────────────────────────

// Tags
const TAGS = [
  { id: 1, text: 'smoke', color: 'green', created_at: ts('2025-03-01'), updated_at: ts('2025-03-01') },
  { id: 2, text: 'regression', color: 'blue', created_at: ts('2025-03-01'), updated_at: ts('2025-03-01') },
  { id: 3, text: 'critical', color: 'red', created_at: ts('2025-03-15'), updated_at: ts('2025-03-15') },
  { id: 4, text: 'performance', color: 'yellow', created_at: ts('2025-04-01'), updated_at: ts('2025-04-01') },
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
];

// Project-tag associations
const PROJECT_TAGS = [
  { project_id: 1, tag_id: 1 }, // e2e-checkout → smoke
  { project_id: 1, tag_id: 3 }, // e2e-checkout → critical
  { project_id: 2, tag_id: 2 }, // api-integration → regression
  { project_id: 3, tag_id: 1 }, // ui-components → smoke
  { project_id: 3, tag_id: 4 }, // ui-components → performance
  { project_id: 4, tag_id: 2 }, // mobile-safari → regression
];

// ── Test cases per project ─────────────────────────────────────────────────
const TEST_CASES = [];
let tcId = 1;

const P1_CASES = [
  ['tests/checkout/checkout.spec.ts', 'should complete checkout with credit card'],
  ['tests/checkout/checkout.spec.ts', 'should complete checkout with PayPal'],
  ['tests/checkout/checkout.spec.ts', 'should complete checkout with Apple Pay'],
  ['tests/checkout/checkout.spec.ts', 'should show error for expired card'],
  ['tests/checkout/checkout.spec.ts', 'should show error for invalid CVV'],
  ['tests/checkout/cart.spec.ts', 'should add item to cart'],
  ['tests/checkout/cart.spec.ts', 'should remove item from cart'],
  ['tests/checkout/cart.spec.ts', 'should update item quantity'],
  ['tests/checkout/cart.spec.ts', 'should apply discount code'],
  ['tests/checkout/cart.spec.ts', 'should display cart total correctly'],
  ['tests/checkout/address.spec.ts', 'should fill and save shipping address'],
  ['tests/checkout/address.spec.ts', 'should validate required address fields'],
];

const P2_CASES = [
  ['tests/api/auth.spec.ts', 'POST /auth/login returns 200 with valid credentials'],
  ['tests/api/auth.spec.ts', 'POST /auth/login returns 401 with invalid credentials'],
  ['tests/api/auth.spec.ts', 'GET /auth/me returns current user'],
  ['tests/api/products.spec.ts', 'GET /products returns paginated list'],
  ['tests/api/products.spec.ts', 'GET /products/:id returns product details'],
  ['tests/api/products.spec.ts', 'POST /products creates product (admin)'],
  ['tests/api/products.spec.ts', 'DELETE /products/:id removes product (admin)'],
  ['tests/api/orders.spec.ts', 'POST /orders creates order'],
  ['tests/api/orders.spec.ts', 'GET /orders/:id returns order details'],
  ['tests/api/orders.spec.ts', 'PUT /orders/:id/status updates order status'],
  ['tests/api/search.spec.ts', 'GET /search returns results'],
  ['tests/api/search.spec.ts', 'GET /search handles empty query'],
  ['tests/api/users.spec.ts', 'GET /users/:id returns user profile'],
  ['tests/api/users.spec.ts', 'PUT /users/:id updates user profile'],
];

const P3_CASES = [
  ['tests/ui/button.spec.ts', 'Button primary variant renders correctly'],
  ['tests/ui/button.spec.ts', 'Button disabled state renders correctly'],
  ['tests/ui/button.spec.ts', 'Button loading state renders correctly'],
  ['tests/ui/modal.spec.ts', 'Modal opens and closes correctly'],
  ['tests/ui/modal.spec.ts', 'Modal with large content scrolls correctly'],
  ['tests/ui/form.spec.ts', 'Form validation shows errors correctly'],
  ['tests/ui/form.spec.ts', 'Form submit button disabled when invalid'],
  ['tests/ui/table.spec.ts', 'Table sorts by column correctly'],
  ['tests/ui/table.spec.ts', 'Table pagination works correctly'],
  ['tests/ui/table.spec.ts', 'Table search filters results'],
];

const P4_CASES = [
  ['tests/mobile/navigation.spec.ts', 'Tab bar navigation works correctly'],
  ['tests/mobile/navigation.spec.ts', 'Back gesture navigates correctly'],
  ['tests/mobile/gestures.spec.ts', 'Swipe to dismiss works'],
  ['tests/mobile/gestures.spec.ts', 'Pull to refresh triggers reload'],
  ['tests/mobile/forms.spec.ts', 'Text input shows keyboard on focus'],
  ['tests/mobile/forms.spec.ts', 'Date picker works correctly'],
  ['tests/mobile/media.spec.ts', 'Images load with correct dimensions'],
];

// Suite definitions per project per file — mirrors describe blocks in test specs
const SUITE_DEFS = {
  1: {
    'tests/checkout/checkout.spec.ts': { suitePath: ['Checkout'], mode: 'parallel', annotations: [] },
    'tests/checkout/cart.spec.ts': { suitePath: ['Cart'], mode: 'default', annotations: [] },
    'tests/checkout/address.spec.ts': { suitePath: ['Address'], mode: 'default', annotations: [] },
  },
  2: {
    'tests/api/auth.spec.ts': { suitePath: ['Auth'], mode: 'default', annotations: [] },
    'tests/api/products.spec.ts': { suitePath: ['Products'], mode: 'default', annotations: [] },
    'tests/api/orders.spec.ts': { suitePath: ['Orders'], mode: 'default', annotations: [] },
    'tests/api/search.spec.ts': { suitePath: ['Search'], mode: 'default', annotations: [] },
    'tests/api/users.spec.ts': { suitePath: ['Users'], mode: 'default', annotations: [] },
  },
  3: {
    'tests/ui/button.spec.ts': { suitePath: ['Button'], mode: 'parallel', annotations: [{ type: 'smoke' }] },
    'tests/ui/modal.spec.ts': { suitePath: ['Modal'], mode: 'serial', annotations: [] },
    'tests/ui/form.spec.ts': { suitePath: ['Form'], mode: 'default', annotations: [] },
    'tests/ui/table.spec.ts': { suitePath: ['Table'], mode: 'default', annotations: [] },
  },
  4: {
    'tests/mobile/navigation.spec.ts': { suitePath: ['Navigation'], mode: 'default', annotations: [] },
    'tests/mobile/gestures.spec.ts': { suitePath: ['Gestures'], mode: 'default', annotations: [] },
    'tests/mobile/forms.spec.ts': { suitePath: ['Forms'], mode: 'default', annotations: [] },
    'tests/mobile/media.spec.ts': { suitePath: ['Media'], mode: 'default', annotations: [] },
  },
};

// Generate test_suites rows: one row per (project, filePath, suitePath)
const TEST_SUITES = [];
let tsId = 1;
const suiteLookup = {}; // projectId → filePath → suiteId
const suiteNow = ts('2025-03-01');

for (const [pid, fileDefs] of Object.entries(SUITE_DEFS)) {
  suiteLookup[pid] = {};
  for (const [fp, def] of Object.entries(fileDefs)) {
    const suitePathStr = def.suitePath.join('\x1f');
    suiteLookup[pid][fp] = tsId;
    TEST_SUITES.push({
      id: tsId,
      project_id: +pid,
      file_path: fp,
      suite_path: suitePathStr,
      mode: def.mode,
      annotations: JSON.stringify(def.annotations),
      created_at: suiteNow,
      updated_at: suiteNow,
    });
    tsId++;
  }
}

const ROOT_CAUSES = ['timing', 'network', 'assertion', 'other'];
function randomRootCause() {
  if (Math.random() < 0.75) return null;
  return ROOT_CAUSES[Math.floor(Math.random() * ROOT_CAUSES.length)];
}

const ALL_CASE_DEFS = [
  [1, P1_CASES],
  [2, P2_CASES],
  [3, P3_CASES],
  [4, P4_CASES],
];

const caseIdsByProject = {};
for (const [pid, cases] of ALL_CASE_DEFS) {
  caseIdsByProject[pid] = [];
  const now = ts('2025-03-01');
  for (const [fp, title] of cases) {
    const suiteId = suiteLookup[pid]?.[fp] ?? null;
    const suitePathStr = SUITE_DEFS[pid]?.[fp]?.suitePath.join('\x1f') ?? '';
    TEST_CASES.push({
      id: tcId,
      project_id: pid,
      file_path: fp,
      suite_path: suitePathStr,
      suite_id: suiteId,
      title,
      flaky_root_cause: randomRootCause(),
      created_at: now,
      updated_at: now,
    });
    caseIdsByProject[pid].push(tcId);
    tcId++;
  }
}

// ── Failure cluster definitions ────────────────────────────────────────────
// NOTE: caseIndices must be in [0, 2] because max failed tests per run is 3
const CLUSTER_DEFS = [
  {
    projectId: 1,
    errorText: 'TimeoutError: locator.click: Timeout 30000ms exceeded.\n    at tests/checkout/checkout.spec.ts:42',
    caseIndices: [0, 1],
  },
  { projectId: 1, errorText: 'expect(received).toBe(expected)\n\nExpected: 3\nReceived: 0', caseIndices: [2] },
  { projectId: 2, errorText: 'expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500', caseIndices: [0, 1] },
  {
    projectId: 2,
    errorText: 'expect(received).toBe(expected)\n\nExpected: truthy\nReceived: undefined',
    caseIndices: [2],
  },
  {
    projectId: 3,
    errorText: 'TimeoutError: page.waitForSelector: Timeout 5000ms exceeded.\n    at tests/ui/modal.spec.ts:18',
    caseIndices: [1, 2],
  },
  {
    projectId: 3,
    errorText:
      "Error: strict mode violation: getByRole('button') resolved to 3 elements\n\n    at tests/ui/button.spec.ts:55",
    caseIndices: [0],
  },
  {
    projectId: 4,
    errorText: 'TimeoutError: page.goto: Timeout 30000ms exceeded.\n    at tests/mobile/navigation.spec.ts:15',
    caseIndices: [0, 1],
  },
  {
    projectId: 4,
    errorText: 'Error: page.fill: Element not found\n    at tests/mobile/forms.spec.ts:28',
    caseIndices: [2],
  },
];

const CLUSTERS = CLUSTER_DEFS.map((def, i) => ({
  id: i + 1,
  ...def,
  ...computeDemoFingerprint(def.errorText),
}));

const clusterLookup = {};
for (const cl of CLUSTERS) {
  if (!clusterLookup[cl.projectId]) clusterLookup[cl.projectId] = {};
  for (const ci of cl.caseIndices) {
    clusterLookup[cl.projectId][ci] = cl.id;
  }
}

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

// ── Test runs + test_runs_cases ────────────────────────────────────────────

const TEST_RUNS = [];
const TEST_RUNS_CASES = [];
const NETWORK_REQUESTS = [];
let nrId = 1;
const REPORTS = [];
const FAILURE_CLUSTERS = [];

const clusterStats = {};
for (const cl of CLUSTERS) {
  clusterStats[cl.id] = { occurrences: 0, firstRunId: null, lastRunId: null };
}

let runId = 1;
let trcId = 1;
let reportId = 1;

// 'main' appears 3× to weight it more heavily in the random distribution
const BRANCHES = ['main', 'main', 'main', 'develop', 'feature/new-ui'];
const AUTHORS = ['Alice Chen', 'Bob Smith', 'Carol White', 'David Lee', 'Eva Brown'];
const COMMIT_MSGS = [
  'feat: add new payment provider',
  'fix: resolve checkout race condition',
  'chore: update dependencies',
  'feat: improve error messages',
  'fix: mobile layout issues',
  'perf: optimize database queries',
  'feat: add A/B test framework',
  'fix: resolve flaky test',
  'docs: update API documentation',
  'refactor: simplify auth flow',
];

function randomCommit() {
  return Math.random().toString(16).slice(2, 10);
}

const ENVIRONMENTS = ['production', 'staging', 'integration', 'development'];

const STEPS_TEMPLATES = [
  [
    { title: 'Navigate to page', duration: 850, category: 'navigation' },
    { title: 'Fill form fields', duration: 1100, category: 'action' },
    { title: 'Submit form', duration: 1200, category: 'action' },
    { title: 'Assert success', duration: 730, category: 'assertion' },
  ],
  [
    { title: 'Open browser', duration: 400, category: 'setup' },
    { title: 'Login as user', duration: 950, category: 'action' },
    { title: 'Navigate to feature', duration: 620, category: 'navigation' },
    { title: 'Interact with element', duration: 800, category: 'action' },
    { title: 'Verify result', duration: 500, category: 'assertion' },
  ],
  [
    { title: 'Setup test data', duration: 300, category: 'setup' },
    { title: 'Execute action', duration: 1500, category: 'action' },
    { title: 'Check database state', duration: 200, category: 'assertion' },
  ],
];

const SERVER_LOGS_OK = [
  { timestamp: 1714000000000, level: 'info', category: 'http', message: 'GET /products — 200 OK (85ms)' },
  { timestamp: 1714000000050, level: 'debug', category: 'cache', message: 'cache HIT for key products:featured' },
];

const SERVER_LOGS_ERROR = [
  {
    timestamp: 1714000000000,
    level: 'error',
    category: 'http',
    message: 'POST /orders — 500 Internal Server Error',
    stack:
      'Error: connection pool exhausted\n    at Query.execute (db/query.ts:42)\n    at POST /orders (routes/orders.ts:18)',
  },
  { timestamp: 1714000000010, level: 'warn', category: 'database', message: 'Connection pool at 95% capacity' },
];

const NETWORK_TEMPLATES = [
  [
    {
      method: 'GET',
      url: 'https://api.example.com/products',
      status: 200,
      duration: 85,
      resourceType: 'fetch',
      serverLogs: SERVER_LOGS_OK,
    },
    { method: 'POST', url: 'https://api.example.com/orders', status: 201, duration: 145, resourceType: 'fetch' },
    { method: 'GET', url: 'https://api.example.com/users/123', status: 200, duration: 62, resourceType: 'fetch' },
  ],
  [
    { method: 'GET', url: 'https://api.example.com/auth/me', status: 200, duration: 45, resourceType: 'fetch' },
    {
      method: 'GET',
      url: 'https://api.example.com/products/42',
      status: 200,
      duration: 72,
      resourceType: 'fetch',
      serverLogs: SERVER_LOGS_OK,
    },
    { method: 'POST', url: 'https://api.example.com/cart/items', status: 200, duration: 110, resourceType: 'fetch' },
  ],
];

// Project configurations: [numRuns, baseTestCount, baseDuration, baseAvgMs, baseP90Ms, failRate, flakyRate]
const PROJECT_CONFIGS = {
  1: {
    numRuns: 20,
    totalTests: 12,
    baseDuration: 145000,
    baseAvg: 4200,
    baseP90: 8900,
    failRate: 0.15,
    flakyRate: 0.12,
  },
  2: { numRuns: 18, totalTests: 14, baseDuration: 82000, baseAvg: 2100, baseP90: 4800, failRate: 0.1, flakyRate: 0.08 },
  3: {
    numRuns: 15,
    totalTests: 10,
    baseDuration: 310000,
    baseAvg: 8500,
    baseP90: 18000,
    failRate: 0.2,
    flakyRate: 0.15,
  },
  4: { numRuns: 8, totalTests: 7, baseDuration: 190000, baseAvg: 5800, baseP90: 12000, failRate: 0.25, flakyRate: 0.1 },
};

// Browser configs per project
const BROWSER_CONFIGS = {
  1: [
    // e2e-checkout — Chromium most runs, Firefox occasionally
    { projectName: 'Chromium', browserName: 'chromium', channel: null, viewport: { width: 1280, height: 720 } },
    { projectName: 'Firefox', browserName: 'firefox', channel: null, viewport: { width: 1280, height: 720 } },
  ],
  2: [
    // api-integration — always Chromium
    { projectName: 'Chromium', browserName: 'chromium', channel: null, viewport: { width: 1280, height: 720 } },
  ],
  3: [
    // ui-components — always Chromium
    { projectName: 'Chromium', browserName: 'chromium', channel: null, viewport: { width: 1280, height: 720 } },
  ],
  4: [
    // mobile-safari — always WebKit with iPhone viewport
    { projectName: 'Mobile Safari', browserName: 'webkit', channel: null, viewport: { width: 390, height: 844 } },
  ],
};

// Base start time (most recent run is at this time, older runs go backwards)
const BASE_START_MS = new Date('2025-04-25T08:30:00Z').getTime();

for (const [pid, cfg] of Object.entries(PROJECT_CONFIGS)) {
  const projectId = +pid;
  const caseIds = caseIdsByProject[projectId];

  for (let i = 0; i < cfg.numRuns; i++) {
    // Runs go from newest (i=0) to oldest (i=numRuns-1)
    const startMs = BASE_START_MS - i * (8 * 60 * 60 * 1000 + Math.floor(Math.random() * 3600000));
    const startTime = Math.floor(startMs / 1000);
    const durationVariance = (Math.random() - 0.5) * 0.2 * cfg.baseDuration;
    const duration = Math.round(cfg.baseDuration + durationVariance);
    const avgVariance = (Math.random() - 0.5) * 0.15 * cfg.baseAvg;
    const avgTestDuration = Math.round(cfg.baseAvg + avgVariance);
    const p90Variance = (Math.random() - 0.5) * 0.15 * cfg.baseP90;
    const p90TestDuration = Math.round(cfg.baseP90 + p90Variance);

    // Determine run status
    const roll = Math.random();
    let status;
    let failedTests = 0;
    let passedTests = cfg.totalTests;
    let flakyTests = 0;
    let didNotRunTests = 0;

    if (roll < cfg.failRate) {
      status = 'failed';
      failedTests = Math.ceil(Math.random() * Math.min(3, cfg.totalTests));
      passedTests = cfg.totalTests - failedTests;
      flakyTests = Math.random() < 0.35 ? 1 : 0;
    } else if (roll < cfg.failRate + 0.05) {
      // An interrupted run: a failure cut the suite short, so the trailing
      // tests never executed (didnotrun).
      status = 'interrupted';
      failedTests = 1;
      didNotRunTests = Math.min(3, Math.max(0, cfg.totalTests - 2));
      passedTests = cfg.totalTests - failedTests - didNotRunTests;
    } else {
      status = 'passed';
      flakyTests = Math.random() < cfg.flakyRate ? 1 : 0;
    }

    const branchIdx = i % BRANCHES.length;
    const branch = i < 3 ? 'main' : BRANCHES[branchIdx];
    const commitMsg = COMMIT_MSGS[i % COMMIT_MSGS.length];
    const authorIdx = i % AUTHORS.length;

    const metadata = {
      ci: {
        provider: 'GitHub Actions',
        buildNumber: String(1200 - i),
        jobName: 'test',
        workflow: 'CI',
        buildUrl: `https://github.com/example/repo/actions/runs/${1200 - i}`,
      },
      scm: {
        commit: randomCommit(),
        branch,
        author: AUTHORS[authorIdx],
        commitMessage: commitMsg,
      },
    };

    const run = {
      id: runId,
      project_id: projectId,
      status,
      start_time: startTime,
      duration,
      total_tests: cfg.totalTests,
      passed_tests: passedTests,
      failed_tests: failedTests,
      skipped_tests: 0,
      did_not_run_tests: didNotRunTests,
      flaky_tests: flakyTests,
      avg_test_duration: avgTestDuration,
      p90_test_duration: p90TestDuration,

      environment: ENVIRONMENTS[i % ENVIRONMENTS.length],
      label: i === 0 ? `v${i + 1}.0.0 release` : null,
      metadata,
      stream_token: null,
      instance_id: null,
      playwright_version: '1.51.0',
      is_full_run: i % 5 !== 4 ? 1 : 0,
      filter_details: i % 5 === 4 ? JSON.stringify({ grep: 'login|checkout' }) : null,
      created_at: startTime,
      updated_at: startTime + Math.floor(duration / 1000),
    };
    TEST_RUNS.push(run);

    // Add a report for the first few runs of each project
    if (i < 3) {
      REPORTS.push({
        id: reportId++,
        test_run_id: runId,
        type: 'report',
        subtype: 'html',
        label: 'HTML Report',
        path: `reports/${projectId}/${runId}/index.html`,
        size: Math.floor(Math.random() * 500000) + 100000,
        created_at: startTime,
      });
    }

    // Generate test_runs_cases for this run
    const stepsTemplate = STEPS_TEMPLATES[i % STEPS_TEMPLATES.length];
    const netTemplate = NETWORK_TEMPLATES[i % NETWORK_TEMPLATES.length];
    const lookup = clusterLookup[projectId] || {};

    for (let j = 0; j < caseIds.length; j++) {
      const caseId = caseIds[j];
      const isFailedCase = failedTests > 0 && j < failedTests;
      const isDidNotRunCase = !isFailedCase && didNotRunTests > 0 && j >= caseIds.length - didNotRunTests;
      const isFlakyCase = !isFailedCase && !isDidNotRunCase && flakyTests > 0 && j === caseIds.length - 1;

      const caseStatus = isFailedCase ? 'failed' : isDidNotRunCase ? 'didnotrun' : 'passed';
      const caseDurationVariance = (Math.random() - 0.5) * 0.3 * avgTestDuration;
      const caseDuration = isDidNotRunCase ? 0 : Math.max(500, Math.round(avgTestDuration + caseDurationVariance));

      // Determine cluster and error text for this case
      const clusterId = isFailedCase ? lookup[j] || null : null;
      const clusterDef = clusterId ? CLUSTERS.find((c) => c.id === clusterId) : null;
      const error = isFailedCase
        ? clusterDef
          ? clusterDef.errorText
          : 'expect(received).toBe(expected)\n\nExpected: true\nReceived: false'
        : null;

      if (clusterId && clusterDef) {
        const stats = clusterStats[clusterId];
        stats.occurrences++;
        if (stats.firstRunId === null) stats.firstRunId = runId;
        stats.lastRunId = runId;
      }

      // Scale steps durations proportionally
      const scaleFactor = caseDuration / stepsTemplate.reduce((s, st) => s + st.duration, 0);
      const steps = stepsTemplate.map((st) => ({
        title: st.title,
        duration: Math.round(st.duration * scaleFactor),
        category: st.category,
      }));
      const slowestStep = steps.reduce((a, b) => (a.duration > b.duration ? a : b));

      const browserConfigs = BROWSER_CONFIGS[projectId] || BROWSER_CONFIGS[1];
      const browser = browserConfigs[projectId === 1 ? i % browserConfigs.length : 0];

      // Add backend server logs to some network requests for realism
      const netWithLogs = isFailedCase
        ? netTemplate.map((req, ri) => (ri === 0 ? { ...req, serverLogs: SERVER_LOGS_ERROR } : req))
        : netTemplate;

      // Assign test annotations — some tests have @fixme, some @slow
      let testAnnotations = null;
      if (isFailedCase && clusterId) {
        testAnnotations = [{ type: 'fixme', description: 'Known issue — see cluster ' + clusterId }];
      } else if (j % 5 === 4) {
        testAnnotations = [{ type: 'slow' }];
      } else if (j === 2 && pid === '1') {
        testAnnotations = [{ type: 'smoke' }];
      }

      const trcIdVal = trcId++;
      const trc = {
        id: trcIdVal,
        test_run_id: runId,
        test_case_id: caseId,
        status: caseStatus,
        duration: caseDuration,
        error,
        failure_cluster_id: clusterId,
        retries: isFlakyCase ? 1 : 0,
        is_new_regression: isFailedCase && Math.random() < 0.25 ? 1 : 0,
        is_new_flaky: !isFailedCase && Math.random() < 0.1 ? 1 : 0,
        line: 10 + j * 8,
        column: 5,
        browser,
        test_annotations: testAnnotations,
        steps,
        slowest_step: slowestStep.title,
        slowest_step_duration: slowestStep.duration,
        web_vitals: {
          navigation: {
            url: 'https://app.example.com/',
            ttfb: 90 + Math.floor(Math.random() * 120),
            domInteractive: 700 + Math.floor(Math.random() * 600),
            domContentLoaded: 1000 + Math.floor(Math.random() * 800),
            loadComplete: 1500 + Math.floor(Math.random() * 1000),
          },
          paint: {
            firstPaint: 600 + Math.floor(Math.random() * 400),
            firstContentfulPaint: 800 + Math.floor(Math.random() * 500),
          },
        },
        console_logs: isFailedCase
          ? [
              {
                type: 'error',
                text: error ? error.split('\n')[0] : 'Unknown error',
                timestamp: (startTime + Math.floor((j * caseDuration) / 1000)) * 1000,
                location: null,
              },
            ]
          : null,
        aria_snapshot: null,
        worker_index: j % 4,
        started_at: (startTime + Math.floor((j * caseDuration) / 1000)) * 1000,
        created_at: startTime + Math.floor((j * caseDuration) / 1000),
      };
      TEST_RUNS_CASES.push(trc);

      for (const req of netWithLogs) {
        NETWORK_REQUESTS.push({
          id: nrId++,
          test_runs_case_id: trcIdVal,
          test_run_id: runId,
          method: req.method,
          url: req.url,
          normalized_url: seedNormalizeUrl(req.url),
          status: req.status,
          duration: req.duration ?? null,
          resource_type: req.resourceType ?? null,
          server_logs: req.serverLogs ?? null,
        });
      }
    }

    runId++;
  }
}

// ── Demo screenshots ───────────────────────────────────────────────────────
// Generate small PNG images for demo attachments and add file records.

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([t, data]);
  let crc = 0xffffffff;
  for (let i = 0; i < crcData.length; i++) {
    crc ^= crcData[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc);
  return Buffer.concat([len, t, data, c]);
}

function createPng(width, height, pixels) {
  const raw = Buffer.alloc(width * height * 4 + height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixels[y * width + x] || [0, 0, 0, 255];
      const off = y * (width * 4 + 1) + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const compressed = deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

function gradientPixels(w, h, r1, g1, b1, r2, g2, b2, accentFn) {
  const px = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y / h;
      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const bl = Math.round(b1 + (b2 - b1) * t);
      const accent = accentFn ? accentFn(x, y, w, h) : null;
      if (accent) px.push(accent);
      else px.push([Math.min(255, r), Math.min(255, g), Math.min(255, bl), 255]);
    }
  }
  return px;
}

const SCREENSHOT_DEFS = [
  {
    name: 'checkout-form-filled',
    label: 'screenshot',
    render: () =>
      gradientPixels(320, 200, 240, 248, 255, 230, 240, 250, (x, y) => {
        if (y > 80 && y < 120 && x > 30 && x < 290) return [255, 255, 255, 255];
        if (y > 140 && y < 170 && x > 80 && x < 240) return [59, 130, 246, 255];
        if (y > 40 && y < 70 && x > 30 && x < 290) return [255, 255, 255, 255];
        return null;
      }),
  },
  {
    name: 'checkout-order-confirmed',
    label: 'screenshot',
    render: () =>
      gradientPixels(320, 200, 240, 255, 240, 255, 255, 255, (x, y, w) => {
        const cx = w / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - 60) ** 2);
        if (dist < 20) return [34, 197, 94, 255];
        if (dist < 15) return [255, 255, 255, 255];
        if (y > 100 && y < 150 && x > 40 && x < 280) return [255, 255, 255, 255];
        return null;
      }),
  },
  {
    name: 'checkout-payment-form',
    label: 'screenshot',
    render: () =>
      gradientPixels(320, 200, 245, 245, 250, 240, 240, 245, (x, y) => {
        if (y > 50 && y < 90 && x > 30 && x < 290) return [255, 255, 255, 255];
        if (y > 60 && y < 78 && x > 40 && x < 80) return [255, 200, 50, 255];
        if (y > 140 && y < 170 && x > 80 && x < 240) return [59, 130, 246, 255];
        return null;
      }),
  },
  {
    name: 'checkout-error',
    label: 'screenshot',
    render: () =>
      gradientPixels(320, 200, 255, 255, 255, 250, 250, 252, (x, y) => {
        if (y > 30 && y < 65 && x > 30 && x < 290) return [254, 242, 242, 255];
        if (y > 38 && y < 55 && x > 50 && x < 270) return [220, 38, 38, 255];
        if (y > 140 && y < 170 && x > 80 && x < 240) return [59, 130, 246, 255];
        return null;
      }),
  },
  {
    name: 'login-form',
    label: 'screenshot',
    render: () =>
      gradientPixels(320, 200, 240, 248, 255, 235, 245, 250, (x, y) => {
        const inEmail = y > 55 && y < 72 && x > 50 && x < 270;
        const inPass = y > 82 && y < 99 && x > 50 && x < 270;
        if (inEmail || inPass) return [255, 255, 255, 255];
        if (y > 120 && y < 150 && x > 80 && x < 240) return [59, 130, 246, 255];
        return null;
      }),
  },
  {
    name: 'cart-summary',
    label: 'screenshot',
    render: () =>
      gradientPixels(320, 200, 250, 250, 252, 245, 245, 248, (x, y) => {
        if ((y > 20 && y < 55) || (y > 60 && y < 95)) {
          if (x > 30 && x < 290) return [255, 255, 255, 255];
        }
        if (y > 110 && y < 130 && x > 30 && x < 290) return [240, 240, 245, 255];
        if (y > 155 && y < 180 && x > 80 && x < 240) return [34, 197, 94, 255];
        return null;
      }),
  },
];

// Generate and save screenshot PNG files
const SCREENSHOTS_DIR = join(__dirname, '../public/demo/screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });
const ATTACHMENTS = [];
let attachmentId = reportId;

for (let idx = 0; idx < SCREENSHOT_DEFS.length; idx++) {
  const def = SCREENSHOT_DEFS[idx];
  const pixels = def.render();
  const pngData = createPng(320, 200, pixels);
  const filename = `${def.name}.png`;
  writeFileSync(join(SCREENSHOTS_DIR, filename), pngData);
  console.log(`  📸 Generated demo screenshot: ${filename} (${pngData.length} bytes)`);

  // Attach screenshots to selected TRCs in project 1 (e2e-checkout)
  // We pick TRCs from the most recent runs of project 1 (run IDs 1-4)
  // TRC IDs are sequential and project 1 has 12 cases per run
  // Run 1 → TRCs 1-12, Run 2 → TRCs 13-24, Run 3 → TRCs 25-36, etc.
  const trcId = 1 + idx; // First TRC of each of the first 6 runs
  // First 6 TRCs belong to run 1 of project 1
  ATTACHMENTS.push({
    id: attachmentId++,
    test_runs_case_id: trcId,
    test_run_id: 1,
    type: 'attachment',
    subtype: def.label,
    label: 'image/png',
    path: `demo/screenshots/${filename}`,
    size: pngData.length,
    created_at: ts('2025-04-25T08:30:00'),
  });
}

// ── Build failure_clusters rows ────────────────────────────────────────────
// Ensure all clusters have valid first/last run IDs. Use any run from the
// project as fallback (no FK constraint on failure_clusters → test_runs).
const firstRunByProject = {};
const lastRunByProject = {};
for (const run of TEST_RUNS) {
  if (!(run.project_id in firstRunByProject)) {
    firstRunByProject[run.project_id] = run.id;
  }
  lastRunByProject[run.project_id] = run.id;
}

const clusterNow = ts('2025-04-25T09:00:00');
const CLUSTER_TRIAGE = {
  1: {
    status: 'resolved',
    triage_note:
      'Root cause identified: CI runner was throttled during peak hours. Added resource_class: large to the workflow. Monitor for recurrence over the next week.',
  },
  3: {
    status: 'open',
    triage_note:
      'Investigating — auth service logs show 500 errors correlated with database connection pool exhaustion. Checking recent migration that added a new users table index.',
  },
  6: {
    status: 'ignored',
    triage_note:
      'Known issue — three buttons match the role on the component page. This is intentional as the page demos multiple button variants. Skip this failure; not a bug.',
  },
};

for (const cl of CLUSTERS) {
  const stats = clusterStats[cl.id];
  const selector = cl.errorType === 'strict-mode' ? "getByRole('button')" : null;
  const triage = CLUSTER_TRIAGE[cl.id] || {};
  FAILURE_CLUSTERS.push({
    id: cl.id,
    project_id: cl.projectId,
    fingerprint: cl.fingerprint,
    signature: cl.signature,
    error_type: cl.errorType,
    selector,
    sample_error: cl.errorText,
    status: triage.status || 'open',
    triage_note: triage.triage_note || null,
    first_seen_run_id: stats.firstRunId ?? firstRunByProject[cl.projectId],
    last_seen_run_id: stats.lastRunId ?? lastRunByProject[cl.projectId],
    occurrences: stats.occurrences || 1,
    created_at: clusterNow,
    updated_at: clusterNow,
  });
}

// ── Demo AI diagnoses ─────────────────────────────────────────────────────
const diagnosisNow = ts('2025-04-25T09:30:00');

const FAILURE_DIAGNOSES = [
  {
    id: 1,
    cluster_id: 1,
    status: 'completed',
    provider: 'demo',
    model: 'demo',
    category: 'infrastructure',
    confidence: 'high',
    summary:
      'Checkout button click times out consistently — suspected slow CI agent or network latency spike causing locator resolution delay.',
    root_cause:
      'The locator.click timeout (30 000 ms) is exceeded when the checkout page renders slowly on the CI runner. The root cause is a missing explicit wait for the payment form to become interactive before clicking, combined with CI infrastructure variability.',
    details: JSON.stringify({
      confidenceScore: 82,
      severity: 'high',
      affectedArea: 'checkout / payment',
      hypotheses: [
        {
          category: 'infrastructure',
          likelihood: 82,
          rootCause:
            'Slow CI runner renders the payment form too late; locator.click exceeds the 30s timeout before the button becomes interactive.',
          evidence: [
            'Failure rate correlates with high-load CI runs (build numbers 1180-1200) [recurrenceFlakiness]',
            'Element present in DOM but not interactive at click time [steps]',
          ],
        },
        {
          category: 'test-bug',
          likelihood: 40,
          rootCause: 'The test clicks without an explicit wait for the payment form to be ready.',
          evidence: ['No waitFor/waitForLoadState precedes the click [testSource]'],
        },
      ],
      investigationSteps: [
        'Re-run the cluster on a low-load runner to confirm CI variability is the driver',
        'Check whether the payment form fires a network-idle event before becoming interactive',
      ],
      evidence: [
        'TimeoutError occurs at tests/checkout/checkout.spec.ts:42 in both affected tests',
        'Error fires during locator.click — the element is present in DOM but not yet interactive',
        'Failure rate correlates with high-load CI runs (build numbers 1180-1200)',
      ],
      suggestedFix: {
        description:
          'Add an explicit waitForLoadState("networkidle") or waitFor condition before the click, and increase the locator timeout for the payment button to 60 000 ms.',
        file: 'tests/checkout/checkout.spec.ts',
        code: 'await page.waitForLoadState("networkidle");\nawait page.getByRole("button", { name: "Pay" }).click({ timeout: 60000 });',
      },
      preventionTips: [
        'Use page.waitForLoadState() before interacting with dynamically loaded payment forms',
        'Add a CI-aware timeout multiplier for payment-related actions',
        'Consider adding a Playwright expect.poll for the button to have aria-disabled=false',
      ],
    }),
    error: null,
    input_tokens: 1240,
    output_tokens: 380,
    duration_ms: 2850,
    created_at: diagnosisNow,
    updated_at: diagnosisNow,
  },
  {
    id: 2,
    cluster_id: 3,
    status: 'completed',
    provider: 'demo',
    model: 'demo',
    category: 'app-bug',
    confidence: 'high',
    summary:
      'POST /auth/login and related auth tests fail with HTTP 500 — server-side exception in the authentication handler.',
    root_cause:
      'The authentication endpoint returns HTTP 500 instead of the expected 200, causing the assertion expect(received).toBe(200).toBe(500) to fail. This indicates a regression in the auth service — likely an unhandled exception in the login handler introduced in recent commits.',
    details: JSON.stringify({
      confidenceScore: 90,
      severity: 'blocker',
      affectedArea: 'authentication / login',
      hypotheses: [
        {
          category: 'app-bug',
          likelihood: 90,
          rootCause:
            'The /auth/login handler throws an unhandled exception introduced in the auth refactor, returning HTTP 500 instead of 200.',
          evidence: [
            'Expected: 200 / Received: 500 in two separate auth test cases [executionError]',
            'Error started appearing in builds after the auth refactor commits [scmInvestigation]',
          ],
        },
      ],
      investigationSteps: [
        'Inspect server logs for the stack trace behind the 500 on POST /auth/login',
        'Bisect the auth refactor commits to find the breaking change',
      ],
      evidence: [
        'Expected: 200 / Received: 500 in two separate auth test cases',
        'Both failures share the same cluster fingerprint, confirming a single root cause',
        'The error started appearing in builds after the auth refactor commits',
      ],
      suggestedFix: {
        description:
          'Inspect the /auth/login endpoint for unhandled exceptions. Add error handling around the credential verification logic and ensure the response status code is correctly set for each code path.',
        file: 'tests/api/auth.spec.ts',
        code: null,
      },
      preventionTips: [
        'Add integration tests that exercise the auth endpoint with a real DB connection',
        'Set up error monitoring (Sentry, Datadog) on the /auth/login endpoint to catch 5xx regressions early',
        'Add a smoke test in CI that hits /auth/login before the full test suite',
      ],
    }),
    error: null,
    input_tokens: 980,
    output_tokens: 310,
    duration_ms: 2100,
    created_at: diagnosisNow,
    updated_at: diagnosisNow,
  },
  {
    id: 3,
    cluster_id: 5,
    status: 'completed',
    provider: 'demo',
    model: 'demo',
    category: 'test-flakiness',
    confidence: 'medium',
    summary:
      'Strict mode violation on button role — multiple elements match because the component page renders three button variants for visual regression testing.',
    root_cause:
      "getByRole('button') resolves to 3 elements on the UI components test page. This occurs because the page intentionally renders primary, disabled, and loading button variants simultaneously. The test should scope its locator to a specific container or use a more specific selector.",
    details: JSON.stringify({
      confidenceScore: 65,
      severity: 'medium',
      affectedArea: 'UI components / button',
      hypotheses: [
        {
          category: 'test-bug',
          likelihood: 65,
          rootCause:
            "getByRole('button') matches 3 rendered button variants, triggering a strict-mode violation; the locator needs scoping.",
          evidence: [
            'Three button elements rendered by design (primary, disabled, loading) [ariaSnapshot]',
            'Failure is deterministic, not intermittent [recurrenceFlakiness]',
          ],
        },
      ],
      investigationSteps: [
        'Confirm the page intentionally renders multiple button variants',
        'Decide on a scoping strategy (name filter or container) with the component owner',
      ],
      evidence: [
        'Error consistently occurs on the button spec page',
        'Three button elements are rendered by design (primary, disabled, loading variants)',
        'Failure is deterministic, not intermittent',
      ],
      suggestedFix: {
        description: 'Scope the locator to the specific button variant container, or use getByRole with a name filter.',
        file: 'tests/ui/button.spec.ts',
        code: "await page.getByRole('button', { name: 'Primary' }).click();",
      },
      preventionTips: [
        'Use unique aria-labels on components in visual regression pages',
        'Scope locators to a parent element when multiple matches are expected',
        'Add data-testid attributes to disambiguate similar elements',
      ],
    }),
    error: null,
    input_tokens: 870,
    output_tokens: 290,
    duration_ms: 1950,
    created_at: diagnosisNow,
    updated_at: diagnosisNow,
  },
  {
    id: 4,
    cluster_id: 7,
    status: 'completed',
    provider: 'demo',
    model: 'demo',
    category: 'infrastructure',
    confidence: 'high',
    summary:
      'Mobile page navigation fails with timeout — the Safari page load takes more than 30 seconds on CI, suggesting slow network or resource-heavy page.',
    root_cause:
      'page.goto timeout (30000ms) exceeded during mobile Safari tests. The navigation endpoint loads heavy assets (images, JS bundles) that are not optimized for mobile connections. Combined with CI network variability, this consistently exceeds the default timeout.',
    details: JSON.stringify({
      confidenceScore: 78,
      severity: 'high',
      affectedArea: 'mobile navigation',
      hypotheses: [
        {
          category: 'infrastructure',
          likelihood: 78,
          rootCause: 'Heavy unoptimized assets push mobile Safari page load past the 30s goto timeout on CI networks.',
          evidence: [
            'Timeout on main navigation load, not subsequent interactions [steps]',
            'Only affects the mobile Safari browser config [browserDistribution]',
          ],
        },
        {
          category: 'environment',
          likelihood: 35,
          rootCause: 'CI network throttling specific to the mobile project profile.',
          evidence: ['Page load time correlates with asset bundle deployments [webVitals]'],
        },
      ],
      investigationSteps: [
        'Measure the page weight and largest-contentful-paint on the mobile profile',
        'Compare goto timing on a local mobile emulation vs CI',
      ],
      evidence: [
        'Timeout occurs on main navigation page load, not on subsequent interactions',
        'Only affects the mobile Safari browser config',
        'Page load time correlates with asset bundle size deployments',
      ],
      suggestedFix: {
        description:
          'Increase the navigation timeout for mobile tests and consider lazy-loading non-critical assets on the target page.',
        file: 'tests/mobile/navigation.spec.ts',
        code: "await page.goto('https://app.example.com', { timeout: 60000 });",
      },
      preventionTips: [
        'Set browser-specific timeouts via Playwright config projects',
        'Optimize page load performance for mobile (code splitting, image optimization)',
        'Add a smoke test that verifies page load under 10s in CI',
      ],
    }),
    error: null,
    input_tokens: 1100,
    output_tokens: 340,
    duration_ms: 2650,
    created_at: diagnosisNow,
    updated_at: diagnosisNow,
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
    created_at: ts('2025-04-25T08:30:00'),
    updated_at: ts('2025-04-25T08:30:00'),
  },
  {
    id: 2,
    test_run_id: null,
    test_runs_case_id: null,
    test_case_id: 1,
    url: 'https://github.com/example/repo/issues/456',
    provider: 'github-issue',
    key: '#456',
    title: 'Fix credit card checkout timeout',
    status_text: 'open',
    status_color: 'neutral',
    metadata: null,
    unfurled_at: null,
    created_by: null,
    created_at: ts('2025-04-24T10:00:00'),
    updated_at: ts('2025-04-24T10:00:00'),
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
    created_at: ts('2025-04-25T09:00:00'),
    updated_at: ts('2025-04-25T09:00:00'),
  },
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
  '-- Project-tag associations',
  insert('project_tags', PROJECT_TAGS),
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
  '-- Test run cases',
  insert('test_runs_cases', TEST_RUNS_CASES),
  '',
  '-- Files (screenshot attachments — reference test_runs_cases, so must come after)',
  insert('files', ATTACHMENTS),
  '',
  '-- Entity links (may reference test_runs_cases, so must come after)',
  insert('entity_links', ENTITY_LINKS),
  '',
  '-- Network requests (child table, references test_runs_cases)',
  insert('network_requests', NETWORK_REQUESTS),
  '',
  'COMMIT;',
];

// Compute the hash from all lines *excluding* the timestamp comment so that
// identical data produces the same hash even across regenerations.  Without
// this, the "New demo data" staleness indicator always appears because every
// `seed:demo` run changes the timestamp comment.
const hashLines = lines.filter((l) => !l.startsWith('-- Generated at:'));
const content = hashLines.join('\n');
const hash = createHash('sha256').update(content, 'utf-8').digest('hex');

const versionInfo = { hash, generatedAt: new Date().toISOString() };
const VERSION_OUTPUT = join(__dirname, '../public/demo/seed.version.json');

mkdirSync(join(__dirname, '../public/demo'), { recursive: true });
writeFileSync(OUTPUT, content, 'utf-8');
writeFileSync(VERSION_OUTPUT, JSON.stringify(versionInfo, null, 2), 'utf-8');

console.log(`✅  Demo seed written to ${OUTPUT}`);
console.log(`✅  Version file written to ${VERSION_OUTPUT}`);
console.log(`   Hash       : ${hash}`);
console.log(`   Projects   : ${PROJECTS.length}`);
console.log(`   Tags       : ${TAGS.length}`);
console.log(`   Suites     : ${TEST_SUITES.length}`);
console.log(`   TestCases  : ${TEST_CASES.length}`);
console.log(`   TestRuns   : ${TEST_RUNS.length}`);
console.log(`   TRC rows   : ${TEST_RUNS_CASES.length}`);
console.log(`   NR rows    : ${NETWORK_REQUESTS.length}`);
console.log(`   Reports    : ${REPORTS.length}`);
console.log(`   Clusters   : ${FAILURE_CLUSTERS.length}`);
console.log(`   Diagnoses  : ${FAILURE_DIAGNOSES.length}`);
console.log(`   Links      : ${ENTITY_LINKS.length}`);
