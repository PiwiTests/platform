/**
 * Feature-graph ingest — the single place run cases become `route`/`page` nodes
 * and `reaches` edges. Called from the one write path on every ingest, with
 * upsert semantics: a node or edge that already exists has its last-seen run
 * bumped, never truncated, so the graph accumulates across a project's history.
 *
 * Rows are tagged with the run's branch: a run on the project's default branch
 * writes canonical rows (`branch` null); a run on any other branch writes rows
 * tagged with that branch, so a route added on a pull request never shows up as
 * surface drift on the default branch. Route nodes come only from requests to
 * the run's own origin, so third-party beacons and CDN assets never enter the
 * graph.
 */

import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  graphNodes,
  graphEdges,
  projects,
  scenarioGaps,
  testRuns,
  testRunsCases,
  networkRequests,
} from '../database/schema';
import { routeNodeKey, pageNodeKey, testEndpointKey, collectOwnOrigins, isOwnOriginRequest } from '#shared/graph';
import type { RunMetadata } from './run-json-types';
import { resolveRunBranch } from './run-branch';
import { resolveDefaultBranch, type DefaultBranchProject } from './scm/default-branch';
import { FALLBACK_DEFAULT_BRANCH } from './scm/git-url';
import type { DbClient as DB } from '../database';

/** One test case's observed reach within a single run. */
export interface RunGraphReach {
  testCaseId: number;
  routes: Array<{ method: string; normalizedUrl: string; status: number; url?: string | null }>;
  pages: string[];
}

interface PendingNode {
  kind: string;
  key: string;
  attrs: unknown;
}

interface PendingEdge {
  fromKind: string;
  fromKey: string;
  toKind: string;
  toKey: string;
  kind: string;
  confidence: number | null;
  evidence: unknown;
}

