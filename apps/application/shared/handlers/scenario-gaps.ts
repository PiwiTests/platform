/**
 * Scenario gaps — proposing tests that do not exist yet from the feature graph
 * plus history. The detectors are pure functions over pre-loaded data so the
 * demo runs the same code; the orchestrators load that data and upsert the
 * `scenario_gaps` ledger, preserving triage across recomputation.
 *
 * Honest by construction: every "no test in this run" is paired with the count
 * from recent history, and the word used is *observed reach*, never coverage.
 */

import { and, count, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  failureClusters,
  graphEdges,
  graphNodes,
  networkRequests,
  scenarioGaps,
  testCases,
  testFunctions,
  testRuns,
} from '../../server/database/schema';
import { fileRouteTarget, filePageTarget, routeKeyMatchesTarget, pageKeyMatchesTarget } from '../graph';
import { isProbeRun } from './probes';
import type { DrizzleDB } from './db';

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type GapKind = 'gap' | 'finding';
export type GapClass = 'blind-spot' | 'false-comfort' | 'fragile' | 'unhandled' | 'degraded';
export type GapStatus = 'open' | 'snoozed' | 'dismissed' | 'accepted' | 'closed';

/** The window of recent runs every honest evidence line is measured against. */
export const HISTORY_WINDOW_RUNS = 30;
/** Extra recent runs fetched beyond the window so excluded probe runs don't shrink it. */
const PROBE_RUN_WINDOW_BUFFER = 20;
/** A route must be seen at least this many times before "always success" is a claim. */
const SUCCESS_ONLY_MIN_OBSERVATIONS = 5;
/** Each exposure factor is clamped here so a missing input can never zero a row. */
export const FACTOR_FLOOR = 0.1;

// ── Detected + scored shapes ─────────────────────────────────────────────────

/** A gap a detector proposes, before exposure ranking. */
export interface DetectedGap {
  detector: string;
  kind: GapKind;
  class: GapClass;
  /** Stable identity within `(project, detector)` so triage survives recompute. */
  key: string;
  title: string;
  evidence: string[];
  /** 0–1 — how strongly the evidence says this is a real gap. */
  confidence: number;
  testCaseId?: number | null;
  ticket?: string | null;
  /** The failure cluster this gap is about, when it is cluster-shaped. */
  failureClusterId?: number | null;
  /** Files whose churn/age/escape define exposure, when the gap is file-shaped. */
  files?: string[];
  /** `piwi:priority` observed around the subject, when known. */
  priority?: string | null;
}

/** The exposure factors behind a gap's rank, each in `[0.1, 1]`. */
export interface ExposureFactors {
  churn: number;
  age: number;
  escapeHistory: number;
  priority: number;
}

export interface ScoredGap extends DetectedGap {
  factors: ExposureFactors;
  score: number;
}

/** Per-file exposure inputs the server computes from the SCM providers. */
export interface FileExposure {
  /** Commits touching the file in the last 90 days. */
  churn?: number;
  /** Age of the file's first commit, in days. */
  ageDays?: number;
  /** True when the file appears in a cluster's first-bad or fixing commit. */
  escaped?: boolean;
}

export interface ExposureInputs {
  /** Keyed by file path; absent files fall back to the neutral floor. */
  files?: Map<string, FileExposure>;
}

// ── Exposure scoring (pure) ──────────────────────────────────────────────────

export function clampFactor(value: number): number {
  if (!Number.isFinite(value)) return FACTOR_FLOOR;
  return Math.max(FACTOR_FLOOR, Math.min(1, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Map a `piwi:priority` tag to its exposure factor. */
export function priorityFactor(priority: string | null | undefined): number {
  switch (priority) {
    case 'critical':
      return 1;
    case 'high':
      return 0.7;
    case 'medium':
      return 0.4;
    case 'low':
      return 0.2;
    default:
      return FACTOR_FLOOR;
  }
}

/** Commits in 90 days → a churn factor; ~12+ commits saturates. */
function churnFactor(commits: number | undefined): number {
  if (!commits || commits <= 0) return FACTOR_FLOOR;
  return clampFactor(commits / 12);
}

/** Older files rank up — escaped defects concentrate in old, churned code. */
function ageFactor(ageDays: number | undefined): number {
  if (!ageDays || ageDays <= 0) return FACTOR_FLOOR;
  return clampFactor(ageDays / 365);
}

/**
 * Fold a gap's per-file exposure and observed priority into the four factors.
 * A file-shaped gap draws churn, age and escape from its files; a gap with no
 * file mapping keeps those at the floor, so it can never outrank a changed file.
 */
export function exposureFactorsFor(gap: DetectedGap, inputs: ExposureInputs): ExposureFactors {
  let churn = FACTOR_FLOOR;
  let age = FACTOR_FLOOR;
  let escapeHistory = FACTOR_FLOOR;

  const files = gap.files ?? [];
  for (const file of files) {
    const fx = inputs.files?.get(file);
    if (!fx) continue;
    churn = Math.max(churn, churnFactor(fx.churn));
    age = Math.max(age, ageFactor(fx.ageDays));
    if (fx.escaped) escapeHistory = 1;
  }

  return {
    churn,
    age,
    escapeHistory,
    priority: priorityFactor(gap.priority),
  };
}

/** exposure = churn × age × escape × priority; gap score = exposure × confidence. */
export function scoreGap(gap: DetectedGap, factors: ExposureFactors): number {
  const exposure = factors.churn * factors.age * factors.escapeHistory * factors.priority;
  return clamp01(gap.confidence) * exposure;
}

/** Attach exposure factors and a score to a detected gap. */
export function rankGap(gap: DetectedGap, inputs: ExposureInputs): ScoredGap {
  const factors = exposureFactorsFor(gap, inputs);
  return { ...gap, factors, score: scoreGap(gap, factors) };
}

// ── Detectors (pure) ─────────────────────────────────────────────────────────

/** Observed statuses of one route pattern over the recent window. */
export interface RouteStat {
  key: string;
  method: string;
  pattern: string;
  count: number;
  statuses: number[];
  priority?: string | null;
  /** Documented response codes from a declared manifest/OpenAPI, when known. */
  documentedCodes?: number[];
}

/**
 * Success only — a route whose observed statuses are all 2xx/3xx, so its error
 * paths were never exercised. Blind spot. Strengthened when a declared manifest
 * documents error codes the route never returned under test: the evidence names
 * them and the next step is the error path per documented code.
 */
export function detectSuccessOnly(routes: RouteStat[], windowRuns = HISTORY_WINDOW_RUNS): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const route of routes) {
    if (route.count < SUCCESS_ONLY_MIN_OBSERVATIONS) continue;
    const statuses = [...new Set(route.statuses)].sort((a, b) => a - b);
    if (statuses.length === 0) continue;
    if (!statuses.every((s) => s >= 200 && s < 400)) continue;

    const observed = new Set(statuses);
    const documentedErrors = [...new Set(route.documentedCodes ?? [])]
      .filter((c) => c >= 400 && !observed.has(c))
      .sort((a, b) => a - b);

    const range =
      statuses.length === 1 ? `always ${statuses[0]}` : `only ${statuses[0]}–${statuses[statuses.length - 1]}`;
    const base = `Observed ${route.count} times over the last ${windowRuns} runs, ${range} — observed reach, no error path exercised.`;
    const evidence =
      documentedErrors.length > 0
        ? [base, `Documents ${documentedErrors.join(', ')} — never returned under test.`]
        : [base];
    gaps.push({
      detector: 'success-only',
      kind: 'gap',
      class: 'blind-spot',
      key: route.key,
      title:
        documentedErrors.length > 0
          ? `${route.method} ${route.pattern}: documented ${documentedErrors.join('/')} never tested`
          : `${route.method} ${route.pattern}: no error path under test`,
      evidence,
      confidence: clamp01(route.count / (SUCCESS_ONLY_MIN_OBSERVATIONS * 4) + (documentedErrors.length > 0 ? 0.3 : 0)),
      priority: route.priority ?? null,
    });
  }
  return gaps;
}

/** A declared route/page node and how many tests reach it. */
export interface DeclaredNode {
  nodeKind: 'route' | 'page';
  nodeKey: string;
  origin: 'manifest' | 'openapi';
  reachCount: number;
  /** Documented response codes, for a route declared via OpenAPI. */
  documentedCodes?: number[];
  priority?: string | null;
}

/**
 * Declared, never hit — a node the application declares (a manifest or OpenAPI
 * route, a declared page) that no test reaches. Blind spot. The origin is named
 * so "declared and never observed" is never confused with "never observed at
 * all".
 */
export function detectDeclaredNeverHit(nodes: DeclaredNode[], windowRuns = HISTORY_WINDOW_RUNS): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const node of nodes) {
    if (node.reachCount > 0) continue;
    const where = node.origin === 'openapi' ? 'OpenAPI' : 'the manifest';
    const codes =
      node.nodeKind === 'route' && node.documentedCodes?.length
        ? ` · documents ${[...new Set(node.documentedCodes)].sort((a, b) => a - b).join(', ')}`
        : '';
    gaps.push({
      detector: 'declared-never-hit',
      kind: 'gap',
      class: 'blind-spot',
      key: `${node.nodeKind}:${node.nodeKey}`,
      title: `Declared ${node.nodeKind} ${node.nodeKey} — never reached`,
      evidence: [`Declared in ${where} · 0 tests in ${windowRuns} runs${codes} — observed reach.`],
      confidence: 0.7,
      priority: node.priority ?? null,
    });
  }
  return gaps;
}

