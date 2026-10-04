/**
 * Hand-back outcomes: one row each time something Piwi handed back reaches an
 * outcome (`shared/handback-outcomes.ts` holds the value sets).
 *
 * `recordOutcome` is the one write path. It is idempotent on the kind, the
 * subject, the suggestion key, the outcome and the run, so a run finalized
 * twice, or a person clicking twice, records one row.
 *
 * Rows follow run retention: `pruneOutcomesOlderThan` adds the rows older than
 * the cutoff to the daily counters of `handback_outcome_rollups`, in the
 * transaction that deletes them, and keeps every row whose run is still stored
 * (a kept run, or one of a project's newest). `readOutcomeCounts` adds the
 * counters to the rows still stored.
 *
 * Shared by the server and the demo (the shared handlers that record person
 * decisions call it), so it uses Drizzle only.
 */
import { and, asc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { handbackOutcomeRollups, handbackOutcomes, testRuns } from '../database/schema';
import type {
  HandbackActor,
  HandbackChannel,
  HandbackKind,
  HandbackOutcome,
  HandbackSubjectType,
} from '#shared/handback-outcomes';
import { dayKey, DAY_MS } from '#shared/handlers/analytics/common';
import type { DrizzleDB } from '#shared/handlers/db';

export interface OutcomeInput {
  projectId: number;
  kind: HandbackKind;
  subjectType: HandbackSubjectType;
  subjectId: number;
  /** A stable key of what was suggested, when one subject can carry several suggestions. */
  suggestionKey?: string;
  outcome: HandbackOutcome;
  /** Who reported it; omitted for an outcome read from the runs. */
  actor?: HandbackActor | null;
  /** The run it was seen in. */
  runId?: number | null;
  commit?: string | null;
  details?: Record<string, unknown> | null;
  /** When it happened; now by default. */
  at?: Date;
}

/** One stored outcome. */
export interface OutcomeRecord {
  id: number;
  projectId: number;
  kind: HandbackKind;
  subjectType: HandbackSubjectType;
  subjectId: number;
  suggestionKey: string;
  outcome: HandbackOutcome;
  channel: HandbackChannel;
  actorUserId: number | null;
  actorApiKeyId: number | null;
  runId: number | null;
  commit: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

/** The identity a row is deduplicated on, within its project. */
export function outcomeDedupeKey(
  input: Pick<OutcomeInput, 'kind' | 'subjectType' | 'subjectId' | 'suggestionKey' | 'outcome' | 'runId'>,
): string {
  return [
    input.kind,
    `${input.subjectType}:${input.subjectId}`,
    input.suggestionKey ?? '',
    input.outcome,
    input.runId ?? '',
  ].join('|');
}

function positiveId(id: number | null | undefined): number | null {
  return typeof id === 'number' && id > 0 ? id : null;
}

/**
 * Record an outcome. Returns true when a row was written, false when the same
 * outcome was already recorded.
 */
export async function recordOutcome(db: DrizzleDB, input: OutcomeInput): Promise<boolean> {
  const rows = await db
    .insert(handbackOutcomes)
    .values({
      projectId: input.projectId,
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      suggestionKey: input.suggestionKey ?? '',
      outcome: input.outcome,
      channel: input.actor?.channel ?? 'inferred',
      // With authentication off the request carries a synthetic user whose id is 0, which no row has.
      actorUserId: positiveId(input.actor?.userId),
      actorApiKeyId: positiveId(input.actor?.apiKeyId),
      runId: input.runId ?? null,
      commitSha: input.commit ?? null,
      details: input.details ?? null,
      dedupeKey: outcomeDedupeKey(input),
      createdAt: input.at ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: handbackOutcomes.id });
  return rows.length > 0;
}

/** Which rows `listOutcomes` returns. Every field is optional. */
export interface OutcomeFilter {
  projectId?: number;
  kind?: HandbackKind;
  subjectType?: HandbackSubjectType;
  subjectIds?: number[];
  suggestionKey?: string;
  outcomes?: HandbackOutcome[];
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(String(value));
}

/** The stored outcomes matching a filter, oldest first. */
export async function listOutcomes(db: DrizzleDB, filter: OutcomeFilter): Promise<OutcomeRecord[]> {
  const t = handbackOutcomes;
  if (filter.subjectIds && filter.subjectIds.length === 0) return [];
  const conditions: SQL[] = [];
  if (filter.projectId != null) conditions.push(eq(t.projectId, filter.projectId));
  if (filter.kind) conditions.push(eq(t.kind, filter.kind));
  if (filter.subjectType) conditions.push(eq(t.subjectType, filter.subjectType));
  if (filter.subjectIds) conditions.push(inArray(t.subjectId, filter.subjectIds));
  if (filter.suggestionKey != null) conditions.push(eq(t.suggestionKey, filter.suggestionKey));
  if (filter.outcomes) conditions.push(inArray(t.outcome, filter.outcomes));
  const rows = await db
    .select()
    .from(t)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(t.createdAt), asc(t.id));
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as HandbackKind,
    subjectType: row.subjectType as HandbackSubjectType,
    subjectId: row.subjectId,
    suggestionKey: row.suggestionKey,
    outcome: row.outcome as HandbackOutcome,
    channel: row.channel as HandbackChannel,
    actorUserId: row.actorUserId ?? null,
    actorApiKeyId: row.actorApiKeyId ?? null,
    runId: row.runId ?? null,
    commit: row.commitSha ?? null,
    details: (row.details as Record<string, unknown> | null) ?? null,
    createdAt: toDate(row.createdAt),
  }));
}

// ── Daily counters ──────────────────────────────────────────────────────────

