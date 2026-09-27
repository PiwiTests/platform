import { and, desc, inArray, isNotNull } from 'drizzle-orm';
import { entityLinks } from '../../server/database/schema';
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
    })
    .from(entityLinks)
    .where(and(inArray(entityLinks.failureClusterId, ids), isNotNull(entityLinks.key)))
    .orderBy(desc(entityLinks.id));
  for (const row of rows) {
    if (row.clusterId == null || out.has(row.clusterId) || !isTrackerLink(row)) continue;
    out.set(row.clusterId, {
      key: row.key!,
      url: row.url,
      provider: row.provider,
      status: row.statusText ?? null,
      statusColor: row.statusColor ?? null,
    });
  }
  return out;
}
