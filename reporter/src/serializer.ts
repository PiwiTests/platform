import type { FullResult } from '@playwright/test/reporter';
import type { CollectedTestCase, WireTestCase } from './types.js';
import type { RunPayload } from './uploader.js';

/**
 * Resolve the overall Piwi run status from Playwright's `FullResult.status`
 * and the accumulated per-case counters.
 *
 * `passed`/`failed`/`timedout`/`interrupted` map directly; when Playwright
 * doesn't report a status, the run is `passed` only when no test failed or
 * timed out (and at least one test ran).
 */
export function resolveOverallStatus(
  result: FullResult,
  counters: { failedTests: number; timedOutTests: number; totalTests: number },
): string {
  const STATUS_MAP: Record<string, string> = {
    passed: 'passed',
    failed: 'failed',
    timedout: 'failed',
    interrupted: 'failed',
  };
  if (result?.status) return STATUS_MAP[result.status] ?? 'failed';
  if (counters.failedTests === 0 && counters.timedOutTests === 0 && counters.totalTests > 0) return 'passed';
  return 'failed';
}

/**
 * Project an internally-collected test-case object into the wire shape sent to
 * the server. Carries the `type` discriminant through so the same mapper works
 * for `begin` and `complete` stream events as well as batch submissions.
 *
 * Quirks preserved from the original in-reporter implementation:
 * - `status`/`duration`/`error`/`retries` pass through unchanged (no `null`
 *   default), so a `begin` event yields `undefined` for those fields.
 * - Numeric/array fields use `|| null` (so `0` and `''` collapse to `null`),
 *   while `workerIndex`/`shardIndex`/`startedAt`/`suitePath`/`suiteConfig`/
 *   `testAnnotations` use `?? null` (so `0` survives). Note: an empty array
 *   is truthy, so `steps: []` is preserved as `[]`, not `null`.
 */
export function toWireTestCase(tc: CollectedTestCase): WireTestCase {
  const { type, ...rest } = tc as any;
  return {
    type,
    title: rest.title,
    location: rest.location,
    status: rest.status,
    duration: rest.duration,
    error: rest.error,
    retries: rest.retries,
    workerIndex: rest.workerIndex ?? null,
    shardIndex: rest.shardIndex ?? null,
    startedAt: rest.startedAt ?? null,
    steps: rest.performanceMetrics?.steps || null,
    stepEvents: rest.stepEvents || null,
    slowestStep: rest.performanceMetrics?.slowestStep?.title || null,
    slowestStepDuration: rest.performanceMetrics?.slowestStep?.duration || null,
    networkRequests: rest.networkRequests || null,
    webVitals: rest.webVitals || null,
    consoleLogs: rest.consoleLogs || null,
    ariaSnapshot: rest.ariaSnapshot || null,
    testSource: rest.testSource || null,
    browser: rest.browser || null,
    suitePath: rest.suitePath ?? null,
    suiteConfig: rest.suiteConfig ?? null,
    testAnnotations: rest.testAnnotations ?? null,
  };
}

/** Options for `serializeRun`. */
export interface SerializeRunOptions {
  /** Include `testCases` (projected to wire shape) in the serialized body. */
  includeTestCases: boolean;
}

/**
 * Serialize a `RunPayload` into the JSON body sent to `/api/test-runs/submit`
 * (with `includeTestCases: true`) or the `testRun` form field of
 * `/api/test-runs/upload` (with `includeTestCases: false`, since the multipart
 * path appends `testCases` as a separate form field).
 *
 * This is the single source of truth for the run-level field list — adding a
 * field touches this helper plus the `RunPayload` type, not three files.
 */
export function serializeRun(payload: RunPayload, opts: SerializeRunOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    projectName: payload.projectName,
    projectDescription: payload.projectDescription,
    status: payload.status,
    startTime: payload.startTime,
    duration: payload.duration,
    totalTests: payload.totalTests,
    passedTests: payload.passedTests,
    failedTests: payload.failedTests,
    skippedTests: payload.skippedTests,
    environment: payload.environment ?? null,
    label: payload.label ?? null,
    metadata: payload.metadata,
    instanceId: payload.instanceId,
    playwrightVersion: payload.playwrightVersion,
    shardIndex: payload.shardIndex,
    shardTotal: payload.shardTotal,
    isFullRun: payload.isFullRun ?? true,
    filterDetails: payload.filterDetails ?? null,
  };
  if (opts.includeTestCases) {
    body.testCases = payload.testCases.map((tc) => toWireTestCase(tc));
  }
  return body;
}
