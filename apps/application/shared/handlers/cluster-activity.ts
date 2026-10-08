/**
 * A failure cluster's activity: the fix attempts reported on it, each step of
 * their outcome, what agents wrote to it over MCP (the write log), and what Piwi
 * wrote to its tracker issue (the issue it filed, its comments and moves),
 * newest first. Shared by the REST route and the demo.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { apiKeys, integrationActions, mcpToolCalls, users } from '../../server/database/schema';
import { listOutcomes } from '../../server/utils/outcomes';
import { describeFixAttempt, type FixAttemptDetails } from '../fix-attempts';
import { describeMcpCall } from '../mcp-write-log';
import type { HandbackOutcome } from '../handback-outcomes';
import type { DrizzleDB } from './db';

/** One line of a cluster's activity. */
export interface ClusterActivityItem {
  /** `fix-attempt` for an attempt's outcome, `agent-call` for a logged MCP write, `tracker-write` for a write to the issue. */
  type: 'fix-attempt' | 'agent-call' | 'tracker-write';
  at: string;
  /** The sentence the timeline shows. */
  text: string;
  /** For an attempt: its outcome at this step. For a call: `ok`, `error` or `not-found`. */
  status: HandbackOutcome | string;
  /** Where it came from: `mcp`, `ui`, `editor`, `inferred` (a run), `tracker` (Piwi's write to the issue). */
  channel: string;
  /** Who: the user's name and the API key's name, when known. */
  user: string | null;
  apiKey: string | null;
  runId: number | null;
  commit: string | null;
  /** The MCP tool, for an agent call. */
  tool?: string;
}

/** Lines returned, at most. */
const MAX_ITEMS = 100;

function attemptSentence(outcome: HandbackOutcome, details: FixAttemptDetails, channel: string, runId: number | null) {
  const what = describeFixAttempt(details);
  const who = channel === 'mcp' ? 'An agent' : 'Someone';
  switch (outcome) {
    case 'applied':
      return `${who} recorded a fix attempt: ${what}`;
    case 'verified': {
      const via =
        details.link === 'trailer' ? ' (Piwi-Cluster trailer)' : details.link === 'branch' ? ' (same branch)' : '';
      return `The fix attempt (${what}) was verified${runId ? ` by run #${runId}` : ''}${via}`;
    }
    case 'regressed':
      return `The cluster failed again after the fix attempt (${what})${runId ? ` in run #${runId}` : ''}`;
    default:
      return `Fix attempt ${outcome}: ${what}`;
  }
}

/** Why Piwi wrote to the issue, read from the write's dedupe key (see `#shared/integrations/action-keys`). */
function trackerReason(dedupeKey: string): string | null {
  if (dedupeKey.includes(':fixed:')) return 'the fix landed';
  if (dedupeKey.includes(':regressed:') || dedupeKey.includes(':reopen:')) return 'the failure came back';
  if (dedupeKey.includes(':occurrences:')) return 'new occurrences';
  if (dedupeKey.includes(':merge:')) return 'the clusters were merged';
  return null;
}

/** The sentence for one of Piwi's writes to the cluster's tracker issue. */
function trackerSentence(row: typeof integrationActions.$inferSelect): string {
  const payload = (row.payload ?? {}) as { issueKey?: string };
  const result = (row.result ?? {}) as { key?: string };
  const key = result.key ?? payload.issueKey ?? 'the issue';
  const reason = trackerReason(row.dedupeKey);
  const why = reason ? ` (${reason})` : '';
  const error = row.error ? `: ${row.error}` : '';
  const done = row.status === 'done';
  const failed = row.status === 'failed' || row.status === 'skipped';
  switch (row.kind) {
    case 'create-issue':
      if (done) return `Piwi filed ${key}`;
      return failed ? `Filing an issue failed${error}` : 'Filing an issue is queued: the tracker did not answer yet';
    case 'comment':
      if (done) return `Piwi commented on ${key}${why}`;
      return failed ? `Commenting on ${key} failed${error}` : `A comment on ${key} is queued${why}`;
    default:
      if (done) return `Piwi moved ${key}${why}`;
      return failed ? `Moving ${key} failed${error}` : `Moving ${key} is queued${why}`;
  }
}

