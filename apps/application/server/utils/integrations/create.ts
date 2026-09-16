/**
 * Turn a create-issue request (from the modal's POST or the MCP tool) into a
 * queued action and one immediate attempt, so a click resolves in a single
 * round-trip when Jira is up. The body and labels are rebuilt server-side from
 * the entity — the client's edits pick the fields, never the evidence — and the
 * dedupe key makes a second click a no-op.
 */
import { eq } from 'drizzle-orm';
import { failureClusters, testRunsCases } from '../../database/schema';
import type { DbClient } from '../../database';
import { issueLabels } from '#shared/integrations/build-issue';
import { DEFAULT_LOCALE, type IssueLocale } from '#shared/integrations/messages';
import type { IssueIncludeOptions } from '#shared/integrations/types';
import { buildClusterIssue, buildExecutionIssue } from './documents';
import { clusterShareTokenMinter } from './share-url';
import { enqueueAction, runActionNow, type CreateIssueActionPayload, type CreateIssueResult } from './actions';
import { readProjectIntegration } from './binding';
import { pickOwnerRoute } from '#shared/integrations/binding';
import { createIssueKey } from '#shared/integrations/action-keys';
import { getFailureCluster } from '#shared/handlers/failure-clusters';
import type { DraftEntityType } from './draft';

export interface CreateIssueParams {
  entityType: DraftEntityType;
  entityId: number;
  connectionId: number;
  projectKey: string;
  issueType: string;
  title?: string;
  labels?: string[];
  assignee?: string | null;
  locale?: IssueLocale;
  include?: Partial<IssueIncludeOptions>;
  requestedBy?: number | null;
  siteUrl?: string | null;
}

export interface CreateIssueOutcome {
  actionId: number;
  status: 'done' | 'pending' | 'failed' | 'skipped';
  key?: string;
  url?: string;
  error?: string;
  projectId: number;
}

/** The cluster an entity belongs to, plus the project it lives in. */
async function resolveTarget(
  db: DbClient,
  entityType: DraftEntityType,
  entityId: number,
): Promise<{ clusterId: number; projectId: number } | null> {
  const clusterId =
    entityType === 'failure_cluster'
      ? entityId
      : ((
          await db
            .select({ clusterId: testRunsCases.failureClusterId })
            .from(testRunsCases)
            .where(eq(testRunsCases.id, entityId))
        )[0]?.clusterId ?? null);
  if (clusterId == null) return null;
  const [cluster] = await db
    .select({ projectId: failureClusters.projectId })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;
  return { clusterId, projectId: cluster.projectId };
}

export async function createIssue(db: DbClient, params: CreateIssueParams): Promise<CreateIssueOutcome | null> {
  const target = await resolveTarget(db, params.entityType, params.entityId);
  if (!target) return null;

  const include = params.include ?? {};
  const locale = params.locale ?? DEFAULT_LOCALE;
  const built =
    params.entityType === 'failure_cluster'
      ? await buildClusterIssue(db, params.entityId, {
          ...include,
          locale,
          siteUrl: params.siteUrl,
          mintShareToken: clusterShareTokenMinter(db),
        })
      : await buildExecutionIssue(db, params.entityId, {
          ...include,
          locale,
          siteUrl: params.siteUrl,
          mintShareToken: clusterShareTokenMinter(db),
        });
  if (!built) return null;

  const [cluster] = await db
    .select({ fingerprint: failureClusters.fingerprint })
    .from(failureClusters)
    .where(eq(failureClusters.id, target.clusterId));
  const standardLabels = issueLabels(target.clusterId, cluster?.fingerprint ?? '');

  // The owner route contributes a Jira component the modal never asks for, plus
  // any labels the route adds; project key and assignee already ride in on the
  // prefilled request, so the route only fills what the request could not carry.
  const binding = await readProjectIntegration(db, target.projectId);
  const clusterMeta = await getFailureCluster(db, target.clusterId).catch(() => null);
  const route = pickOwnerRoute(binding.ownerRoutes, clusterMeta?.owner?.name ?? null);

  const labels = [...new Set([...(params.labels ?? built.labels), ...(route?.labels ?? []), ...standardLabels])];

  const payload: CreateIssueActionPayload = {
    projectKey: params.projectKey,
    issueType: params.issueType,
    title: params.title?.trim() || built.title,
    document: built.document,
    labels,
    assigneeId: params.assignee ?? null,
    componentId: route?.componentId ?? null,
    locale,
    // The created known-issue link always attaches to the cluster, so the chip
    // shows on the cluster page and the inbox regardless of the entity clicked.
    linkEntityType: 'failure_cluster',
    linkEntityId: target.clusterId,
  };

  const dedupeKey = createIssueKey(params.entityType, params.entityId, params.connectionId);
  const action = await enqueueAction(db, {
    connectionId: params.connectionId,
    projectId: target.projectId,
    kind: 'create-issue',
    entityType: params.entityType,
    entityId: params.entityId,
    dedupeKey,
    payload,
    requestedBy: params.requestedBy ?? null,
  });

  const outcome = await runActionNow(db, action.id);
  const base: CreateIssueOutcome = { actionId: action.id, status: 'pending', projectId: target.projectId };
  if (!outcome) return base;
  if (outcome.status === 'done') {
    const result = outcome.result as CreateIssueResult | undefined;
    return { ...base, status: 'done', key: result?.key, url: result?.url };
  }
  if (outcome.status === 'failed') return { ...base, status: 'failed', error: outcome.error };
  if (outcome.status === 'skipped') return { ...base, status: 'skipped', error: outcome.reason };
  return base;
}
