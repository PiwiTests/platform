/**
 * Status pull — reading the ticket back into the dashboard. Every entity link
 * that carries a `connection_id` is refreshed through its tracker: the status
 * name and color, the title, the status category and assignee (kept in the
 * link's metadata), so a cluster whose Jira issue closed last week stops sitting
 * in the inbox as open.
 *
 * Links on an open cluster refresh every sweep; links on a resolved or ignored
 * cluster refresh at most daily. When the ticket has moved to Done the
 * resolve-on-close policy closes the cluster (otherwise its state line offers
 * the reconcile), and a ticket reopened under a resolved cluster reopens it.
 * Work is bounded per sweep and a connection's failure is recorded on its
 * `last_error` rather than failing the whole sweep.
 */
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { entityLinks, failureClusters, integrationConnections } from '../../database/schema';
import type { DbClient } from '../../database';
import type { EntityLink } from '../../database/schema';
import type { IssueTracker } from './types';
import { statusColorForCategory } from './types';
import { createTracker } from './connections';
import { readProjectIntegration } from './binding';
import { updateEntityLinkStatus, mergeEntityLinkMetadata } from './entity-links';
import { appendTriageNote } from '../fix-verification';
import { SYNC_BATCH_LIMIT, isLinkRefreshDue } from '#shared/integrations/sync-config';
import type { ResolvedProjectIntegration } from '#shared/integrations/binding';

/** The cluster a link belongs to, for the policy checks. */
interface LinkCluster {
  id: number;
  projectId: number;
  status: string;
  triageNote: string | null;
}

/** Load the cluster (if any) each link is scoped to, keyed by link id. */
async function clustersForLinks(db: DbClient, links: EntityLink[]): Promise<Map<number, LinkCluster>> {
  const byLink = new Map<number, LinkCluster>();
  const clusterIds = [...new Set(links.map((l) => l.failureClusterId).filter((id): id is number => id != null))];
  if (clusterIds.length === 0) return byLink;
  const rows = await db
    .select({
      id: failureClusters.id,
      projectId: failureClusters.projectId,
      status: failureClusters.status,
      triageNote: failureClusters.triageNote,
    })
    .from(failureClusters)
    .where(inArray(failureClusters.id, clusterIds));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const link of links) {
    if (link.failureClusterId != null) {
      const c = byId.get(link.failureClusterId);
      if (c) byLink.set(link.id, c);
    }
  }
  return byLink;
}

