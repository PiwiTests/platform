/**
 * Embedding-based reconciliation of newly-created failure clusters.
 *
 * The deterministic fingerprint (shared/error-fingerprint.ts) is the fast,
 * always-on primary path. This is the optional semantic layer: after a run, the
 * clusters first seen in that run are embedded and compared (cosine) against the
 * project's other open clusters. Near-duplicates above a threshold are merged
 * into the longest-lived cluster via `mergeFailureClusters`, which records a
 * fingerprint alias so future failures route to the survivor.
 *
 * Runs only when an `embedding` AI role is configured; otherwise it's a no-op,
 * so clustering still works with zero AI configuration. Invoked fire-and-forget
 * from the run-finalization path (see ai-diagnosis.ts#autoDiagnoseRun).
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { failureClusters } from '../database/schema';
import { mergeFailureClusters } from '#shared/handlers/failure-cluster-ops';
import { recordMergeSuggestion } from '#shared/handlers/cluster-merge-suggestions';
import { embedTexts } from './ai-embeddings';
import { cosineSimilarity, parseEmbedding } from './cluster-similarity';
import { adjudicateClusterPair } from './cluster-adjudicate';
import type { ResolvedAiRole } from '~~/types/api';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

function threshold(envVar: string, fallback: number): number {
  const v = Number(process.env[envVar]);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

/** Cosine ≥ this → auto-merge (clearly the same root cause). */
const MERGE_THRESHOLD = threshold('PIWI_CLUSTER_SIMILARITY_THRESHOLD', 0.92);
/** Cosine in [SUGGEST_THRESHOLD, MERGE_THRESHOLD) → ambiguous band (adjudicate / suggest). */
const SUGGEST_THRESHOLD = Math.min(MERGE_THRESHOLD, threshold('PIWI_CLUSTER_SUGGEST_THRESHOLD', 0.8));

const EMBED_TEXT_CAP = 2000; // chars of sample error fed to the embedder
const MAX_NEW_PER_RUN = 50; // cost guard: cap clusters embedded per run
const MAX_ADJUDICATIONS_PER_RUN = 5; // cost guard: cap reasoning-model calls per run

interface ReconcileRoles {
  embeddingRole: ResolvedAiRole;
  /** Reasoning model used to adjudicate the ambiguous band; null disables adjudication. */
  reasoningRole?: ResolvedAiRole | null;
}

function embedText(signature: string, sampleError: string | null): string {
  return `${signature}\n${(sampleError ?? '').slice(0, EMBED_TEXT_CAP)}`.trim();
}

