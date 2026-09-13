/**
 * Build the prefilled create-issue draft: the ticket body from the entity's
 * facts, the fields prefilled from a project binding when one exists, and the
 * dedupe candidates that make the modal lead with "already tracked" rather than
 * filing a second ticket.
 *
 * Dedupe looks in three places: a link already pinned to the cluster, a tracker
 * search for the `piwi-cluster-<id>` and `piwi-fp-<hash>` labels, and a
 * fixed-before match whose earlier cluster carries an issue.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { entityLinks, failureClusters, testRunsCases } from '../../database/schema';
import type { DbClient } from '../../database';
import { renderMarkdown } from '#shared/integrations/render-markdown';
import { issueLabels } from '#shared/integrations/build-issue';
import { DEFAULT_LOCALE, toIssueLocale, type IssueLocale } from '#shared/integrations/messages';
import type {
  ExistingIssueCandidate,
  IssueDraft,
  IssueIncludeOptions,
  TrackerSummary,
} from '#shared/integrations/types';
import { buildClusterIssue, buildExecutionIssue, type BuiltClusterIssue } from './documents';
import { getConnectionRow, getProjectBinding, listTrackerConnections, trackerForRow } from './connections';
import { bindingRowToResolved } from './binding';
import { pickOwnerRoute } from '#shared/integrations/binding';
import { getFailureCluster } from '#shared/handlers/failure-clusters';
import { findFixedBefore } from '../cluster-memory';
import { statusColorForCategory } from './types';
import type { IssueTracker, TrackerIssue } from './types';

export type DraftEntityType = 'failure_cluster' | 'test_runs_case';

/** The cluster an entity belongs to (itself for a cluster, its cluster for an execution). */
async function resolveClusterId(db: DbClient, entityType: DraftEntityType, entityId: number): Promise<number | null> {
  if (entityType === 'failure_cluster') return entityId;
  const [row] = await db
    .select({ clusterId: testRunsCases.failureClusterId })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, entityId));
  return row?.clusterId ?? null;
}

/** A tracker link already pinned to the cluster, as a candidate. */
async function linkedCandidates(db: DbClient, clusterId: number): Promise<ExistingIssueCandidate[]> {
  const links = await db
    .select()
    .from(entityLinks)
    .where(and(eq(entityLinks.failureClusterId, clusterId), isNotNull(entityLinks.key)));
  return links
    .filter((l) => l.provider === 'jira' || l.connectionId != null)
    .map((l) => ({
      key: l.key ?? '',
      url: l.url,
      title: l.title ?? null,
      statusText: l.statusText ?? null,
      statusColor: l.statusColor ?? null,
      reason: 'linked' as const,
    }));
}

/** A tracker search for the cluster and fingerprint labels. */
async function labelCandidates(
  tracker: IssueTracker,
  clusterId: number,
  fingerprint: string,
): Promise<ExistingIssueCandidate[]> {
  const clusterLabel = `piwi-cluster-${clusterId}`;
  const fpLabel = `piwi-fp-${fingerprint.slice(0, 8)}`;
  const out: ExistingIssueCandidate[] = [];
  const seen = new Set<string>();
  const push = (issue: TrackerIssue, reason: 'label' | 'fingerprint') => {
    if (!issue.key || seen.has(issue.key)) return;
    seen.add(issue.key);
    out.push({
      key: issue.key,
      url: issue.url,
      title: issue.title,
      statusText: issue.status,
      statusColor: issue.statusColor ?? statusColorForCategory(issue.statusCategory),
      reason,
    });
  };
  try {
    for (const issue of await tracker.search({ labels: [clusterLabel], limit: 5 })) push(issue, 'label');
    for (const issue of await tracker.search({ labels: [fpLabel], limit: 5 })) push(issue, 'fingerprint');
  } catch {
    /* a search failure never blocks drafting — the modal simply shows no candidate */
  }
  return out;
}

/** Fixed-before matches whose earlier cluster carries a known issue. */
async function fixedBeforeCandidates(db: DbClient, clusterId: number): Promise<ExistingIssueCandidate[]> {
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  if (!cluster) return [];
  const matches = await findFixedBefore(db, cluster).catch(() => []);
  const out: ExistingIssueCandidate[] = [];
  for (const match of matches.slice(0, 3)) {
    const links = await db
      .select()
      .from(entityLinks)
      .where(and(eq(entityLinks.failureClusterId, match.clusterId), isNotNull(entityLinks.key)));
    const jira = links.find((l) => l.provider === 'jira' || l.connectionId != null);
    if (jira?.key) {
      out.push({
        key: jira.key,
        url: jira.url,
        title: jira.title ?? match.title,
        statusText: jira.statusText ?? null,
        statusColor: jira.statusColor ?? null,
        reason: 'fixed-before',
      });
    }
  }
  return out;
}