/** One daily counter: the outcomes of one kind, outcome and channel in a project on a UTC day. */
export interface OutcomeCount {
  projectId: number;
  day: string;
  kind: HandbackKind;
  outcome: HandbackOutcome;
  channel: HandbackChannel;
  count: number;
}

export interface OutcomeCountFilter {
  projectIds: 'all' | number[];
  /** Inclusive UTC day range, `YYYY-MM-DD`. */
  fromDay: string;
  toDay: string;
  kinds?: HandbackKind[];
}

function countCellId(c: Pick<OutcomeCount, 'projectId' | 'day' | 'kind' | 'outcome' | 'channel'>): string {
  return JSON.stringify([c.projectId, c.day, c.kind, c.outcome, c.channel]);
}

function addCount(cells: Map<string, OutcomeCount>, cell: Omit<OutcomeCount, 'count'>, count: number): void {
  const id = countCellId(cell);
  const existing = cells.get(id);
  if (existing) existing.count += count;
  else cells.set(id, { ...cell, count });
}

/**
 * Daily outcome counts per project, kind, outcome and channel over a day range:
 * the rows still stored plus the counters of the rows retention pruned.
 */
export async function readOutcomeCounts(db: DrizzleDB, filter: OutcomeCountFilter): Promise<OutcomeCount[]> {
  if (filter.projectIds !== 'all' && filter.projectIds.length === 0) return [];
  const t = handbackOutcomes;
  const r = handbackOutcomeRollups;
  const from = new Date(`${filter.fromDay}T00:00:00.000Z`);
  const to = new Date(new Date(`${filter.toDay}T00:00:00.000Z`).getTime() + DAY_MS);

  const live: SQL[] = [gte(t.createdAt, from), lt(t.createdAt, to)];
  const archived: SQL[] = [gte(r.day, filter.fromDay), sql`${r.day} <= ${filter.toDay}`];
  if (filter.projectIds !== 'all') {
    live.push(inArray(t.projectId, filter.projectIds));
    archived.push(inArray(r.projectId, filter.projectIds));
  }
  if (filter.kinds) {
    live.push(inArray(t.kind, filter.kinds));
    archived.push(inArray(r.kind, filter.kinds));
  }

  const cells = new Map<string, OutcomeCount>();
  const rows = await db
    .select({ projectId: t.projectId, kind: t.kind, outcome: t.outcome, channel: t.channel, createdAt: t.createdAt })
    .from(t)
    .where(and(...live));
  for (const row of rows) {
    addCount(
      cells,
      {
        projectId: row.projectId,
        day: dayKey(toDate(row.createdAt)),
        kind: row.kind as HandbackKind,
        outcome: row.outcome as HandbackOutcome,
        channel: row.channel as HandbackChannel,
      },
      1,
    );
  }
  const counters = await db
    .select()
    .from(r)
    .where(and(...archived));
  for (const row of counters) {
    addCount(
      cells,
      {
        projectId: row.projectId,
        day: row.day,
        kind: row.kind as HandbackKind,
        outcome: row.outcome as HandbackOutcome,
        channel: row.channel as HandbackChannel,
      },
      Number(row.count) || 0,
    );
  }
  return [...cells.values()].sort(
    (a, b) => a.day.localeCompare(b.day) || a.projectId - b.projectId || countCellId(a).localeCompare(countCellId(b)),
  );
}

/** Outcome rows deleted per transaction, each slice with its counters. */
const PRUNE_SLICE_ROWS = 500;

/**
 * Prune the outcome rows recorded before the cutoff whose run is gone (or that
 * have none), adding each one to its daily counter in the transaction that
 * deletes it. A row whose run retention keeps stays. Returns the rows pruned.
 */
export async function pruneOutcomesOlderThan(db: DrizzleDB, olderThanDays: number, now = Date.now()): Promise<number> {
  const t = handbackOutcomes;
  const cutoff = new Date(now - olderThanDays * DAY_MS);
  const runGone = sql`(${t.runId} IS NULL OR NOT EXISTS (SELECT 1 FROM ${testRuns} WHERE ${testRuns.id} = ${t.runId}))`;
  let pruned = 0;
  for (;;) {
    // The rows are read inside the transaction that counts and deletes them, so two sweeps never count one row twice.
    const sliced = await db.transaction(async (tx) => {
      const slice = await tx
        .select({
          id: t.id,
          projectId: t.projectId,
          kind: t.kind,
          outcome: t.outcome,
          channel: t.channel,
          createdAt: t.createdAt,
        })
        .from(t)
        .where(and(lt(t.createdAt, cutoff), runGone))
        .orderBy(asc(t.id))
        .limit(PRUNE_SLICE_ROWS);
      if (slice.length === 0) return 0;

      const cells = new Map<string, OutcomeCount>();
      for (const row of slice) {
        addCount(
          cells,
          {
            projectId: row.projectId,
            day: dayKey(toDate(row.createdAt)),
            kind: row.kind as HandbackKind,
            outcome: row.outcome as HandbackOutcome,
            channel: row.channel as HandbackChannel,
          },
          1,
        );
      }
      const r = handbackOutcomeRollups;
      const at = new Date();
      for (const cell of cells.values()) {
        await tx
          .insert(r)
          .values({ ...cell, computedAt: at })
          .onConflictDoUpdate({
            target: [r.projectId, r.day, r.kind, r.outcome, r.channel],
            set: { count: sql`${r.count} + ${cell.count}`, computedAt: at },
          });
      }
      await tx.delete(t).where(
        inArray(
          t.id,
          slice.map((row) => row.id),
        ),
      );
      return slice.length;
    });
    pruned += sliced;
    if (sliced < PRUNE_SLICE_ROWS) return pruned;
  }
}