/** A node's reach — which test cases observably exercise it. */
export interface NodeReach {
  nodeKind: string;
  nodeKey: string;
  /** Distinct test cases reaching this node, each with its display title. */
  tests: Array<{ testCaseId: number; title: string; priority?: string | null }>;
}

/**
 * Single covering test — a node reached by exactly one test. Fragile: one flaky
 * or quarantined test away from no coverage at all.
 */
export function detectSingleCoveringTest(nodes: NodeReach[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const node of nodes) {
    if (node.tests.length !== 1) continue;
    const only = node.tests[0]!;
    gaps.push({
      detector: 'single-covering-test',
      kind: 'gap',
      class: 'fragile',
      key: `${node.nodeKind}:${node.nodeKey}`,
      title: `Only one test reaches ${node.nodeKind} ${node.nodeKey}`,
      evidence: [`Only ${only.title} reaches this — observed reach. A second scenario would make it resilient.`],
      confidence: 0.5,
      testCaseId: only.testCaseId,
      priority: only.priority ?? null,
    });
  }
  return gaps;
}

/** A node with its first- and last-seen runs and reach count. */
export interface NodeDrift {
  nodeKind: string;
  nodeKey: string;
  firstSeenRunId: number | null;
  reachCount: number;
  priority?: string | null;
}

/**
 * Surface drift — a node first seen in the latest run. New surface the suite may
 * not yet exercise deliberately; the reach count is stated honestly.
 */
export function detectSurfaceDrift(nodes: NodeDrift[], latestRunId: number | null): DetectedGap[] {
  if (latestRunId == null) return [];
  const gaps: DetectedGap[] = [];
  for (const node of nodes) {
    if (node.firstSeenRunId !== latestRunId) continue;
    gaps.push({
      detector: 'surface-drift',
      kind: 'gap',
      class: 'blind-spot',
      key: `${node.nodeKind}:${node.nodeKey}`,
      title: `New ${node.nodeKind} ${node.nodeKey} — confirm it is tested`,
      evidence: [
        `Appeared in run #${latestRunId}, reached by ${node.reachCount} test${node.reachCount === 1 ? '' : 's'} so far — observed reach.`,
      ],
      confidence: 0.4,
      priority: node.priority ?? null,
    });
  }
  return gaps;
}

/** One changed file and whether any test reached it, in this run and history. */
export interface ChangedFileReach {
  filePath: string;
  additions: number;
  deletions: number;
  reachedInRun: boolean;
  reachedCountHistory: number;
  /**
   * Whether reach is observable for this file. `no-evidence` means no route or
   * page convention maps it and no test source touches it, so its unreached
   * state is not a confident gap. Absent is treated as observable.
   */
  reachBasis?: 'reached' | 'observable-unreached' | 'no-evidence';
  ticket?: string | null;
}

/**
 * Changed, unreached — a changed source file no test reached in this run, paired
 * with its history count so a selection-narrowed run is never mistaken for a
 * gap. Blind spot, reported per ticket at change time. A file the graph cannot
 * observe (no route or page maps it, no test source touches it) is reported at
 * low confidence and says so, rather than as a strong blind spot.
 */
export function detectChangedUnreached(
  files: ChangedFileReach[],
  runId: number,
  windowRuns = HISTORY_WINDOW_RUNS,
): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const file of files) {
    if (file.reachedInRun) continue;
    const noEvidence = file.reachBasis === 'no-evidence';
    const base = `+${file.additions} −${file.deletions} · no test in run #${runId} · ${file.reachedCountHistory} in ${windowRuns} runs — observed reach.`;
    gaps.push({
      detector: 'changed-unreached',
      kind: 'gap',
      class: 'blind-spot',
      key: file.filePath,
      title: `${file.filePath} changed but not reached`,
      evidence: noEvidence
        ? [base, 'No route or page maps this file and no test source touches it — no observed-reach evidence.']
        : [base],
      confidence: noEvidence ? 0.3 : file.reachedCountHistory === 0 ? 0.9 : 0.5,
      files: [file.filePath],
      ticket: file.ticket ?? null,
    });
  }
  return gaps;
}

// ── M2 detectors (pure) ──────────────────────────────────────────────────────

/** A control node and how the suite touches it. */
export interface ControlReach {
  key: string;
  /** Number of pages that contain this control. */
  pageCount: number;
  /** Distinct tests whose locators target it. */
  reachCount: number;
}

/**
 * Control nobody exercises — a control the suite has seen on a page but no
 * locator ever targets. Blind spot.
 */
export function detectControlNobodyExercises(controls: ControlReach[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const c of controls) {
    if (c.reachCount > 0) continue;
    if (c.pageCount === 0) continue;
    gaps.push({
      detector: 'control-nobody-exercises',
      kind: 'gap',
      class: 'blind-spot',
      key: `control:${c.key}`,
      title: `No test exercises control ${c.key}`,
      evidence: [`On ${c.pageCount} page${c.pageCount === 1 ? '' : 's'} · no locator targets it — observed reach.`],
      confidence: clamp01(0.3 + Math.min(0.5, c.pageCount / 10)),
    });
  }
  return gaps;
}

/** A page node, whether a test reached it, and how many pages link to it. */
export interface PageLinkReach {
  key: string;
  reached: boolean;
  linkedFrom: number;
}

/**
 * Reachable, unvisited — a page linked from other pages that no test ever
 * navigates to. Blind spot.
 */
export function detectReachableUnvisited(pages: PageLinkReach[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const p of pages) {
    if (p.reached || p.linkedFrom === 0) continue;
    gaps.push({
      detector: 'reachable-unvisited',
      kind: 'gap',
      class: 'blind-spot',
      key: `page:${p.key}`,
      title: `${p.key} is linked but never visited`,
      evidence: [
        `Linked from ${p.linkedFrom} page${p.linkedFrom === 1 ? '' : 's'} · never navigated to — observed reach.`,
      ],
      confidence: clamp01(0.4 + Math.min(0.4, p.linkedFrom / 10)),
    });
  }
  return gaps;
}

/** A route node, whether a test reaches it, and whether a control/page drives it. */
export interface RouteEntryReach {
  key: string;
  reached: boolean;
  hasTrigger: boolean;
  hasLoad: boolean;
}

/**
 * API-only route — a route the suite reaches only through request fixtures: no
 * control triggers it and no page loads it. Blind spot (or headless by design).
 */
export function detectApiOnlyRoute(routes: RouteEntryReach[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const r of routes) {
    if (!r.reached || r.hasTrigger || r.hasLoad) continue;
    gaps.push({
      detector: 'api-only-route',
      kind: 'gap',
      class: 'blind-spot',
      key: `route:${r.key}`,
      title: `${r.key} is reached only by request fixtures`,
      evidence: [
        `No control triggers it and no page loads it — an API-level scenario, or nothing if headless by design.`,
      ],
      confidence: 0.35,
    });
  }
  return gaps;
}

