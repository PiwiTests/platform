/**
 * Environment incidents: a run whose failures come from the environment under
 * test being down or broken, not from the tests or the code.
 *
 * `classifyRunHealth` decides from data a finished run already stored: the
 * share of tests that failed, how many of the failures were navigating or
 * connecting to the app's host (the host of the run's `baseURL`), how many
 * were browser crashes, the largest group of failures sharing a fingerprint,
 * and whether the same host or fingerprint failed in other projects within
 * {@link INCIDENT_THRESHOLDS}' window. A flagged run carries
 * `metadata.incident` ({@link RunIncident}), which the run eligibility rule
 * reads to leave the run out of baselines, fix verification, flaky scores, the
 * selection catalog, auto-heal and notifications, and which the gate reads as
 * an inconclusive verdict.
 *
 * A person can mark a run as an incident or clear the flag
 * (`setRunIncident`). Their decision is kept in `metadata.incidentReview`, and
 * the classifier never overrides it, so a cleared flag stays cleared when the
 * run is finalized again.
 */

import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { failureClusters, markers, testRuns, testRunsCases } from '../../server/database/schema';
import { parsePlaywrightError } from '../error-parse';
import { runBaseUrls } from '../graph';
import { eligibleRunSql, isEligibleRun } from '../run-eligibility';
import {
  INCIDENT_REVIEW_METADATA_KEY,
  INCIDENT_RUN_METADATA_KEY,
  readIncidentReview,
  readRunIncident,
  type IncidentReview,
  type IncidentRule,
  type RunIncident,
  type RunIncidentRequest,
} from '../run-incident';
import { FAILED_STATUS_KEYS } from '../utils/test-counts';
import type { DrizzleDB } from './db';

/** The thresholds the classifier applies, in one place. */
export const INCIDENT_THRESHOLDS = {
  /** Fewer failing tests than this never make an incident: a tiny suite says too little. */
  minFailedTests: 3,
  /** Share of the executed tests that failed. */
  failedShare: 0.8,
  /** Share of the failures that were navigating or connecting to the app's host. */
  hostFailureShare: 0.7,
  /** Share of the failures that were browser crashes. */
  crashShare: 0.7,
  /** Share of the failures in the largest group sharing a fingerprint, for the cross-project signal. */
  fingerprintShare: 0.7,
  /** With the same host or fingerprint failing in another project, this share of failed tests is enough. */
  crossProjectFailedShare: 0.5,
  /** How far apart two projects' runs may start and still be one incident. */
  crossProjectWindowMs: 30 * 60 * 1000,
  /** Runs of other projects read for the cross-project signal. */
  crossProjectRunLimit: 20,
  /** Failing executions read per run of another project. */
  crossProjectFailureLimit: 100,
} as const;

/** Failing executions read from the run being classified. */
const FAILURE_LIMIT = 2000;

/** What one failure says about the environment. */
export interface FailureSignal {
  kind: 'connection' | 'navigation' | 'crash' | 'other';
  /** The host the failure was reaching, when the error names one. */
  host: string | null;
  /** A short phrase for the network error (`connection refused`), when there is one. */
  cause: string | null;
}

