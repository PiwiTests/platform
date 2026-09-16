/**
 * The two-way sync policies — the write-backs a cluster's evolution triggers on
 * its ticket. Each is an outbox action (comment or transition) with a dedupe key
 * so it is retried, deduped and listed like every other integration write.
 *
 * A policy runs only when the cluster carries a tracker link and the project's
 * binding turns that policy on; both default off, so nothing writes to Jira
 * until an administrator opts in. Every comment is built through the message
 * catalog in the binding's language.
 */
import { and, eq, gt } from 'drizzle-orm';
import { integrationActions, testRunsCases } from '../../database/schema';
import type { DbClient } from '../../database';
import type { EntityLink } from '../../database/schema';
import { DEFAULT_LOCALE, toIssueLocale, type IssueLocale } from '#shared/integrations/messages';
import {
  buildFixComment,
  buildRegressionComment,
  buildStillFailingComment,
  buildMergeComment,
  type FixCommentVerification,
} from '#shared/integrations/policy-comments';
import type { ResolvedProjectIntegration } from '#shared/integrations/binding';
import {
  fixCommentKey,
  fixTransitionKey,
  regressionCommentKey,
  reopenTransitionKey,
  occurrencesCommentKey,
  mergeCommentKey,
} from '#shared/integrations/action-keys';
import type { CommentActionPayload, TransitionActionPayload } from './actions';
import { enqueueAction, runActionNow } from './actions';
import { readProjectIntegration } from './binding';
import { getConnectionRow } from './connections';
import { getClusterTrackerLink } from './known-issue';
import { mergeEntityLinkMetadata } from './entity-links';

/** Everything a policy needs: the writable link, the binding, and the ticket language. */
interface PolicyContext {
  link: EntityLink;
  binding: ResolvedProjectIntegration;
  locale: IssueLocale;
  clusterUrl: string | null;
}

/** The dashboard base URL, trailing slash trimmed, or null when unset. */
function siteBase(): string | null {
  const raw = process.env.PIWI_SITE_URL?.trim();
  return raw ? raw.replace(/\/$/, '') : null;
}

/** Resolution order for a comment's language: binding → connection default → en. */
function resolveLocale(binding: ResolvedProjectIntegration, connectionConfig: unknown): IssueLocale {
  if (binding.locale) return binding.locale;
  const config = (connectionConfig ?? null) as { locale?: string } | null;
  return toIssueLocale(config?.locale) ?? DEFAULT_LOCALE;
}

/** Gather the context for a cluster, or null when there is nothing to write to. */
async function policyContext(db: DbClient, clusterId: number, projectId: number): Promise<PolicyContext | null> {
  const link = await getClusterTrackerLink(db, clusterId);
  if (!link?.key || link.connectionId == null) return null;
  const binding = await readProjectIntegration(db, projectId);
  const connection = await getConnectionRow(db, link.connectionId);
  const base = siteBase();
  return {
    link,
    binding,
    locale: resolveLocale(binding, connection?.config ?? null),
    clusterUrl: base ? `${base}/failure-clusters/${clusterId}` : null,
  };
}

/** Enqueue one action and make an immediate best-effort attempt (the click path). */
async function enqueueAndKick(db: DbClient, input: Parameters<typeof enqueueAction>[1]): Promise<void> {
  const action = await enqueueAction(db, input);
  await runActionNow(db, action.id).catch(() => null);
}

/** Comment (and optionally transition) on the ticket when a cluster's fix is verified. */
export async function enqueueFixPolicies(
  db: DbClient,
  facts: {
    clusterId: number;
    projectId: number;
    runId: number;
    commit: string | null;
    verification: FixCommentVerification;
  },
): Promise<void> {
  const ctx = await policyContext(db, facts.clusterId, facts.projectId);
  if (!ctx) return;
  const { link, binding, locale, clusterUrl } = ctx;

  if (binding.policies.commentOnFix) {
    const document = buildFixComment(locale, {
      runNumber: facts.runId,
      commit: facts.commit,
      verification: facts.verification,
      clusterUrl,
    });
    await enqueueAndKick(db, {
      connectionId: link.connectionId!,
      projectId: facts.projectId,
      kind: 'comment',
      entityType: 'failure_cluster',
      entityId: facts.clusterId,
      dedupeKey: fixCommentKey(facts.clusterId, facts.runId),
      payload: { issueKey: link.key!, document } satisfies CommentActionPayload,
    });
  }

  if (binding.policies.transitionOnFix && binding.policies.fixTransitionId) {
    await enqueueAndKick(db, {
      connectionId: link.connectionId!,
      projectId: facts.projectId,
      kind: 'transition',
      entityType: 'failure_cluster',
      entityId: facts.clusterId,
      dedupeKey: fixTransitionKey(facts.clusterId, facts.runId),
      payload: {
        issueKey: link.key!,
        transitionId: binding.policies.fixTransitionId,
        statusName: binding.policies.fixTransitionId,
      } satisfies TransitionActionPayload,
    });
  }
}

