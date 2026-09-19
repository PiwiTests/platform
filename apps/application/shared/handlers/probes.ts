/**
 * Client probes and the probe ledger. A probe run replays a passing test with a
 * fault injected at the Playwright route boundary and records whether the test
 * noticed. The plan picks which (test, route) pairs to probe; the results write
 * the `probes` ledger and a `checks` edge per pair, so the "checked" axis of the
 * Test Map stops being a prior and becomes an observation.
 *
 * The selection core is pure so the demo runs it; the loaders read the graph and
 * the ledger and upsert the results.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { graphEdges, graphNodes, probes, testCases } from '../../server/database/schema';
import type { DrizzleDB } from './db';

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** The client-side faults a probe run applies through `page.route`. */
export const PROBE_FAULTS = ['status-500', 'empty-body', 'drop-field', 'stale-value', 'slow'] as const;
export type ProbeFault = (typeof PROBE_FAULTS)[number];

export type ProbeOutcome = 'noticed' | 'not-noticed' | 'inconclusive';
export type ProbeLevel = 'client' | 'server';

/** Default per-project probes per run. */
export const DEFAULT_PROBE_BUDGET = 50;

/** The run-metadata flag that stamps a run as a probe run (never a real run). */
export const PROBE_RUN_METADATA_KEY = 'piwiProbe';

/** True when a run's metadata stamps it as a probe run. */
export function isProbeRun(metadata: unknown): boolean {
  return (
    !!metadata && typeof metadata === 'object' && (metadata as Record<string, unknown>)[PROBE_RUN_METADATA_KEY] === true
  );
}

/** One (test, route, fault) pair the plan asks a probe run to apply. */
export interface ProbePlanItem {
  testCaseId: number;
  testTitle: string;
  /** Spec file relative to the project root — disambiguates a leaf title shared across files. */
  filePath: string | null;
  /** Describe-block titles from the outermost down, breaking a title tie within one file. */
  suitePath: string[];
  routeKey: string;
  fault: ProbeFault;
  /** Apply the fault only to the Nth matching request after the first navigation. */
  nth: number;
}

export interface ProbePlan {
  budget: number;
  items: ProbePlanItem[];
}

/** An outcome a probe run reports back for one pair. */
export interface ProbeResultInput {
  testCaseId: number;
  routeKey: string;
  fault: string;
  outcome: ProbeOutcome;
  level?: ProbeLevel;
  applied?: boolean;
  handled?: string;
  evidence?: unknown;
}

/** A candidate pair the plan chooses among, with the inputs selection needs. */
export interface ProbeCandidate {
  testCaseId: number;
  testTitle: string;
  filePath: string | null;
  suitePath: string[];
  routeKey: string;
  /** Exposure proxy — higher is probed first. */
  exposure: number;
  /** True when a probe already exists for this (test, route). */
  probed: boolean;
  /** True when the test's source or the route's handler changed since that probe. */
  changed: boolean;
}

// ── Selection (pure) ─────────────────────────────────────────────────────────

/**
 * Choose the pairs to probe this run: never-probed pairs first, then pairs whose
 * test or handler changed since their last probe, each ordered by exposure. At
 * most one fault per test per run, capped at the budget. The fault rotates
 * deterministically so a project's probes spread across the fault classes.
 */
export function selectProbePlan(candidates: ProbeCandidate[], options: { budget?: number } = {}): ProbePlan {
  const budget = Math.max(0, options.budget ?? DEFAULT_PROBE_BUDGET);
  const eligible = candidates.filter((c) => !c.probed || c.changed);
  eligible.sort((a, b) => {
    // Unprobed (probed === false) before re-probes.
    if (a.probed !== b.probed) return a.probed ? 1 : -1;
    return b.exposure - a.exposure;
  });

  const seenTests = new Set<number>();
  const items: ProbePlanItem[] = [];
  for (const c of eligible) {
    if (items.length >= budget) break;
    if (seenTests.has(c.testCaseId)) continue; // one fault per test per run
    seenTests.add(c.testCaseId);
    items.push({
      testCaseId: c.testCaseId,
      testTitle: c.testTitle,
      filePath: c.filePath,
      suitePath: c.suitePath,
      routeKey: c.routeKey,
      fault: PROBE_FAULTS[items.length % PROBE_FAULTS.length]!,
      nth: 1,
    });
  }
  return { budget, items };
}

// ── Loaders + orchestration (impure) ─────────────────────────────────────────

/**
 * Build a probe plan for a project: which passing tests reach which routes, how
 * exposed each route is (its reach count as a popularity proxy), whether the
 * pair was already probed, and whether the test changed since. Canonical rows
 * only — probe runs target the default-branch surface.
 */
