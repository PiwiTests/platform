import type { LocatorSnapshot } from './locator-healing.types';

// ── Test status types ──────────────────────────────────────────────────────────
// These mirror the values stored in the test_runs.status column and the
// Playwright result.status values.

export type TestRunStatus =
  | 'passed'
  | 'failed'
  | 'timedout'
  | 'interrupted'
  | 'running'
  | 'cancelled'
  | 'initialising'
  | 'finalizing';

// `didnotrun` = a test that never executed: cut short by `maxFailures` or
// skipped as a side effect of an earlier failure in a `describe.serial` group.
// Distinct from `skipped`, which is reserved for intentional `test.skip()` /
// `test.fixme()`.
export type TestCaseStatus = 'passed' | 'failed' | 'skipped' | 'timedout' | 'didnotrun';

export type ClusterStatus = 'open' | 'resolved' | 'ignored';

// ── Roles ─────────────────────────────────────────────────────────────────────

export enum Role {
  ADMINISTRATOR = 'administrator',
  REPORTER = 'reporter',
  USER = 'user',
}

// ── Suite hierarchy config ────────────────────────────────────────────────────
// One entry per level in suitePath (parallel to the array).

export interface SuiteConfigEntry {
  mode: 'parallel' | 'serial' | 'default';
  annotations: Array<{ type: string; description?: string }>;
}

export interface TestAnnotation {
  type: string;
  description?: string;
}

// ── Browser/project config ────────────────────────────────────────────────────

export interface BrowserConfig {
  projectName?: string;
  browserName?: string | null;
  channel?: string | null;
  viewport?: { width: number; height: number } | null;
  deviceScaleFactor?: number | null;
  isMobile?: boolean | null;
  hasTouch?: boolean | null;
  locale?: string | null;
  timezoneId?: string | null;
  geolocation?: { longitude: number; latitude: number; accuracy?: number } | null;
  colorScheme?: string | null;
  reducedMotion?: string | null;
  forcedColors?: string | null;
  offline?: boolean | null;
  bypassCSP?: boolean | null;
  javaScriptEnabled?: boolean | null;
  serviceWorkers?: string | null;
  userAgent?: string | null;
}

// ── Test case payload ─────────────────────────────────────────────────────────
// The JSON shape exchanged between the reporter and the server APIs.
// The reporter uses `location` (combined "file:line:col" string); the server
// parses it into filePath/line/column via parseLocation().

export interface TestCasePayload {
  title: string;
  location: string;
  status: string;
  duration?: number | null;
  error?: string | null;
  retries?: number | null;
  steps?: unknown;
  stepEvents?: TestStepEvent[] | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: unknown;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  /** Per-element locator snapshots with ranked alternatives (transient — not stored as a column). */
  locatorSnapshots?: LocatorSnapshot[] | null;
}

// ── Test run counters ─────────────────────────────────────────────────────────

export interface TestRunCounters {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests?: number;
  flakyTests?: number;
  duration?: number;
}

// ── Submit (JSON) payload ─────────────────────────────────────────────────────

export type FlakyRootCause = 'timing' | 'network' | 'assertion' | 'environment' | 'other';

export interface FilterDetails {
  grep?: string;
  grepInvert?: string;
  /** Positional file/path filters from the CLI invocation (e.g. ["tests/login.spec.ts"]). */
  files?: string[];
}

export interface TestRunSubmitPayload {
  projectName: string;
  projectDescription?: string;
  status: string;
  startTime: string;
  duration?: number;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  /** Timed-out tests; folded into `failedTests` by the server (no separate column). */
  timedOutTests?: number;
  skippedTests?: number;
  didNotRunTests?: number;
  environment?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
  instanceId?: string | null;
  playwrightVersion?: string;
  testCases?: TestCasePayload[];
  shardIndex?: number;
  shardTotal?: number;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
}

// ── Step / hook events within a test case ─────────────────────────────────────
// Represents a single step (hook, fixture, or user-defined action) with its
// absolute start time and duration, used by WorkersTimeline to render segments.

export interface TestStepEvent {
  title: string;
  category: 'hook' | 'fixture' | 'test.step' | 'expect' | 'wait';
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
}

// ── Streaming event payload ───────────────────────────────────────────────────

export interface StreamEventPayload {
  type: 'begin' | 'complete' | 'step-begin' | 'step-end';
  title: string;
  location: string;
  status?: string;
  duration?: number | null;
  error?: string | null;
  retries?: number | null;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  steps?: unknown;
  stepEvents?: TestStepEvent[] | null;
  stepCategory?: string | null;
  parentTitle?: string | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: unknown;
  projectName?: string | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  locatorSnapshots?: LocatorSnapshot[] | null;
}

// ── Finish payload ────────────────────────────────────────────────────────────

export interface TestRunFinishPayload {
  streamToken: string | null;
  status: string;
  duration: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  /** Timed-out tests; folded into `failedTests` by the server (no separate column). */
  timedOutTests?: number;
  skippedTests: number;
  didNotRunTests?: number;
  flakyTests: number;
  durations: number[];
  label?: string | null;
  metadata?: Record<string, unknown>;
  playwrightVersion?: string;
  shardIndex?: number;
  shardTotal?: number;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
}

// ── Setup / start payload ─────────────────────────────────────────────────────

export interface TestRunStartPayload {
  projectName: string;
  projectDescription?: string;
  startTime?: string;
  environment?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown>;
  instanceId?: string;
  playwrightVersion?: string;
  shardIndex?: number;
  shardTotal?: number;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
}