/**
 * All probe outcomes for one route, aggregated across the tests that probed it.
 * Several tests can probe one route with opposite outcomes, so the outcomes are
 * kept per test and reduced deterministically rather than letting the last edge
 * in database order decide.
 */
export interface CheckOutcome {
  routeKey: string;
  /** True when at least one trusted test noticed a probe on this route. */
  noticed: boolean;
  /** The tests whose probe went unnoticed, each with the fault it saw. */
  notNoticed: Array<{ testCaseId: number; title: string; fault: string | null }>;
  /** Exposure proxy — how many tests reach the node. */
  exposure: number;
}

/** A node must be at least this exposed for a not-noticed probe to be a gap. */
const NOT_NOTICED_MIN_EXPOSURE = 1;

/**
 * Not noticed — a probe made a route return garbage and every test still passed.
 * The most dangerous class: the catalog says it is covered. False comfort. A
 * route that any trusted test noticed is checked, so it is never a gap even when
 * another test did not notice; a gap names the tests that did not.
 */
export function detectNotNoticed(checks: CheckOutcome[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const c of checks) {
    if (c.noticed || c.notNoticed.length === 0) continue;
    if (c.exposure < NOT_NOTICED_MIN_EXPOSURE) continue;
    const tests = [...c.notNoticed].sort((a, b) => a.testCaseId - b.testCaseId);
    const fault = tests[0]!.fault ? ` (${tests[0]!.fault})` : '';
    const names = tests.map((t) => t.title).join(', ');
    gaps.push({
      detector: 'not-noticed',
      kind: 'gap',
      class: 'false-comfort',
      key: `route:${c.routeKey}`,
      title: `Tests pass when ${c.routeKey} breaks`,
      evidence: [
        `A probe${fault} on ${c.routeKey} did not make ${names} fail — assert the effect the request should have.`,
      ],
      confidence: 0.8,
    });
  }
  return gaps;
}

/** A test and the set of nodes it reaches, each with whether it was seen recently. */
export interface TestReachRecency {
  testCaseId: number;
  title: string;
  /** Nodes this test reaches; empty means it reaches nothing observable. */
  reachedNodes: Array<{ seenRecently: boolean }>;
  priority?: string | null;
}

/**
 * Orphan test — a test whose every reached node vanished from the recent window.
 * Fragile: it may be exercising surface that no longer exists.
 */
export function detectOrphanTest(tests: TestReachRecency[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const t of tests) {
    if (t.reachedNodes.length === 0) continue;
    if (t.reachedNodes.some((n) => n.seenRecently)) continue;
    gaps.push({
      detector: 'orphan-test',
      kind: 'gap',
      class: 'fragile',
      key: `test:${t.testCaseId}`,
      title: `${t.title} reaches only vanished surface`,
      evidence: [
        `All ${t.reachedNodes.length} node${t.reachedNodes.length === 1 ? '' : 's'} it reaches disappeared from recent runs — retire or repoint it.`,
      ],
      confidence: 0.4,
      testCaseId: t.testCaseId,
      priority: t.priority ?? null,
    });
  }
  return gaps;
}

/** A failure cluster whose fix later regressed. */
export interface RegressedCluster {
  clusterId: number;
  title: string;
  fixCommit?: string | null;
  daysSinceFix?: number | null;
}

/** Fix did not hold — a cluster that was fixed and then regressed. Fragile. */
export function detectFixDidNotHold(clusters: RegressedCluster[]): DetectedGap[] {
  return clusters.map((c) => ({
    detector: 'fix-did-not-hold',
    kind: 'gap' as const,
    class: 'fragile' as const,
    key: `cluster:${c.clusterId}`,
    title: `A fix for "${c.title}" did not hold`,
    evidence: [
      c.fixCommit
        ? `Fixed in ${c.fixCommit.slice(0, 7)}${c.daysSinceFix != null ? ` · regressed ${c.daysSinceFix} day${c.daysSinceFix === 1 ? '' : 's'} later` : ' · regressed since'} — a regression test would pin it.`
        : `Fixed once and regressed — a regression test would pin it.`,
    ],
    confidence: 0.6,
    failureClusterId: c.clusterId,
  }));
}

/** A test's phantom status: skipped/fixme/did-not-run/blocked for how long. */
export interface PhantomTest {
  testCaseId: number;
  title: string;
  /** 'skipped' | 'didnotrun' | 'fixme' | 'blocked'. */
  reason: string;
  daysStale: number;
}

/** A phantom is only reported once it has been stale this long. */
const PHANTOM_MIN_DAYS = 30;

/**
 * Phantom coverage — a test skipped, fixme, did-not-run or blocked for over a
 * month. Fragile: it discounts every node it used to reach. Also lowers the
 * reach factor of those nodes (handled by the caller).
 */
export function detectPhantomCoverage(tests: PhantomTest[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const t of tests) {
    if (t.daysStale < PHANTOM_MIN_DAYS) continue;
    gaps.push({
      detector: 'phantom-coverage',
      kind: 'gap',
      class: 'fragile',
      key: `test:${t.testCaseId}`,
      title: `${t.title} has not really run in ${t.daysStale} days`,
      evidence: [`${t.reason} ${t.daysStale} days · it no longer protects the nodes it used to reach.`],
      confidence: clamp01(0.3 + Math.min(0.5, t.daysStale / 120)),
      testCaseId: t.testCaseId,
    });
  }
  return gaps;
}

/** A passing execution that logged an error the suite ignored. */
export interface PassedWithError {
  testCaseId: number;
  title: string;
  /** A short description of the error, e.g. 'POST /api/audit returned 500 in background'. */
  detail: string;
}

/**
 * Passed with errors — a test passed while a console error, a backend Error log
 * or a background 5xx went unremarked. False comfort.
 */
export function detectPassedWithErrors(execs: PassedWithError[]): DetectedGap[] {
  return execs.map((e) => ({
    detector: 'passed-with-errors',
    kind: 'gap' as const,
    class: 'false-comfort' as const,
    key: `test:${e.testCaseId}`,
    title: `${e.title} passed with errors`,
    evidence: [`Passed · ${e.detail} — assert no server errors occur during this flow.`],
    confidence: 0.6,
    testCaseId: e.testCaseId,
  }));
}

/** A catalog method and whether any test calls it, plus whether its page is reached. */
export interface CatalogMethodReach {
  module: string;
  name: string;
  callCount: number;
  pageReachedBy: number;
}

/**
 * Catalog method, no test calls — a page-object method the catalog owns that no
 * test calls, on a page the suite reaches. The cheapest gap: the steps exist.
 */
export function detectCatalogMethodNoTestCalls(methods: CatalogMethodReach[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const m of methods) {
    if (m.callCount > 0) continue;
    if (m.pageReachedBy === 0) continue;
    gaps.push({
      detector: 'catalog-method-no-test-calls',
      kind: 'gap',
      class: 'blind-spot',
      key: `catalog:${m.module}#${m.name}`,
      title: `${m.name} is never called`,
      evidence: [
        `${m.module} · ${m.name} · page reached by ${m.pageReachedBy}, called by 0 — the cheapest gap, its steps already exist.`,
      ],
      confidence: 0.5,
    });
  }
  return gaps;
}

/** A cluster diagnosis and whether its cause maps to any affected test's identity. */
export interface IncidentalCatchInput {
  clusterId: number;
  causeFile: string;
  /** The test that caught it, for the evidence line. */
  catcherTitle: string;
  /** True when the cause file appears in an affected test's title, tags, feature or reach. */
  causeInAffectedIdentity: boolean;
}

/**
 * Incidental catch — a cluster's diagnosed cause is in a file none of the tests
 * that failed are actually about; they caught it by accident. Fragile.
 */
