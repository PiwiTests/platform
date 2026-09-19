/**
 * The feature-graph neighborhood for the graph view and the `get_feature_graph`
 * MCP tool: starting from one node, walk the typed graph outward — in both
 * directions — to a bounded depth, and return the nodes (each with its gap class
 * and the tests that reach it) and the edges between them.
 *
 * The walk is a breadth-first expansion capped at depth six and at a per-level
 * frontier size, so a hub node cannot fan the query out without bound. Only
 * canonical rows (branch null) are read.
 */

import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { graphEdges, scenarioGaps, testCases } from '../database/schema';
import { subjectFromGapKey } from '#shared/handlers/scenario-gaps';
import type { DrizzleDB } from '#shared/handlers/db';

/** The maximum traversal depth the endpoint and tool allow. */
export const MAX_GRAPH_DEPTH = 6;
/** The most nodes expanded at any one level, so a hub cannot explode the query. */
const MAX_FRONTIER = 200;

export interface GraphViewNode {
  kind: string;
  key: string;
  /** The class of the highest-scoring open gap on this node, or null. */
  class: string | null;
  /** How many hops from the seed this node is. */
  depth: number;
  /** Tests that reach this node, by id and title. */
  tests: Array<{ testCaseId: number; title: string }>;
}

export interface GraphViewEdge {
  fromKind: string;
  fromKey: string;
  toKind: string;
  toKey: string;
  kind: string;
  confidence: number | null;
}

export interface FeatureGraph {
  seed: { kind: string; key: string };
  depth: number;
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
}

/** A node's identity string for the visited set and lookups. */
function id(kind: string, key: string): string {
  return `${kind}\x00${key}`;
}

/**
 * Walk the graph outward from `seed` to `depth`, both directions. Returns the
 * reachable nodes with their gap class and reaching tests, and the edges walked.
 */
export async function getFeatureGraph(
  db: DrizzleDB,
  projectId: number,
  seed: { kind: string; key: string },
  depth: number,
): Promise<FeatureGraph> {
  const maxDepth = Math.min(MAX_GRAPH_DEPTH, Math.max(1, Math.floor(depth)));
  const nodeDepth = new Map<string, number>([[id(seed.kind, seed.key), 0]]);
  const edges = new Map<string, GraphViewEdge>();
  let frontier: Array<{ kind: string; key: string }> = [seed];

  for (let level = 0; level < maxDepth && frontier.length > 0; level++) {
    const capped = frontier.slice(0, MAX_FRONTIER);
    const conds = capped.map((n) =>
      or(
        and(eq(graphEdges.fromKind, n.kind), eq(graphEdges.fromKey, n.key)),
        and(eq(graphEdges.toKind, n.kind), eq(graphEdges.toKey, n.key)),
      ),
    );
    const rows = await db
      .select({
        fromKind: graphEdges.fromKind,
        fromKey: graphEdges.fromKey,
        toKind: graphEdges.toKind,
        toKey: graphEdges.toKey,
        kind: graphEdges.kind,
        confidence: graphEdges.confidence,
      })
      .from(graphEdges)
      .where(and(eq(graphEdges.projectId, projectId), isNull(graphEdges.branch), or(...conds)));

    const next: Array<{ kind: string; key: string }> = [];
    for (const e of rows) {
      const edgeId = `${e.fromKind}\x00${e.fromKey}\x00${e.kind}\x00${e.toKind}\x00${e.toKey}`;
      if (!edges.has(edgeId)) edges.set(edgeId, { ...e });
      for (const end of [
        { kind: e.fromKind, key: e.fromKey },
        { kind: e.toKind, key: e.toKey },
      ]) {
        const nid = id(end.kind, end.key);
        if (!nodeDepth.has(nid)) {
          nodeDepth.set(nid, level + 1);
          next.push(end);
        }
      }
    }
    frontier = next;
  }

  // Gap class per node: the class of the highest-scoring open gap on the node.
  const gapRows = await db
    .select({ key: scenarioGaps.key, class: scenarioGaps.class, score: scenarioGaps.score })
    .from(scenarioGaps)
    .where(and(eq(scenarioGaps.projectId, projectId), eq(scenarioGaps.status, 'open')));
  const classByNode = new Map<string, { class: string; score: number }>();
  for (const g of gapRows) {
    const subject = subjectFromGapKey(g.key);
    const nid = id(subject.kind, subject.key);
    const score = g.score ?? 0;
    const prev = classByNode.get(nid);
    if (!prev || score > prev.score) classByNode.set(nid, { class: g.class, score });
  }

  // Tests reaching each node (from the reaches edges already walked), with titles.
  const testsByNode = new Map<string, Set<number>>();
  for (const e of edges.values()) {
    if (e.kind !== 'reaches' || e.fromKind !== 'test') continue;
    const testId = Number(e.fromKey);
    if (!Number.isFinite(testId)) continue;
    const nid = id(e.toKind, e.toKey);
    const set = testsByNode.get(nid) ?? new Set<number>();
    set.add(testId);
    testsByNode.set(nid, set);
  }
  const allTestIds = [...new Set([...testsByNode.values()].flatMap((s) => [...s]))];
  const titleById = new Map<number, string>();
  for (let i = 0; i < allTestIds.length; i += 200) {
    const rows = await db
      .select({ id: testCases.id, title: testCases.title })
      .from(testCases)
      .where(inArray(testCases.id, allTestIds.slice(i, i + 200)));
    for (const r of rows) titleById.set(r.id, r.title);
  }

  const nodes: GraphViewNode[] = [...nodeDepth].map(([nid, d]) => {
    const [kind, key] = nid.split('\x00');
    return {
      kind: kind!,
      key: key!,
      class: classByNode.get(nid)?.class ?? null,
      depth: d,
      tests: [...(testsByNode.get(nid) ?? [])].map((tid) => ({
        testCaseId: tid,
        title: titleById.get(tid) ?? `test ${tid}`,
      })),
    };
  });

  return { seed, depth: maxDepth, nodes, edges: [...edges.values()] };
}
