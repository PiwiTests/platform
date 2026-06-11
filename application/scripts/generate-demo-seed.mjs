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

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT = join(__dirname, '../public/demo/seed.sql')

// ── Helpers ────────────────────────────────────────────────────────────────

function ts(isoDate) {
  return Math.floor(new Date(isoDate).getTime() / 1000)
}

function q(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, '\'\'')}'`
  return `'${String(v).replace(/'/g, '\'\'')}'`
}

function insert(table, rows) {
  return rows.map((row) => {
    const cols = Object.keys(row).join(', ')
    const vals = Object.values(row).map(q).join(', ')
    return `INSERT INTO ${table} (${cols}) VALUES (${vals});`
  }).join('\n')
}

// ── Fingerprint helpers (mirrors shared/error-fingerprint.ts) ──────────────
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const HEX_RE = /\b[0-9a-f]{8,}\b/gi

function computeDemoFingerprint(rawError) {
  const FINGERPRINT_VERSION = 1
  let errorType = 'unknown'
  if (/strict mode violation/i.test(rawError)) errorType = 'strict-mode'
  else if (/\bexpect\(|\.toBe|\.toContain|\.toEqual/.test(rawError)) errorType = 'assertion'
  else if (/Timeout \d+m?s exceeded|TimeoutError/i.test(rawError)) errorType = 'timeout'
  else if (/page\.goto|Navigation failed|net::ERR_/i.test(rawError)) errorType = 'navigation'
  let head = rawError
  const stackIdx = head.search(/\n\s+at /)
  if (stackIdx !== -1) head = head.slice(0, stackIdx)
  const lines = head.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const messageHead = lines.slice(0, 5).join('\n')
  const masked = messageHead.replace(UUID_RE, '<UUID>').replace(HEX_RE, '<HASH>').replace(/\d+/g, '<N>')
  const signature = (masked.split('\n')[0] || '').slice(0, 200) || 'Unknown error'
  const input = `v${FINGERPRINT_VERSION}\0${errorType}\0${masked}\0\0`
  const hash = createHash('sha256').update(input, 'utf-8').digest('hex')
  return { fingerprint: hash, errorType, signature }
}

// ── Schema ─────────────────────────────────────────────────────────────────
const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  label TEXT,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_name_unique ON projects (name);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at);

