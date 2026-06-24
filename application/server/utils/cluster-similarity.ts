/**
 * Vector helpers for embedding-based failure clustering. Vectors are stored as
 * JSON-encoded number[] on `failure_clusters.embedding` (same representation on
 * SQLite and Postgres), so nearest-neighbour search is a brute-force cosine over
 * a project's open clusters — fine given per-project cluster counts are small.
 */

/** Cosine similarity in [-1, 1]; 0 for mismatched/empty/zero vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Parse a stored embedding column (JSON number[]) back into a vector, or null. */
export function parseEmbedding(json: string | null | undefined): number[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) && v.every((n) => typeof n === 'number') ? (v as number[]) : null;
  } catch {
    return null;
  }
}
