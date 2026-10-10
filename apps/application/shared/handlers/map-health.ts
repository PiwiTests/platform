/**
 * Map health: how complete a project's Test Map is, input by input. Each input
 * is optional, and a detector that reads one stays silent without it, so a quiet
 * Gaps tab can mean a covered application or a map that cannot see. Each row
 * counts what the input holds against what it could hold, and names the
 * detectors it wakes; the Gaps tab adds the setup step behind each.
 */
import { and, count, countDistinct, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { graphEdges, graphNodes, locatorUsages, testFunctions } from '../../server/database/schema';
import type { DrizzleDB } from './db';

/** The inputs the panel lists, in its order. */
export type MapHealthInput = 'inventory' | 'locator-pages' | 'handlers' | 'probes' | 'declared' | 'changes' | 'catalog';

export interface MapHealthRow {
  id: MapHealthInput;
  /** What the input holds: pages with an inventory, routes with a handler, declared routes. */
  have: number;
  /** What it could hold, or null for an input counted on its own (declared routes, catalog methods). */
  of: number | null;
  /** The detectors that read it. */
  wakes: string[];
  /** The input also ranks gaps: churn and escape history behind a route's handler. */
  ranks?: boolean;
}

/** The detectors each input wakes. */
const WAKES: Record<MapHealthInput, string[]> = {
  inventory: ['control-nobody-exercises', 'reachable-unvisited'],
  'locator-pages': ['assertion-light', 'single-covering-test'],
  handlers: ['unprobed-dependency', 'not-handled'],
  probes: ['not-noticed', 'not-handled'],
  declared: ['declared-never-hit', 'success-only'],
  changes: ['changed-unreached'],
  catalog: ['catalog-method-no-test-calls'],
};

/** How long a locator use counts, as for control reach. */
const LOCATOR_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

const within = (keys: Set<string>, of: Set<string>) => [...keys].filter((k) => of.has(k)).length;

/**
 * The map's completeness per input, on the default branch: reached pages with
 * an inventory, tests whose locator calls name their page, observed routes with
 * a handler, reached routes a probe checked, then the declared routes and pages,
 * the recorded diffs and the catalog's methods, each counted on its own. Five
 * queries, run together: the live pages and routes, the tests' edges into them,
 * the edges out of pages, routes and commits, the locator index and the catalog.
 */
export async function getMapHealth(db: DrizzleDB, projectId: number, now: Date = new Date()): Promise<MapHealthRow[]> {
  const canonical = and(eq(graphEdges.projectId, projectId), isNull(graphEdges.branch));
  const [live, targets, sources, locator, catalog] = await Promise.all([
    db
      .select({ kind: graphNodes.kind, key: graphNodes.key, origin: graphNodes.origin })
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, projectId),
          isNull(graphNodes.branch),
          isNull(graphNodes.prunedAt),
          inArray(graphNodes.kind, ['page', 'route']),
        ),
      ),
    db
      .selectDistinct({ kind: graphEdges.kind, toKind: graphEdges.toKind, key: graphEdges.toKey })
      .from(graphEdges)
      .where(
        and(
          canonical,
          eq(graphEdges.fromKind, 'test'),
          inArray(graphEdges.kind, ['reaches', 'checks']),
          inArray(graphEdges.toKind, ['page', 'route']),
        ),
      ),
    db
      .selectDistinct({ kind: graphEdges.kind, key: graphEdges.fromKey })
      .from(graphEdges)
      .where(
        and(
          canonical,
          or(
            and(eq(graphEdges.kind, 'contains'), eq(graphEdges.fromKind, 'page')),
            and(eq(graphEdges.kind, 'handled-by'), eq(graphEdges.fromKind, 'route')),
            and(eq(graphEdges.kind, 'changes'), eq(graphEdges.fromKind, 'commit')),
          ),
        ),
      ),
    db
      .select({
        tests: countDistinct(locatorUsages.testCaseId),
        paged: sql<number>`count(distinct case when ${locatorUsages.page} <> '' then ${locatorUsages.testCaseId} end)`,
      })
      .from(locatorUsages)
      .where(
        and(
          eq(locatorUsages.projectId, projectId),
          eq(locatorUsages.branch, ''),
          gte(locatorUsages.lastSeenAt, new Date(now.getTime() - LOCATOR_MAX_AGE_MS)),
        ),
      ),
    db
      .select({ methods: count() })
      .from(testFunctions)
      .where(and(eq(testFunctions.projectId, projectId), ne(testFunctions.kind, 'fixture'))),
  ]);

  const declared = live.filter((n) => n.origin === 'manifest' || n.origin === 'openapi');
  const liveKeys = (kind: string) => new Set(live.filter((n) => n.kind === kind).map((n) => n.key));
  const edgeKeys = (rows: Array<{ kind: string; key: string; toKind?: string }>, kind: string, toKind?: string) =>
    new Set(rows.filter((r) => r.kind === kind && (!toKind || r.toKind === toKind)).map((r) => r.key));
  const pages = liveKeys('page');
  const routes = liveKeys('route');
  const reachedPages = new Set([...edgeKeys(targets, 'reaches', 'page')].filter((k) => pages.has(k)));
  const reachedRoutes = new Set([...edgeKeys(targets, 'reaches', 'route')].filter((k) => routes.has(k)));
  const observedRoutes = new Set(
    live.filter((n) => n.kind === 'route' && n.origin !== 'manifest' && n.origin !== 'openapi').map((n) => n.key),
  );

  const rows: Array<Omit<MapHealthRow, 'wakes'>> = [
    { id: 'inventory', have: within(reachedPages, edgeKeys(sources, 'contains')), of: reachedPages.size },
    { id: 'locator-pages', have: Number(locator[0]?.paged ?? 0), of: Number(locator[0]?.tests ?? 0) },
    {
      id: 'handlers',
      have: within(observedRoutes, edgeKeys(sources, 'handled-by')),
      of: observedRoutes.size,
      ranks: true,
    },
    { id: 'probes', have: within(reachedRoutes, edgeKeys(targets, 'checks', 'route')), of: reachedRoutes.size },
    { id: 'declared', have: declared.length, of: null },
    { id: 'changes', have: edgeKeys(sources, 'changes').size, of: null, ranks: true },
    { id: 'catalog', have: Number(catalog[0]?.methods ?? 0), of: null },
  ];
  return rows.map((row) => ({ ...row, wakes: WAKES[row.id] }));
}