CREATE TABLE IF NOT EXISTS test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_test_cases_project_id ON test_cases (project_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_file_path_title ON test_cases (project_id, file_path, title);

CREATE TABLE IF NOT EXISTS test_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  duration INTEGER,
  total_tests INTEGER DEFAULT 0 NOT NULL,
  passed_tests INTEGER DEFAULT 0 NOT NULL,
  failed_tests INTEGER DEFAULT 0 NOT NULL,
  skipped_tests INTEGER DEFAULT 0 NOT NULL,
  flaky_tests INTEGER DEFAULT 0 NOT NULL,
  avg_test_duration INTEGER,
  p90_test_duration INTEGER,
  environment TEXT,
  metadata TEXT,
  stream_token TEXT,
  instance_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_test_runs_project_id ON test_runs (project_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_start_time ON test_runs (start_time);

CREATE TABLE IF NOT EXISTS test_runs_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  test_run_id INTEGER NOT NULL,
  test_case_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  duration INTEGER,
  error TEXT,
  failure_cluster_id INTEGER,
  retries INTEGER DEFAULT 0,
  line INTEGER,
  column INTEGER,
  steps TEXT,
  slowest_step TEXT,
  slowest_step_duration INTEGER,
  network_requests TEXT,
  web_vitals TEXT,
  console_logs TEXT,
  aria_snapshot TEXT,
  worker_index INTEGER,
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (test_run_id) REFERENCES test_runs(id),
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id)
);
CREATE INDEX IF NOT EXISTS idx_test_runs_cases_test_run_id ON test_runs_cases (test_run_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_cases_test_case_id ON test_runs_cases (test_case_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_cases_failure_cluster_id ON test_runs_cases (failure_cluster_id);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  test_run_id INTEGER,
  test_runs_case_id INTEGER,
  type TEXT NOT NULL,
  subtype TEXT,
  label TEXT,
  path TEXT NOT NULL,
  size INTEGER,
  blob_id INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (test_run_id) REFERENCES test_runs(id),
  FOREIGN KEY (test_runs_case_id) REFERENCES test_runs_cases(id)
);
CREATE INDEX IF NOT EXISTS idx_files_test_run_id ON files (test_run_id);
CREATE INDEX IF NOT EXISTS idx_files_test_runs_case_id ON files (test_runs_case_id);

CREATE TABLE IF NOT EXISTS trace_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_resources_project_name ON trace_resources (project_id, name);

CREATE TABLE IF NOT EXISTS trace_blobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL,
  hash TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_blobs_project_hash ON trace_blobs (project_id, hash);

CREATE TABLE IF NOT EXISTS failure_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  project_id INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  signature TEXT NOT NULL,
  error_type TEXT,
  selector TEXT,
  sample_error TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  triage_note TEXT,
  first_seen_run_id INTEGER NOT NULL,
  last_seen_run_id INTEGER NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_failure_clusters_project_fingerprint ON failure_clusters (project_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_failure_clusters_project_last_seen ON failure_clusters (project_id, last_seen_run_id);
CREATE INDEX IF NOT EXISTS idx_failure_clusters_status ON failure_clusters (status);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  text TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'neutral',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_text_unique ON tags (text);

CREATE TABLE IF NOT EXISTS project_tags (
  project_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (project_id, tag_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_tags_project_id ON project_tags (project_id);
CREATE INDEX IF NOT EXISTS idx_project_tags_tag_id ON project_tags (tag_id);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  oauth_provider TEXT,
  oauth_provider_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users (oauth_provider, oauth_provider_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_unique ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash);
`.trim()

// ── Demo data ─────────────────────────────────────────────────────────────

// Tags
const TAGS = [
  { id: 1, text: 'smoke', color: 'green', created_at: ts('2025-03-01'), updated_at: ts('2025-03-01') },
  { id: 2, text: 'regression', color: 'blue', created_at: ts('2025-03-01'), updated_at: ts('2025-03-01') },
  { id: 3, text: 'critical', color: 'red', created_at: ts('2025-03-15'), updated_at: ts('2025-03-15') },
  { id: 4, text: 'performance', color: 'yellow', created_at: ts('2025-04-01'), updated_at: ts('2025-04-01') }
]

// Projects
const PROJECTS = [
  { id: 1, name: 'e2e-checkout', label: 'E2E Checkout', description: 'End-to-end tests for the checkout flow', created_at: ts('2025-03-01'), updated_at: ts('2025-04-25T08:30:00') },
  { id: 2, name: 'api-integration', label: 'API Integration', description: 'Integration tests for REST API endpoints', created_at: ts('2025-02-15'), updated_at: ts('2025-04-25T07:15:00') },
  { id: 3, name: 'ui-components', label: 'UI Components', description: 'Visual regression tests for UI components', created_at: ts('2025-01-10'), updated_at: ts('2025-04-24T16:45:00') },
  { id: 4, name: 'mobile-safari', label: 'Mobile Safari', description: 'Mobile Safari browser compatibility tests', created_at: ts('2025-04-01'), updated_at: ts('2025-04-20T12:00:00') }
]

// Project-tag associations
const PROJECT_TAGS = [
  { project_id: 1, tag_id: 1 }, // e2e-checkout → smoke
  { project_id: 1, tag_id: 3 }, // e2e-checkout → critical
  { project_id: 2, tag_id: 2 }, // api-integration → regression
  { project_id: 3, tag_id: 1 }, // ui-components → smoke
  { project_id: 3, tag_id: 4 }, // ui-components → performance
  { project_id: 4, tag_id: 2 } // mobile-safari → regression
]

// ── Test cases per project ─────────────────────────────────────────────────
const TEST_CASES = []
let tcId = 1

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
  ['tests/checkout/address.spec.ts', 'should validate required address fields']
]

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
  ['tests/api/users.spec.ts', 'PUT /users/:id updates user profile']
]

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
  ['tests/ui/table.spec.ts', 'Table search filters results']
]

const P4_CASES = [
  ['tests/mobile/navigation.spec.ts', 'Tab bar navigation works correctly'],
  ['tests/mobile/navigation.spec.ts', 'Back gesture navigates correctly'],
  ['tests/mobile/gestures.spec.ts', 'Swipe to dismiss works'],
  ['tests/mobile/gestures.spec.ts', 'Pull to refresh triggers reload'],
  ['tests/mobile/forms.spec.ts', 'Text input shows keyboard on focus'],
  ['tests/mobile/forms.spec.ts', 'Date picker works correctly'],
  ['tests/mobile/media.spec.ts', 'Images load with correct dimensions']
]

const ALL_CASE_DEFS = [
  [1, P1_CASES],
  [2, P2_CASES],
  [3, P3_CASES],
  [4, P4_CASES]
]

const caseIdsByProject = {}
for (const [pid, cases] of ALL_CASE_DEFS) {
  caseIdsByProject[pid] = []
  const now = ts('2025-03-01')
  for (const [fp, title] of cases) {
    TEST_CASES.push({ id: tcId, project_id: pid, file_path: fp, title, created_at: now, updated_at: now })
    caseIdsByProject[pid].push(tcId)
    tcId++
  }
}

// ── Failure cluster definitions ────────────────────────────────────────────
// NOTE: caseIndices must be in [0, 2] because max failed tests per run is 3
const CLUSTER_DEFS = [
  { projectId: 1, errorText: 'TimeoutError: locator.click: Timeout 30000ms exceeded.\n    at tests/checkout/checkout.spec.ts:42', caseIndices: [0, 1] },
  { projectId: 1, errorText: 'expect(received).toBe(expected)\n\nExpected: 3\nReceived: 0', caseIndices: [2] },
  { projectId: 2, errorText: 'expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500', caseIndices: [0, 1] },
  { projectId: 2, errorText: 'expect(received).toBe(expected)\n\nExpected: truthy\nReceived: undefined', caseIndices: [2] },
  { projectId: 3, errorText: 'TimeoutError: page.waitForSelector: Timeout 5000ms exceeded.\n    at tests/ui/modal.spec.ts:18', caseIndices: [1, 2] },
  { projectId: 3, errorText: 'Error: strict mode violation: getByRole(\'button\') resolved to 3 elements\n\n    at tests/ui/button.spec.ts:55', caseIndices: [0] },
  { projectId: 4, errorText: 'TimeoutError: page.goto: Timeout 30000ms exceeded.\n    at tests/mobile/navigation.spec.ts:15', caseIndices: [0, 1] },
  { projectId: 4, errorText: 'Error: page.fill: Element not found\n    at tests/mobile/forms.spec.ts:28', caseIndices: [2] }
]

const CLUSTERS = CLUSTER_DEFS.map((def, i) => ({
  id: i + 1,
  ...def,
  ...computeDemoFingerprint(def.errorText)
}))

const clusterLookup = {}
for (const cl of CLUSTERS) {
  if (!clusterLookup[cl.projectId]) clusterLookup[cl.projectId] = {}
  for (const ci of cl.caseIndices) {
    clusterLookup[cl.projectId][ci] = cl.id
  }
}

// ── Test runs + test_runs_cases ────────────────────────────────────────────

const TEST_RUNS = []
const TEST_RUNS_CASES = []
const REPORTS = []
const FAILURE_CLUSTERS = []

const clusterStats = {}
for (const cl of CLUSTERS) {
  clusterStats[cl.id] = { occurrences: 0, firstRunId: null, lastRunId: null }
}

let runId = 1
let trcId = 1
let reportId = 1

// 'main' appears 3× to weight it more heavily in the random distribution
const BRANCHES = ['main', 'main', 'main', 'develop', 'feature/new-ui']
const AUTHORS = ['Alice Chen', 'Bob Smith', 'Carol White', 'David Lee', 'Eva Brown']
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
  'refactor: simplify auth flow'
]

function randomCommit() {
  return Math.random().toString(16).slice(2, 10)
}

const ENVIRONMENTS = ['production', 'staging', 'integration', 'development']

const STEPS_TEMPLATES = [
  [
    { title: 'Navigate to page', duration: 850, category: 'navigation' },
    { title: 'Fill form fields', duration: 1100, category: 'action' },
    { title: 'Submit form', duration: 1200, category: 'action' },
    { title: 'Assert success', duration: 730, category: 'assertion' }
  ],
  [
    { title: 'Open browser', duration: 400, category: 'setup' },
    { title: 'Login as user', duration: 950, category: 'action' },
    { title: 'Navigate to feature', duration: 620, category: 'navigation' },
    { title: 'Interact with element', duration: 800, category: 'action' },
    { title: 'Verify result', duration: 500, category: 'assertion' }
  ],
  [
    { title: 'Setup test data', duration: 300, category: 'setup' },
    { title: 'Execute action', duration: 1500, category: 'action' },
    { title: 'Check database state', duration: 200, category: 'assertion' }
  ]
]

const NETWORK_TEMPLATES = [
  [
    { method: 'GET', url: 'https://api.example.com/products', status: 200, duration: 85, resourceType: 'fetch' },
    { method: 'POST', url: 'https://api.example.com/orders', status: 201, duration: 145, resourceType: 'fetch' },
    { method: 'GET', url: 'https://api.example.com/users/123', status: 200, duration: 62, resourceType: 'fetch' }
  ],
  [
    { method: 'GET', url: 'https://api.example.com/auth/me', status: 200, duration: 45, resourceType: 'fetch' },
    { method: 'GET', url: 'https://api.example.com/products/42', status: 200, duration: 72, resourceType: 'fetch' },
    { method: 'POST', url: 'https://api.example.com/cart/items', status: 200, duration: 110, resourceType: 'fetch' }
  ]
]

// Project configurations: [numRuns, baseTestCount, baseDuration, baseAvgMs, baseP90Ms, failRate, flakyRate]
const PROJECT_CONFIGS = {
  1: { numRuns: 20, totalTests: 12, baseDuration: 145000, baseAvg: 4200, baseP90: 8900, failRate: 0.15, flakyRate: 0.08 },
  2: { numRuns: 18, totalTests: 14, baseDuration: 82000, baseAvg: 2100, baseP90: 4800, failRate: 0.1, flakyRate: 0.05 },
  3: { numRuns: 15, totalTests: 10, baseDuration: 310000, baseAvg: 8500, baseP90: 18000, failRate: 0.2, flakyRate: 0.1 },
  4: { numRuns: 8, totalTests: 7, baseDuration: 190000, baseAvg: 5800, baseP90: 12000, failRate: 0.25, flakyRate: 0.05 }
}

// Base start time (most recent run is at this time, older runs go backwards)
const BASE_START_MS = new Date('2025-04-25T08:30:00Z').getTime()

for (const [pid, cfg] of Object.entries(PROJECT_CONFIGS)) {
  const projectId = +pid
  const caseIds = caseIdsByProject[projectId]

  for (let i = 0; i < cfg.numRuns; i++) {
    // Runs go from newest (i=0) to oldest (i=numRuns-1)
    const startMs = BASE_START_MS - i * (8 * 60 * 60 * 1000 + Math.floor(Math.random() * 3600000))
    const startTime = Math.floor(startMs / 1000)
    const durationVariance = (Math.random() - 0.5) * 0.2 * cfg.baseDuration
    const duration = Math.round(cfg.baseDuration + durationVariance)
    const avgVariance = (Math.random() - 0.5) * 0.15 * cfg.baseAvg
    const avgTestDuration = Math.round(cfg.baseAvg + avgVariance)
    const p90Variance = (Math.random() - 0.5) * 0.15 * cfg.baseP90
    const p90TestDuration = Math.round(cfg.baseP90 + p90Variance)

    // Determine run status
    const roll = Math.random()
    let status
    let failedTests = 0
    let passedTests = cfg.totalTests
    let flakyTests = 0

    if (roll < cfg.failRate) {
      status = 'failed'
      failedTests = Math.ceil(Math.random() * Math.min(3, cfg.totalTests))
      passedTests = cfg.totalTests - failedTests
      flakyTests = Math.random() < 0.3 ? 1 : 0
    } else if (roll < cfg.failRate + 0.05) {
      status = 'interrupted'
      failedTests = 1
      passedTests = cfg.totalTests - 1
    } else {
      status = 'passed'
      flakyTests = Math.random() < cfg.flakyRate ? 1 : 0
    }

    const branchIdx = i % BRANCHES.length
    const branch = i < 3 ? 'main' : BRANCHES[branchIdx]
    const commitMsg = COMMIT_MSGS[i % COMMIT_MSGS.length]
    const authorIdx = i % AUTHORS.length

    const metadata = {
      ci: {
        provider: 'GitHub Actions',
        buildNumber: String(1200 - i),
        jobName: 'test',
        workflow: 'CI',
        buildUrl: `https://github.com/example/repo/actions/runs/${1200 - i}`
      },
      scm: {
        commit: randomCommit(),
        branch,
        author: AUTHORS[authorIdx],
        commitMessage: commitMsg
      }
    }

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
      flaky_tests: flakyTests,
      avg_test_duration: avgTestDuration,
      p90_test_duration: p90TestDuration,

      environment: ENVIRONMENTS[i % ENVIRONMENTS.length],
      metadata,
      stream_token: null,
      instance_id: null,
      created_at: startTime,
      updated_at: startTime + Math.floor(duration / 1000)
    }
    TEST_RUNS.push(run)

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
        created_at: startTime
      })
    }

    // Generate test_runs_cases for this run
    const stepsTemplate = STEPS_TEMPLATES[i % STEPS_TEMPLATES.length]
    const netTemplate = NETWORK_TEMPLATES[i % NETWORK_TEMPLATES.length]
    const lookup = clusterLookup[projectId] || {}

    for (let j = 0; j < caseIds.length; j++) {
      const caseId = caseIds[j]
      const isFailedCase = failedTests > 0 && j < failedTests
      const isFlakyCase = !isFailedCase && flakyTests > 0 && j === caseIds.length - 1

      const caseStatus = isFailedCase ? 'failed' : 'passed'
      const caseDurationVariance = (Math.random() - 0.5) * 0.3 * avgTestDuration
      const caseDuration = Math.max(500, Math.round(avgTestDuration + caseDurationVariance))

      // Determine cluster and error text for this case
      const clusterId = isFailedCase ? (lookup[j] || null) : null
      const clusterDef = clusterId ? CLUSTERS.find(c => c.id === clusterId) : null
      const error = isFailedCase ? (clusterDef ? clusterDef.errorText : 'expect(received).toBe(expected)\n\nExpected: true\nReceived: false') : null

      if (clusterId && clusterDef) {
        const stats = clusterStats[clusterId]
        stats.occurrences++
        if (stats.firstRunId === null) stats.firstRunId = runId
        stats.lastRunId = runId
      }

      // Scale steps durations proportionally
      const scaleFactor = caseDuration / stepsTemplate.reduce((s, st) => s + st.duration, 0)
      const steps = stepsTemplate.map(st => ({
        title: st.title,
        duration: Math.round(st.duration * scaleFactor),
        category: st.category
      }))
      const slowestStep = steps.reduce((a, b) => a.duration > b.duration ? a : b)

      const trc = {
        id: trcId++,
        test_run_id: runId,
        test_case_id: caseId,
        status: caseStatus,
        duration: caseDuration,
        error,
        failure_cluster_id: clusterId,
        retries: isFlakyCase ? 1 : 0,
        line: 10 + (j * 8),
        column: 5,
        steps,
        slowest_step: slowestStep.title,
        slowest_step_duration: slowestStep.duration,
        network_requests: netTemplate,
        web_vitals: {
          navigation: {
            url: 'https://app.example.com/',
            ttfb: 90 + Math.floor(Math.random() * 120),
            domInteractive: 700 + Math.floor(Math.random() * 600),
            domContentLoaded: 1000 + Math.floor(Math.random() * 800),
            loadComplete: 1500 + Math.floor(Math.random() * 1000)
          },
          paint: {
            firstPaint: 600 + Math.floor(Math.random() * 400),
            firstContentfulPaint: 800 + Math.floor(Math.random() * 500)
          }
        },
        console_logs: isFailedCase
          ? [{ type: 'error', text: error ? error.split('\n')[0] : 'Unknown error', timestamp: (startTime + Math.floor(j * caseDuration / 1000)) * 1000, location: null }]
          : null,
        aria_snapshot: null,
        worker_index: j % 4,
        started_at: (startTime + Math.floor(j * caseDuration / 1000)) * 1000,
        created_at: startTime + Math.floor(j * caseDuration / 1000)
      }
      TEST_RUNS_CASES.push(trc)
    }

    runId++
  }
}

