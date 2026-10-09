/**
 * A failure cluster's activity: the fix attempts reported on it, each step of
 * their outcome, what agents wrote to it over MCP (the write log), and what Piwi
 * wrote to its tracker issue (the issue it filed, by hand or by a rule, its
 * comments, moves and description updates) or left to a person, newest first.
 * Shared by the REST route and the demo.
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
  /**
   * For an attempt: its outcome at this step. For a call: `ok`, `error` or `not-found`. For a write to the
   * issue: `ok`, `error`, `pending`, or `skipped` for one Piwi left on purpose (an issue a rule found open
   * with the failure's labels, a description edited in the tracker).
   */
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
  if (dedupeKey.includes(':diagnosis:')) return 'the failure was diagnosed';
  if (dedupeKey.startsWith('update-issue:') && dedupeKey.includes(':day:')) return 'the failure failed again';
  return null;
}

type TrackerWrite = typeof integrationActions.$inferSelect;

/** The issue a rule found open with the failure's labels, when it left the filing to a person. */
function leftToPerson(row: TrackerWrite): string | null {
  if (row.kind !== 'create-issue' || row.status !== 'skipped') return null;
  const existingKey = (row.payload as { existingKey?: unknown } | null)?.existingKey;
  return typeof existingKey === 'string' && existingKey ? existingKey : null;
}

/** A description update that found the issue up to date: nothing was written. */
function unchangedUpdate(row: TrackerWrite): boolean {
  return (
    row.kind === 'update-issue' &&
    row.status === 'done' &&
    (row.result as { updated?: unknown } | null)?.updated === false
  );
}

/** A write's status on the timeline: one Piwi left on purpose is `skipped`, not an error. */
function trackerStatus(row: TrackerWrite): string {
  if (row.status === 'done') return 'ok';
  if (row.status === 'skipped' && (leftToPerson(row) || row.kind === 'update-issue')) return 'skipped';
  if (row.status === 'failed' || row.status === 'skipped') return 'error';
  return 'pending';
}

/** The sentence for one of Piwi's writes to the cluster's tracker issue, or one it left to a person. */
function trackerSentence(row: TrackerWrite): string {
  const payload = (row.payload ?? {}) as { issueKey?: string; automatic?: unknown };
  const result = (row.result ?? {}) as { key?: string };
  const key = result.key ?? payload.issueKey ?? 'the issue';
  const reason = trackerReason(row.dedupeKey);
  const why = reason ? ` (${reason})` : '';
  const error = row.error ? `: ${row.error}` : '';
  const done = row.status === 'done';
  const failed = row.status === 'failed' || row.status === 'skipped';
  switch (row.kind) {
    case 'create-issue': {
      if (done) return payload.automatic ? `Piwi filed ${key} (by a rule)` : `Piwi filed ${key}`;
      const found = leftToPerson(row);
      if (found) return `A rule left the filing to a person: ${found} is already open with this failure's labels`;
      return failed ? `Filing an issue failed${error}` : 'Filing an issue is queued: the tracker did not answer yet';
    }
    case 'comment':
      if (done) return `Piwi commented on ${key}${why}`;
      return failed ? `Commenting on ${key} failed${error}` : `A comment on ${key} is queued${why}`;
    case 'update-issue':
      if (done) return `Piwi updated the description of ${key}${why}`;
      if (row.status === 'skipped') {
        const edited = /edited in the tracker/.test(row.error ?? '');
        return edited
          ? `Left the description of ${key}: edited in the tracker`
          : `Left the description of ${key}${error}`;
      }
      return failed
        ? `Updating the description of ${key} failed${error}`
        : `A description update of ${key} is queued${why}`;
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
        inArray(integrationActions.kind, ['create-issue', 'comment', 'transition', 'update-issue']),
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
    // A description update that changed nothing wrote nothing.
    if (unchangedUpdate(write)) continue;
    const run = /:r(\d+)$/.exec(write.dedupeKey);
    items.push({
      type: 'tracker-write',
      at: iso(write.finishedAt ?? write.createdAt),
      text: trackerSentence(write),
      status: trackerStatus(write),
      channel: 'tracker',
      user: write.requestedBy ? (userNames.get(write.requestedBy) ?? null) : null,
      apiKey: null,
      runId: run ? Number(run[1]) : null,
      commit: null,
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS);
}
