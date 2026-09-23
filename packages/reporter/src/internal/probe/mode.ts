/**
 * Probe-mode glue for the capture fixtures. When `piwi probe` runs Playwright it
 * sets `PIWI_PROBE=1` and points `PIWI_PROBE_PLAN` at the plan file; the capture
 * fixtures then install the fault interception for the matching test and append
 * each outcome to `PIWI_PROBE_RESULTS`. The command reads that file afterwards
 * and posts the results to the dashboard.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PIWI_PROBE_ENV } from '../config/env.js';
import { matchProbeItem, type ProbePlan, type ProbePlanItem } from './plan.js';

let planCache: ProbePlan | null | undefined;

/** True when this Playwright run is a probe run. */
export function isProbeMode(): boolean {
  return process.env[PIWI_PROBE_ENV.flag] === '1' || process.env[PIWI_PROBE_ENV.flag] === 'true';
}

function loadPlan(): ProbePlan | null {
  if (planCache !== undefined) return planCache;
  planCache = null;
  const path = process.env[PIWI_PROBE_ENV.plan];
  if (path) {
    try {
      planCache = JSON.parse(fs.readFileSync(path, 'utf8')) as ProbePlan;
    } catch {
      planCache = null;
    }
  }
  return planCache;
}

/**
 * The plan item for a running test, matched on the spec file and leaf title so a
 * title shared across specs never matches the wrong file. The file is normalized
 * to a project-root-relative POSIX path, the same shape the dashboard stores.
 */
export function probeItemForTest(test: {
  title: string;
  file?: string | null;
  titlePath?: string[];
}): ProbePlanItem | null {
  const plan = loadPlan();
  if (!plan) return null;
  const filePath = test.file ? path.relative(process.cwd(), test.file).split(path.sep).join('/') : null;
  // `titlePath` runs [file, ...describe titles, test title]; the describe titles
  // are the suite path.
  const suitePath = test.titlePath ? test.titlePath.slice(1, -1) : undefined;
  return matchProbeItem(plan, { title: test.title, filePath, suitePath });
}

/** An outcome line appended to the results file, one per probed test. */
export interface ProbeOutcomeLine {
  testCaseId: number;
  routeKey: string;
  fault: string;
  applied: boolean;
  outcome: 'noticed' | 'not-noticed' | 'inconclusive';
  /** `client` (mutated at the Playwright boundary) or `server` (signed onto the request). */
  level: 'client' | 'server';
  /** The dependency a server dependency fault targeted, so its `checks` edge can fire. */
  dependency: string | null;
  /** How the application handled a server fault, for resilience findings; `n/a` for client faults. */
  handled: string;
}

/** The resilience signals the probe collected while a server fault was applied. */
export interface ProbeResilienceSignals {
  /** Console errors logged during the probed test. */
  consoleErrors: number;
  /** Dialogs (alert/confirm/prompt) opened during the probed test. */
  dialogs: number;
  /** A backend error (5xx / error root span) rode back in the probe response's trace. */
  backendError: boolean;
}

/**
 * Classify how the application handled a server fault from the signals the probe
 * collected: a visible degradation (a console error, a dialog, or a backend
 * error) is `degraded`, anything else `graceful`. Client faults never reach here
 * — their line records `n/a`.
 */
export function classifyProbeHandled(signals: ProbeResilienceSignals): 'graceful' | 'degraded' {
  return signals.consoleErrors > 0 || signals.dialogs > 0 || signals.backendError ? 'degraded' : 'graceful';
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
  const path = process.env[PIWI_PROBE_ENV.results];
  if (!path) return;
  try {
    fs.appendFileSync(path, `${JSON.stringify(line)}\n`);
  } catch {
    // A results-file write failure must never break the run.
  }
}
