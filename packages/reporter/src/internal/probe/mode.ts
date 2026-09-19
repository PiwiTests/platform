/**
 * Probe-mode glue for the capture fixtures. When `piwi probe` runs Playwright it
 * sets `PIWI_PROBE=1` and points `PIWI_PROBE_PLAN` at the plan file; the capture
 * fixtures then install the fault interception for the matching test and append
 * each outcome to `PIWI_PROBE_RESULTS`. The command reads that file afterwards
 * and posts the results to the dashboard.
 */

import * as fs from 'node:fs';
import { matchProbeItem, type ProbePlan, type ProbePlanItem } from './plan.js';

let planCache: ProbePlan | null | undefined;

/** True when this Playwright run is a probe run. */
export function isProbeMode(): boolean {
  return process.env.PIWI_PROBE === '1' || process.env.PIWI_PROBE === 'true';
}

function loadPlan(): ProbePlan | null {
  if (planCache !== undefined) return planCache;
  planCache = null;
  const path = process.env.PIWI_PROBE_PLAN;
  if (path) {
    try {
      planCache = JSON.parse(fs.readFileSync(path, 'utf8')) as ProbePlan;
    } catch {
      planCache = null;
    }
  }
  return planCache;
}

/** The plan item for a running test, matched by title (or location when set). */
export function probeItemForTest(test: { title: string; location?: string | null }): ProbePlanItem | null {
  const plan = loadPlan();
  if (!plan) return null;
  return matchProbeItem(plan, { title: test.title, location: test.location ?? null });
}

/** An outcome line appended to the results file, one per probed test. */
export interface ProbeOutcomeLine {
  testCaseId: number;
  routeKey: string;
  fault: string;
  applied: boolean;
  outcome: 'noticed' | 'not-noticed' | 'inconclusive';
}

/**
 * The probe outcome from a test's status: a failed or timed-out test *noticed*
 * the injected fault; a passing test did *not*. An unapplied fault (the request
 * never fired) is inconclusive.
 */
export function outcomeFromStatus(status: string | undefined, applied: boolean): ProbeOutcomeLine['outcome'] {
  if (!applied) return 'inconclusive';
  return status === 'failed' || status === 'timedOut' || status === 'interrupted' ? 'noticed' : 'not-noticed';
}

/** Append one probe outcome to the results file, best-effort (JSON lines). */
export function recordProbeOutcome(line: ProbeOutcomeLine): void {
  const path = process.env.PIWI_PROBE_RESULTS;
  if (!path) return;
  try {
    fs.appendFileSync(path, `${JSON.stringify(line)}\n`);
  } catch {
    // A results-file write failure must never break the run.
  }
}
