/**
 * Cluster merge suggestions — the human review step of cluster reconciliation.
 *
 * When the reconciler / LLM adjudicator find two clusters that are probably (but
 * not certainly) the same root cause, they record a pending suggestion here.
 * Admins approve (→ runs mergeFailureClusters) or reject it. A pair the
 * adjudicator judged distinct is kept as `declined`, and a pair split apart by
 * hand as `rejected`, so the reconciler neither merges nor re-judges it.
 *
 * Shared (relative imports only) so the logic is unit-testable and reusable.
 */

import { and, eq, desc, or } from 'drizzle-orm';
import { clusterMergeSuggestions, failureClusters } from '../../server/database/schema';
import { mergeFailureClusters } from './failure-cluster-ops';
import { recordOutcome } from '../../server/utils/outcomes';
import type { HandbackActor } from '../handback-outcomes';
import type { DrizzleDB } from './db';

export interface SuggestionInput {
  projectId: number;
  clusterAId: number;
  clusterBId: number;
  score?: number | null;
  /** `split`: the pair came from moving tests out of a cluster into a new one. */
  method: 'embedding' | 'llm' | 'split';
  llmConfidence?: string | null;
  llmReason?: string | null;
  /** `pending` by default; `declined` records an adjudicator's "not the same cause", `rejected` a person's. */
  status?: 'pending' | 'declined' | 'rejected';
}

/** A merge decision the reconciler must not override: a person's rejection or the adjudicator's "no". */
export const DECIDED_AGAINST_STATUSES: ReadonlySet<string> = new Set(['rejected', 'declined']);

/** The recorded state of a cluster pair, in either order, or null when the pair was never recorded. */
export async function getMergePairState(
  db: DrizzleDB,
  clusterAId: number,
  clusterBId: number,
): Promise<{ status: string; method: string } | null> {
  const [a, b] = clusterAId < clusterBId ? [clusterAId, clusterBId] : [clusterBId, clusterAId];
  const [row] = await db
    .select({ status: clusterMergeSuggestions.status, method: clusterMergeSuggestions.method })
    .from(clusterMergeSuggestions)
    .where(and(eq(clusterMergeSuggestions.clusterAId, a), eq(clusterMergeSuggestions.clusterBId, b)));
  return row ?? null;
}

/** Record a suggestion, pending unless `status` says otherwise (deduped on the ordered cluster pair). */
export async function recordMergeSuggestion(db: DrizzleDB, input: SuggestionInput): Promise<void> {
  if (input.clusterAId === input.clusterBId) return;
  const [clusterAId, clusterBId] =
    input.clusterAId < input.clusterBId ? [input.clusterAId, input.clusterBId] : [input.clusterBId, input.clusterAId];
  await db
    .insert(clusterMergeSuggestions)
    .values({
      projectId: input.projectId,
      clusterAId,
      clusterBId,
      score: input.score ?? null,
      method: input.method,
      llmConfidence: input.llmConfidence ?? null,
      llmReason: input.llmReason ?? null,
      status: input.status ?? 'pending',
    })
    .onConflictDoNothing();
}

/** List suggestions for a project (default: pending), joined with cluster summaries. */
export async function listMergeSuggestions(db: DrizzleDB, projectId: number, status = 'pending') {
  const a = failureClusters;
  const rows = await db
    .select({
      id: clusterMergeSuggestions.id,
      score: clusterMergeSuggestions.score,
      method: clusterMergeSuggestions.method,
      llmConfidence: clusterMergeSuggestions.llmConfidence,
      llmReason: clusterMergeSuggestions.llmReason,
      status: clusterMergeSuggestions.status,
      createdAt: clusterMergeSuggestions.createdAt,
      clusterAId: clusterMergeSuggestions.clusterAId,
      clusterBId: clusterMergeSuggestions.clusterBId,
    })
    .from(clusterMergeSuggestions)
    .where(and(eq(clusterMergeSuggestions.projectId, projectId), eq(clusterMergeSuggestions.status, status)))
    .orderBy(desc(clusterMergeSuggestions.createdAt));

  if (rows.length === 0) return [];

  const ids = [...new Set(rows.flatMap((r) => [r.clusterAId, r.clusterBId]))];
  const clusters = await db
    .select({
      id: a.id,
      signature: a.signature,
      errorType: a.errorType,
      occurrences: a.occurrences,
      status: a.status,
    })
    .from(a)
    .where(or(...ids.map((id) => eq(a.id, id))));
  const byId = new Map(clusters.map((c) => [c.id, c]));

  return rows.map((r) => ({
    id: r.id,
    score: r.score,
    method: r.method,
    llmConfidence: r.llmConfidence,
    llmReason: r.llmReason,
    status: r.status,
    createdAt: r.createdAt,
    clusterA: byId.get(r.clusterAId) ?? null,
    clusterB: byId.get(r.clusterBId) ?? null,
  }));
}

