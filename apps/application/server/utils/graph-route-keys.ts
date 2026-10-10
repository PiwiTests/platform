/**
 * One endpoint, one route node. A route key holds no query (`routeNodeKey`), but
 * older versions kept the query's parameter names in it, so `GET /api/users?page=…`
 * and `GET /api/users?role=…` were two nodes. This rewrites those keys once per
 * instance, after the migrations: the nodes and edges that then share a key are
 * merged, the probe ledger and the snooze signatures follow, and the gap ledger
 * keeps every verdict.
 */
import { and, eq, isNull, like, or } from 'drizzle-orm';
import { graphEdges, graphNodes, probes, scenarioGaps } from '../database/schema';
import { routeKeyWithoutQuery } from '#shared/graph';
import type { DrizzleDB } from '#shared/handlers/db';
import { getAppSetting, setAppSetting } from './app-settings';

/** App setting that records the rewrite, so it runs once per instance. */
export const ROUTE_KEYS_WITHOUT_QUERY_SETTING = 'graph_route_keys_without_query_at';

/** What the rewrite changed, per table. */
export interface RouteKeyRewrite {
  nodes: number;
  edges: number;
  probes: number;
  gaps: number;
}

/** A query names no `:` once encoded, so it ends at the next `:` (a gap key's status suffix) or the end. */
function withoutQuery(routePart: string): string {
  return routePart.replace(/\?[^:]*/, '');
}

/**
 * A gap key with the query taken out of the route it names, for the forms that
 * name one: a bare route key, `route:<route>` (with an optional `:<status>`), and
 * `dependency:<name> @ <route>`. Any other key is returned as it is, so a
 * control named `Need help?` keeps its question mark.
 */
export function gapKeyWithoutRouteQuery(key: string): string {
  if (key.startsWith('dependency:')) {
    const at = key.indexOf(' @ ');
    return at < 0 ? key : `${key.slice(0, at + 3)}${withoutQuery(key.slice(at + 3))}`;
  }
  if (key.startsWith('route:')) return `route:${withoutQuery(key.slice('route:'.length))}`;
  if (/^[A-Z]+ \//.test(key)) return withoutQuery(key);
  return key;
}

/**
 * A snooze signature with the query taken out of every route endpoint it lists,
 * the lines the merge made equal counted once: the signature the subject has
 * after the rewrite, so a gap snoozed until its node changes is not woken by it.
 */
export function signatureWithoutRouteQuery(signature: string): string {
  const [, ...lines] = signature.split('\n');
  const rewritten = [
    ...new Set(lines.map((line) => line.replace(/(route:[A-Z]+ [^>|?]*)\?[^>|]*/g, '$1')).filter(Boolean)),
  ].sort();
  return `${rewritten.length}\n${rewritten.join('\n')}`;
}

const earliest = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.min(a, b));
const latest = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
const later = (a: Date, b: Date) => (new Date(a).getTime() >= new Date(b).getTime() ? a : b);

/** How deliberate a gap's status is, for the row a set of duplicates keeps: a verdict first, then the queue. */
const STATUS_RANK: Record<string, number> = { dismissed: 5, accepted: 4, snoozed: 3, open: 2, closed: 1 };

/**
 * Rewrite the route keys that hold a query. A node whose new key another node
 * already has is merged into it: the earliest first sighting, the latest last
 * one, live if either is, the survivor's attributes first, and its probes moved
 * over. An edge is merged the same way. A probe whose new key collides keeps
 * the newer outcome. A gap row takes the new key when no row has it yet, the
 * most deliberate of its duplicates first; the others keep their key and their
 * verdict, and an open, snoozed or accepted one closes, with no run credited.
 */