// ── Build failure_clusters rows ────────────────────────────────────────────
// Ensure all clusters have valid first/last run IDs. Use any run from the
// project as fallback (no FK constraint on failure_clusters → test_runs).
const firstRunByProject = {}
const lastRunByProject = {}
for (const run of TEST_RUNS) {
  if (!(run.project_id in firstRunByProject)) {
    firstRunByProject[run.project_id] = run.id
  }
  lastRunByProject[run.project_id] = run.id
}

const clusterNow = ts('2025-04-25T09:00:00')
for (const cl of CLUSTERS) {
  const stats = clusterStats[cl.id]
  const selector = cl.errorType === 'strict-mode' ? 'getByRole(\'button\')' : null
  FAILURE_CLUSTERS.push({
    id: cl.id,
    project_id: cl.projectId,
    fingerprint: cl.fingerprint,
    signature: cl.signature,
    error_type: cl.errorType,
    selector,
    sample_error: cl.errorText,
    status: 'open',
    triage_note: null,
    first_seen_run_id: stats.firstRunId ?? firstRunByProject[cl.projectId],
    last_seen_run_id: stats.lastRunId ?? lastRunByProject[cl.projectId],
    occurrences: stats.occurrences || 1,
    created_at: clusterNow,
    updated_at: clusterNow
  })
}

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
  '-- Test run cases',
  insert('test_runs_cases', TEST_RUNS_CASES),
  '',
  'COMMIT;'
]

