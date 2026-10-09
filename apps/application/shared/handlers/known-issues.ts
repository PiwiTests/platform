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
  /** The issue's summary as last synced from the tracker. */
  title: string | null;
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
      title: entityLinks.title,
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
      title: row.title ?? null,
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
 * An issue filing that ended for good, because the tracker refused it, every
 * retry failed, or Piwi could not send it: no retry is coming, and filing again
 * replaces it.
 */
export interface IssueFilingFailure {
  /** Why, as the tracker answered or as Piwi recorded it. */
  error: string | null;
  /** When its last attempt ended. */
  at: string | null;
}

/** Where the issue filings of some clusters stand, by cluster id. */
export interface ClusterIssueFilings {
  /** A filing waits on the tracker: the outbox retries it, and filing again re-runs it at once. */
  queued: Set<number>;
  /** The newest filing failed for good, with its reason. */
  failures: Map<number, IssueFilingFailure>;
}

/**
 * Where each cluster's issue filings stand, in two queries: the `create-issue`
 * actions recorded for the cluster and for its executions, since a filing asked
 * from an execution counts for its cluster. A cluster's filing is queued while
 * one of them waits on the tracker, and failed while the newest of them failed
 * or was skipped. The failure pages show both where they name the ticket.
 */
export async function clusterIssueFilings(db: DrizzleDB, clusterIds: number[]): Promise<ClusterIssueFilings> {
  const out: ClusterIssueFilings = { queued: new Set(), failures: new Map() };
  const ids = [...new Set(clusterIds.filter((id): id is number => typeof id === 'number'))];
  if (ids.length === 0) return out;
  const columns = {
    id: integrationActions.id,
    status: integrationActions.status,
    error: integrationActions.error,
    createdAt: integrationActions.createdAt,
    finishedAt: integrationActions.finishedAt,
  };
  const createIssue = eq(integrationActions.kind, 'create-issue');
  const [onCluster, onExecution] = await Promise.all([
    db
      .select({ ...columns, clusterId: integrationActions.entityId })
      .from(integrationActions)
      .where(
        and(
          createIssue,
          eq(integrationActions.entityType, 'failure_cluster'),
          inArray(integrationActions.entityId, ids),
        ),
      ),
    db
      .select({ ...columns, clusterId: testRunsCases.failureClusterId })
      .from(integrationActions)
      .innerJoin(testRunsCases, eq(testRunsCases.id, integrationActions.entityId))
      .where(
        and(
          createIssue,
          eq(integrationActions.entityType, 'test_runs_case'),
          inArray(testRunsCases.failureClusterId, ids),
        ),
      ),
  ]);
  const newest = new Map<number, (typeof onExecution)[number]>();
  for (const row of [...onCluster, ...onExecution]) {
    if (row.clusterId == null) continue;
    if (row.status === 'pending' || row.status === 'processing') out.queued.add(row.clusterId);
    const seen = newest.get(row.clusterId);
    if (!seen || row.id > seen.id) newest.set(row.clusterId, row);
  }
  for (const [clusterId, row] of newest) {
    if (row.status !== 'failed' && row.status !== 'skipped') continue;
    const at = row.finishedAt ?? row.createdAt;
    out.failures.set(clusterId, {
      error: row.error ?? null,
      at: at ? new Date(at as unknown as string | number | Date).toISOString() : null,
    });
  }
  return out;
}
