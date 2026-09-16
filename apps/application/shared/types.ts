import type { LocatorSnapshot } from './locator-healing.types';
import type {
  BrowserConfig,
  FilterDetails,
  SelectionStamp,
  SuiteConfigEntry,
  TestAnnotation,
  TestMetadata,
  TestSourceFrame,
  TestStepEvent,
} from '@piwitests/core/wire';

// The wire leaf shapes live in @piwitests/core (shared with the reporter);
// re-export them so `#shared/types` consumers keep importing them from here.
export type {
  BrowserConfig,
  FilterDetails,
  SelectionStamp,
  SuiteConfigEntry,
  TestAnnotation,
  TestMetadata,
  TestSourceFrame,
  TestStepEvent,
};

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
  | 'initializing'
  | 'finalizing';

// `didnotrun` = a test that never executed: cut short by `maxFailures` or
// skipped as a side effect of an earlier failure in a `describe.serial` group.
// Distinct from `skipped`, which is reserved for intentional `test.skip()` /
// `test.fixme()`.
// `timedout` is the canonical stored spelling: ingest normalizes Playwright's
// camelCase `timedOut` wire value (`normalizeTestCaseStatus`), while rows
// written by earlier releases may still carry the camelCase form — readers
// match both via `FAILED_STATUS_KEYS` (shared/utils/test-counts.ts).
export type TestCaseStatus = 'passed' | 'failed' | 'skipped' | 'timedout' | 'didnotrun';

export type ClusterStatus = 'open' | 'resolved' | 'ignored';

// ── Roles ─────────────────────────────────────────────────────────────────────

export enum Role {
  ADMINISTRATOR = 'administrator',
  REPORTER = 'reporter',
  USER = 'user',
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
  /** Effective per-test timeout in ms (`TestCase.timeout`); `0` means unbounded. */
  timeout?: number | null;
  error?: string | null;
  retries?: number | null;
  /** One entry per attempt up to and including this one: `{ retry, status, duration, startedAt }`. */
  attempts?: Array<{ retry: number; status: string; duration: number; startedAt: number | null }> | null;
  steps?: unknown;
  stepEvents?: TestStepEvent[] | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  pageState?: unknown;
  /** AI-step usage manifest (`{ entries: string[] }`): committed AI-step artifacts this test replayed. */
  aiUsage?: unknown;
  consoleLogs?: unknown;
  dialogs?: unknown;
  ariaSnapshot?: unknown;
  ariaSnapshotJson?: unknown;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  /** Tags declared on the test (`TestCase.tags`), normalized with `@` stripped. */
  tags?: string[] | null;
  /** Lock names the execution held (`TestCase._locks`); best effort — none from blob imports. */
  locks?: string[] | null;
  /** Ownership metadata declared via `piwi:` annotations. */
  testMeta?: TestMetadata | null;
  /** Per-element locator snapshots with ranked alternatives (transient — not stored as a column). */
  locatorSnapshots?: LocatorSnapshot[] | null;
  /** Source snippet around the failing line of the spec file (captured on failure only). */
  testSource?: string | null;
  /** In-project call-stack frames (innermost first): the failing line + its callers. */
  testSourceFrames?: TestSourceFrame[] | null;
  /** Why a `didnotrun` case never executed (`previous-failure`/`global-timeout`/`max-failures`/`interrupted`). */
  didNotRunReason?: string | null;
  /** For a `previous-failure` cascade, the location of the failing test that blocked it. */
  blockedBy?: string | null;
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
  reporterVersion?: string;
  testCases?: TestCasePayload[];
  shardIndex?: number;
  shardTotal?: number;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
}

// ── Streaming event payload ───────────────────────────────────────────────────

export interface StreamEventPayload {
  type: 'begin' | 'complete' | 'step-begin' | 'step-end';
  title: string;
  location: string;
  status?: string;
  duration?: number | null;
  /** Effective per-test timeout in ms (`TestCase.timeout`); `0` means unbounded. */
  timeout?: number | null;
  error?: string | null;
  retries?: number | null;
  /** One entry per attempt up to and including this one: `{ retry, status, duration, startedAt }`. */
  attempts?: Array<{ retry: number; status: string; duration: number; startedAt: number | null }> | null;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  steps?: unknown;
  stepEvents?: TestStepEvent[] | null;
  stepCategory?: string | null;
  /** Step target for a `step-begin`/`step-end` event (rendered locator or URL). */
  subtitle?: string | null;
  parentTitle?: string | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  pageState?: unknown;
  aiUsage?: unknown;
  consoleLogs?: unknown;
  dialogs?: unknown;
  ariaSnapshot?: unknown;
  ariaSnapshotJson?: unknown;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  tags?: string[] | null;
  locks?: string[] | null;
  testMeta?: TestMetadata | null;
  locatorSnapshots?: LocatorSnapshot[] | null;
  /** Source snippet around the failing line of the spec file (captured on failure only). */
  testSource?: string | null;
  /** In-project call-stack frames (innermost first): the failing line + its callers. */
  testSourceFrames?: TestSourceFrame[] | null;
  /** Why a `didnotrun` case never executed (`previous-failure`/`global-timeout`/`max-failures`/`interrupted`). */
  didNotRunReason?: string | null;
  /** For a `previous-failure` cascade, the location of the failing test that blocked it. */
  blockedBy?: string | null;
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
  /** Trace/report uploads are still in flight — the run enters `finalizing` instead of completing. */
  hasPendingUploads?: boolean;
  /** Suite-level hook/fixture steps (beforeAll/afterAll) for the run timeline. */
  setupSteps?: Array<{
    title: string;
    category: string;
    startedAt: number;
    duration: number;
    status: string;
    location?: string | null;
    workerIndex?: number | null;
  }>;
  label?: string | null;
  metadata?: Record<string, unknown>;
  playwrightVersion?: string;
  reporterVersion?: string;
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
  reporterVersion?: string;
  shardIndex?: number;
  shardTotal?: number;
  isFullRun?: boolean;
  filterDetails?: FilterDetails | null;
}
