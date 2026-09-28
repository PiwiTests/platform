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
  /** The first line of the step's error, when it failed — hook and fixture events only. */
  error?: string | null;
  /** The hooks and fixtures a hook section (`Before Hooks`, `After Hooks`) ran, in order. */
  hooks?: TestStepEventHook[] | null;
}

/** One hook or fixture a hook section ran: `beforeAll hook`, `Fixture "db"`, a titled hook. */
export interface TestStepEventHook {
  title: string;
  category: 'hook' | 'fixture';
  duration: number;
  /** True when it failed; absent when it passed. */
  failed?: boolean;
}

/**
 * One locator call and the page it ran on, as the capture fixtures record it
 * in the `piwi-locator-pages` attachment: a test's calls, deduped by call
 * site, chain and page. The dashboard joins it to the locator index, so a use
 * of a chain knows the pages it was made on.
 */
export interface LocatorPageUse {
  /** `file:line:col` of the call, as a step location reports it (absolute; the server makes it project-relative). */
  location: string;
  /** The chain as Playwright prints it (`Locator.toString()`). */
  locator: string;
  /** The page's origin (`https://shop.test`), to tell the application's pages from third-party ones. */
  origin: string;
  /** The page key: the path with ids and tokens collapsed, no query, no hash (`/orders/:id`). */
  page: string;
  /** No locator interaction happened on the page since it was navigated to: the element was there as it loaded. */
  arrival: boolean;
}

/**
 * One request the page made, as the capture fixtures record it in the
 * `piwi-network` attachment: API calls and documents, not static assets.
 */
export interface WireNetworkRequest {
  method: string;
  url: string;
  /** The HTTP status; 0 when no response arrived (the request failed, or finished without one). */
  status: number;
  /** Milliseconds to the response end; for a failed request, to the moment it failed. */
  duration: number;
  /** Request start, Unix epoch milliseconds. */
  startTime?: number;
  /** Playwright's resource type: `fetch`, `xhr`, `document` or `other`. */
  resourceType?: string;
  /** The response's content type, without parameters. */
  contentType?: string;
  /** Backend logs from the `X-Piwi-Logs` response header. */
  serverLogs?: unknown;
  /** Backend spans from the `X-Piwi-Trace` response header. */
  serverTraces?: unknown;
  /** Why the request failed, as Playwright reports it (`net::ERR_CONNECTION_RESET`); absent when it finished. */
  failure?: string;
}
