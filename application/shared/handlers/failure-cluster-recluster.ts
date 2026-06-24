/**
 * Non-destructive re-fingerprinting of existing failure clusters.
 *
 * When the fingerprint algorithm changes (FINGERPRINT_VERSION bump in
 * shared/error-fingerprint.ts), clusters created under the old algorithm carry
 * stale fingerprints and would no longer match incoming failures — so new runs
 * would silently fork brand-new clusters and orphan all the triage history
 * (status, notes, diagnoses) attached to the old ones.
 *
 * This backfill recomputes each cluster's fingerprint from its stored
 * `sampleError` and migrates in place:
 *  - unchanged fingerprint  → already current, skip (keeps the pass idempotent)
 *  - fingerprint now equals another cluster in the same project → merge into it
 *    (the older/lower id wins so the longest-lived triage state survives)
 *  - otherwise → update the fingerprint + derived fields on the row
 *
 * Runs once on startup after migrations; safe to run repeatedly.
 */

import { eq, and, ne, asc } from 'drizzle-orm';
import { failureClusters } from '../../server/database/schema';
import { computeErrorFingerprint } from '../error-fingerprint';
import { mergeFailureClusters } from './failure-cluster-ops';
import type { DrizzleDB } from './db';

export async function reclusterFailureFingerprints(db: DrizzleDB): Promise<{ updated: number; merged: number }> {
  // Process oldest-first so a re-fingerprinted cluster that becomes the merge
  // target already exists by the time later duplicates are visited.
  const clusters = await db
    .select({
      id: failureClusters.id,
      projectId: failureClusters.projectId,
      fingerprint: failureClusters.fingerprint,
      sampleError: failureClusters.sampleError,
    })
    .from(failureClusters)
    .orderBy(asc(failureClusters.id));

  let updated = 0;
  let merged = 0;

  for (const cluster of clusters) {
    if (!cluster.sampleError) continue; // nothing to recompute from — leave as-is

    const fp = await computeErrorFingerprint(cluster.sampleError);
    if (fp.fingerprint === cluster.fingerprint) continue; // already on the current algorithm

    const [survivor] = await db
      .select({ id: failureClusters.id })
      .from(failureClusters)
      .where(
        and(
          eq(failureClusters.projectId, cluster.projectId),
          eq(failureClusters.fingerprint, fp.fingerprint),
          ne(failureClusters.id, cluster.id),
        ),
      );

    if (survivor) {
      // Keep the lower id so the longest-lived cluster (and its triage) wins.
      // Merge BEFORE rewriting the fingerprint: updating the row first could
      // momentarily duplicate (projectId, fingerprint) and trip the unique index.
      const [keep, drop] = survivor.id < cluster.id ? [survivor.id, cluster.id] : [cluster.id, survivor.id];
      await mergeFailureClusters(db, keep, drop);
      merged++;
      // The surviving row may still hold the old fingerprint (when it was this
      // cluster). Normalize it to the current algorithm — safe now that the
      // duplicate is gone.
      await db
        .update(failureClusters)
        .set({
          fingerprint: fp.fingerprint,
          signature: fp.signature,
          errorType: fp.errorType,
          selector: fp.selector,
          updatedAt: new Date(),
        })
        .where(eq(failureClusters.id, keep));
      continue;
    }

    await db
      .update(failureClusters)
      .set({
        fingerprint: fp.fingerprint,
        signature: fp.signature,
        errorType: fp.errorType,
        selector: fp.selector,
        updatedAt: new Date(),
      })
      .where(eq(failureClusters.id, cluster.id));
    updated++;
  }

  return { updated, merged };
}