export async function rewriteQueryRouteKeys(db: DrizzleDB): Promise<RouteKeyRewrite> {
  const out: RouteKeyRewrite = { nodes: 0, edges: 0, probes: 0, gaps: 0 };

  const nodes = await db
    .select()
    .from(graphNodes)
    .where(and(eq(graphNodes.kind, 'route'), like(graphNodes.key, '%?%')));
  for (const node of nodes) {
    const key = routeKeyWithoutQuery(node.key);
    const [survivor] = await db
      .select()
      .from(graphNodes)
      .where(
        and(
          eq(graphNodes.projectId, node.projectId),
          eq(graphNodes.kind, 'route'),
          eq(graphNodes.key, key),
          node.branch == null ? isNull(graphNodes.branch) : eq(graphNodes.branch, node.branch),
        ),
      );
    if (!survivor) {
      await db.update(graphNodes).set({ key }).where(eq(graphNodes.id, node.id));
    } else {
      await db
        .update(graphNodes)
        .set({
          firstSeenRunId: earliest(survivor.firstSeenRunId, node.firstSeenRunId),
          lastSeenRunId: latest(survivor.lastSeenRunId, node.lastSeenRunId),
          lastSeenAt: later(survivor.lastSeenAt, node.lastSeenAt),
          prunedAt: survivor.prunedAt && node.prunedAt ? later(survivor.prunedAt, node.prunedAt) : null,
          attrs: survivor.attrs ?? node.attrs,
          usage30d: latest(survivor.usage30d, node.usage30d),
        })
        .where(eq(graphNodes.id, survivor.id));
      await db.update(probes).set({ nodeId: survivor.id }).where(eq(probes.nodeId, node.id));
      await db.delete(graphNodes).where(eq(graphNodes.id, node.id));
    }
    out.nodes++;
  }

  const edges = await db
    .select()
    .from(graphEdges)
    .where(
      or(
        and(eq(graphEdges.fromKind, 'route'), like(graphEdges.fromKey, '%?%')),
        and(eq(graphEdges.toKind, 'route'), like(graphEdges.toKey, '%?%')),
      ),
    );
  for (const edge of edges) {
    const fromKey = edge.fromKind === 'route' ? routeKeyWithoutQuery(edge.fromKey) : edge.fromKey;
    const toKey = edge.toKind === 'route' ? routeKeyWithoutQuery(edge.toKey) : edge.toKey;
    const [survivor] = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.projectId, edge.projectId),
          eq(graphEdges.fromKind, edge.fromKind),
          eq(graphEdges.fromKey, fromKey),
          eq(graphEdges.kind, edge.kind),
          eq(graphEdges.toKind, edge.toKind),
          eq(graphEdges.toKey, toKey),
          edge.branch == null ? isNull(graphEdges.branch) : eq(graphEdges.branch, edge.branch),
        ),
      );
    if (!survivor) {
      await db.update(graphEdges).set({ fromKey, toKey }).where(eq(graphEdges.id, edge.id));
    } else {
      await db
        .update(graphEdges)
        .set({
          firstSeenRunId: earliest(survivor.firstSeenRunId, edge.firstSeenRunId),
          lastSeenRunId: latest(survivor.lastSeenRunId, edge.lastSeenRunId),
          lastSeenAt: later(survivor.lastSeenAt, edge.lastSeenAt),
          confidence: latest(survivor.confidence, edge.confidence),
        })
        .where(eq(graphEdges.id, survivor.id));
      await db.delete(graphEdges).where(eq(graphEdges.id, edge.id));
    }
    out.edges++;
  }

  // A dependency's checks edge names the route it was probed through in its evidence.
  const dependencyChecks = await db
    .select({ id: graphEdges.id, evidence: graphEdges.evidence })
    .from(graphEdges)
    .where(and(eq(graphEdges.kind, 'checks'), eq(graphEdges.toKind, 'dependency')));
  for (const edge of dependencyChecks) {
    const evidence = edge.evidence as { route?: unknown } | null;
    if (typeof evidence?.route !== 'string' || !evidence.route.includes('?')) continue;
    await db
      .update(graphEdges)
      .set({ evidence: { ...evidence, route: routeKeyWithoutQuery(evidence.route) } as never })
      .where(eq(graphEdges.id, edge.id));
    out.edges++;
  }

  const probeRows = await db.select().from(probes).where(like(probes.routeKey, '%?%'));
  for (const probe of probeRows) {
    const routeKey = routeKeyWithoutQuery(probe.routeKey!);
    const [other] = await db
      .select({ id: probes.id, probedAt: probes.probedAt })
      .from(probes)
      .where(
        and(
          eq(probes.projectId, probe.projectId),
          probe.testCaseId == null ? isNull(probes.testCaseId) : eq(probes.testCaseId, probe.testCaseId),
          eq(probes.routeKey, routeKey),
          eq(probes.fault, probe.fault),
        ),
      );
    if (other && later(other.probedAt, probe.probedAt) === other.probedAt) {
      await db.delete(probes).where(eq(probes.id, probe.id));
    } else {
      if (other) await db.delete(probes).where(eq(probes.id, other.id));
      await db.update(probes).set({ routeKey }).where(eq(probes.id, probe.id));
    }
    out.probes++;
  }

  const gapRows = await db
    .select({
      id: scenarioGaps.id,
      projectId: scenarioGaps.projectId,
      detector: scenarioGaps.detector,
      key: scenarioGaps.key,
      status: scenarioGaps.status,
      updatedAt: scenarioGaps.updatedAt,
    })
    .from(scenarioGaps)
    .where(like(scenarioGaps.key, '%?%'));
  const groups = new Map<string, typeof gapRows>();
  for (const gap of gapRows) {
    const key = gapKeyWithoutRouteQuery(gap.key);
    if (key === gap.key) continue;
    const id = `${gap.projectId}\x00${gap.detector}\x00${key}`;
    groups.set(id, [...(groups.get(id) ?? []), gap]);
  }
  const now = new Date();
  for (const [id, rows] of groups) {
    const key = id.split('\x00')[2]!;
    const { projectId, detector } = rows[0]!;
    const [holder] = await db
      .select({ id: scenarioGaps.id })
      .from(scenarioGaps)
      .where(
        and(eq(scenarioGaps.projectId, projectId), eq(scenarioGaps.detector, detector), eq(scenarioGaps.key, key)),
      );
    const ranked = [...rows].sort(
      (a, b) =>
        (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) ||
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const renamed = holder ? null : ranked[0]!;
    if (renamed) await db.update(scenarioGaps).set({ key }).where(eq(scenarioGaps.id, renamed.id));
    for (const gap of ranked) {
      if (gap === renamed || !['open', 'snoozed', 'accepted'].includes(gap.status)) continue;
      await db
        .update(scenarioGaps)
        .set({ status: 'closed', closedAt: now, closedByRunId: null, updatedAt: now })
        .where(eq(scenarioGaps.id, gap.id));
    }
    out.gaps += rows.length;
  }

  const snoozed = await db
    .select({ id: scenarioGaps.id, signature: scenarioGaps.snoozedAtSignature })
    .from(scenarioGaps)
    .where(like(scenarioGaps.snoozedAtSignature, '%?%'));
  for (const gap of snoozed) {
    const signature = signatureWithoutRouteQuery(gap.signature!);
    if (signature !== gap.signature) {
      await db.update(scenarioGaps).set({ snoozedAtSignature: signature }).where(eq(scenarioGaps.id, gap.id));
    }
  }

  return out;
}

/** Run {@link rewriteQueryRouteKeys} once per instance; later starts skip it. */
export async function rewriteQueryRouteKeysOnce(db: DrizzleDB): Promise<RouteKeyRewrite | null> {
  if (await getAppSetting(db, ROUTE_KEYS_WITHOUT_QUERY_SETTING)) return null;
  const rewrite = await rewriteQueryRouteKeys(db);
  await setAppSetting(db, ROUTE_KEYS_WITHOUT_QUERY_SETTING, new Date().toISOString());
  return rewrite;
}
