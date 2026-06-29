/**
 * Internal collection model — the shapes the reporter accumulates *in process*
 * while a run executes.
 *
 * These are NOT sent to the server verbatim: the wire projection happens in
 * `serializer.ts` (`toWireTestCase` / `serializeRun`) at the JSON boundary. For
 * the external server contract, see `./wire.ts`.
 */

import type { BrowserConfig, SuiteConfigEntry, TestAnnotation, TestStepEvent } from './wire.js';
import type { LocatorSnapshot } from '../internal/capture/locator-healing.js';

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
  locatorSnapshots?: LocatorSnapshot[];
}

/** Hash + size of a single trace file, used for dedup against the server. */
export interface TraceHashInfo {
  tracePath: string;
  hash: string;
  size: number;
}
