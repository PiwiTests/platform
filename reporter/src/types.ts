/**
 * Reporter-local domain model.
 *
 * These interfaces describe the data that flows *between* the reporter's
 * classes (`FileHandler`, `Uploader`, `StreamManager`, `PiwiDashboardReporter`).
 * They intentionally mirror — but do not import — the wire types in
 * `application/shared/types.ts`. Importing that module would leak the monorepo
 * path into the published `.d.ts` files; the constraint forbids the import,
 * not the types. Keep these structurally compatible with
 * `TestCasePayload` / `StreamEventPayload` / `TestRunFinishPayload` when
 * evolving them.
 */

// ── Suite / browser / annotation shapes (mirror shared/types.ts) ─────────────

export interface SuiteConfigEntry {
  mode: 'parallel' | 'serial' | 'default';
  annotations: Array<{ type: string; description?: string }>;
}

export interface TestAnnotation {
  type: string;
  description?: string;
}

/**
 * Filter that narrowed a run to a subset of tests, recorded when `isFullRun`
 * is false. Mirrors `FilterDetails` in `application/shared/types.ts`.
 */
export interface FilterDetails {
  /** A non-default `--grep` pattern (Playwright's default `.*` is excluded). */
  grep?: string;
  /** A `--grep-invert` pattern. */
  grepInvert?: string;
  /** Positional file/path filters from the CLI invocation (e.g. ["tests/login.spec.ts"]). */
  files?: string[];
}

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

// ── Test-case model ───────────────────────────────────────────────────────────

/**
 * A raw Playwright attachment as exposed on `TestResult.attachments`.
 * Carried verbatim on `CollectedTestCase.attachments` so `FileHandler` can
 * resolve trace/attachment paths; never sent to the server.
 */
export interface RawAttachment {
  name: string;
  path?: string;
  contentType?: string;
  body?: Buffer;
  originalName?: string;
}

/** Performance metrics collected from `result.steps` by `step-analyzer`. */
export interface CollectedPerformanceMetrics {
  steps: Array<{ title: string; duration: number; category: string }>;
  totalStepDuration: number;
  slowestStep: { title: string; duration: number } | null;
  navigationCount: number;
  navigationTotalDuration: number;
  waitTotalDuration: number;
  waitCount: number;
}

/** A hook/fixture step event with absolute timings (for the workers timeline). */
export interface TestStepEvent {
  title: string;
  category: 'hook' | 'fixture' | 'test.step' | 'expect' | 'wait';
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
}

/**
 * What `onTestEnd` accumulates per test case. Mixes three concerns that the
 * reporter must keep together during a run:
 *  - **wire fields** (`title`, `status`, `duration`, …) that `toWireTestCase`
 *    projects onto `WireTestCase` before sending,
 *  - **collection-only state** (`attachments`, `performanceMetrics`,
 *    `stepEvents`) consumed by `FileHandler` and the run-level summary,
 *  - the `type` discriminant so the same collected object can be queued as a
 *    stream event.
 *
 * Upload bookkeeping (`_filesUploaded`) is deliberately NOT on this object —
 * `StreamManager` tracks it in a side `Set` so the data model stays clean.
 */
export interface CollectedTestCase {
  /** Stream-event discriminant: `'begin'` or `'complete'`. Omitted for batch-only runs. */
  type?: 'begin' | 'complete';
  title: string;
  location: string;
  status?: string;
  duration?: number;
  error?: string | null;
  retries?: number;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  /** Raw Playwright attachments — never sent on the wire. */
  attachments?: RawAttachment[];
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  /** Source snippet around the failing line (failed/timedOut only). */
  testSource?: string;
  /** Step metrics from `collectStepMetrics`. Consumed by the run summary + `toWireTestCase`. */
  performanceMetrics?: CollectedPerformanceMetrics;
  stepEvents?: TestStepEvent[];
  /** Parsed from `piwi-network` attachments by `FileHandler`. */
  networkRequests?: unknown;
  /** Parsed from `piwi-web-vitals` attachments. */
  webVitals?: unknown;
  /** Parsed from `piwi-console` attachments. */
  consoleLogs?: unknown;
  /** Parsed from `piwi-aria-snapshot` attachment. */
  ariaSnapshot?: string;
  /** Parsed from `piwi-locators` attachment. */
  locatorSnapshots?: import('./locator-healing.js').LocatorSnapshot[];
}

/**
 * The per-case wire shape that `toWireTestCase` produces and the server
 * receives. Structurally compatible with `TestCasePayload` and the per-event
 * `StreamEventPayload`.
 */
export interface WireTestCase {
  type?: 'begin' | 'complete' | 'step-begin' | 'step-end';
  title: string;
  location: string;
  status?: string;
  duration?: number;
  error?: string | null;
  retries?: number;
  workerIndex?: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  steps?: unknown;
  stepEvents?: TestStepEvent[] | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  wastedTimeMs?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: unknown;
  testSource?: string | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  /** Step-event discriminant (only for `step-begin`/`step-end` events). */
  stepCategory?: string | null;
  parentTitle?: string | null;
  /** Per-element locator snapshots with ranked alternatives (transient — not stored per-run). */
  locatorSnapshots?: unknown;
}

// ── Stream events (discriminated union) ──────────────────────────────────────

export interface BeginStreamEvent {
  type: 'begin';
  title: string;
  location: string;
  workerIndex: number | null;
  shardIndex: number | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
}

export interface CompleteStreamEvent {
  type: 'complete';
  title: string;
  location: string;
  status: string;
  duration: number;
  error: string | null;
  retries: number;
  workerIndex: number | null;
  shardIndex: number | null;
  startedAt: number | null;
  browser?: BrowserConfig | null;
  suitePath?: string[] | null;
  suiteConfig?: SuiteConfigEntry[] | null;
  testAnnotations?: TestAnnotation[] | null;
  steps?: unknown;
  stepEvents?: TestStepEvent[] | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
  networkRequests?: unknown;
  webVitals?: unknown;
  consoleLogs?: unknown;
  ariaSnapshot?: unknown;
  testSource?: string | null;
  locatorSnapshots?: unknown;
}

export interface StepBeginStreamEvent {
  type: 'step-begin';
  title: string;
  location: string;
  stepCategory: 'hook' | 'fixture';
  parentTitle: string | null;
  workerIndex: number | null;
  startedAt: number | null;
}

export interface StepEndStreamEvent {
  type: 'step-end';
  title: string;
  location: string;
  status: string;
  duration: number;
  stepCategory: 'hook' | 'fixture';
  parentTitle: string | null;
  workerIndex: number | null;
  startedAt: number | null;
}

/** Discriminated union of events queued to `StreamManager` and persisted by `StreamBuffer`. */
export type StreamEvent = BeginStreamEvent | CompleteStreamEvent | StepBeginStreamEvent | StepEndStreamEvent;

// ── Suite-level setup steps (beforeAll/afterAll timeline) ─────────────────────

export interface SetupStep {
  title: string;
  category: string;
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
  workerIndex?: number | null;
}

// ── Trace dedup ───────────────────────────────────────────────────────────────

/** Hash + size of a single trace file, used for dedup against the server. */
export interface TraceHashInfo {
  tracePath: string;
  hash: string;
  size: number;
}