export function detectIncidentalCatch(inputs: IncidentalCatchInput[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const i of inputs) {
    if (i.causeInAffectedIdentity) continue;
    gaps.push({
      detector: 'incidental-catch',
      kind: 'gap',
      class: 'fragile',
      key: `cluster:${i.clusterId}`,
      title: `${i.causeFile} is caught only incidentally`,
      evidence: [
        `Cause ${i.causeFile} · caught by ${i.catcherTitle}, which is not about it — a targeted regression test would pin it.`,
      ],
      confidence: 0.45,
      files: [i.causeFile],
      failureClusterId: i.clusterId,
    });
  }
  return gaps;
}

/** A page and its assertion strength: tests on it and how many assert on data. */
export interface AssertionLightPage {
  pageKey: string;
  testCount: number;
  /** Tests with a data (non-visibility) `expect` on this page. */
  dataAssertions: number;
}

/**
 * Assertion-light — tests reach a page but none makes a data assertion on it.
 * The false-comfort prior before a probe runs.
 */
export function detectAssertionLight(pages: AssertionLightPage[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const p of pages) {
    if (p.testCount === 0 || p.dataAssertions > 0) continue;
    gaps.push({
      detector: 'assertion-light',
      kind: 'gap',
      class: 'false-comfort',
      key: `page:${p.pageKey}`,
      title: `${p.pageKey} is asserted only by visibility`,
      evidence: [
        `${p.testCount} test${p.testCount === 1 ? '' : 's'}, 0 data assertions on this page — schedule a probe, or add one assertion.`,
      ],
      confidence: 0.4,
    });
  }
  return gaps;
}

// ── M2 change-time detectors (pure) ──────────────────────────────────────────

/** A commit or ticket intent and whether any test matches its words. */
export interface IntentInput {
  /** The intent text (commit/PR title). */
  title: string;
  ticket?: string | null;
  /** True when a test title, tag or feature matched the intent's words. */
  matchedByTest: boolean;
  files?: string[];
}

/**
 * Intent without a test — a commit or PR whose words match no test title, tag or
 * feature. Blind spot, reported at change time.
 */
export function detectIntentWithoutTest(intents: IntentInput[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const i of intents) {
    if (i.matchedByTest) continue;
    gaps.push({
      detector: 'intent-without-test',
      kind: 'gap',
      class: 'blind-spot',
      key: `intent:${i.ticket ?? i.title}`,
      title: `No test mentions "${i.title}"`,
      evidence: [
        `${i.title} · no test title, tag or feature matches — a regression test drafted from the diff and message.`,
      ],
      confidence: 0.4,
      ticket: i.ticket ?? null,
      files: i.files,
    });
  }
  return gaps;
}

/** A hunk that adds a thrown error or status code to a route's handler. */
export interface NewErrorPathInput {
  routeKey: string;
  addedStatus: number;
  filePath: string;
}

/**
 * New error path — a hunk adds a thrown error or a status to a handler with a
 * route node, and that status was never observed. Blind spot.
 */
export function detectNewErrorPath(inputs: NewErrorPathInput[]): DetectedGap[] {
  return inputs.map((i) => ({
    detector: 'new-error-path',
    kind: 'gap' as const,
    class: 'blind-spot' as const,
    key: `route:${i.routeKey}:${i.addedStatus}`,
    title: `${i.routeKey} gains a ${i.addedStatus} nobody tests`,
    evidence: [`Adds ${i.addedStatus} to ${i.routeKey} · never observed — a scenario for that code.`],
    confidence: 0.55,
    files: [i.filePath],
  }));
}

/** A hunk that adds a control to a template whose page the suite reaches. */
export interface NewControlInput {
  pageKey: string;
  control: string;
  filePath: string;
  pageReached: boolean;
}

/** New control — a hunk adds a field/button/menu item to a reached page. Blind spot. */
export function detectNewControl(inputs: NewControlInput[]): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const i of inputs) {
    if (!i.pageReached) continue;
    gaps.push({
      detector: 'new-control',
      kind: 'gap',
      class: 'blind-spot',
      key: `control:${i.pageKey}:${i.control}`,
      title: `New control ${i.control} on ${i.pageKey}`,
      evidence: [`Adds ${i.control} on ${i.pageKey} · a scenario that exercises it.`],
      confidence: 0.5,
      files: [i.filePath],
    });
  }
  return gaps;
}

/** A hunk that removes a locator anchor a control node's snapshot still relies on. */
export interface LocatorBreakInput {
  removedAttr: string;
  filePath: string;
  /** Call sites whose stored locator uses the removed attribute. */
  callSites: string[];
}

/** A prediction handed to locator healing — not a gap. */
export interface LocatorBreakPrediction {
  detector: 'locator-break-ahead';
  removedAttr: string;
  filePath: string;
  callSites: string[];
  evidence: string;
}

/**
 * Locator break ahead — a diff removes a testid/id/name a control node's stored
 * locator relies on. A prediction handed to locator healing as a pre-flight, not
 * a scenario gap.
 */
export function detectLocatorBreakAhead(inputs: LocatorBreakInput[]): LocatorBreakPrediction[] {
  return inputs
    .filter((i) => i.callSites.length > 0)
    .map((i) => ({
      detector: 'locator-break-ahead' as const,
      removedAttr: i.removedAttr,
      filePath: i.filePath,
      callSites: i.callSites,
      evidence: `Removes ${i.removedAttr} · ${i.callSites.length} call site${i.callSites.length === 1 ? '' : 's'} — heal before the run fails.`,
    }));
}

// ── Loaders + orchestration (impure) ─────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** The higher-priority tag among a set, or null when none is set. */
function maxPriority(
  ids: Iterable<number>,
  meta: Map<number, { title: string; priority: string | null }>,
): string | null {
  let best: string | null = null;
  for (const id of ids) {
    const p = meta.get(id)?.priority ?? null;
    if (p && (best == null || (PRIORITY_RANK[p] ?? 0) > (PRIORITY_RANK[best] ?? 0))) best = p;
  }
  return best;
}

/**
 * Ids of a project's most recent real runs, newest first. Probe runs are
 * excluded — their injected faults must never enter the detectors' history
 * window — so a buffer beyond the window is fetched to keep it full.
 */
async function loadRecentRunIds(db: DrizzleDB, projectId: number, limit: number): Promise<number[]> {
  const rows = await db
    .select({ id: testRuns.id, metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.id))
    .limit(limit + PROBE_RUN_WINDOW_BUFFER);
  return rows
    .filter((r) => !isProbeRun(r.metadata))
    .slice(0, limit)
    .map((r) => r.id);
}

/** Title + priority for a set of test cases. */
async function loadTestMeta(
  db: DrizzleDB,
  ids: number[],
): Promise<Map<number, { title: string; priority: string | null }>> {
  const meta = new Map<number, { title: string; priority: string | null }>();
  if (ids.length === 0) return meta;
  const rows = await db
    .select({ id: testCases.id, title: testCases.title, priority: testCases.priority })
    .from(testCases)
    .where(inArray(testCases.id, ids));
  for (const r of rows) meta.set(r.id, { title: r.title, priority: r.priority ?? null });
  return meta;
}

/**
 * Observed route statuses over the recent window, one row per pattern, kept only
 * for patterns the graph holds as route nodes. Route nodes are written on ingest
 * from the run's own origin alone, so this reuses that own-origin filter and a
 * third-party beacon's raw `network_requests` never becomes a success-only gap.
 */
async function loadRouteStats(
  db: DrizzleDB,
  runIds: number[],
  routeNodeKeys: Set<string>,
): Promise<Map<string, RouteStat>> {
  const stats = new Map<string, RouteStat>();
  if (runIds.length === 0 || routeNodeKeys.size === 0) return stats;
  const rows = await db
    .select({
      method: networkRequests.method,
      url: networkRequests.normalizedUrl,
      status: networkRequests.status,
      c: count(),
    })
    .from(networkRequests)
    .where(inArray(networkRequests.testRunId, runIds))
    .groupBy(networkRequests.method, networkRequests.normalizedUrl, networkRequests.status);

  for (const r of rows) {
    if (!r.url) continue;
    const method = r.method.toUpperCase();
    const key = `${method} ${r.url}`;
    if (!routeNodeKeys.has(key)) continue;
    const entry = stats.get(key) ?? { key, method, pattern: r.url, count: 0, statuses: [], priority: null };
    entry.count += Number(r.c);
    entry.statuses.push(r.status);
    stats.set(key, entry);
  }
  return stats;
}