function iso(value: unknown): string {
  return (value instanceof Date ? value : new Date(value as string | number)).toISOString();
}

/** A cluster's activity, newest first. */
export async function getClusterActivity(db: DrizzleDB, clusterId: number): Promise<ClusterActivityItem[]> {
  const outcomes = await listOutcomes(db, { kind: 'fix-attempt', subjectType: 'cluster', subjectIds: [clusterId] });
  const calls = await db
    .select()
    .from(mcpToolCalls)
    .where(and(eq(mcpToolCalls.subjectType, 'cluster'), eq(mcpToolCalls.subjectId, clusterId)))
    .orderBy(desc(mcpToolCalls.createdAt), desc(mcpToolCalls.id))
    .limit(MAX_ITEMS);
  const writes = await db
    .select()
    .from(integrationActions)
    .where(
      and(
        eq(integrationActions.entityType, 'failure_cluster'),
        eq(integrationActions.entityId, clusterId),
        inArray(integrationActions.kind, ['create-issue', 'comment', 'transition']),
      ),
    )
    .orderBy(desc(integrationActions.createdAt), desc(integrationActions.id))
    .limit(MAX_ITEMS);

  const userIds = [
    ...new Set(
      [
        ...outcomes.map((o) => o.actorUserId),
        ...calls.map((c) => c.userId),
        ...writes.map((w) => w.requestedBy),
      ].filter((id): id is number => !!id),
    ),
  ];
  const keyIds = [
    ...new Set(
      [...outcomes.map((o) => o.actorApiKeyId), ...calls.map((c) => c.apiKeyId)].filter((id): id is number => !!id),
    ),
  ];
  const userNames = new Map(
    userIds.length
      ? (
          await db
            .select({ id: users.id, name: users.name, username: users.username })
            .from(users)
            .where(inArray(users.id, userIds))
        ).map((u) => [u.id, u.name || u.username] as const)
      : [],
  );
  const keyNames = new Map(
    keyIds.length
      ? (await db.select({ id: apiKeys.id, name: apiKeys.name }).from(apiKeys).where(inArray(apiKeys.id, keyIds))).map(
          (k) => [k.id, k.name] as const,
        )
      : [],
  );

  // An attempt's verdicts carry no actor; they read the reported attempt's details.
  const reported = new Map<string, FixAttemptDetails>();
  const items: ClusterActivityItem[] = [];
  for (const row of outcomes) {
    const details = { ...(reported.get(row.suggestionKey) ?? {}), ...(row.details as unknown as FixAttemptDetails) };
    if (row.outcome === 'applied') reported.set(row.suggestionKey, details);
    items.push({
      type: 'fix-attempt',
      at: iso(row.createdAt),
      text: attemptSentence(row.outcome, details, row.channel, row.runId),
      status: row.outcome,
      channel: row.channel,
      user: row.actorUserId ? (userNames.get(row.actorUserId) ?? null) : null,
      apiKey: row.actorApiKeyId ? (keyNames.get(row.actorApiKeyId) ?? null) : null,
      runId: row.runId,
      commit: row.commit,
    });
  }
  for (const call of calls) {
    // The attempt's own line already says an agent recorded it.
    if (call.tool === 'report_fix_attempt' && call.result === 'ok') continue;
    items.push({
      type: 'agent-call',
      at: iso(call.createdAt),
      text: describeMcpCall(call.tool, call.result),
      status: call.result,
      channel: 'mcp',
      user: call.userId ? (userNames.get(call.userId) ?? null) : null,
      apiKey: call.apiKeyId ? (keyNames.get(call.apiKeyId) ?? null) : null,
      runId: null,
      commit: null,
      tool: call.tool,
    });
  }
  for (const write of writes) {
    const run = /:r(\d+)$/.exec(write.dedupeKey);
    items.push({
      type: 'tracker-write',
      at: iso(write.finishedAt ?? write.createdAt),
      text: trackerSentence(write),
      status:
        write.status === 'done' ? 'ok' : write.status === 'failed' || write.status === 'skipped' ? 'error' : 'pending',
      channel: 'tracker',
      user: write.requestedBy ? (userNames.get(write.requestedBy) ?? null) : null,
      apiKey: null,
      runId: run ? Number(run[1]) : null,
      commit: null,
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS);
}