/** Record a connection-level failure without failing the sweep. */
async function recordConnectionError(db: DbClient, connectionId: number, message: string): Promise<void> {
  await db
    .update(integrationConnections)
    .set({ status: 'failed', lastError: message.slice(0, 500), lastCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(integrationConnections.id, connectionId));
}

/** Refresh one link's cached status and drive the resolve/reopen policies. */
async function syncOneLink(
  db: DbClient,
  tracker: IssueTracker,
  link: EntityLink,
  cluster: LinkCluster | undefined,
  bindingFor: (projectId: number) => Promise<ResolvedProjectIntegration>,
): Promise<void> {
  const idOrKey = link.externalId ?? link.key;
  if (!idOrKey) return;
  const issue = await tracker.getIssue(idOrKey);
  if (!issue) return;

  await updateEntityLinkStatus(db, link.id, {
    title: issue.title,
    statusText: issue.status,
    statusColor: issue.statusColor ?? statusColorForCategory(issue.statusCategory),
    key: issue.key,
  });
  await mergeEntityLinkMetadata(db, link.id, {
    statusCategory: issue.statusCategory,
    assignee: issue.assignee?.displayName ?? null,
  });

  if (!cluster) return;
  const binding = await bindingFor(cluster.projectId);

  // Ticket moved to Done → resolve the cluster when the policy is on. Without
  // it, the cluster page's state line offers the reconcile instead.
  if (issue.statusCategory === 'done' && cluster.status === 'open' && binding.policies.resolveOnClose) {
    await db
      .update(failureClusters)
      .set({
        status: 'resolved',
        triageNote: appendTriageNote(cluster.triageNote, `Resolved automatically: ${issue.key} is Done`),
        updatedAt: new Date(),
      })
      .where(eq(failureClusters.id, cluster.id));
    return;
  }

  // Ticket reopened while the cluster is resolved → reopen it with a note,
  // mirroring the regression reopen.
  if (issue.statusCategory !== 'done' && cluster.status === 'resolved' && binding.policies.reopenOnTicketReopen) {
    await db
      .update(failureClusters)
      .set({
        status: 'open',
        triageNote: appendTriageNote(cluster.triageNote, `Reopened automatically: ${issue.key} was reopened`),
        updatedAt: new Date(),
      })
      .where(eq(failureClusters.id, cluster.id));
  }
}

export interface SyncResult {
  refreshed: number;
  failed: number;
  skipped: number;
}

/**
 * Refresh due tracker links, bounded to {@link SYNC_BATCH_LIMIT} per sweep. Open
 * clusters come first so a large backlog of resolved links never starves them.
 */
export async function syncTrackerLinks(db: DbClient, opts: { now?: Date; limit?: number } = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? SYNC_BATCH_LIMIT;

  const links = await db
    .select()
    .from(entityLinks)
    .where(and(isNotNull(entityLinks.connectionId), isNotNull(entityLinks.key)))
    .orderBy(asc(entityLinks.unfurledAt));

  const clusterByLink = await clustersForLinks(db, links);
  const due = links
    .filter((l) => isLinkRefreshDue(clusterByLink.get(l.id)?.status ?? null, l.unfurledAt, now))
    .slice(0, limit);

  const trackerCache = new Map<number, IssueTracker | null>();
  const bindingCache = new Map<number, ResolvedProjectIntegration>();
  const bindingFor = async (projectId: number): Promise<ResolvedProjectIntegration> => {
    let b = bindingCache.get(projectId);
    if (!b) bindingCache.set(projectId, (b = await readProjectIntegration(db, projectId)));
    return b;
  };
  const failedConnections = new Set<number>();

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;

  for (const link of due) {
    const connectionId = link.connectionId!;
    if (failedConnections.has(connectionId)) {
      skipped++;
      continue;
    }
    let tracker = trackerCache.get(connectionId);
    if (tracker === undefined) {
      tracker = await createTracker(db, connectionId).catch(() => null);
      trackerCache.set(connectionId, tracker);
    }
    if (!tracker) {
      failedConnections.add(connectionId);
      skipped++;
      continue;
    }
    try {
      await syncOneLink(db, tracker, link, clusterByLink.get(link.id), bindingFor);
      refreshed++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await recordConnectionError(db, connectionId, message).catch(() => null);
      failedConnections.add(connectionId);
    }
  }

  // A connection that refreshed at least one link is healthy again.
  const healthy = [...trackerCache.entries()].filter(([id, t]) => t && !failedConnections.has(id)).map(([id]) => id);
  for (const id of healthy) {
    await db
      .update(integrationConnections)
      .set({ status: 'ok', lastError: null, lastCheckedAt: now })
      .where(and(eq(integrationConnections.id, id), eq(integrationConnections.status, 'failed')))
      .catch(() => null);
  }

  return { refreshed, failed, skipped };
}

/** Sync a single connection's links immediately (the webhook and the tests use this). */
export async function refreshLinkByExternalId(
  db: DbClient,
  connectionId: number,
  externalId: string,
): Promise<boolean> {
  const links = await db
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.connectionId, connectionId), eq(entityLinks.externalId, externalId)));
  if (links.length === 0) return false;
  const tracker = await createTracker(db, connectionId).catch(() => null);
  if (!tracker) return false;
  const clusterByLink = await clustersForLinks(db, links);
  const bindingCache = new Map<number, ResolvedProjectIntegration>();
  const bindingFor = async (projectId: number): Promise<ResolvedProjectIntegration> => {
    let b = bindingCache.get(projectId);
    if (!b) bindingCache.set(projectId, (b = await readProjectIntegration(db, projectId)));
    return b;
  };
  for (const link of links) {
    await syncOneLink(db, tracker, link, clusterByLink.get(link.id), bindingFor).catch(() => null);
  }
  return true;
}