/**
 * Recompute a project's project-wide gaps (success-only, single-covering-test,
 * surface-drift) from the graph and history, rank them by exposure, and upsert
 * the ledger — preserving triage and closing gaps that no longer hold. Change-
 * time detectors (changed-unreached) run in the change-coverage path instead.
 */
export async function computeScenarioGaps(
  db: DrizzleDB,
  projectId: number,
  options: { exposure?: ExposureInputs; branch?: string | null } = {},
): Promise<{ upserted: number; closed: number }> {
  const recentIds = await loadRecentRunIds(db, projectId, HISTORY_WINDOW_RUNS);
  const latestRunId = recentIds[0] ?? null;

  // Read canonical rows (branch null), plus the branch under inspection when one
  // is given — so a route added on a pull-request branch never shows as surface
  // drift on the default branch.
  const nodeBranchScope = options.branch
    ? or(isNull(graphNodes.branch), eq(graphNodes.branch, options.branch))
    : isNull(graphNodes.branch);
  const edgeBranchScope = options.branch
    ? or(isNull(graphEdges.branch), eq(graphEdges.branch, options.branch))
    : isNull(graphEdges.branch);

  // Reach edges → which test cases reach which nodes.
  const reachRows = await db
    .select({ toKind: graphEdges.toKind, toKey: graphEdges.toKey, fromKey: graphEdges.fromKey })
    .from(graphEdges)
    .where(and(eq(graphEdges.projectId, projectId), eq(graphEdges.kind, 'reaches'), edgeBranchScope));

  const reachByNode = new Map<string, Set<number>>();
  const testIds = new Set<number>();
  for (const r of reachRows) {
    const id = Number(r.fromKey);
    if (!Number.isFinite(id)) continue;
    testIds.add(id);
    const nodeKey = `${r.toKind}\x00${r.toKey}`;
    const set = reachByNode.get(nodeKey) ?? new Set<number>();
    set.add(id);
    reachByNode.set(nodeKey, set);
  }

  const meta = await loadTestMeta(db, [...testIds]);

  // Node first-seen for surface drift. Pruned (soft-deleted) nodes are excluded
  // so vanished surface neither reaches detectors nor re-flags as drift.
  const nodeRows = await db
    .select({
      kind: graphNodes.kind,
      key: graphNodes.key,
      origin: graphNodes.origin,
      attrs: graphNodes.attrs,
      firstSeenRunId: graphNodes.firstSeenRunId,
      lastSeenRunId: graphNodes.lastSeenRunId,
    })
    .from(graphNodes)
    .where(and(eq(graphNodes.projectId, projectId), nodeBranchScope, isNull(graphNodes.prunedAt)));

  // Documented response codes a declared (manifest/OpenAPI) route carries in its attrs.
  const documentedByRoute = new Map<string, number[]>();
  for (const node of nodeRows) {
    if (node.kind !== 'route') continue;
    const responses = (node.attrs as { responses?: unknown } | null)?.responses;
    if (Array.isArray(responses)) {
      const codes = responses.filter((c): c is number => Number.isInteger(c));
      if (codes.length > 0) documentedByRoute.set(node.key, codes);
    }
  }

  // Route patterns the graph holds as nodes — the own-origin set success-only reads.
  const routeNodeKeys = new Set(nodeRows.filter((n) => n.kind === 'route').map((n) => n.key));
  const routeStats = await loadRouteStats(db, recentIds, routeNodeKeys);

  // Attach the priority observed around each route pattern and any documented codes.
  for (const [key, stat] of routeStats) {
    stat.priority = maxPriority(reachByNode.get(`route\x00${key}`) ?? [], meta);
    const documented = documentedByRoute.get(key);
    if (documented) stat.documentedCodes = documented;
  }

  // Declared nodes (manifest/OpenAPI) with no test reaching them — the declared-
  // never-hit blind spots. Origin sticks to a node's first write, so a declared
  // route the suite later exercises keeps its origin but gains a reaches edge and
  // is skipped here by reachCount.
  const declaredNodes: DeclaredNode[] = [];
  for (const node of nodeRows) {
    if (node.kind !== 'route' && node.kind !== 'page') continue;
    if (node.origin !== 'manifest' && node.origin !== 'openapi') continue;
    const ids = reachByNode.get(`${node.kind}\x00${node.key}`) ?? new Set<number>();
    declaredNodes.push({
      nodeKind: node.kind,
      nodeKey: node.key,
      origin: node.origin,
      reachCount: ids.size,
      documentedCodes: documentedByRoute.get(node.key),
      priority: maxPriority(ids, meta),
    });
  }

  const nodeReach: NodeReach[] = [];
  const nodeDrift: NodeDrift[] = [];
  for (const node of nodeRows) {
    const ids = reachByNode.get(`${node.kind}\x00${node.key}`) ?? new Set<number>();
    nodeReach.push({
      nodeKind: node.kind,
      nodeKey: node.key,
      tests: [...ids].map((id) => ({
        testCaseId: id,
        title: meta.get(id)?.title ?? `test ${id}`,
        priority: meta.get(id)?.priority ?? null,
      })),
    });
    nodeDrift.push({
      nodeKind: node.kind,
      nodeKey: node.key,
      firstSeenRunId: node.firstSeenRunId ?? null,
      reachCount: ids.size,
      priority: maxPriority(ids, meta),
    });
  }

  // Breadth edges the M2 detectors read: contains (page → control), links
  // (page → page), triggers/loads (into a route) and checks (probe outcomes).
  const breadthEdges = await db
    .select({
      kind: graphEdges.kind,
      fromKind: graphEdges.fromKind,
      fromKey: graphEdges.fromKey,
      toKind: graphEdges.toKind,
      toKey: graphEdges.toKey,
      evidence: graphEdges.evidence,
    })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.projectId, projectId),
        inArray(graphEdges.kind, ['contains', 'links', 'triggers', 'loads', 'checks']),
        edgeBranchScope,
      ),
    );

  const pagesByControl = new Map<string, Set<string>>(); // control key → containing pages
  const linkSourcesByPage = new Map<string, Set<string>>(); // target page → source pages
  const triggeredRoutes = new Set<string>();
  const loadedRoutes = new Set<string>();
  // Every checks edge per route, kept per probing test so opposite outcomes on
  // one route are reduced deterministically rather than overwriting each other.
  const checksByRoute = new Map<string, Array<{ testKey: string; outcome: string; fault: string | null }>>();
  for (const e of breadthEdges) {
    if (e.kind === 'contains' && e.toKind === 'control') {
      const set = pagesByControl.get(e.toKey) ?? new Set<string>();
      set.add(e.fromKey);
      pagesByControl.set(e.toKey, set);
    } else if (e.kind === 'links' && e.toKind === 'page') {
      const set = linkSourcesByPage.get(e.toKey) ?? new Set<string>();
      set.add(e.fromKey);
      linkSourcesByPage.set(e.toKey, set);
    } else if (e.kind === 'triggers' && e.toKind === 'route') {
      triggeredRoutes.add(e.toKey);
    } else if (e.kind === 'loads' && e.toKind === 'route') {
      loadedRoutes.add(e.toKey);
    } else if (e.kind === 'checks' && e.toKind === 'route') {
      const ev = (e.evidence ?? {}) as { outcome?: string; fault?: string };
      if (ev.outcome) {
        const list = checksByRoute.get(e.toKey) ?? [];
        list.push({ testKey: e.fromKey, outcome: ev.outcome, fault: ev.fault ?? null });
        checksByRoute.set(e.toKey, list);
      }
    }
  }

  // Node recency for orphan tests: a node last seen inside the recent window.
  const recentSet = new Set(recentIds);
  const nodeSeenRecently = new Map<string, boolean>();
  for (const node of nodeRows) {
    nodeSeenRecently.set(`${node.kind}\x00${node.key}`, recentSet.has(node.lastSeenRunId ?? -1));
  }

  const controlReach: ControlReach[] = [];
  const pageLinkReach: PageLinkReach[] = [];
  const routeEntryReach: RouteEntryReach[] = [];
  for (const node of nodeRows) {
    const nodeKey = `${node.kind}\x00${node.key}`;
    const reachCount = reachByNode.get(nodeKey)?.size ?? 0;
    if (node.kind === 'control') {
      controlReach.push({ key: node.key, pageCount: pagesByControl.get(node.key)?.size ?? 0, reachCount });
    } else if (node.kind === 'page') {
      pageLinkReach.push({
        key: node.key,
        reached: reachCount > 0,
        linkedFrom: linkSourcesByPage.get(node.key)?.size ?? 0,
      });
    } else if (node.kind === 'route') {
      routeEntryReach.push({
        key: node.key,
        reached: reachCount > 0,
        hasTrigger: triggeredRoutes.has(node.key),
        hasLoad: loadedRoutes.has(node.key),
      });
    }
  }

  const checkOutcomes: CheckOutcome[] = [...checksByRoute].map(([routeKey, edges]) => ({
    routeKey,
    noticed: edges.some((e) => e.outcome === 'noticed'),
    notNoticed: edges
      .filter((e) => e.outcome === 'not-noticed')
      .map((e) => {
        const id = Number(e.testKey);
        return {
          testCaseId: Number.isFinite(id) ? id : -1,
          title: meta.get(id)?.title ?? `test ${e.testKey}`,
          fault: e.fault,
        };
      }),
    exposure: reachByNode.get(`route\x00${routeKey}`)?.size ?? 0,
  }));

  // Orphan tests: for each test, the recency of every node it reaches.
  const reachedByTest = new Map<number, Array<{ seenRecently: boolean }>>();
  for (const [nodeKey, ids] of reachByNode) {
    const seenRecently = nodeSeenRecently.get(nodeKey) ?? false;
    for (const id of ids) {
      const list = reachedByTest.get(id) ?? [];
      list.push({ seenRecently });
      reachedByTest.set(id, list);
    }
  }
  const testReachRecency: TestReachRecency[] = [...reachedByTest].map(([testCaseId, reachedNodes]) => ({
    testCaseId,
    title: meta.get(testCaseId)?.title ?? `test ${testCaseId}`,
    reachedNodes,
    priority: meta.get(testCaseId)?.priority ?? null,
  }));

  // Fix did not hold: clusters whose fix later regressed.
  const regressedRows = await db
    .select({
      id: failureClusters.id,
      title: failureClusters.title,
      fixCommit: failureClusters.fixCommit,
      fixLandedAt: failureClusters.fixLandedAt,
    })
    .from(failureClusters)
    .where(and(eq(failureClusters.projectId, projectId), eq(failureClusters.fixVerification, 'regressed')));
  const regressedClusters: RegressedCluster[] = regressedRows.map((c) => {
    const landed = c.fixLandedAt instanceof Date ? c.fixLandedAt.getTime() : Number(c.fixLandedAt) || 0;
    return {
      clusterId: c.id,
      title: c.title ?? 'a failure',
      fixCommit: c.fixCommit ?? null,
      daysSinceFix: landed > 0 ? Math.max(0, Math.round((Date.now() - landed) / 86_400_000)) : null,
    };
  });

  const detected = [
    ...detectSuccessOnly([...routeStats.values()]),
    ...detectSingleCoveringTest(nodeReach),
    ...detectSurfaceDrift(nodeDrift, latestRunId),
    ...detectControlNobodyExercises(controlReach),
    ...detectReachableUnvisited(pageLinkReach),
    ...detectApiOnlyRoute(routeEntryReach),
    ...detectNotNoticed(checkOutcomes),
    ...detectOrphanTest(testReachRecency),
    ...detectFixDidNotHold(regressedClusters),
    ...detectDeclaredNeverHit(declaredNodes),
  ];

  const exposure = options.exposure ?? {};
  const scored = detected.map((gap) => rankGap(gap, exposure));

  await syncFeatureNodes(db, projectId, reachByNode, latestRunId);

  const upserted = await upsertScenarioGaps(db, projectId, scored, { runId: latestRunId });
  const closed = await closeMissingGaps(
    db,
    projectId,
    [
      'success-only',
      'single-covering-test',
      'surface-drift',
      'control-nobody-exercises',
      'reachable-unvisited',
      'api-only-route',
      'not-noticed',
      'orphan-test',
      'fix-did-not-hold',
      'declared-never-hit',
    ],
    scored,
    latestRunId,
  );
  const closedChanged = await closeReachedChangedUnreached(db, projectId, latestRunId, reachByNode);
  return { upserted, closed: closed + closedChanged };
}

