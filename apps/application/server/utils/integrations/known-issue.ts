/**
 * The tracker issue a cluster is already known by, if any — the join every
 * surface that "carries the key" reads: the notifications, the PR feedback
 * comment, the fix plan, and the MCP outputs. A cluster's known issue is the
 * newest tracker link pinned to it (or created for it) that has a key.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { entityLinks } from '../../database/schema';
import type { DbClient } from '../../database';
import type { EntityLink } from '../../database/schema';

export interface KnownIssue {
  key: string;
  url: string;
  status: string | null;
}

/**
 * The cluster's tracker link — the newest link with a key that Piwi can write
 * back through (a Jira link, or any link that carries a `connection_id`). The
 * full row, for the sync task and the policies that comment and transition.
 */
export async function getClusterTrackerLink(db: DbClient, clusterId: number): Promise<EntityLink | null> {
  const links = await db
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.failureClusterId, clusterId), isNotNull(entityLinks.key)))
    .orderBy(desc(entityLinks.id));
  return links.find((l) => l.provider === 'jira' || l.connectionId != null) ?? null;
}

/** The cluster's known tracker issue, or null. */
export async function getClusterKnownIssue(db: DbClient, clusterId: number): Promise<KnownIssue | null> {
  const link = await getClusterTrackerLink(db, clusterId);
  if (!link?.key) return null;
  return { key: link.key, url: link.url, status: link.statusText ?? null };
}

/** Known issues for several clusters at once, keyed by cluster id. */
export async function getClusterKnownIssues(db: DbClient, clusterIds: number[]): Promise<Map<number, KnownIssue>> {
  const out = new Map<number, KnownIssue>();
  const unique = [...new Set(clusterIds.filter((id) => id != null))];
  for (const id of unique) {
    const issue = await getClusterKnownIssue(db, id);
    if (issue) out.set(id, issue);
  }
  return out;
}
