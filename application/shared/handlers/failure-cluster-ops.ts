/**
 * Shared failure-cluster and run-cancellation operations used by both server
 * and demo reporter implementations.
 */

import { eq, ne, and, or, inArray, sql, isNull, count } from 'drizzle-orm';
import {
  testRuns,
  testRunsCases,
  failureClusters,
  failureClusterAliases,
  failureDiagnoses,
  failureDiagnosisVersions,
} from '../../server/database/schema';
import type { DrizzleDB } from './db';

/** Per-fingerprint accumulator for the batch being persisted. */
export interface PendingCluster {
  fp: {
    fingerprint: string;
    signature: string;
    errorType: string | null;
    selector: string | null;
  };
  sampleError: string;
  count: number;
}

/**
 * Get-or-create the `failure_clusters` rows for a batch of fingerprints and
 * return fingerprint → cluster id. Existing clusters get their lastSeenRunId
 * and occurrences bumped; new ones start at this run. Insert races with
 * concurrent streaming batches are resolved via the unique
 * (projectId, fingerprint) index + onConflictDoNothing.
 */
export async function getOrCreateFailureClusters(
  db: DrizzleDB,
  projectId: number,
  testRunId: number,
  pending: Map<string, PendingCluster>,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  if (pending.size === 0) return ids;

  const bumpExisting = (clusterId: number, count: number) =>
    db
      .update(failureClusters)
      .set({
        lastSeenRunId: testRunId,
        occurrences: sql`${failureClusters.occurrences} + ${count}`,
        updatedAt: new Date(),
      })
      .where(eq(failureClusters.id, clusterId));

  const existing = await db
    .select({ id: failureClusters.id, fingerprint: failureClusters.fingerprint })
    .from(failureClusters)
    .where(and(eq(failureClusters.projectId, projectId), inArray(failureClusters.fingerprint, [...pending.keys()])));

  await Promise.all(
    existing.map(async (cluster) => {
      const p = pending.get(cluster.fingerprint);
      if (!p) return;
      ids.set(cluster.fingerprint, cluster.id);
      await bumpExisting(cluster.id, p.count);
    }),
  );

  // Route fingerprints that were absorbed by a prior merge to their surviving
  // cluster (instead of forking a fresh one), via the alias table.
  const unmatched = [...pending.keys()].filter((fp) => !ids.has(fp));
  if (unmatched.length > 0) {
    const aliases = await db
      .select({ fingerprint: failureClusterAliases.fingerprint, clusterId: failureClusterAliases.clusterId })
      .from(failureClusterAliases)
      .where(
        and(eq(failureClusterAliases.projectId, projectId), inArray(failureClusterAliases.fingerprint, unmatched)),
      );
    await Promise.all(
      aliases.map(async (a) => {
        const p = pending.get(a.fingerprint);
        if (!p || ids.has(a.fingerprint)) return;
        ids.set(a.fingerprint, a.clusterId);
        await bumpExisting(a.clusterId, p.count);
      }),
    );
  }

  const newFingerprints = [...pending.keys()].filter((fp) => !ids.has(fp));
  await Promise.all(
    newFingerprints.map(async (fingerprint) => {
      const p = pending.get(fingerprint)!;
      const inserted = await db
        .insert(failureClusters)
        .values({
          projectId,
          fingerprint,
          signature: p.fp.signature,
          errorType: p.fp.errorType,
          selector: p.fp.selector,
          sampleError: p.sampleError,
          firstSeenRunId: testRunId,
          lastSeenRunId: testRunId,
          occurrences: p.count,
        })
        .onConflictDoNothing()
        .returning({ id: failureClusters.id });

      if (inserted[0]) {
        ids.set(fingerprint, inserted[0].id);
        return;
      }

      const winner = await db
        .select({ id: failureClusters.id })
        .from(failureClusters)
        .where(and(eq(failureClusters.projectId, projectId), eq(failureClusters.fingerprint, fingerprint)));
      if (winner[0]) {
        ids.set(fingerprint, winner[0].id);
        await bumpExisting(winner[0].id, p.count);
      }
    }),
  );

  return ids;
}

/**
 * Merge one failure cluster into another. The `survivorId` cluster keeps its
 * triage state (status, notes, manual base commit) and absorbs the victim:
 * all linked test-run cases and diagnoses are re-pointed, occurrence counts
 * and seen-run bounds are recomputed, then the victim row is deleted.
 *
 * Used by the re-fingerprinting backfill (when an algorithm change makes two
 * previously-distinct clusters collapse onto the same fingerprint) and is the
 * building block for future cluster-reconciliation work.
 */