/**
 * Build `feature` nodes and `groups` edges from the `piwi:feature` tag on tests:
 * a feature groups the route and page nodes the tests carrying that tag reach.
 * Features from the function catalog and URL clustering are lower-trust sources
 * added later; the tag is the first. Canonical rows only — features are
 * project-level. Upsert semantics, so a feature that loses its tag simply stops
 * being refreshed.
 */
async function syncFeatureNodes(
  db: DrizzleDB,
  projectId: number,
  reachByNode: Map<string, Set<number>>,
  runId: number | null,
): Promise<void> {
  const testIds = new Set<number>();
  for (const ids of reachByNode.values()) for (const id of ids) testIds.add(id);
  if (testIds.size === 0) return;

  const featureByTest = new Map<number, string>();
  const ids = [...testIds];
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await db
      .select({ id: testCases.id, feature: testCases.feature })
      .from(testCases)
      .where(inArray(testCases.id, ids.slice(i, i + 200)));
    for (const r of rows) if (r.feature?.trim()) featureByTest.set(r.id, r.feature.trim());
  }
  if (featureByTest.size === 0) return;

  // feature → set of "kind\x00key" nodes its tests reach.
  const groups = new Map<string, Set<string>>();
  for (const [nodeKey, testSet] of reachByNode) {
    const sep = nodeKey.indexOf('\x00');
    const kind = nodeKey.slice(0, sep);
    if (kind !== 'route' && kind !== 'page' && kind !== 'control') continue;
    for (const testId of testSet) {
      const feature = featureByTest.get(testId);
      if (!feature) continue;
      const set = groups.get(feature) ?? new Set<string>();
      set.add(nodeKey);
      groups.set(feature, set);
    }
  }
  if (groups.size === 0) return;

  const now = new Date();
  for (const [feature, nodeKeys] of groups) {
    await db
      .insert(graphNodes)
      .values({
        projectId,
        kind: 'feature',
        key: feature,
        branch: null,
        attrs: { source: 'tag' } as any,
        origin: 'observed',
        firstSeenRunId: runId,
        lastSeenRunId: runId,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [graphNodes.projectId, graphNodes.kind, graphNodes.key],
        targetWhere: isNull(graphNodes.branch),
        set: {
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          lastSeenAt: sql`excluded.last_seen_at`,
          prunedAt: sql`null`,
        },
      });

    const edgeValues = [...nodeKeys].map((nodeKey) => {
      const sep = nodeKey.indexOf('\x00');
      return {
        projectId,
        fromKind: 'feature',
        fromKey: feature,
        toKind: nodeKey.slice(0, sep),
        toKey: nodeKey.slice(sep + 1),
        kind: 'groups',
        branch: null,
        confidence: null,
        origin: 'observed',
        evidence: null as any,
        firstSeenRunId: runId,
        lastSeenRunId: runId,
        lastSeenAt: now,
      };
    });
    for (let i = 0; i < edgeValues.length; i += 100) {
      await db
        .insert(graphEdges)
        .values(edgeValues.slice(i, i + 100))
        .onConflictDoUpdate({
          target: [
            graphEdges.projectId,
            graphEdges.fromKind,
            graphEdges.fromKey,
            graphEdges.kind,
            graphEdges.toKind,
            graphEdges.toKey,
          ],
          targetWhere: isNull(graphEdges.branch),
          set: { lastSeenRunId: sql`excluded.last_seen_run_id`, lastSeenAt: sql`excluded.last_seen_at` },
        });
    }
  }
}