/**
 * Deduplicate candidates by key, keeping the first (highest-priority) reason.
 * Callers pass the lists in priority order: a pinned link, then a label match, a
 * fingerprint match, and finally a fixed-before match.
 */
export function dedupeCandidates(lists: ExistingIssueCandidate[][]): ExistingIssueCandidate[] {
  const byKey = new Map<string, ExistingIssueCandidate>();
  for (const list of lists) {
    for (const c of list) if (c.key && !byKey.has(c.key)) byKey.set(c.key, c);
  }
  return [...byKey.values()];
}

export interface DraftOptions {
  connectionId?: number | null;
  include?: Partial<IssueIncludeOptions>;
  /** A per-issue language override (the modal's Language select); else resolved. */
  locale?: IssueLocale | null;
  siteUrl?: string | null;
}

/** Resolution order: binding `locale` → connection `config.locale` → `en`. */
function resolveLocale(
  binding: { locale?: string | null } | null,
  connection: { config?: unknown } | null,
  override?: IssueLocale | null,
): IssueLocale {
  if (override) return override;
  const fromBinding = toIssueLocale(binding?.locale);
  if (fromBinding) return fromBinding;
  const config = (connection?.config ?? null) as { locale?: string } | null;
  return toIssueLocale(config?.locale) ?? DEFAULT_LOCALE;
}

/** Build the full draft, or null when no tracker is connected or the entity is gone. */
export async function buildIssueDraft(
  db: DbClient,
  entityType: DraftEntityType,
  entityId: number,
  opts: DraftOptions = {},
): Promise<IssueDraft | null> {
  const connections: TrackerSummary[] = await listTrackerConnections(db);
  if (!connections.length) return null;

  const clusterId = await resolveClusterId(db, entityType, entityId);
  if (clusterId == null) return null;

  const projectId = (
    await db
      .select({ projectId: failureClusters.projectId })
      .from(failureClusters)
      .where(eq(failureClusters.id, clusterId))
  )[0]?.projectId;
  if (projectId == null) return null;

  const chosenId = opts.connectionId ?? connections[0]!.id;
  const bindingRow = await getProjectBinding(db, projectId);
  const resolved = bindingRowToResolved(bindingRow);
  const chosenRow = await getConnectionRow(db, chosenId);
  const include = { ...resolved.include, ...(opts.include ?? {}) };
  const locale = resolveLocale(bindingRow, chosenRow, opts.locale);

  const built: BuiltClusterIssue | null =
    entityType === 'failure_cluster'
      ? await buildClusterIssue(db, entityId, { ...include, locale, siteUrl: opts.siteUrl })
      : await buildExecutionIssue(db, entityId, { ...include, locale, siteUrl: opts.siteUrl });
  if (!built) return null;

  // The cluster's effective owner picks the first matching route; its overrides
  // (project key, assignee, extra labels) fill the draft on top of the binding
  // defaults, so a team's failures prefill that team's destination.
  const clusterMeta = await getFailureCluster(db, clusterId).catch(() => null);
  const route = pickOwnerRoute(resolved.ownerRoutes, clusterMeta?.owner?.name ?? null);

  const [cluster] = await db
    .select({ fingerprint: failureClusters.fingerprint })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  const labels = [
    ...new Set([...resolved.labels, ...(route?.labels ?? []), ...issueLabels(clusterId, cluster?.fingerprint ?? '')]),
  ];

  // Dedupe candidates — a pinned link first, then label/fingerprint search, then fixed-before.
  const tracker = chosenRow ? trackerForRow(chosenRow) : null;
  const candidates = dedupeCandidates([
    await linkedCandidates(db, clusterId),
    tracker && cluster?.fingerprint ? await labelCandidates(tracker, clusterId, cluster.fingerprint) : [],
    await fixedBeforeCandidates(db, clusterId),
  ]);

  return {
    entityType,
    entityId,
    clusterId,
    title: built.title,
    connectionId: chosenId,
    connections,
    projectKey: route?.projectKey ?? resolved.projectKey,
    issueType: resolved.issueType,
    labels,
    assignee: route?.assigneeAccountId ?? resolved.defaultAssignee,
    locale,
    include,
    markdown: renderMarkdown(built.document),
    document: built.document,
    existing: candidates,
  };
}