export async function reconcileNewClusters(
  db: DbClient,
  projectId: number,
  runId: number,
  roles: ReconcileRoles,
): Promise<{ embedded: number; merged: number; suggested: number }> {
  const { embeddingRole, reasoningRole } = roles;
  // Clusters first seen in this run (the ones that may be near-duplicates of
  // existing ones, or of each other).
  const fresh = await db
    .select({
      id: failureClusters.id,
      signature: failureClusters.signature,
      errorType: failureClusters.errorType,
      sampleError: failureClusters.sampleError,
      embedding: failureClusters.embedding,
    })
    .from(failureClusters)
    .where(
      and(
        eq(failureClusters.projectId, projectId),
        eq(failureClusters.firstSeenRunId, runId),
        eq(failureClusters.status, 'open'),
      ),
    )
    .limit(MAX_NEW_PER_RUN);

  if (fresh.length === 0) return { embedded: 0, merged: 0, suggested: 0 };

  // Embed the ones that don't have a vector yet.
  const toEmbed = fresh.filter((c) => !c.embedding);
  let embedded = 0;
  if (toEmbed.length > 0) {
    const vectors = await embedTexts(
      embeddingRole,
      toEmbed.map((c) => embedText(c.signature, c.sampleError)),
    );
    for (let i = 0; i < toEmbed.length; i++) {
      const vec = vectors[i];
      if (!vec || vec.length === 0) continue;
      const json = JSON.stringify(vec);
      await db
        .update(failureClusters)
        .set({ embedding: json, embeddingModel: embeddingRole.model, updatedAt: new Date() })
        .where(eq(failureClusters.id, toEmbed[i]!.id));
      toEmbed[i]!.embedding = json;
      embedded++;
    }
  }

  // Candidate pool: every open cluster in the project that has an embedding.
  const pool = await db
    .select({ id: failureClusters.id, embedding: failureClusters.embedding })
    .from(failureClusters)
    .where(
      and(
        eq(failureClusters.projectId, projectId),
        eq(failureClusters.status, 'open'),
        isNotNull(failureClusters.embedding),
      ),
    );

  const poolVecs = pool
    .map((p) => ({ id: p.id, vec: parseEmbedding(p.embedding) }))
    .filter((p): p is { id: number; vec: number[] } => p.vec !== null);

  const dead = new Set<number>(); // clusters already merged away this pass
  let merged = 0;
  let suggested = 0;
  let adjudications = 0;

  // Lazy fetch of a pool cluster's details for adjudication / suggestion display.
  const detailCache = new Map<number, ClusterDetails>();
  const getDetails = async (id: number): Promise<ClusterDetails | null> => {
    if (detailCache.has(id)) return detailCache.get(id)!;
    const [row] = await db
      .select({
        signature: failureClusters.signature,
        errorType: failureClusters.errorType,
        sampleError: failureClusters.sampleError,
      })
      .from(failureClusters)
      .where(eq(failureClusters.id, id));
    if (!row) return null;
    detailCache.set(id, row);
    return row;
  };

  for (const c of fresh) {
    if (dead.has(c.id)) continue;
    const vec = parseEmbedding(c.embedding);
    if (!vec) continue;

    let best = { id: 0, score: 0 };
    for (const p of poolVecs) {
      if (p.id === c.id || dead.has(p.id)) continue;
      const score = cosineSimilarity(vec, p.vec);
      if (score > best.score) best = { id: p.id, score };
    }
    if (!best.id || best.score < SUGGEST_THRESHOLD) continue;

    // Keep the lower id (oldest / longest-lived triage history) as survivor.
    const [keep, drop] = best.id < c.id ? [best.id, c.id] : [c.id, best.id];

    if (best.score >= MERGE_THRESHOLD) {
      await mergeFailureClusters(db, keep, drop);
      dead.add(drop);
      merged++;
      continue;
    }

    // Ambiguous band: adjudicate with the reasoning model (budget-capped), else
    // record a suggestion for human review.
    if (reasoningRole && adjudications < MAX_ADJUDICATIONS_PER_RUN) {
      adjudications++;
      const other = await getDetails(best.id);
      const verdict = other
        ? await adjudicateClusterPair(
            reasoningRole,
            { signature: c.signature, errorType: c.errorType, sampleError: c.sampleError },
            other,
          ).catch(() => null)
        : null;
      if (verdict?.merge && verdict.confidence === 'high') {
        await mergeFailureClusters(db, keep, drop);
        dead.add(drop);
        merged++;
        continue;
      }
      if (verdict?.merge) {
        await recordMergeSuggestion(db, {
          projectId,
          clusterAId: keep,
          clusterBId: drop,
          score: best.score,
          method: 'llm',
          llmConfidence: verdict.confidence,
          llmReason: verdict.reason,
        });
        suggested++;
        continue;
      }
      // verdict says don't merge (or adjudication failed) → no suggestion.
      continue;
    }

    await recordMergeSuggestion(db, {
      projectId,
      clusterAId: keep,
      clusterBId: drop,
      score: best.score,
      method: 'embedding',
    });
    suggested++;
  }

  return { embedded, merged, suggested };
}

interface ClusterDetails {
  signature: string;
  errorType: string | null;
  sampleError: string | null;
}