/**
 * Close a changed-unreached gap once a test reaches the file's route or page
 * node — the same self-closing the project-wide detectors get, so a changed file
 * that later gains a test stops being reported. The file is resolved to its node
 * through the file-routing convention and checked against this run's reach edges.
 */
async function closeReachedChangedUnreached(
  db: DrizzleDB,
  projectId: number,
  runId: number | null,
  reachByNode: Map<string, Set<number>>,
): Promise<number> {
  const open = await db
    .select({ id: scenarioGaps.id, key: scenarioGaps.key })
    .from(scenarioGaps)
    .where(
      and(
        eq(scenarioGaps.projectId, projectId),
        eq(scenarioGaps.detector, 'changed-unreached'),
        inArray(scenarioGaps.status, ['open', 'snoozed']),
      ),
    );
  if (open.length === 0) return 0;

  // Route and page node keys a test reaches in this scope.
  const reachedRoutes: string[] = [];
  const reachedPages: string[] = [];
  for (const [nodeKey, ids] of reachByNode) {
    if (ids.size === 0) continue;
    const sep = nodeKey.indexOf('\x00');
    const kind = nodeKey.slice(0, sep);
    const key = nodeKey.slice(sep + 1);
    if (kind === 'route') reachedRoutes.push(key);
    else if (kind === 'page') reachedPages.push(key);
  }

  const toClose: number[] = [];
  for (const gap of open) {
    const routeTarget = fileRouteTarget(gap.key);
    const pageTarget = filePageTarget(gap.key);
    const reached =
      (routeTarget != null && reachedRoutes.some((k) => routeKeyMatchesTarget(routeTarget, k))) ||
      (pageTarget != null && reachedPages.some((k) => pageKeyMatchesTarget(pageTarget, k)));
    if (reached) toClose.push(gap.id);
  }
  if (toClose.length === 0) return 0;

  const now = new Date();
  for (let i = 0; i < toClose.length; i += 100) {
    await db
      .update(scenarioGaps)
      .set({ status: 'closed', closedAt: now, closedByRunId: runId, updatedAt: now })
      .where(inArray(scenarioGaps.id, toClose.slice(i, i + 100)));
  }
  return toClose.length;
}

/**
 * Upsert scored gaps into the ledger. A row's evidence, factors and score are
 * refreshed; its triage columns (`status`, `dismiss_reason`, `assigned_to`) are
 * never touched, so a dismissed or accepted gap keeps its verdict.
 */
