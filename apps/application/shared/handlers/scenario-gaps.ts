/**
 * Scenario gaps — proposing tests that do not exist yet from the feature graph
 * plus history. The detectors are pure functions over pre-loaded data so the
 * demo runs the same code; the orchestrators load that data and upsert the
 * `scenario_gaps` ledger, preserving triage across recomputation.
 *
 * Honest by construction: every "no test in this run" is paired with the count
 * from recent history, and the word used is *observed reach*, never coverage.
 */

import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  graphEdges,
  graphNodes,
  networkRequests,
  scenarioGaps,
  testCases,
  testRuns,
} from '../../server/database/schema';
import type { DrizzleDB } from './db';

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type GapKind = 'gap' | 'finding';
export type GapClass = 'blind-spot' | 'false-comfort' | 'fragile' | 'unhandled' | 'degraded';
export type GapStatus = 'open' | 'snoozed' | 'dismissed' | 'accepted' | 'closed';

/** The window of recent runs every honest evidence line is measured against. */
export const HISTORY_WINDOW_RUNS = 30;
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
}

/**
 * Success only — a route whose observed statuses are all 2xx/3xx, so its error
 * paths were never exercised. Blind spot.
 */
export function detectSuccessOnly(routes: RouteStat[], windowRuns = HISTORY_WINDOW_RUNS): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const route of routes) {
    if (route.count < SUCCESS_ONLY_MIN_OBSERVATIONS) continue;
    const statuses = [...new Set(route.statuses)].sort((a, b) => a - b);
    if (statuses.length === 0) continue;
    if (!statuses.every((s) => s >= 200 && s < 400)) continue;

    const range =
      statuses.length === 1 ? `always ${statuses[0]}` : `only ${statuses[0]}–${statuses[statuses.length - 1]}`;
    gaps.push({
      detector: 'success-only',
      kind: 'gap',
      class: 'blind-spot',
      key: route.key,
      title: `${route.method} ${route.pattern}: no error path under test`,
      evidence: [
        `Observed ${route.count} times over the last ${windowRuns} runs, ${range} — observed reach, no error path exercised.`,
      ],
      confidence: clamp01(route.count / (SUCCESS_ONLY_MIN_OBSERVATIONS * 4)),
      priority: route.priority ?? null,
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
  ticket?: string | null;
}

/**
 * Changed, unreached — a changed source file no test reached in this run, paired
 * with its history count so a selection-narrowed run is never mistaken for a
 * gap. Blind spot, reported per ticket at change time.
 */
export function detectChangedUnreached(
  files: ChangedFileReach[],
  runId: number,
  windowRuns = HISTORY_WINDOW_RUNS,
): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  for (const file of files) {
    if (file.reachedInRun) continue;
    gaps.push({
      detector: 'changed-unreached',
      kind: 'gap',
      class: 'blind-spot',
      key: file.filePath,
      title: `${file.filePath} changed but not reached`,
      evidence: [
        `+${file.additions} −${file.deletions} · no test in run #${runId} · ${file.reachedCountHistory} in ${windowRuns} runs — observed reach.`,
      ],
      confidence: file.reachedCountHistory === 0 ? 0.9 : 0.5,
      files: [file.filePath],
      ticket: file.ticket ?? null,
    });
  }
  return gaps;
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

/** Ids of a project's most recent runs, newest first. */
async function loadRecentRunIds(db: DrizzleDB, projectId: number, limit: number): Promise<number[]> {
  const rows = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.id))
    .limit(limit);
  return rows.map((r) => r.id);
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

/** Observed route statuses over the recent window, one row per pattern. */
async function loadRouteStats(db: DrizzleDB, runIds: number[]): Promise<Map<string, RouteStat>> {
  const stats = new Map<string, RouteStat>();
  if (runIds.length === 0) return stats;
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
  options: { exposure?: ExposureInputs } = {},
): Promise<{ upserted: number; closed: number }> {
  const recentIds = await loadRecentRunIds(db, projectId, HISTORY_WINDOW_RUNS);
  const latestRunId = recentIds[0] ?? null;

  // Reach edges → which test cases reach which nodes.
  const reachRows = await db
    .select({ toKind: graphEdges.toKind, toKey: graphEdges.toKey, fromKey: graphEdges.fromKey })
    .from(graphEdges)
    .where(and(eq(graphEdges.projectId, projectId), eq(graphEdges.kind, 'reaches')));

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

  // Node first-seen for surface drift.
  const nodeRows = await db
    .select({ kind: graphNodes.kind, key: graphNodes.key, firstSeenRunId: graphNodes.firstSeenRunId })
    .from(graphNodes)
    .where(eq(graphNodes.projectId, projectId));

  const routeStats = await loadRouteStats(db, recentIds);

  // Attach the priority observed around each route pattern.
  for (const [key, stat] of routeStats) {
    stat.priority = maxPriority(reachByNode.get(`route\x00${key}`) ?? [], meta);
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

  const detected = [
    ...detectSuccessOnly([...routeStats.values()]),
    ...detectSingleCoveringTest(nodeReach),
    ...detectSurfaceDrift(nodeDrift, latestRunId),
  ];

  const exposure = options.exposure ?? {};
  const scored = detected.map((gap) => rankGap(gap, exposure));

  const upserted = await upsertScenarioGaps(db, projectId, scored, { runId: latestRunId });
  const closed = await closeMissingGaps(
    db,
    projectId,
    ['success-only', 'single-covering-test', 'surface-drift'],
    scored,
    latestRunId,
  );
  return { upserted, closed };
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