/**
 * The survivor/victim clusters a pending suggestion would merge, for a caller
 * that must act before the merge deletes the victim (the merge-comment policy).
 */
export async function getMergeSuggestionPair(
  db: DrizzleDB,
  id: number,
): Promise<{ survivorId: number; victimId: number; projectId: number } | null> {
  const [s] = await db.select().from(clusterMergeSuggestions).where(eq(clusterMergeSuggestions.id, id));
  if (!s || s.status !== 'pending') return null;
  return { survivorId: s.clusterAId, victimId: s.clusterBId, projectId: s.projectId };
}

/** The suggestion key of a merge suggestion: its ordered cluster pair. */
export function mergeSuggestionKey(clusterAId: number, clusterBId: number): string {
  return `${Math.min(clusterAId, clusterBId)}+${Math.max(clusterAId, clusterBId)}`;
}

/** A person's decision on a suggestion, recorded as its hand-back outcome. */
async function recordMergeDecision(
  db: DrizzleDB,
  s: { projectId: number; clusterAId: number; clusterBId: number; method: string },
  outcome: 'applied' | 'rejected',
  actor: HandbackActor,
): Promise<void> {
  await recordOutcome(db, {
    projectId: s.projectId,
    kind: 'merge-suggestion',
    subjectType: 'cluster',
    subjectId: s.clusterAId,
    suggestionKey: mergeSuggestionKey(s.clusterAId, s.clusterBId),
    outcome,
    actor,
    details: { clusterAId: s.clusterAId, clusterBId: s.clusterBId, method: s.method },
  });
}

/**
 * Approve a suggestion: merge clusterB into clusterA (lower id survives). The
 * approval is recorded as the suggestion's `applied` outcome first, since the
 * merge deletes the suggestion row.
 */
export async function approveMergeSuggestion(
  db: DrizzleDB,
  id: number,
  actor: HandbackActor = { channel: 'ui' },
): Promise<{ survivorId: number } | null> {
  const [s] = await db.select().from(clusterMergeSuggestions).where(eq(clusterMergeSuggestions.id, id));
  if (!s || s.status !== 'pending') return null;
  await recordMergeDecision(db, s, 'applied', actor);
  // Survivor = lower id (longest-lived). Merging deletes clusterB, which cascade-
  // deletes this suggestion (and any others referencing the absorbed cluster).
  await mergeFailureClusters(db, s.clusterAId, s.clusterBId);
  return { survivorId: s.clusterAId };
}

/**
 * Reject a suggestion (keeps the row for audit, both clusters untouched), and
 * record the person's rejection as the suggestion's `rejected` outcome.
 */
export async function rejectMergeSuggestion(
  db: DrizzleDB,
  id: number,
  actor: HandbackActor = { channel: 'ui' },
): Promise<boolean> {
  const [s] = await db.select().from(clusterMergeSuggestions).where(eq(clusterMergeSuggestions.id, id));
  if (!s || s.status !== 'pending') return false;
  await db
    .update(clusterMergeSuggestions)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(clusterMergeSuggestions.id, id));
  await recordMergeDecision(db, s, 'rejected', actor);
  return true;
}

/** The pending suggestions that involve a cluster, oldest first, with the other cluster of each. */
export async function pendingSuggestionsForCluster(
  db: DrizzleDB,
  clusterId: number,
): Promise<Array<{ id: number; otherClusterId: number }>> {
  const rows = await db
    .select({
      id: clusterMergeSuggestions.id,
      clusterAId: clusterMergeSuggestions.clusterAId,
      clusterBId: clusterMergeSuggestions.clusterBId,
    })
    .from(clusterMergeSuggestions)
    .where(
      and(
        eq(clusterMergeSuggestions.status, 'pending'),
        or(eq(clusterMergeSuggestions.clusterAId, clusterId), eq(clusterMergeSuggestions.clusterBId, clusterId)),
      ),
    )
    .orderBy(clusterMergeSuggestions.id);
  return rows.map((r) => ({ id: r.id, otherClusterId: r.clusterAId === clusterId ? r.clusterBId : r.clusterAId }));
}

/** Resolve a suggestion's project (for access checks). */
export async function getSuggestionProjectId(db: DrizzleDB, id: number): Promise<number | null> {
  const [s] = await db
    .select({ projectId: clusterMergeSuggestions.projectId })
    .from(clusterMergeSuggestions)
    .where(eq(clusterMergeSuggestions.id, id));
  return s?.projectId ?? null;
}