export async function upsertScenarioGaps(
  db: DrizzleDB,
  projectId: number,
  gaps: ScoredGap[],
  ctx: { runId?: number | null; prNumber?: number | null } = {},
): Promise<number> {
  if (gaps.length === 0) return 0;
  const now = new Date();
  const CHUNK = 100;
  let written = 0;

  for (let i = 0; i < gaps.length; i += CHUNK) {
    const slice = gaps.slice(i, i + CHUNK);
    await db
      .insert(scenarioGaps)
      .values(
        slice.map((g) => ({
          projectId,
          kind: g.kind,
          detector: g.detector,
          class: g.class,
          key: g.key,
          title: g.title,
          evidence: g.evidence as any,
          factors: g.factors as any,
          score: g.score,
          testCaseId: g.testCaseId ?? null,
          failureClusterId: g.failureClusterId ?? null,
          ticket: g.ticket ?? null,
          testRunId: ctx.runId ?? null,
          prNumber: ctx.prNumber ?? null,
          status: 'open',
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [scenarioGaps.projectId, scenarioGaps.detector, scenarioGaps.key],
        set: {
          kind: sql`excluded.kind`,
          class: sql`excluded.class`,
          title: sql`excluded.title`,
          evidence: sql`excluded.evidence`,
          factors: sql`excluded.factors`,
          score: sql`excluded.score`,
          testCaseId: sql`excluded.test_case_id`,
          failureClusterId: sql`excluded.failure_cluster_id`,
          ticket: sql`excluded.ticket`,
          testRunId: sql`excluded.test_run_id`,
          prNumber: sql`coalesce(excluded.pr_number, ${scenarioGaps.prNumber})`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    written += slice.length;
  }
  return written;
}

/**
 * Close open/snoozed gaps of the given detectors whose key was not re-detected:
 * a gap whose node gained a trusted edge, or whose route now sees an error path,
 * closes itself so "closed this month" is a real number.
 */
async function closeMissingGaps(
  db: DrizzleDB,
  projectId: number,
  detectors: string[],
  kept: ScoredGap[],
  runId: number | null,
): Promise<number> {
  const keptKeys = new Set(kept.map((g) => `${g.detector}\x00${g.key}`));
  const open = await db
    .select({ id: scenarioGaps.id, detector: scenarioGaps.detector, key: scenarioGaps.key })
    .from(scenarioGaps)
    .where(
      and(
        eq(scenarioGaps.projectId, projectId),
        inArray(scenarioGaps.detector, detectors),
        inArray(scenarioGaps.status, ['open', 'snoozed']),
      ),
    );

  const toClose = open.filter((row) => !keptKeys.has(`${row.detector}\x00${row.key}`)).map((r) => r.id);
  if (toClose.length === 0) return 0;

  const now = new Date();
  for (let i = 0; i < toClose.length; i += 100) {
    await db
      .update(scenarioGaps)
      .set({ status: 'closed', closedAt: now, closedByRunId: runId, updatedAt: now })
      .where(inArray(scenarioGaps.id, toClose.slice(i, i + 100)));
  }
  return toClose.length;
}

// ── Read ─────────────────────────────────────────────────────────────────────

export interface ScenarioGapRow {
  id: number;
  kind: GapKind;
  detector: string;
  class: GapClass;
  key: string;
  /** The graph node the gap is about, typed (kind + key), separate from the dedupe `key`. */
  subject: GapSubject;
  title: string;
  evidence: string[];
  factors: ExposureFactors | null;
  score: number | null;
  status: GapStatus;
  ticket: string | null;
  prNumber: number | null;
  testCaseId: number | null;
  testRunId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GapFilters {
  kind?: string;
  class?: string;
  detector?: string;
  status?: string;
  prNumber?: number;
  /** Keep only gaps at or above this exposure score. */
  minScore?: number;
  limit?: number;
}

/** List a project's gaps, ranked by score. Defaults to open gaps only. */
export async function listScenarioGaps(
  db: DrizzleDB,
  projectId: number,
  filters: GapFilters = {},
): Promise<ScenarioGapRow[]> {
  const where = [eq(scenarioGaps.projectId, projectId)];
  if (filters.status && filters.status !== 'all') where.push(eq(scenarioGaps.status, filters.status));
  else if (!filters.status) where.push(eq(scenarioGaps.status, 'open'));
  if (filters.kind) where.push(eq(scenarioGaps.kind, filters.kind));
  if (filters.class) where.push(eq(scenarioGaps.class, filters.class));
  if (filters.detector) where.push(eq(scenarioGaps.detector, filters.detector));
  if (filters.prNumber != null) where.push(eq(scenarioGaps.prNumber, filters.prNumber));
  if (filters.minScore != null) where.push(gte(scenarioGaps.score, filters.minScore));

  const limit = Math.min(200, Math.max(1, filters.limit ?? 100));
  const rows = await db
    .select()
    .from(scenarioGaps)
    .where(and(...where))
    .orderBy(desc(scenarioGaps.score), desc(scenarioGaps.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as GapKind,
    detector: r.detector,
    class: r.class as GapClass,
    key: r.key,
    subject: subjectFromGapKey(r.key),
    title: r.title,
    evidence: Array.isArray(r.evidence) ? (r.evidence as string[]) : [],
    factors: (r.factors as ExposureFactors | null) ?? null,
    score: r.score ?? null,
    status: r.status as GapStatus,
    ticket: r.ticket ?? null,
    prNumber: r.prNumber ?? null,
    testCaseId: r.testCaseId ?? null,
    testRunId: r.testRunId ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.getTime() : Number(r.updatedAt),
  }));
}

// ── Deterministic draft (pure + loader) ──────────────────────────────────────

/** The pieces a draft skeleton is rendered from. */
export interface ScenarioDraftInput {
  gapTitle: string;
  gapClass: string;
  subject: { kind: string; key: string };
  nearestTest?: { title: string; feature?: string | null; priority?: string | null; location?: string | null } | null;
  /** Human-readable path steps from a reached page to the gap. */
  path: string[];
  catalogMethods: Array<{ module: string; name: string; receiver?: string | null }>;
  evidence: string[];
}

export interface ScenarioDraft extends ScenarioDraftInput {
  /** The piwi: annotations carried into the skeleton, from the nearest test. */
  annotations: Array<{ type: string; description?: string }>;
  /** The rendered Playwright test skeleton, delivered as text. */
  text: string;
}

/** A safe single-quoted string for the generated source. */
function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The TODO assertion a gap's class suggests. */
function assertionForClass(gapClass: string, subjectKey: string): string {
  switch (gapClass) {
    case 'false-comfort':
      return `TODO: assert the effect ${subjectKey} should have on the page — a probe showed a passing test does not notice it breaking.`;
    case 'fragile':
      return `TODO: assert the behavior a second scenario should protect.`;
    default:
      return `TODO: assert what ${subjectKey} should produce.`;
  }
}

/**
 * Render a deterministic test skeleton for a gap: a title, piwi: annotations
 * from the nearest test, the graph path as the step list, catalog methods where
 * they match, and a TODO assertion. No AI — the assertion is left for a human or
 * an agent to fill.
 */
export function renderScenarioDraft(input: ScenarioDraftInput): ScenarioDraft {
  const annotations: Array<{ type: string; description?: string }> = [];
  if (input.nearestTest?.feature) annotations.push({ type: 'piwi:feature', description: input.nearestTest.feature });
  if (input.nearestTest?.priority) annotations.push({ type: 'piwi:priority', description: input.nearestTest.priority });

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`// Draft for a ${input.gapClass} gap: ${input.gapTitle}`);
  for (const e of input.evidence) lines.push(`// ${e}`);
  if (input.nearestTest?.location)
    lines.push(`// Nearest test: ${input.nearestTest.title} (${input.nearestTest.location})`);
  lines.push('');

  const annotationArg =
    annotations.length > 0
      ? `, {\n  annotation: [${annotations.map((a) => `{ type: ${q(a.type)}, description: ${q(a.description ?? '')} }`).join(', ')}],\n}`
      : '';
  lines.push(`test(${q(input.gapTitle)}${annotationArg}, async ({ page }) => {`);

  if (input.path.length > 0) {
    lines.push('  // Path to the gap:');
    for (const step of input.path) lines.push(`  ${step}`);
  } else {
    lines.push('  // No reached path to this gap — start from the nearest entry point.');
  }

  if (input.catalogMethods.length > 0) {
    lines.push('  // Catalog methods that match this page:');
    for (const m of input.catalogMethods) {
      const recv = m.receiver ? `${m.receiver}.` : '';
      lines.push(`  // await ${recv}${m.name}(); // from ${m.module}`);
    }
  }

  lines.push(`  // ${assertionForClass(input.gapClass, input.subject.key)}`);
  lines.push('});');
  lines.push('');

  return { ...input, annotations, text: lines.join('\n') };
}

/** A gap's subject node — the graph node the gap is about, as a typed (kind, key) pair. */
export interface GapSubject {
  kind: string;
  key: string;
}

/**
 * The subject node a gap is about, kept separate from its dedupe `key`: the
 * dedupe key varies by detector (a typed `kind:key`, a raw route key, or a file
 * path), so callers that need to join a gap to a graph node — the feature filter,
 * the draft builder — read the subject, never the raw key.
 */
export function subjectFromGapKey(key: string): GapSubject {
  for (const kind of ['route', 'page', 'control', 'link', 'test', 'cluster', 'catalog', 'intent']) {
    const prefix = `${kind}:`;
    if (key.startsWith(prefix)) return { kind, key: key.slice(prefix.length) };
  }
  // M1 keys: a raw route key or a file path.
  if (/^[A-Z]+\s/.test(key)) return { kind: 'route', key };
  return { kind: 'file', key };
}

/**
 * Load a gap and render its deterministic draft. Finds the nearest test (the
 * gap's own, else one reaching the subject or a neighboring node), the reached
 * page nearest the subject as the path, and the catalog methods whose url pattern
 * matches. Returns null when the gap does not exist in the project.
 */
export async function draftScenario(db: DrizzleDB, projectId: number, gapId: number): Promise<ScenarioDraft | null> {
  const [gap] = await db
    .select()
    .from(scenarioGaps)
    .where(and(eq(scenarioGaps.projectId, projectId), eq(scenarioGaps.id, gapId)));
  if (!gap) return null;

  const subject = subjectFromGapKey(gap.key);
  const evidence = Array.isArray(gap.evidence) ? (gap.evidence as string[]) : [];

  // Nearest test: the gap's own, else a test reaching the subject node.
  let nearestTestId = gap.testCaseId ?? null;
  if (nearestTestId == null && (subject.kind === 'route' || subject.kind === 'page' || subject.kind === 'control')) {
    const [edge] = await db
      .select({ fromKey: graphEdges.fromKey })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.kind, 'reaches'),
          eq(graphEdges.toKind, subject.kind),
          eq(graphEdges.toKey, subject.key),
          isNull(graphEdges.branch),
        ),
      )
      .limit(1);
    if (edge) nearestTestId = Number(edge.fromKey) || null;
  }

  let nearestTest: ScenarioDraftInput['nearestTest'] = null;
  if (nearestTestId != null) {
    const [tc] = await db
      .select({
        title: testCases.title,
        feature: testCases.feature,
        priority: testCases.priority,
        filePath: testCases.filePath,
      })
      .from(testCases)
      .where(eq(testCases.id, nearestTestId));
    if (tc) {
      nearestTest = {
        title: tc.title,
        feature: tc.feature ?? null,
        priority: tc.priority ?? null,
        location: tc.filePath ?? null,
      };
    }
  }

  // Path: a reached page nearest the subject.
  const path: string[] = [];
  let pageForCatalog: string | null = null;
  if (subject.kind === 'page') {
    pageForCatalog = subject.key;
    path.push(`await page.goto(${q(subject.key)});`);
  } else if (subject.kind === 'control' || subject.kind === 'route') {
    // A page that contains the control, or loads/triggers the route.
    const [edge] = await db
      .select({ pageKey: graphEdges.fromKey })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          inArray(graphEdges.kind, subject.kind === 'control' ? ['contains'] : ['loads', 'triggers']),
          eq(graphEdges.fromKind, 'page'),
          eq(graphEdges.toKind, subject.kind),
          eq(graphEdges.toKey, subject.key),
          isNull(graphEdges.branch),
        ),
      )
      .limit(1);
    if (edge?.pageKey) {
      pageForCatalog = edge.pageKey;
      path.push(`await page.goto(${q(edge.pageKey)});`);
    }
    if (subject.kind === 'control') {
      const [role, ...nameParts] = subject.key.split(':');
      const name = nameParts.join(':');
      path.push(`await page.getByRole(${q(role ?? 'button')}, { name: ${q(name)} }).click();`);
    }
  }

  // Catalog methods whose url pattern matches the page.
  const catalogMethods: ScenarioDraftInput['catalogMethods'] = [];
  if (pageForCatalog) {
    const fns = await db
      .select({
        module: testFunctions.module,
        name: testFunctions.name,
        receiver: testFunctions.receiver,
        urlPattern: testFunctions.urlPattern,
      })
      .from(testFunctions)
      .where(eq(testFunctions.projectId, projectId));
    for (const f of fns) {
      if (!f.urlPattern || pageForCatalog.includes(f.urlPattern.replace(/\*+/g, ''))) {
        catalogMethods.push({ module: f.module, name: f.name, receiver: f.receiver });
      }
      if (catalogMethods.length >= 5) break;
    }
  }

  return renderScenarioDraft({
    gapTitle: gap.title,
    gapClass: gap.class,
    subject,
    nearestTest,
    path,
    catalogMethods,
    evidence,
  });
}
