/**
 * The feature-graph neighborhood for the graph view and the `get_feature_graph`
 * MCP tool: starting from one node, walk the typed graph outward — in both
 * directions — to a bounded depth, and return the nodes (each with its gap class
 * and the tests that reach it) and the edges between them.
 *
 * The walk is a breadth-first expansion capped at depth six and at a per-level
 * frontier size, so a hub node cannot fan the query out without bound. Only
 * canonical rows (branch null) are read.
 *
 * Also the feature map — the folded, per-feature view the graph view opens on —
 * at the bottom of this file.
 */

import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { graphEdges, scenarioGaps, testCases } from '../database/schema';
import { subjectFromGapKey } from '#shared/handlers/scenario-gaps';
import { gapClassSeverity, worstGapClass } from '#shared/gap-classes';
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

  // Tests reaching each node, with titles. Read for every node in the graph,
  // not only from the edges walked: a route one hop from a feature still shows
  // its reaching tests even though the walk stopped before their edges.
  const testsByNode = new Map<string, Set<number>>();
  const nodeIds = [...nodeDepth.keys()];
  for (let i = 0; i < nodeIds.length; i += 200) {
    const chunk = nodeIds.slice(i, i + 200).map((nid) => {
      const [kind, key] = nid.split('\x00');
      return and(eq(graphEdges.toKind, kind!), eq(graphEdges.toKey, key!));
    });
    const rows = await db
      .select({ fromKey: graphEdges.fromKey, toKind: graphEdges.toKind, toKey: graphEdges.toKey })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.kind, 'reaches'),
          eq(graphEdges.fromKind, 'test'),
          isNull(graphEdges.branch),
          or(...chunk),
        ),
      );
    for (const e of rows) {
      const testId = Number(e.fromKey);
      if (!Number.isFinite(testId)) continue;
      const nid = id(e.toKind, e.toKey);
      const set = testsByNode.get(nid) ?? new Set<number>();
      set.add(testId);
      testsByNode.set(nid, set);
    }
  }
  const allTestIds = [...new Set([...testsByNode.values()].flatMap((s) => [...s]))];
  const titleById = new Map<number, string>();
  for (let i = 0; i < allTestIds.length; i += 200) {
    const rows = await db
      .select({ id: testCases.id, title: testCases.title })
      .from(testCases)
      .where(and(eq(testCases.projectId, projectId), inArray(testCases.id, allTestIds.slice(i, i + 200))));
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

// ── The feature map ──────────────────────────────────────────────────────────
//
// The top level of the graph view: one node per feature, sized by what it
// groups, colored by the worst open gap under it, linked to the features it
// shares routes and pages with. It reads the canonical `groups` edges (feature →
// route/page/control), the open gaps and the `reaches` edges, and folds them per
// feature — a bounded query however large the application, since features are
// the tags a team put on its tests.

export interface FeatureMapFeature {
  /** The feature's name — its node key. */
  key: string;
  /** How many nodes the feature groups, per kind. */
  members: { routes: number; pages: number; controls: number };
  /** Distinct tests reaching any node the feature groups. */
  tests: number;
  /** Open gaps on the feature's nodes (and on the feature node itself), by class. */
  gaps: Record<string, number>;
  /** The most severe open-gap class under the feature, or null. */
  worstClass: string | null;
}

export interface FeatureMapLink {
  from: string;
  to: string;
  /** How many route/page/control nodes the two features share. */
  weight: number;
}

export interface FeatureMap {
  features: FeatureMapFeature[];
  links: FeatureMapLink[];
  /** Open gaps whose subject no feature groups, by class. */
  ungrouped: { gaps: Record<string, number>; worstClass: string | null };
}

/** Fold the canonical graph into features, their gap counts and shared-node links. */
export async function getFeatureMap(db: DrizzleDB, projectId: number): Promise<FeatureMap> {
  const groupRows = await db
    .select({ feature: graphEdges.fromKey, toKind: graphEdges.toKind, toKey: graphEdges.toKey })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.projectId, projectId),
        eq(graphEdges.kind, 'groups'),
        eq(graphEdges.fromKind, 'feature'),
        isNull(graphEdges.branch),
      ),
    );

  const features = new Map<string, FeatureMapFeature>();
  const featuresByNode = new Map<string, Set<string>>();
  const feature = (key: string): FeatureMapFeature => {
    let f = features.get(key);
    if (!f) {
      f = { key, members: { routes: 0, pages: 0, controls: 0 }, tests: 0, gaps: {}, worstClass: null };
      features.set(key, f);
    }
    return f;
  };
  for (const row of groupRows) {
    const f = feature(row.feature);
    if (row.toKind === 'route') f.members.routes++;
    else if (row.toKind === 'page') f.members.pages++;
    else if (row.toKind === 'control') f.members.controls++;
    const nid = id(row.toKind, row.toKey);
    const set = featuresByNode.get(nid) ?? new Set<string>();
    set.add(row.feature);
    featuresByNode.set(nid, set);
  }

  // Open gaps, folded onto the features grouping their subject — or onto the
  // feature itself for a gap keyed on the feature node — else onto "ungrouped".
  const gapRows = await db
    .select({ key: scenarioGaps.key, class: scenarioGaps.class })
    .from(scenarioGaps)
    .where(and(eq(scenarioGaps.projectId, projectId), eq(scenarioGaps.status, 'open')));
  const ungrouped: Record<string, number> = {};
  const count = (bucket: Record<string, number>, cls: string) => {
    bucket[cls] = (bucket[cls] ?? 0) + 1;
  };
  for (const g of gapRows) {
    const subject = subjectFromGapKey(g.key);
    const owners =
      subject.kind === 'feature' && features.has(subject.key)
        ? new Set([subject.key])
        : featuresByNode.get(id(subject.kind, subject.key));
    if (!owners || owners.size === 0) {
      count(ungrouped, g.class);
      continue;
    }
    for (const owner of owners) count(feature(owner).gaps, g.class);
  }
  for (const f of features.values()) f.worstClass = worstGapClass(Object.keys(f.gaps));

  // Distinct tests per feature, from the canonical `reaches` edges onto its nodes.
  if (featuresByNode.size > 0) {
    const reachRows = await db
      .select({ test: graphEdges.fromKey, toKind: graphEdges.toKind, toKey: graphEdges.toKey })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, projectId),
          eq(graphEdges.kind, 'reaches'),
          eq(graphEdges.fromKind, 'test'),
          isNull(graphEdges.branch),
        ),
      );
    const testsByFeature = new Map<string, Set<string>>();
    for (const r of reachRows) {
      const owners = featuresByNode.get(id(r.toKind, r.toKey));
      if (!owners) continue;
      for (const owner of owners) {
        const set = testsByFeature.get(owner) ?? new Set<string>();
        set.add(r.test);
        testsByFeature.set(owner, set);
      }
    }
    for (const [key, tests] of testsByFeature) feature(key).tests = tests.size;
  }

  // Links: one per pair of features sharing a node, weighted by how many they share.
  const links = new Map<string, FeatureMapLink>();
  for (const owners of featuresByNode.values()) {
    if (owners.size < 2) continue;
    const sorted = [...owners].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const from = sorted[i]!;
        const to = sorted[j]!;
        const lid = `${from}\x00${to}`;
        const link = links.get(lid) ?? { from, to, weight: 0 };
        link.weight++;
        links.set(lid, link);
      }
    }
  }

  const ranked = [...features.values()].sort(
    (a, b) =>
      gapClassSeverity(b.worstClass) - gapClassSeverity(a.worstClass) ||
      sumGaps(b.gaps) - sumGaps(a.gaps) ||
      a.key.localeCompare(b.key),
  );
  return {
    features: ranked,
    links: [...links.values()].sort((a, b) => b.weight - a.weight),
    ungrouped: { gaps: ungrouped, worstClass: worstGapClass(Object.keys(ungrouped)) },
  };
}

function sumGaps(gaps: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(gaps)) n += v;
  return n;
}
