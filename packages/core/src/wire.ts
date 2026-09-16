/**
 * Wire leaf shapes — the small, identical building blocks of the JSON contract
 * exchanged between the reporter and the server. The single source of truth
 * shared by the app (`#shared/types`) and the reporter (`types/wire.ts`).
 *
 * The per-case *payloads* are intentionally NOT here: the reporter produces a
 * loose `WireTestCase` superset while the server receives the stricter
 * `TestCasePayload` / `StreamEventPayload`. Those live on each side and are kept
 * field-compatible by `apps/application/tests/unit/wire-shared-drift.test.ts`.
 */

/** One entry per level in a test's suite path (parallel to `suitePath`). */
export interface SuiteConfigEntry {
  mode: 'parallel' | 'serial' | 'default';
  annotations: Array<{ type: string; description?: string }>;
}

export interface TestAnnotation {
  type: string;
  description?: string;
}

export type { TestMetadata } from './test-meta';

/**
 * A run produced by resolving a named selection (`piwi run <key>`), stamped onto
 * the run so the dashboard can name the subset and re-resolve the same
 * definition when a gate requires it.
 */
export interface SelectionStamp {
  /** The selection's project-unique slug. */
  key: string;
  /** The definition version this run resolved (definitions increment on edit). */
  version: number;
  /** SHA-256 over the sorted stable test identities the definition resolved to. */
  resolvedHash: string;
  /** How many tests the definition resolved to. */
  resolvedCount: number;
}

/**
 * Filter that narrowed a run to a subset of tests, recorded when `isFullRun`
 * is false.
 */
export interface FilterDetails {
  /** A non-default `--grep` pattern (Playwright's default `.*` is excluded). */
  grep?: string;
  /** A `--grep-invert` pattern. */
  grepInvert?: string;
  /** Positional file/path filters from the CLI invocation (e.g. ["tests/login.spec.ts"]). */
  files?: string[];
  /** Set when the run came from `piwi run <key>` resolving a saved selection. */
  selection?: SelectionStamp;
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
  contrast?: string | null;
  offline?: boolean | null;
  bypassCSP?: boolean | null;
  javaScriptEnabled?: boolean | null;
  serviceWorkers?: string | null;
  userAgent?: string | null;
}

/**
 * One in-project source frame from a failure's call stack — the failing line
 * plus the callers above it — so the interesting code that led into the
 * assertion is visible, not just the test line that triggered it.
 */
export interface TestSourceFrame {
  /** Project-relative source path (e.g. `tests/checkout.spec.ts`). */
  file: string;
  /** 1-based line within `file` the stack frame points at. */
  line: number;
  /** Line-numbered snippet around `line`, with a `>` marker on it. */
  snippet: string;
}

/** A hook/fixture/step event with absolute timings (for the workers timeline). */
export interface TestStepEvent {
  title: string;
  /** The step's target (rendered locator or URL), carried separately by newer Playwright. */
  subtitle?: string | null;
  category: 'hook' | 'fixture' | 'test.step' | 'expect' | 'wait';
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
}
