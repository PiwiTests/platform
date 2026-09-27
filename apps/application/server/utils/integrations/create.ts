/**
 * Turn a create-issue request (from the modal's POST or the MCP tool) into a
 * queued action and one immediate attempt, so a click resolves in a single
 * round-trip when Jira is up. The body and labels are rebuilt server-side from
 * the entity — the client's edits pick the fields, never the evidence — and the
 * dedupe key makes a second click a no-op once an issue exists.
 *
 * The fields the tracker requires are checked first: the project's field
 * defaults and the request's own values fill them, and a create that would still
 * leave one empty is refused with the field names before Jira is called. A
 * request that failed before is replaced by the new one rather than replayed.
 */
import { eq } from 'drizzle-orm';
import { failureClusters, testRunsCases } from '../../database/schema';
import type { DbClient } from '../../database';
import { issueLabels } from '#shared/integrations/build-issue';
import { DEFAULT_LOCALE, type IssueLocale } from '#shared/integrations/messages';
import type { IssueIncludeOptions } from '#shared/integrations/types';
import { buildClusterIssue, buildExecutionIssue } from './documents';
import { clusterShareTokenMinter } from './share-url';
import {
  enqueueOrReplaceAction,
  findActionByKey,
  runActionNow,
  type CreateIssueActionPayload,
  type CreateIssueResult,
} from './actions';
import { forgetCreateFields, getCreateFields } from './fields';
import {
  fieldPayload,
  hasFieldValue,
  missingFieldsMessage,
  missingRequiredFields,
  type FieldValues,
  type TrackerField,
} from '#shared/integrations/fields';
import type { IssueFieldProblem } from '#shared/integrations/types';
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
  /** Values for tracker fields, over the project's field defaults. */
  fields?: FieldValues;
  requestedBy?: number | null;
  siteUrl?: string | null;
}

export interface CreateIssueOutcome {
  /** The queued action; null when the create was refused before anything was queued. */
  actionId: number | null;
  status: 'done' | 'pending' | 'failed' | 'skipped';
  key?: string;
  url?: string;
  error?: string;
  /** Required fields the create would leave empty — nothing was sent to the tracker. */
  missingFields?: IssueFieldProblem[];
  /** The tracker's own per-field refusals, with the fields' names. */
  fieldErrors?: IssueFieldProblem[];
  projectId: number;
}

/** The request's values over the project defaults, dropping any left empty. */
function mergeFieldValues(defaults: FieldValues, requested: FieldValues | undefined): FieldValues {
  const merged: FieldValues = { ...defaults };
  for (const [id, entry] of Object.entries(requested ?? {})) {
    if (hasFieldValue(entry?.value)) merged[id] = entry;
    else delete merged[id];
  }
  return merged;
}

/** The tracker's per-field refusals, named from the create screen when it is known. */
function namedFieldErrors(errors: Record<string, string>, screen: TrackerField[] | null): IssueFieldProblem[] {
  const names = new Map((screen ?? []).map((f) => [f.id, f.name]));
  return Object.entries(errors).map(([id, message]) => ({ id, name: names.get(id) ?? id, message }));
}

/** The create screen's fields, or null when the tracker cannot be asked; a create never waits on it failing. */
async function screenFields(
  db: DbClient,
  connectionId: number,
  projectKey: string,
  issueType: string,
): Promise<TrackerField[] | null> {
  try {
    return await getCreateFields(db, connectionId, projectKey, issueType);
  } catch {
    return null;
  }
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

  // An issue already filed for this entity is the answer, whatever the request says.
  const dedupeKey = createIssueKey(params.entityType, params.entityId, params.connectionId);
  const filed = await findActionByKey(db, dedupeKey);
  if (filed?.status === 'done') {
    const result = filed.result as CreateIssueResult | null;
    return { actionId: filed.id, status: 'done', key: result?.key, url: result?.url, projectId: target.projectId };
  }

  // Required fields: refuse before calling Jira when the defaults and the
  // request still leave one empty, naming them.
  const values = mergeFieldValues(binding.fieldDefaults, params.fields);
  const screen = await screenFields(db, params.connectionId, params.projectKey, params.issueType);
  if (screen) {
    const missing = missingRequiredFields(screen, values, {
      assignee: !!params.assignee,
      components: !!route?.componentId,
    });
    if (missing.length) {
      return {
        actionId: null,
        status: 'failed',
        error: missingFieldsMessage(missing),
        missingFields: missing.map((f) => ({ id: f.id, name: f.name })),
        projectId: target.projectId,
      };
    }
  }

  const payload: CreateIssueActionPayload = {
    projectKey: params.projectKey,
    issueType: params.issueType,
    title: params.title?.trim() || built.title,
    document: built.document,
    labels,
    assigneeId: params.assignee ?? null,
    componentId: route?.componentId ?? null,
    fields: fieldPayload(values, screen),
    locale,
    // The created known-issue link always attaches to the cluster, so the chip
    // shows on the cluster page and the inbox regardless of the entity clicked.
    linkEntityType: 'failure_cluster',
    linkEntityId: target.clusterId,
  };

  const action = await enqueueOrReplaceAction(db, {
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
  if (outcome.status === 'failed') {
    // A refusal naming fields means the cached screen may be stale.
    if (outcome.fieldErrors) forgetCreateFields(params.connectionId, params.projectKey, params.issueType);
    return {
      ...base,
      status: 'failed',
      error: outcome.error,
      ...(outcome.fieldErrors ? { fieldErrors: namedFieldErrors(outcome.fieldErrors, screen) } : {}),
    };
  }
  if (outcome.status === 'skipped') return { ...base, status: 'skipped', error: outcome.reason };
  return base;
}