const NODE_CODE_RE =
  /\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b(?:\s+([^\s'"`,)]+))?/;
const BROWSER_PHRASE_RE = /Could not connect to (?:the )?server|Could not resolve host|socket hang up/i;
const GOTO_TIMEOUT_RE = /\b(?:page|frame)\.(?:goto|reload):\s*Timeout \d+ms exceeded/;
const ANY_URL_RE = /https?:\/\/[^\s'"`)]+/;

function causeOf(code: string): string {
  if (/REFUSED/.test(code)) return 'connection refused';
  if (/NAME_NOT_RESOLVED|UNKNOWN_HOST|ENOTFOUND|EAI_AGAIN|resolve host/i.test(code)) return 'host not found';
  if (/TIMED_OUT|TIMEOUT|ETIMEDOUT/i.test(code)) return 'timed out';
  if (/RESET|CLOSED|EMPTY_RESPONSE|hang up/i.test(code)) return 'connection reset';
  if (/CERT|SSL/.test(code)) return 'TLS error';
  return 'unreachable';
}

/** The host (with its port) of a URL, lowercased; null for anything that is not an http(s) URL. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** What a failing test's error says about the environment it ran against. */
export function readFailureSignal(error: string | null | undefined): FailureSignal {
  if (!error) return { kind: 'other', host: null, cause: null };
  const parsed = parsePlaywrightError(error);
  const urlHost = hostOf(parsed.url) ?? hostOf(ANY_URL_RE.exec(error)?.[0]);
  const node = NODE_CODE_RE.exec(error);
  const phrase = BROWSER_PHRASE_RE.exec(error);
  if (parsed.networkErrorCode || node || phrase) {
    const code = parsed.networkErrorCode ?? node?.[1] ?? phrase![0];
    const nodeHost = node?.[2] ? node[2].toLowerCase() : null;
    return { kind: 'connection', host: urlHost ?? nodeHost, cause: causeOf(code) };
  }
  if (GOTO_TIMEOUT_RE.test(error)) return { kind: 'navigation', host: urlHost, cause: 'timed out' };
  if (parsed.kind === 'crash') return { kind: 'crash', host: null, cause: null };
  return { kind: 'other', host: null, cause: null };
}

/** One failing test of the run being classified. */
export interface HealthFailure {
  error: string | null;
  /** The fingerprint of the cluster the failure joined. */
  fingerprint?: string | null;
}

/** A run of another project that started within the window. */
export interface NeighborRun {
  runId: number;
  projectId: number;
  /** Hosts its failures were navigating or connecting to. */
  hosts: string[];
  /** Fingerprints of its failures. */
  fingerprints: string[];
  /** Its incident flag, when it has one. */
  incident: Pick<RunIncident, 'host' | 'firstRunId'> | null;
}

export interface RunHealthInput {
  runId: number;
  executedTests: number;
  failedTests: number;
  failures: HealthFailure[];
  /** The run's Playwright `baseURL`s. */
  baseUrls: string[];
  neighbors?: NeighborRun[];
}

/** What the classifier measured, whether or not it flagged the run. */
export interface RunHealthMeasure {
  failedShare: number;
  host: string | null;
  hostFailures: number;
  hostFailureShare: number;
  cause: string | null;
  crashShare: number;
  /** The fingerprint shared by the most failures, and its share of them. */
  topFingerprint: string | null;
  topFingerprintShare: number;
}

/** A classifier verdict: the incident fields the rule decides. */
export type RunHealthVerdict = Omit<RunIncident, 'decidedBy' | 'by' | 'decidedAt'>;

function mostCommon(values: Array<string | null>): { value: string | null; count: number } {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: string | null; count: number } = { value: null, count: 0 };
  for (const [value, count] of counts) if (count > best.count) best = { value, count };
  return best;
}

/** The app hosts a failure counts against: the `baseURL` hosts, or the host most failures reached when none is known. */
function appHostsFor(signals: FailureSignal[], baseUrls: string[]): Set<string> {
  const hosts = new Set(baseUrls.map(hostOf).filter((h): h is string => !!h));
  if (hosts.size > 0) return hosts;
  const reaching = signals.filter((s) => s.kind === 'connection' || s.kind === 'navigation').map((s) => s.host);
  const top = mostCommon(reaching).value;
  return top ? new Set([top]) : hosts;
}

/** True for a failure navigating or connecting to one of the app's hosts. */
function hitsAppHost(signal: FailureSignal, appHosts: Set<string>): boolean {
  if (signal.kind !== 'connection' && signal.kind !== 'navigation') return false;
  if (signal.host) return appHosts.has(signal.host);
  // An error that names no address was reaching the app, when the app has one host.
  return appHosts.size === 1;
}

/** The hosts a run's failures were navigating or connecting to: what another project's run is compared on. */
export function failingHosts(errors: Array<string | null>, baseUrls: string[]): string[] {
  const signals = errors.map(readFailureSignal);
  const appHosts = appHostsFor(signals, baseUrls);
  const hosts = new Set<string>();
  for (const s of signals) {
    if (s.kind !== 'connection' && s.kind !== 'navigation') continue;
    const host = s.host ?? (appHosts.size === 1 ? [...appHosts][0]! : null);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/** Measure a run's failures against the thresholds. */
export function measureRunHealth(input: RunHealthInput): RunHealthMeasure {
  const signals = input.failures.map((f) => readFailureSignal(f.error));
  const appHosts = appHostsFor(signals, input.baseUrls);
  const hitting = signals.filter((s) => hitsAppHost(s, appHosts));
  const total = Math.max(1, signals.length);
  const hostCounts = mostCommon(hitting.map((s) => s.host ?? (appHosts.size === 1 ? [...appHosts][0]! : null)));
  const top = mostCommon(input.failures.map((f) => f.fingerprint ?? null));
  return {
    failedShare: input.executedTests > 0 ? input.failedTests / input.executedTests : 0,
    host: hostCounts.value,
    hostFailures: hitting.length,
    hostFailureShare: hitting.length / total,
    cause: mostCommon(hitting.map((s) => s.cause)).value,
    crashShare: signals.filter((s) => s.kind === 'crash').length / total,
    topFingerprint: top.value,
    topFingerprintShare: top.count / total,
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Decide whether a finished run is an environment incident. Returns null for a
 * run that is not one.
 */
export function classifyRunHealth(input: RunHealthInput): RunHealthVerdict | null {
  const t = INCIDENT_THRESHOLDS;
  if (input.failedTests < t.minFailedTests || input.failures.length < t.minFailedTests) return null;
  const m = measureRunHealth(input);
  const hostDown = m.hostFailureShare >= t.hostFailureShare && m.host !== null;
  const sharedFingerprint = m.topFingerprintShare >= t.fingerprintShare ? m.topFingerprint : null;

  const neighbors = input.neighbors ?? [];
  const related = neighbors.filter(
    (n) =>
      (hostDown && (n.hosts.includes(m.host!) || n.incident?.host === m.host)) ||
      (sharedFingerprint !== null && n.fingerprints.includes(sharedFingerprint)),
  );
  const otherProjects = [...new Set(related.map((n) => n.projectId))].sort((a, b) => a - b);

  let rule: IncidentRule | null = null;
  if (m.failedShare >= t.failedShare && hostDown) rule = 'host-unreachable';
  else if (m.failedShare >= t.failedShare && m.crashShare >= t.crashShare) rule = 'browser-crash';
  else if (m.failedShare >= t.crossProjectFailedShare && otherProjects.length > 0 && (hostDown || sharedFingerprint)) {
    rule = 'cross-project';
  }
  if (!rule) return null;

  const firstRunId = Math.min(
    input.runId,
    ...related.filter((n) => n.incident).map((n) => n.incident!.firstRunId ?? n.runId),
  );
  const head = `${input.failedTests} of ${plural(input.executedTests, 'test')} failed`;
  const what =
    rule === 'browser-crash'
      ? `, most of them because the browser crashed or closed`
      : hostDown
        ? `, ${m.hostFailures} of them navigating or connecting to ${m.host}${m.cause ? ` (${m.cause})` : ''}`
        : ', most of them with the same error';
  const elsewhere =
    otherProjects.length > 0
      ? ` The same ${hostDown ? 'host' : 'error'} failed in ${plural(otherProjects.length, 'other project')} within ${t.crossProjectWindowMs / 60_000} minutes.`
      : '';
  return {
    rule,
    reason: `${head}${what}.${elsewhere}`,
    host: hostDown ? m.host : null,
    projects: otherProjects,
    failedTests: input.failedTests,
    executedTests: input.executedTests,
    hostFailures: hostDown ? m.hostFailures : 0,
    firstRunId,
  };
}

// ── Reading and writing a run's flag ─────────────────────────────────────────

function metaRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

type RunRow = typeof testRuns.$inferSelect;

/** The run's failing tests (one per test that never passed in the run), with their cluster's fingerprint. */
async function loadFailures(db: DrizzleDB, runId: number, limit: number): Promise<HealthFailure[]> {
  const rows = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      error: testRunsCases.error,
      fingerprint: failureClusters.fingerprint,
    })
    .from(testRunsCases)
    .leftJoin(failureClusters, eq(failureClusters.id, testRunsCases.failureClusterId))
    .where(and(eq(testRunsCases.testRunId, runId), inArray(testRunsCases.status, [...FAILED_STATUS_KEYS])))
    .limit(limit);
  if (rows.length === 0) return [];
  const caseIds = [...new Set(rows.map((r) => r.testCaseId))];
  const passed = new Set(
    (
      await db
        .select({ testCaseId: testRunsCases.testCaseId })
        .from(testRunsCases)
        .where(
          and(
            eq(testRunsCases.testRunId, runId),
            eq(testRunsCases.status, 'passed'),
            inArray(testRunsCases.testCaseId, caseIds),
          ),
        )
    ).map((r) => r.testCaseId),
  );
  const byCase = new Map<number, HealthFailure>();
  for (const row of rows) {
    if (passed.has(row.testCaseId)) continue;
    const seen = byCase.get(row.testCaseId);
    if (!seen || (!seen.error && row.error))
      byCase.set(row.testCaseId, { error: row.error, fingerprint: row.fingerprint });
  }
  return [...byCase.values()];
}

/** Runs of other projects that started within the window of `run`, with what their failures reached. */
async function loadNeighbors(db: DrizzleDB, run: RunRow): Promise<NeighborRun[]> {
  const t = INCIDENT_THRESHOLDS;
  const start = run.startTime.getTime();
  const end = start + (run.duration ?? 0);
  const rows = await db
    .select({ id: testRuns.id, projectId: testRuns.projectId, metadata: testRuns.metadata })
    .from(testRuns)
    .where(
      and(
        ne(testRuns.projectId, run.projectId),
        gte(testRuns.startTime, new Date(start - t.crossProjectWindowMs)),
        lte(testRuns.startTime, new Date(end + t.crossProjectWindowMs)),
        eligibleRunSql('run-health'),
      ),
    )
    .limit(t.crossProjectRunLimit);
  const neighbors: NeighborRun[] = [];
  for (const row of rows) {
    const failures = await loadFailures(db, row.id, t.crossProjectFailureLimit);
    const incident = readRunIncident(row.metadata);
    if (failures.length === 0 && !incident) continue;
    neighbors.push({
      runId: row.id,
      projectId: row.projectId,
      hosts: failingHosts(
        failures.map((f) => f.error),
        runBaseUrls(row.metadata),
      ),
      fingerprints: [...new Set(failures.map((f) => f.fingerprint).filter((f): f is string => !!f))],
      incident: incident ? { host: incident.host, firstRunId: incident.firstRunId ?? row.id } : null,
    });
  }
  return neighbors;
}

/** Classify a stored run, reading its failures and its neighbors in other projects. */
export async function classifyStoredRun(db: DrizzleDB, run: RunRow): Promise<RunHealthVerdict | null> {
  const executedTests = (run.passedTests ?? 0) + (run.failedTests ?? 0);
  const t = INCIDENT_THRESHOLDS;
  if ((run.failedTests ?? 0) < t.minFailedTests) return null;
  if (executedTests === 0 || run.failedTests / executedTests < t.crossProjectFailedShare) return null;
  const failures = await loadFailures(db, run.id, FAILURE_LIMIT);
  const neighbors = await loadNeighbors(db, run);
  return classifyRunHealth({
    runId: run.id,
    executedTests,
    failedTests: run.failedTests,
    failures,
    baseUrls: runBaseUrls(run.metadata),
    neighbors,
  });
}

/** The label of an incident marker. */
function markerLabel(incident: RunIncident): string {
  return incident.host ? `Environment incident: ${incident.host}` : 'Environment incident';
}

/** Add the run's one incident marker, unless it has one. */
async function addIncidentMarker(db: DrizzleDB, run: RunRow, incident: RunIncident): Promise<void> {
  const existing = await db
    .select({ id: markers.id })
    .from(markers)
    .where(and(eq(markers.runId, run.id), eq(markers.category, 'incident')));
  if (existing.length > 0) return;
  await db.insert(markers).values({
    projectId: run.projectId,
    label: markerLabel(incident),
    description: incident.reason,
    occurredAt: run.startTime,
    category: 'incident',
    environment: run.environment ?? null,
    source: 'auto',
    runId: run.id,
  });
}

async function writeMetadata(db: DrizzleDB, runId: number, metadata: Record<string, unknown>): Promise<void> {
  await db.update(testRuns).set({ metadata, updatedAt: new Date() }).where(eq(testRuns.id, runId));
}

export interface RunHealthResult {
  /** The run's metadata after classification. */
  metadata: unknown;
  /** The run's incident flag, or null. */
  incident: RunIncident | null;
  /** True when this call flagged the run. */
  flagged: boolean;
}

/**
 * Classify a finished run and flag it when it is an environment incident:
 * `metadata.incident` and one `incident` marker (none with
 * `PIWI_AUTO_MARKERS=false`). A run whose origin the
 * `run-health` use leaves out, a run a person already decided on, and a run
 * already flagged are returned as they are.
 */
export async function recordRunHealth(db: DrizzleDB, runId: number, now = new Date()): Promise<RunHealthResult> {
  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) return { metadata: null, incident: null, flagged: false };
  const current = readRunIncident(run.metadata);
  if (!isEligibleRun({ metadata: run.metadata }, 'run-health') || current || readIncidentReview(run.metadata)) {
    return { metadata: run.metadata, incident: current, flagged: false };
  }
  const verdict = await classifyStoredRun(db, run);
  if (!verdict) return { metadata: run.metadata, incident: null, flagged: false };
  const incident: RunIncident = { ...verdict, decidedBy: 'rule', decidedAt: now.toISOString() };
  const metadata = { ...metaRecord(run.metadata), [INCIDENT_RUN_METADATA_KEY]: incident };
  await writeMetadata(db, run.id, metadata);
  const autoMarkersOff = typeof process !== 'undefined' && process.env?.PIWI_AUTO_MARKERS === 'false';
  if (!autoMarkersOff) await addIncidentMarker(db, run, incident);
  return { metadata, incident, flagged: true };
}

export interface SetRunIncidentInput extends RunIncidentRequest {
  /** Who decided: a user's name, or null with auth off. */
  by: string | null;
}

/** What a run's incident state reads as, for the run page and the route's answer. */
export interface RunIncidentState {
  runId: number;
  incident: RunIncident | null;
  review: IncidentReview | null;
}

/**
 * A person marks a run as an environment incident, or clears its flag. Marking
 * adds the run's incident marker; clearing removes the marker the classifier
 * added. Either way the decision is kept so the classifier never overrides it.
 */
export async function setRunIncident(
  db: DrizzleDB,
  runId: number,
  input: SetRunIncidentInput,
  now = new Date(),
): Promise<RunIncidentState> {
  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) throw new Error('Test run not found');
  const review: IncidentReview = {
    decision: input.incident ? 'marked' : 'cleared',
    by: input.by,
    at: now.toISOString(),
  };
  const meta = metaRecord(run.metadata);
  meta[INCIDENT_REVIEW_METADATA_KEY] = review;

  if (input.incident) {
    const executedTests = (run.passedTests ?? 0) + (run.failedTests ?? 0);
    const measured = measureRunHealth({
      runId: run.id,
      executedTests,
      failedTests: run.failedTests ?? 0,
      failures: await loadFailures(db, run.id, FAILURE_LIMIT),
      baseUrls: runBaseUrls(run.metadata),
    });
    const host = measured.hostFailureShare >= INCIDENT_THRESHOLDS.hostFailureShare ? measured.host : null;
    const previous = readRunIncident(run.metadata);
    const incident: RunIncident = {
      rule: 'person',
      reason:
        input.reason ??
        `${input.by ? `${input.by} marked` : 'Marked'} the run as an environment incident: ${run.failedTests ?? 0} of ${plural(executedTests, 'test')} failed.`,
      host,
      projects: previous?.projects ?? [],
      failedTests: run.failedTests ?? 0,
      executedTests,
      hostFailures: host ? measured.hostFailures : 0,
      decidedBy: 'person',
      by: input.by,
      decidedAt: now.toISOString(),
      firstRunId: previous?.firstRunId ?? run.id,
    };
    meta[INCIDENT_RUN_METADATA_KEY] = incident;
    await writeMetadata(db, run.id, meta);
    await addIncidentMarker(db, run, incident);
    return { runId: run.id, incident, review };
  }

  delete meta[INCIDENT_RUN_METADATA_KEY];
  await writeMetadata(db, run.id, meta);
  await db
    .delete(markers)
    .where(and(eq(markers.runId, run.id), eq(markers.category, 'incident'), eq(markers.source, 'auto')));
  return { runId: run.id, incident: null, review };
}