export async function buildProbePlan(
  db: DrizzleDB,
  projectId: number,
  options: { budget?: number } = {},
): Promise<ProbePlan> {
  // Reach edges test → route (canonical).
  const reachRows = await db
    .select({ fromKey: graphEdges.fromKey, routeKey: graphEdges.toKey })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.projectId, projectId),
        eq(graphEdges.kind, 'reaches'),
        eq(graphEdges.toKind, 'route'),
        isNull(graphEdges.branch),
      ),
    );
  if (reachRows.length === 0) return { budget: options.budget ?? DEFAULT_PROBE_BUDGET, items: [] };

  // Route popularity: how many distinct tests reach each route → exposure proxy.
  const routeReach = new Map<string, Set<number>>();
  for (const r of reachRows) {
    const id = Number(r.fromKey);
    if (!Number.isFinite(id)) continue;
    const set = routeReach.get(r.routeKey) ?? new Set<number>();
    set.add(id);
    routeReach.set(r.routeKey, set);
  }

  const testIds = [...new Set(reachRows.map((r) => Number(r.fromKey)).filter((n) => Number.isFinite(n)))];
  const testMeta = new Map<number, { title: string; filePath: string; suitePath: string[]; updatedAt: number }>();
  for (let i = 0; i < testIds.length; i += 200) {
    const rows = await db
      .select({
        id: testCases.id,
        title: testCases.title,
        filePath: testCases.filePath,
        suitePath: testCases.suitePath,
        updatedAt: testCases.updatedAt,
      })
      .from(testCases)
      .where(inArray(testCases.id, testIds.slice(i, i + 200)));
    for (const r of rows) {
      const updated = r.updatedAt instanceof Date ? r.updatedAt.getTime() : Number(r.updatedAt) || 0;
      // `suite_path` is stored as a \x1f-delimited string; split it back to the array the plan carries.
      const suitePath = r.suitePath ? r.suitePath.split('\x1f').filter(Boolean) : [];
      testMeta.set(r.id, { title: r.title, filePath: r.filePath, suitePath, updatedAt: updated });
    }
  }

  // Existing probes: (test, route) → last probedAt.
  const existing = await db
    .select({ testCaseId: probes.testCaseId, routeKey: probes.routeKey, probedAt: probes.probedAt })
    .from(probes)
    .where(eq(probes.projectId, projectId));
  const probedAt = new Map<string, number>();
  for (const p of existing) {
    if (p.testCaseId == null || !p.routeKey) continue;
    const at = p.probedAt instanceof Date ? p.probedAt.getTime() : Number(p.probedAt) || 0;
    const key = `${p.testCaseId}\x00${p.routeKey}`;
    probedAt.set(key, Math.max(probedAt.get(key) ?? 0, at));
  }

  const candidates: ProbeCandidate[] = [];
  for (const r of reachRows) {
    const testCaseId = Number(r.fromKey);
    if (!Number.isFinite(testCaseId)) continue;
    const meta = testMeta.get(testCaseId);
    if (!meta) continue;
    const pairKey = `${testCaseId}\x00${r.routeKey}`;
    const lastProbe = probedAt.get(pairKey);
    candidates.push({
      testCaseId,
      testTitle: meta.title,
      filePath: meta.filePath,
      suitePath: meta.suitePath,
      routeKey: r.routeKey,
      exposure: routeReach.get(r.routeKey)?.size ?? 1,
      probed: lastProbe != null,
      // Re-probe when the test's source changed after the last probe.
      changed: lastProbe != null && meta.updatedAt > lastProbe,
    });
  }

  return selectProbePlan(candidates, options);
}

/**
 * Record a probe run's outcomes: one `probes` row per pair (deduped by
 * (project, test, route, fault)) and a refreshed `checks` edge test → route
 * carrying the outcome. A noticed probe is confidence 1, not-noticed 0,
 * inconclusive unscored.
 */
export async function recordProbeResults(
  db: DrizzleDB,
  projectId: number,
  runId: number | null,
  results: ProbeResultInput[],
): Promise<{ recorded: number }> {
  if (results.length === 0) return { recorded: 0 };

  // Resolve route node ids for the checks edges and the ledger's node_id.
  const routeKeys = [...new Set(results.map((r) => r.routeKey))];
  const nodeIdByKey = new Map<string, number>();
  for (let i = 0; i < routeKeys.length; i += 200) {
    const rows = await db
      .select({ id: graphNodes.id, key: graphNodes.key })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          eq(graphNodes.kind, 'route'),
          isNull(graphNodes.branch),
          inArray(graphNodes.key, routeKeys.slice(i, i + 200)),
        ),
      );
    for (const r of rows) nodeIdByKey.set(r.key, r.id);
  }

  const now = new Date();
  let recorded = 0;
  for (const r of results) {
    const outcome: ProbeOutcome = r.outcome === 'noticed' || r.outcome === 'not-noticed' ? r.outcome : 'inconclusive';
    await db
      .insert(probes)
      .values({
        projectId,
        testCaseId: r.testCaseId,
        nodeId: nodeIdByKey.get(r.routeKey) ?? null,
        routeKey: r.routeKey,
        level: r.level ?? 'client',
        fault: r.fault,
        applied: r.applied ?? true,
        outcome,
        handled: r.handled ?? 'n/a',
        runId,
        evidence: (r.evidence ?? null) as any,
        probedAt: now,
      })
      .onConflictDoUpdate({
        target: [probes.projectId, probes.testCaseId, probes.routeKey, probes.fault],
        set: {
          outcome: sql`excluded.outcome`,
          applied: sql`excluded.applied`,
          handled: sql`excluded.handled`,
          level: sql`excluded.level`,
          nodeId: sql`excluded.node_id`,
          runId: sql`excluded.run_id`,
          evidence: sql`excluded.evidence`,
          probedAt: sql`excluded.probed_at`,
        },
      });
    recorded++;

    // Refresh the checks edge test → route with this outcome.
    const confidence = outcome === 'noticed' ? 1 : outcome === 'not-noticed' ? 0 : null;
    await db
      .insert(graphEdges)
      .values({
        projectId,
        fromKind: 'test',
        fromKey: String(r.testCaseId),
        toKind: 'route',
        toKey: r.routeKey,
        kind: 'checks',
        branch: null,
        confidence,
        origin: 'observed',
        evidence: { fault: r.fault, outcome, level: r.level ?? 'client' } as any,
        firstSeenRunId: runId,
        lastSeenRunId: runId,
        lastSeenAt: now,
      })
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
        set: {
          confidence: sql`excluded.confidence`,
          evidence: sql`excluded.evidence`,
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }

  return { recorded };
}
