import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { entityLinks, integrationActions, testRunsCases } from '../../server/database/schema';
import type { DrizzleDB } from './db';

/**
 * The tracker issue a failure cluster is known by, as the surfaces around an
 * execution show it: the execution page, a run's test rows, a test's recent
 * executions. An issue created from a failing test is attached to the test's
 * cluster, so every execution of that cluster carries it.
 */
export interface KnownIssueRef {
  key: string;
  url: string;
  provider: string;
  /** The issue's status as last synced from the tracker, e.g. "In Progress". */
  status: string | null;
  /** The badge color token resolved from the status category. */
  statusColor: string | null;
  /** The tracker's status category as last synced (`new`, `indeterminate`, `done`). */
  statusCategory: string | null;
  /** The issue's assignee in the tracker, as last synced. */
  assignee: string | null;
  /** `created` when Piwi filed the issue, else a link a person pinned. */
  origin: string | null;
  /** When the link was made: the filing, or the pin. */
  linkedAt: string | null;
}

/**
 * Whether a link is a tracker issue Piwi can write back through: it carries a
 * key and is a Jira link or sits on a connection. The newest such link on a
 * cluster is the cluster's known issue.
 */
export function isTrackerLink(link: { provider: string; key: string | null; connectionId: number | null }): boolean {
  return !!link.key && (link.provider === 'jira' || link.connectionId != null);
}

/** The known issue of each cluster that has one, keyed by cluster id, in one query. */
export async function clusterKnownIssues(db: DrizzleDB, clusterIds: number[]): Promise<Map<number, KnownIssueRef>> {
  const out = new Map<number, KnownIssueRef>();
  const ids = [...new Set(clusterIds.filter((id): id is number => typeof id === 'number'))];
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      clusterId: entityLinks.failureClusterId,
      key: entityLinks.key,
      url: entityLinks.url,
      provider: entityLinks.provider,
      connectionId: entityLinks.connectionId,
      statusText: entityLinks.statusText,
      statusColor: entityLinks.statusColor,
      metadata: entityLinks.metadata,
      origin: entityLinks.origin,
      createdAt: entityLinks.createdAt,
    })
    .from(entityLinks)
    .where(and(inArray(entityLinks.failureClusterId, ids), isNotNull(entityLinks.key)))
    .orderBy(desc(entityLinks.id));
  for (const row of rows) {
    if (row.clusterId == null || out.has(row.clusterId) || !isTrackerLink(row)) continue;
    const meta = (row.metadata ?? null) as { statusCategory?: string | null; assignee?: string | null } | null;
    out.set(row.clusterId, {
      key: row.key!,
      url: row.url,
      provider: row.provider,
      status: row.statusText ?? null,
      statusColor: row.statusColor ?? null,
      statusCategory: meta?.statusCategory ?? null,
      assignee: meta?.assignee ?? null,
      origin: row.origin ?? null,
      linkedAt: row.createdAt ? new Date(row.createdAt as unknown as string | number | Date).toISOString() : null,
    });
  }
  return out;
}

/**
 * The clusters whose issue filing is queued: the tracker did not answer the
 * create yet and the outbox retries it. The pages show the queued filing; filing
 * again re-runs the same action at once.
 */
export async function clusterIssueFilingsQueued(db: DrizzleDB, clusterIds: number[]): Promise<Set<number>> {
  const ids = [...new Set(clusterIds.filter((id): id is number => typeof id === 'number'))];
  if (ids.length === 0) return new Set();
  const queued = and(
    eq(integrationActions.kind, 'create-issue'),
    inArray(integrationActions.status, ['pending', 'processing']),
  );
  const [onCluster, onExecution] = await Promise.all([
    db
      .select({ clusterId: integrationActions.entityId })
      .from(integrationActions)
      .where(
        and(queued, eq(integrationActions.entityType, 'failure_cluster'), inArray(integrationActions.entityId, ids)),
      ),
    // A filing recorded against one of the cluster's executions counts for the cluster.
    db
      .select({ clusterId: testRunsCases.failureClusterId })
      .from(integrationActions)
      .innerJoin(testRunsCases, eq(testRunsCases.id, integrationActions.entityId))
      .where(
        and(queued, eq(integrationActions.entityType, 'test_runs_case'), inArray(testRunsCases.failureClusterId, ids)),
      ),
  ]);
  return new Set([...onCluster, ...onExecution].map((r) => r.clusterId).filter((id): id is number => id != null));
}
