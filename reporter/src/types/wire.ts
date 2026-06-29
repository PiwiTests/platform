/**
 * Wire contract — the **external** shapes sent to / received from the Piwi
 * Dashboard server.
 *
 * These structurally mirror — but do not import — `application/shared/types.ts`
 * (`TestCasePayload`, `StreamEventPayload`, `TestRunFinishPayload`). Importing
 * that module would leak the monorepo path into the published `.d.ts` files; the
 * constraint forbids the import, not the types. **Any change here is a change to
 * the server contract** — keep both sides structurally compatible.
 *
 * For the in-process collection model (never sent verbatim), see `./collected.ts`.
 */

// ── Suite / browser / annotation shapes ──────────────────────────────────────

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

/** A hook/fixture step event with absolute timings (for the workers timeline). */
export interface TestStepEvent {
  title: string;
  category: 'hook' | 'fixture' | 'test.step' | 'expect' | 'wait';
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
}

// ── Per-case wire shape ──────────────────────────────────────────────────────

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