/** Read the sanitized page URL off a persisted case's `pageState`. */
function pageUrlOf(pageState: unknown): string | null {
  if (!pageState || typeof pageState !== 'object') return null;
  const url = (pageState as { url?: unknown }).url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

/**
 * Fold the per-execution rows of one run into per-test-case reach. A test that
 * ran several times (retries, browsers) contributes the union of what each
 * execution touched. When `origins` is given, only requests to one of those
 * origins become routes — third-party beacons and CDN assets are dropped before
 * the fold, so they never key a node.
 */
export function collectRunGraphReaches(
  rows: Array<{ testCaseId: number | null | undefined; pageState: unknown }>,
  networkBuilders: Array<{
    items: Array<{ method: string; normalizedUrl: string; status: number; url?: string | null }>;
  }>,
  options: { origins?: Set<string> } = {},
): RunGraphReach[] {
  const origins = options.origins ?? new Set<string>();
  const byCase = new Map<
    number,
    {
      routes: Map<string, { method: string; normalizedUrl: string; status: number; url?: string | null }>;
      pages: Set<string>;
    }
  >();

  for (let i = 0; i < rows.length; i++) {
    const testCaseId = rows[i]!.testCaseId;
    if (testCaseId == null) continue;
    let entry = byCase.get(testCaseId);
    if (!entry) {
      entry = { routes: new Map(), pages: new Set() };
      byCase.set(testCaseId, entry);
    }
    for (const item of networkBuilders[i]?.items ?? []) {
      if (!item.normalizedUrl) continue;
      if (!isOwnOriginRequest(item.url, origins)) continue;
      entry.routes.set(routeNodeKey(item.method, item.normalizedUrl), item);
    }
    const url = pageUrlOf(rows[i]!.pageState);
    if (url) entry.pages.add(url);
  }

  return [...byCase].map(([testCaseId, e]) => ({
    testCaseId,
    routes: [...e.routes.values()],
    pages: [...e.pages],
  }));
}

/** Conflict target + predicate for the branch-aware unique indexes on nodes. */
function nodeConflict(branch: string | null) {
  return branch == null
    ? { target: [graphNodes.projectId, graphNodes.kind, graphNodes.key], targetWhere: isNull(graphNodes.branch) }
    : {
        target: [graphNodes.projectId, graphNodes.kind, graphNodes.key, graphNodes.branch],
        targetWhere: sql`${graphNodes.branch} is not null`,
      };
}

/** Conflict target + predicate for the branch-aware unique indexes on edges. */
function edgeConflict(branch: string | null) {
  return branch == null
    ? {
        target: [
          graphEdges.projectId,
          graphEdges.fromKind,
          graphEdges.fromKey,
          graphEdges.kind,
          graphEdges.toKind,
          graphEdges.toKey,
        ],
        targetWhere: isNull(graphEdges.branch),
      }
    : {
        target: [
          graphEdges.projectId,
          graphEdges.fromKind,
          graphEdges.fromKey,
          graphEdges.kind,
          graphEdges.toKind,
          graphEdges.toKey,
          graphEdges.branch,
        ],
        targetWhere: sql`${graphEdges.branch} is not null`,
      };
}

async function chunkedUpsertNodes(
  db: DB,
  projectId: number,
  runId: number,
  now: Date,
  branch: string | null,
  nodes: PendingNode[],
): Promise<void> {
  const CHUNK = 100;
  const conflict = nodeConflict(branch);
  for (let i = 0; i < nodes.length; i += CHUNK) {
    const slice = nodes.slice(i, i + CHUNK);
    await db
      .insert(graphNodes)
      .values(
        slice.map((n) => ({
          projectId,
          kind: n.kind,
          key: n.key,
          branch,
          attrs: (n.attrs ?? null) as any,
          origin: 'observed',
          firstSeenRunId: runId,
          lastSeenRunId: runId,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: conflict.target,
        targetWhere: conflict.targetWhere,
        set: {
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }
}

async function chunkedUpsertEdges(
  db: DB,
  projectId: number,
  runId: number,
  now: Date,
  branch: string | null,
  edges: PendingEdge[],
): Promise<void> {
  const CHUNK = 100;
  const conflict = edgeConflict(branch);
  for (let i = 0; i < edges.length; i += CHUNK) {
    const slice = edges.slice(i, i + CHUNK);
    await db
      .insert(graphEdges)
      .values(
        slice.map((e) => ({
          projectId,
          fromKind: e.fromKind,
          fromKey: e.fromKey,
          toKind: e.toKind,
          toKey: e.toKey,
          kind: e.kind,
          branch,
          confidence: e.confidence,
          origin: 'observed',
          evidence: (e.evidence ?? null) as any,
          firstSeenRunId: runId,
          lastSeenRunId: runId,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: conflict.target,
        targetWhere: conflict.targetWhere,
        set: {
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          lastSeenAt: sql`excluded.last_seen_at`,
          confidence: sql`excluded.confidence`,
          evidence: sql`excluded.evidence`,
        },
      });
  }
}

/**
 * Upsert the `route`/`page` nodes and `reaches` edges implied by one run's
 * reach. Deduplicated per unique key before the batch upsert — a repeated key
 * within one statement would otherwise break PostgreSQL's `ON CONFLICT`. Rows
 * carry the run's `branch` tag (null = canonical, from a default-branch run).
 */
export async function ingestRunGraph(
  db: DB,
  projectId: number,
  runId: number,
  reaches: RunGraphReach[],
  options: { branch?: string | null } = {},
): Promise<void> {
  if (reaches.length === 0) return;
  const now = new Date();
  const branch = options.branch ?? null;

  const nodes = new Map<string, PendingNode>();
  const edges = new Map<string, PendingEdge>();

  const addNode = (kind: string, key: string, attrs: unknown = null) => {
    const id = `${kind}\x00${key}`;
    if (!nodes.has(id)) nodes.set(id, { kind, key, attrs });
  };
  const addEdge = (e: PendingEdge) => {
    const id = `${e.fromKind}\x00${e.fromKey}\x00${e.kind}\x00${e.toKind}\x00${e.toKey}`;
    edges.set(id, e);
  };

  for (const reach of reaches) {
    const from = testEndpointKey(reach.testCaseId);
    for (const route of reach.routes) {
      const key = routeNodeKey(route.method, route.normalizedUrl);
      addNode('route', key);
      addEdge({
        fromKind: 'test',
        fromKey: from,
        toKind: 'route',
        toKey: key,
        kind: 'reaches',
        confidence: 1,
        evidence: { method: route.method.toUpperCase(), status: route.status },
      });
    }
    for (const url of reach.pages) {
      const key = pageNodeKey(url);
      if (!key) continue;
      addNode('page', key, { url });
      addEdge({
        fromKind: 'test',
        fromKey: from,
        toKind: 'page',
        toKey: key,
        kind: 'reaches',
        confidence: 1,
        evidence: null,
      });
    }
  }

  await chunkedUpsertNodes(db, projectId, runId, now, branch, [...nodes.values()]);
  await chunkedUpsertEdges(db, projectId, runId, now, branch, [...edges.values()]);
}

/**
 * Persist `changes` edges for a diff: the head commit and every ticket named in
 * the pull request point at each changed file. Files are edge endpoints, not
 * materialized nodes in this milestone. Upsert semantics, never truncate. Rows
 * carry the run's `branch` tag, like the reach graph.
 */
export async function ingestChangesEdges(
  db: DB,
  projectId: number,
  runId: number,
  headSha: string,
  tickets: string[],
  files: string[],
  options: { branch?: string | null } = {},
): Promise<void> {
  if (files.length === 0) return;
  const now = new Date();
  const branch = options.branch ?? null;
  const edges = new Map<string, PendingEdge>();
  const add = (fromKind: string, fromKey: string, file: string) => {
    const id = `${fromKind}\x00${fromKey}\x00changes\x00file\x00${file}`;
    edges.set(id, {
      fromKind,
      fromKey,
      toKind: 'file',
      toKey: file,
      kind: 'changes',
      confidence: null,
      evidence: null,
    });
  };
  for (const file of files) {
    if (headSha) add('commit', headSha, file);
    for (const ticket of tickets) add('ticket', ticket, file);
  }
  await chunkedUpsertEdges(db, projectId, runId, now, branch, [...edges.values()]);
}

/**
 * The graph branch tag for a run: null when the run is on the project's default
 * branch (canonical rows), otherwise the run's own branch. An unknown branch is
 * treated as canonical, since it cannot be distinguished from the default.
 */
export async function resolveRunBranchTag(
  db: DB,
  project: DefaultBranchProject,
  runMetadata: unknown,
  runBranch?: string | null,
): Promise<string | null> {
  const branch = (runBranch ?? resolveRunBranch(runMetadata))?.trim() || null;
  if (!branch) return null;
  const defaultBranch = await resolveDefaultBranch(db, project, runMetadata).catch(() => FALLBACK_DEFAULT_BRANCH);
  return branch === defaultBranch ? null : branch;
}

/** The base URLs a run's Playwright config recorded, one per configured project. */
export function runBaseUrls(runMetadata: unknown): string[] {
  const meta = (runMetadata as RunMetadata | null) ?? null;
  const configProjects = meta?.htmlReport?.projects ?? [];
  const urls: string[] = [];
  for (const p of configProjects) {
    const baseUrl = p?.use?.baseURL;
    if (typeof baseUrl === 'string' && baseUrl) urls.push(baseUrl);
  }
  return urls;
}

/** The per-project route-origin allowlist stored on the project row. */
export function projectRouteOrigins(routeOrigins: unknown): string[] {
  if (!Array.isArray(routeOrigins)) return [];
  return routeOrigins.filter((o): o is string => typeof o === 'string' && o.length > 0);
}

/**
 * Rebuild a project's `route`/`page` nodes and `reaches` edges from its whole
 * stored history, oldest run first so first- and last-seen land in order. Upsert
 * semantics make it idempotent — running it twice changes nothing. This is the
 * one-off backfill for instances whose history predates the graph.
 */
export async function rebuildProjectGraph(db: DB, projectId: number): Promise<{ runsProcessed: number }> {
  const [project] = await db
    .select({ id: projects.id, defaultBranch: projects.defaultBranch, routeOrigins: projects.routeOrigins })
    .from(projects)
    .where(eq(projects.id, projectId));
  const allowlist = projectRouteOrigins(project?.routeOrigins);

  const runs = await db
    .select({ id: testRuns.id, branch: testRuns.branch, metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(asc(testRuns.id));

  let processed = 0;
  for (const run of runs) {
    const cases = await db
      .select({ id: testRunsCases.id, testCaseId: testRunsCases.testCaseId, pageState: testRunsCases.pageState })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, run.id));
    if (cases.length === 0) continue;

    const requests = await db
      .select({
        testRunsCaseId: networkRequests.testRunsCaseId,
        method: networkRequests.method,
        normalizedUrl: networkRequests.normalizedUrl,
        url: networkRequests.url,
        status: networkRequests.status,
      })
      .from(networkRequests)
      .where(eq(networkRequests.testRunId, run.id));

    const byCase = new Map<
      number,
      Array<{ method: string; normalizedUrl: string; status: number; url: string | null }>
    >();
    for (const r of requests) {
      if (!r.normalizedUrl) continue;
      const list = byCase.get(r.testRunsCaseId) ?? [];
      list.push({ method: r.method, normalizedUrl: r.normalizedUrl, status: r.status, url: r.url });
      byCase.set(r.testRunsCaseId, list);
    }

    const origins = collectOwnOrigins(runBaseUrls(run.metadata), allowlist);
    const branch = project ? await resolveRunBranchTag(db, project, run.metadata, run.branch) : null;

    const rows = cases.map((c) => ({ testCaseId: c.testCaseId, pageState: c.pageState }));
    const builders = cases.map((c) => ({ items: byCase.get(c.id) ?? [] }));
    await ingestRunGraph(db, projectId, run.id, collectRunGraphReaches(rows, builders, { origins }), { branch });
    processed++;
  }

  return { runsProcessed: processed };
}

// ── Pruning ────────────────────────────────────────────────────────────────

/** Nodes and edges older than a `changes`/branch window are dropped by age. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** `changes` edges track churn; ninety days is all churn needs. */
const CHANGES_EDGE_MAX_AGE_MS = 90 * DAY_MS;
/** Branch-tagged rows outlive their pull request by at most thirty days. */
const BRANCH_ROW_MAX_AGE_MS = 30 * DAY_MS;
/** A canonical node unseen for this many runs is a candidate for removal. */
const STALE_NODE_RUNS = 30;

/**
 * Delete every branch-tagged node and edge for one branch of a project. Called
 * where the SCM flow learns a pull request closed or merged, so its surface
 * stops shadowing the default branch immediately rather than aging out.
 */
export async function deleteBranchGraphRows(db: DB, projectId: number, branch: string): Promise<number> {
  if (!branch) return 0;
  const nodeCond = and(eq(graphNodes.projectId, projectId), eq(graphNodes.branch, branch));
  const edgeCond = and(eq(graphEdges.projectId, projectId), eq(graphEdges.branch, branch));
  const nodes = await db.delete(graphNodes).where(nodeCond).returning({ id: graphNodes.id });
  const edges = await db.delete(graphEdges).where(edgeCond).returning({ id: graphEdges.id });
  return nodes.length + edges.length;
}

/**
 * Prune `changes` edges last seen more than ninety days ago, independent of
 * `PIWI_RETENTION_DAYS`. Churn needs no longer a window, and commits are unique
 * keys that would otherwise grow with history forever.
 */
export async function pruneChangesEdges(db: DB, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CHANGES_EDGE_MAX_AGE_MS);
  const deleted = await db
    .delete(graphEdges)
    .where(and(eq(graphEdges.kind, 'changes'), lt(graphEdges.lastSeenAt, cutoff)))
    .returning({ id: graphEdges.id });
  return deleted.length;
}

/**
 * Prune branch-tagged rows last seen more than thirty days ago — the fallback
 * for a pull request whose close the SCM flow never learned of.
 */
export async function pruneStaleBranchGraphRows(db: DB, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - BRANCH_ROW_MAX_AGE_MS);
  const nodes = await db
    .delete(graphNodes)
    .where(and(sql`${graphNodes.branch} is not null`, lt(graphNodes.lastSeenAt, cutoff)))
    .returning({ id: graphNodes.id });
  const edges = await db
    .delete(graphEdges)
    .where(and(sql`${graphEdges.branch} is not null`, lt(graphEdges.lastSeenAt, cutoff)))
    .returning({ id: graphEdges.id });
  return nodes.length + edges.length;
}

/**
 * Remove canonical nodes unseen for thirty runs whose surface-drift gap is no
 * longer open, independently of `PIWI_RETENTION_DAYS` (which is opt-in and
 * cannot be relied on). A node still carrying an open surface-drift gap is kept
 * so the triage keeps its subject.
 */
export async function pruneStaleCanonicalNodes(db: DB): Promise<number> {
  const projectRows = await db.selectDistinct({ projectId: graphNodes.projectId }).from(graphNodes);
  let removed = 0;

  for (const { projectId } of projectRows) {
    const recent = await db
      .select({ id: testRuns.id })
      .from(testRuns)
      .where(eq(testRuns.projectId, projectId))
      .orderBy(sql`${testRuns.id} desc`)
      .limit(STALE_NODE_RUNS);
    // Fewer than a full window of runs — nothing has been unseen long enough.
    if (recent.length < STALE_NODE_RUNS) continue;
    const windowFloor = recent[recent.length - 1]!.id;

    const stale = await db
      .select({ id: graphNodes.id, kind: graphNodes.kind, key: graphNodes.key })
      .from(graphNodes)
      .where(
        and(eq(graphNodes.projectId, projectId), isNull(graphNodes.branch), lt(graphNodes.lastSeenRunId, windowFloor)),
      );
    if (stale.length === 0) continue;

    // Keep any node whose surface-drift gap is still open.
    const openGaps = await db
      .select({ key: scenarioGaps.key })
      .from(scenarioGaps)
      .where(
        and(
          eq(scenarioGaps.projectId, projectId),
          eq(scenarioGaps.detector, 'surface-drift'),
          eq(scenarioGaps.status, 'open'),
        ),
      );
    const openKeys = new Set(openGaps.map((g) => g.key));

    const removable = stale.filter((n) => !openKeys.has(`${n.kind}:${n.key}`)).map((n) => n.id);
    for (let i = 0; i < removable.length; i += 100) {
      const slice = removable.slice(i, i + 100);
      await db.delete(graphNodes).where(inArray(graphNodes.id, slice));
      removed += slice.length;
    }
  }
  return removed;
}
