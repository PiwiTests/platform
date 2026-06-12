// ── Test status types ──────────────────────────────────────────────────────────
// These mirror the values stored in the test_runs.status column and the
// Playwright result.status values.

export type TestRunStatus = 'passed' | 'failed' | 'timedout' | 'interrupted' | 'running' | 'cancelled' | 'initialising' | 'finalizing'

export type TestCaseStatus = 'passed' | 'failed' | 'skipped' | 'timedout'

export type ClusterStatus = 'open' | 'resolved' | 'ignored'

// ── Browser/project config ────────────────────────────────────────────────────

export interface BrowserConfig {
  projectName?: string
  browserName?: string | null
  channel?: string | null
  viewport?: { width: number, height: number } | null
  deviceScaleFactor?: number | null
  isMobile?: boolean | null
  hasTouch?: boolean | null
  locale?: string | null
  timezoneId?: string | null
  geolocation?: { longitude: number, latitude: number, accuracy?: number } | null
  colorScheme?: string | null
  reducedMotion?: string | null
  forcedColors?: string | null
  offline?: boolean | null
  bypassCSP?: boolean | null
  javaScriptEnabled?: boolean | null
  serviceWorkers?: string | null
  userAgent?: string | null
}

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
  browser?: BrowserConfig | null
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
  projectName?: string | null
  browser?: BrowserConfig | null
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