/** Comment (and optionally reopen) on the ticket when a cluster regresses. */
export async function enqueueRegressionPolicies(
  db: DbClient,
  facts: { clusterId: number; projectId: number; runId: number },
): Promise<void> {
  const ctx = await policyContext(db, facts.clusterId, facts.projectId);
  if (!ctx) return;
  const { link, binding, locale, clusterUrl } = ctx;

  if (binding.policies.commentOnRegression) {
    const document = buildRegressionComment(locale, { runNumber: facts.runId, clusterUrl });
    await enqueueAndKick(db, {
      connectionId: link.connectionId!,
      projectId: facts.projectId,
      kind: 'comment',
      entityType: 'failure_cluster',
      entityId: facts.clusterId,
      dedupeKey: regressionCommentKey(facts.clusterId, facts.runId),
      payload: { issueKey: link.key!, document } satisfies CommentActionPayload,
    });
  }

  if (binding.policies.reopenTransitionId) {
    await enqueueAndKick(db, {
      connectionId: link.connectionId!,
      projectId: facts.projectId,
      kind: 'transition',
      entityType: 'failure_cluster',
      entityId: facts.clusterId,
      dedupeKey: reopenTransitionKey(facts.clusterId, facts.runId),
      payload: {
        issueKey: link.key!,
        transitionId: binding.policies.reopenTransitionId,
        statusName: binding.policies.reopenTransitionId,
      } satisfies TransitionActionPayload,
    });
  }
}

/** Bookkeeping the still-failing policy keeps on the link's metadata. */
interface OccurrenceMeta {
  lastCommentedOccurrences?: number;
  lastCommentedRunId?: number;
}

/**
 * Comment once per day on an open ticket when new occurrences land, reporting
 * how many occurrences over how many runs since the last note. The baseline is
 * established the first time and reported against on the next bump.
 */
export async function enqueueStillFailingPolicy(
  db: DbClient,
  facts: { clusterId: number; projectId: number; latestRunId: number; occurrences: number },
): Promise<void> {
  const ctx = await policyContext(db, facts.clusterId, facts.projectId);
  if (!ctx || !ctx.binding.policies.commentOnNewOccurrences) return;
  const { link, locale, clusterUrl } = ctx;

  const meta = (link.metadata as OccurrenceMeta | null) ?? {};
  const baseline = meta.lastCommentedOccurrences;
  if (baseline == null) {
    // First observation with the policy on — record where we are, do not comment.
    await mergeEntityLinkMetadata(db, link.id, {
      lastCommentedOccurrences: facts.occurrences,
      lastCommentedRunId: facts.latestRunId,
    });
    return;
  }

  const addedOccurrences = facts.occurrences - baseline;
  if (addedOccurrences <= 0) return;

  // At most one comment per day per link, enforced by the date in the dedupe key.
  const dateKey = new Date().toISOString().slice(0, 10);
  const dedupeKey = occurrencesCommentKey(facts.clusterId, dateKey);
  const [already] = await db
    .select({ id: integrationActions.id })
    .from(integrationActions)
    .where(eq(integrationActions.dedupeKey, dedupeKey));
  if (already) return;

  const sinceRunId = meta.lastCommentedRunId ?? 0;
  const runRows = await db
    .selectDistinct({ runId: testRunsCases.testRunId })
    .from(testRunsCases)
    .where(and(eq(testRunsCases.failureClusterId, facts.clusterId), gt(testRunsCases.testRunId, sinceRunId)));
  const runs = Math.max(1, runRows.length);

  const document = buildStillFailingComment(locale, {
    addedOccurrences,
    runs,
    latestRun: facts.latestRunId,
    clusterUrl,
  });
  await enqueueAndKick(db, {
    connectionId: link.connectionId!,
    projectId: facts.projectId,
    kind: 'comment',
    entityType: 'failure_cluster',
    entityId: facts.clusterId,
    dedupeKey,
    payload: { issueKey: link.key!, document } satisfies CommentActionPayload,
  });
  await mergeEntityLinkMetadata(db, link.id, {
    lastCommentedOccurrences: facts.occurrences,
    lastCommentedRunId: facts.latestRunId,
  });
}

/**
 * Comment on both issues when one cluster is merged into another — the survivor
 * absorbs the victim, the victim points at the survivor. The survivor inheriting
 * the victim's links is the merge handler's job; this only writes the notes.
 */
export async function enqueueMergePolicies(
  db: DbClient,
  facts: { survivorId: number; victimId: number; projectId: number },
): Promise<void> {
  const binding = await readProjectIntegration(db, facts.projectId);
  if (!binding.policies.commentOnMerge) return;

  const survivorLink = await getClusterTrackerLink(db, facts.survivorId);
  const victimLink = await getClusterTrackerLink(db, facts.victimId);
  const connectionId = survivorLink?.connectionId ?? victimLink?.connectionId ?? null;
  const connection = connectionId != null ? await getConnectionRow(db, connectionId) : null;
  const locale = resolveLocale(binding, connection?.config ?? null);
  const base = siteBase();

  if (victimLink?.key && victimLink.connectionId != null && survivorLink?.key) {
    const document = buildMergeComment(locale, {
      direction: 'into',
      otherKey: survivorLink.key,
      clusterUrl: base ? `${base}/failure-clusters/${facts.survivorId}` : null,
    });
    await enqueueAndKick(db, {
      connectionId: victimLink.connectionId,
      projectId: facts.projectId,
      kind: 'comment',
      entityType: 'failure_cluster',
      entityId: facts.victimId,
      dedupeKey: mergeCommentKey(facts.victimId, facts.survivorId),
      payload: { issueKey: victimLink.key, document } satisfies CommentActionPayload,
    });
  }

  if (survivorLink?.key && survivorLink.connectionId != null && victimLink?.key) {
    const document = buildMergeComment(locale, {
      direction: 'absorbed',
      otherKey: victimLink.key,
      clusterUrl: base ? `${base}/failure-clusters/${facts.survivorId}` : null,
    });
    await enqueueAndKick(db, {
      connectionId: survivorLink.connectionId,
      projectId: facts.projectId,
      kind: 'comment',
      entityType: 'failure_cluster',
      entityId: facts.survivorId,
      dedupeKey: mergeCommentKey(facts.survivorId, facts.victimId),
      payload: { issueKey: survivorLink.key, document } satisfies CommentActionPayload,
    });
  }
}
