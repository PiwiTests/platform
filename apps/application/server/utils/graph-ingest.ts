/**
 * Feature-graph ingest — the single place run cases become `route`/`page` nodes
 * and `reaches` edges. Called from the one write path on every ingest, with
 * upsert semantics: a node or edge that already exists has its last-seen run
 * bumped, never truncated, so the graph accumulates across a project's history.
 */

import { graphNodes, graphEdges, testRuns, testRunsCases, networkRequests } from '../database/schema';
import { asc, eq, sql } from 'drizzle-orm';
import { routeNodeKey, pageNodeKey, testEndpointKey } from '#shared/graph';
import type { DbClient as DB } from '../database';

/** One test case's observed reach within a single run. */
export interface RunGraphReach {
  testCaseId: number;
  routes: Array<{ method: string; normalizedUrl: string; status: number }>;
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
 * execution touched.
 */
export function collectRunGraphReaches(
  rows: Array<{ testCaseId: number | null | undefined; pageState: unknown }>,
  networkBuilders: Array<{ items: Array<{ method: string; normalizedUrl: string; status: number }> }>,
): RunGraphReach[] {
  const byCase = new Map<
    number,
    { routes: Map<string, { method: string; normalizedUrl: string; status: number }>; pages: Set<string> }
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

async function chunkedUpsertNodes(
  db: DB,
  projectId: number,
  runId: number,
  now: Date,
  nodes: PendingNode[],
): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < nodes.length; i += CHUNK) {
    const slice = nodes.slice(i, i + CHUNK);
    await db
      .insert(graphNodes)
      .values(
        slice.map((n) => ({
          projectId,
          kind: n.kind,
          key: n.key,
          attrs: (n.attrs ?? null) as any,
          origin: 'observed',
          firstSeenRunId: runId,
          lastSeenRunId: runId,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [graphNodes.projectId, graphNodes.kind, graphNodes.key],
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
  edges: PendingEdge[],
): Promise<void> {
  const CHUNK = 100;
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
          confidence: e.confidence,
          origin: 'observed',
          evidence: (e.evidence ?? null) as any,
          firstSeenRunId: runId,
          lastSeenRunId: runId,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          graphEdges.projectId,
          graphEdges.fromKind,
          graphEdges.fromKey,
          graphEdges.kind,
          graphEdges.toKind,
          graphEdges.toKey,
        ],
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
 * within one statement would otherwise break PostgreSQL's `ON CONFLICT`.
 */
export async function ingestRunGraph(
  db: DB,
  projectId: number,
  runId: number,
  reaches: RunGraphReach[],
): Promise<void> {
  if (reaches.length === 0) return;
  const now = new Date();

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

  await chunkedUpsertNodes(db, projectId, runId, now, [...nodes.values()]);
  await chunkedUpsertEdges(db, projectId, runId, now, [...edges.values()]);
}

/**
 * Persist `changes` edges for a diff: the head commit and every ticket named in
 * the pull request point at each changed file. Files are edge endpoints, not
 * materialized nodes in this milestone. Upsert semantics, never truncate.
 */
export async function ingestChangesEdges(
  db: DB,
  projectId: number,
  runId: number,
  headSha: string,
  tickets: string[],
  files: string[],
): Promise<void> {
  if (files.length === 0) return;
  const now = new Date();
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
  await chunkedUpsertEdges(db, projectId, runId, now, [...edges.values()]);
}

/**
 * Rebuild a project's `route`/`page` nodes and `reaches` edges from its whole
 * stored history, oldest run first so first- and last-seen land in order. Upsert
 * semantics make it idempotent — running it twice changes nothing. This is the
 * one-off backfill for instances whose history predates the graph.
 */
export async function rebuildProjectGraph(db: DB, projectId: number): Promise<{ runsProcessed: number }> {
  const runs = await db
    .select({ id: testRuns.id })
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
        status: networkRequests.status,
      })
      .from(networkRequests)
      .where(eq(networkRequests.testRunId, run.id));

    const byCase = new Map<number, Array<{ method: string; normalizedUrl: string; status: number }>>();
    for (const r of requests) {
      if (!r.normalizedUrl) continue;
      const list = byCase.get(r.testRunsCaseId) ?? [];
      list.push({ method: r.method, normalizedUrl: r.normalizedUrl, status: r.status });
      byCase.set(r.testRunsCaseId, list);
    }

    const rows = cases.map((c) => ({ testCaseId: c.testCaseId, pageState: c.pageState }));
    const builders = cases.map((c) => ({ items: byCase.get(c.id) ?? [] }));
    await ingestRunGraph(db, projectId, run.id, collectRunGraphReaches(rows, builders));
    processed++;
  }

  return { runsProcessed: processed };
}
