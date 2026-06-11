// ── Test status types ──────────────────────────────────────────────────────────
// These mirror the values stored in the test_runs.status column and the
// Playwright result.status values.

export type TestRunStatus = 'passed' | 'failed' | 'timedout' | 'interrupted' | 'running' | 'cancelled' | 'initialising'

export type TestCaseStatus = 'passed' | 'failed' | 'skipped' | 'timedout'

export type ClusterStatus = 'open' | 'resolved' | 'ignored'

// ── Test case payload ─────────────────────────────────────────────────────────
// The JSON shape exchanged between the reporter and the server APIs.
// The reporter uses `location` (combined "file:line:col" string); the server
// parses it into filePath/line/column via parseLocation().

export interface TestCasePayload {
  title: string
  location: string
  status: string
  duration?: number | null
  error?: string | null
  retries?: number | null
  steps?: unknown
  slowestStep?: string | null
  slowestStepDuration?: number | null
  networkRequests?: unknown
  webVitals?: unknown
  consoleLogs?: unknown
  ariaSnapshot?: unknown
  workerIndex?: number | null
  startedAt?: number | null
}

// ── Test run counters ─────────────────────────────────────────────────────────

export interface TestRunCounters {
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  flakyTests?: number
  duration?: number
}

// ── Submit (JSON) payload ─────────────────────────────────────────────────────

export interface TestRunSubmitPayload {
  projectName: string
  projectDescription?: string
  status: string
  startTime: string
  duration?: number
  totalTests?: number
  passedTests?: number
  failedTests?: number
  skippedTests?: number
  environment?: string | null
  metadata?: Record<string, unknown> | null
  instanceId?: string | null
  testCases?: TestCasePayload[]
}

// ── Streaming event payload ───────────────────────────────────────────────────

export interface StreamEventPayload {
  type: 'begin' | 'complete'
  title: string
  location: string
  status?: string
  duration?: number | null
  error?: string | null
  retries?: number | null
  workerIndex?: number | null
  startedAt?: number | null
  steps?: unknown
  slowestStep?: string | null
  slowestStepDuration?: number | null
  networkRequests?: unknown
  webVitals?: unknown
  consoleLogs?: unknown
  ariaSnapshot?: unknown
}

// ── Finish payload ────────────────────────────────────────────────────────────

export interface TestRunFinishPayload {
  streamToken: string | null
  status: string
  duration: number
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  flakyTests: number
  durations: number[]
  metadata?: Record<string, unknown>
}

// ── Setup / start payload ─────────────────────────────────────────────────────

export interface TestRunStartPayload {
  projectName: string
  projectDescription?: string
  startTime?: string
  environment?: string | null
  metadata?: Record<string, unknown>
  instanceId?: string
}