// Compute the hash from all lines *excluding* the timestamp comment so that
// identical data produces the same hash even across regenerations.  Without
// this, the "New demo data" staleness indicator always appears because every
// `seed:demo` run changes the timestamp comment.
const hashLines = lines.filter(l => !l.startsWith('-- Generated at:'))
const content = hashLines.join('\n')
const hash = createHash('sha256').update(content, 'utf-8').digest('hex')

const versionInfo = { hash, generatedAt: new Date().toISOString() }
const VERSION_OUTPUT = join(__dirname, '../public/demo/seed.version.json')

mkdirSync(join(__dirname, '../public/demo'), { recursive: true })
writeFileSync(OUTPUT, content, 'utf-8')
writeFileSync(VERSION_OUTPUT, JSON.stringify(versionInfo, null, 2), 'utf-8')

console.log(`✅  Demo seed written to ${OUTPUT}`)
console.log(`✅  Version file written to ${VERSION_OUTPUT}`)
console.log(`   Hash       : ${hash}`)
console.log(`   Projects   : ${PROJECTS.length}`)
console.log(`   Tags       : ${TAGS.length}`)
console.log(`   TestCases  : ${TEST_CASES.length}`)
console.log(`   TestRuns   : ${TEST_RUNS.length}`)
console.log(`   TRC rows   : ${TEST_RUNS_CASES.length}`)
console.log(`   Reports    : ${REPORTS.length}`)
console.log(`   Clusters   : ${FAILURE_CLUSTERS.length}`)