export async function mergeFailureClusters(db: DrizzleDB, survivorId: number, victimId: number): Promise<void> {
  if (survivorId === victimId) return;

  // Re-point per-run case links.
  await db
    .update(testRunsCases)
    .set({ failureClusterId: survivorId })
    .where(eq(testRunsCases.failureClusterId, victimId));

  // Execution-scope diagnoses are keyed by test-run-case and stay meaningful —
  // move them to the survivor. A cluster-scope diagnosis on the victim is
  // redundant with the survivor's own, so drop it (cascade on delete) unless
  // the survivor has none, in which case keep the victim's.
  const [survivorClusterDiag] = await db
    .select({ id: failureDiagnoses.id })
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.clusterId, survivorId), eq(failureDiagnoses.scope, 'cluster')));

  await db
    .update(failureDiagnoses)
    .set({ clusterId: survivorId })
    .where(
      and(
        eq(failureDiagnoses.clusterId, victimId),
        survivorClusterDiag ? eq(failureDiagnoses.scope, 'execution') : sql`1 = 1`,
      ),
    );
  await db
    .update(failureDiagnosisVersions)
    .set({ clusterId: survivorId })
    .where(eq(failureDiagnosisVersions.clusterId, victimId));

  // Recompute aggregates from both clusters' surviving links.
  const [survivor] = await db
    .select({
      occurrences: failureClusters.occurrences,
      firstSeenRunId: failureClusters.firstSeenRunId,
      lastSeenRunId: failureClusters.lastSeenRunId,
    })
    .from(failureClusters)
    .where(eq(failureClusters.id, survivorId));
  const [victim] = await db
    .select({
      projectId: failureClusters.projectId,
      fingerprint: failureClusters.fingerprint,
      occurrences: failureClusters.occurrences,
      firstSeenRunId: failureClusters.firstSeenRunId,
      lastSeenRunId: failureClusters.lastSeenRunId,
    })
    .from(failureClusters)
    .where(eq(failureClusters.id, victimId));

  // Record the victim's fingerprint → survivor so future failures with that
  // fingerprint attach to the survivor, and re-home any aliases that pointed
  // at the victim (keeps chained merges consistent).
  if (victim) {
    await db
      .insert(failureClusterAliases)
      .values({ projectId: victim.projectId, fingerprint: victim.fingerprint, clusterId: survivorId })
      .onConflictDoNothing();
    await db
      .update(failureClusterAliases)
      .set({ clusterId: survivorId })
      .where(eq(failureClusterAliases.clusterId, victimId));
  }

  if (survivor && victim) {
    await db
      .update(failureClusters)
      .set({
        occurrences: (survivor.occurrences ?? 0) + (victim.occurrences ?? 0),
        firstSeenRunId: Math.min(survivor.firstSeenRunId, victim.firstSeenRunId),
        lastSeenRunId: Math.max(survivor.lastSeenRunId, victim.lastSeenRunId),
        updatedAt: new Date(),
      })
      .where(eq(failureClusters.id, survivorId));
  }

  await db.delete(failureClusters).where(eq(failureClusters.id, victimId));
}

/**
 * Recompute a cluster's occurrence counter from the test-run-cases still
 * linked to it. Must run after the case rows have actually been deleted or
 * unlinked (not before), otherwise the count still includes rows that are
 * about to disappear.
 */
export async function recomputeClusterOccurrences(db: DrizzleDB, clusterId: number): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(testRunsCases)
    .where(eq(testRunsCases.failureClusterId, clusterId));
  const occurrences = Number(row?.count ?? 0);

  await db.update(failureClusters).set({ occurrences, updatedAt: new Date() }).where(eq(failureClusters.id, clusterId));

  return occurrences;
}

/**
 * Cancel stale in-progress runs for a given project + instanceId.
 * Returns the cancelled runs so callers can publish their own lifecycle events.
 */
export async function cancelInstanceRuns(
  db: DrizzleDB,
  projectId: number,
  instanceId: string | null,
  excludeRunId?: number,
  isShardedRun?: boolean,
): Promise<Array<{ id: number; projectId: number }>> {
  if (!instanceId) return [];

  const conditions = [
    eq(testRuns.projectId, projectId),
    eq(testRuns.instanceId, instanceId),
    or(eq(testRuns.status, 'running'), eq(testRuns.status, 'initialising'), eq(testRuns.status, 'finalizing')),
  ];

  if (excludeRunId !== undefined) {
    conditions.push(ne(testRuns.id, excludeRunId));
  }

  if (isShardedRun) {
    conditions.push(isNull(testRuns.shardTotal));
  }

  return db
    .update(testRuns)
    .set({ status: 'cancelled', streamToken: null, updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: testRuns.id, projectId: testRuns.projectId });
}
