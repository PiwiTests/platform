/**
 * "Fixed before" — scoring how much an open failure cluster resembles a cluster
 * that has already been resolved, so the dashboard can show how the earlier one
 * was fixed.
 *
 * The scoring is deterministic and pure: same fingerprint family (error kind,
 * masked message, masked locator — the components of `shared/error-fingerprint`),
 * same failing locator, same spec file / test title, plus an optional embedding
 * cosine supplied by the caller when a semantic vector exists for both clusters.
 * Living in `shared/` keeps it unit-testable and lets the demo mirror reuse it.
 *
 * The caller (server/utils/cluster-memory.ts) selects the resolved-like
 * candidates, computes the fingerprint components and the cosine, and turns the
 * winners into the displayable `FixedBeforeMatch`.
 */

/** The comparable shape of one cluster, derived from its stored error + tests. */
export interface MemoryCluster {
  id: number;
  /** Error category from `classifyError` (timeout/assertion/…), null when unknown. */
  errorType: string | null;
  /** Masked message head — the main fingerprint input. */
  normalizedMessage: string;
  /** Masked failing locator, null when the error carried none. */
  maskedSelector: string | null;
  /** Unmasked failing locator (the `selector` column), for an exact-locator signal. */
  locator: string | null;
  /** Spec files of the cluster's affected tests. */
  specFiles: string[];
  /** Titles of the cluster's affected tests. */
  testTitles: string[];
}

/** A resolved candidate paired with its embedding cosine to the open cluster. */
export interface MemoryCandidate {
  cluster: MemoryCluster;
  /** Cosine of the two clusters' embeddings, or null when either is missing. */
  cosine: number | null;
}

export interface FixedBeforeScore {
  clusterId: number;
  /** Combined score, capped at 1. */
  score: number;
  /** The embedding cosine that fed the score, when one was available. */
  cosine: number | null;
  /** One short human reason ("same error and locator"). */
  reason: string;
}

// Weights per signal. A match qualifies once the combined score clears the
// threshold — a single shared signal (e.g. only the error type) is deliberately
// too weak on its own.
const W_ERROR_TYPE = 0.15;
const W_MESSAGE = 0.4;
const W_MASKED_SELECTOR = 0.2;
const W_LOCATOR = 0.2;
const W_SPEC = 0.15;
const W_TITLE = 0.15;
const W_EMBED = 0.6;

/** Below this cosine the embedding carries no weight — vectors are broadly close. */
export const FIXED_BEFORE_EMBED_THRESHOLD = 0.82;
/** Minimum combined score for a candidate to be shown as a prior fix. */
export const FIXED_BEFORE_THRESHOLD = 0.35;
/** How many prior fixes to surface. */
export const FIXED_BEFORE_LIMIT = 3;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Fraction of the cosine above the threshold, scaled to the embedding weight. */
function embedWeight(cosine: number | null): number {
  if (cosine == null || cosine <= FIXED_BEFORE_EMBED_THRESHOLD) return 0;
  return clamp01((cosine - FIXED_BEFORE_EMBED_THRESHOLD) / (1 - FIXED_BEFORE_EMBED_THRESHOLD)) * W_EMBED;
}

function intersects(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((v) => set.has(v));
}

interface Signals {
  sameErrorType: boolean;
  sameMessage: boolean;
  sameMaskedSelector: boolean;
  sameLocator: boolean;
  sameSpec: boolean;
  sameTitle: boolean;
  cosine: number | null;
}

/** One short, human reason for the match — the strongest signals, named plainly. */
function describeMatch(s: Signals): string {
  const err = s.sameMessage ? 'same error' : s.sameErrorType ? 'same error type' : null;
  const cos = s.cosine != null && s.cosine > FIXED_BEFORE_EMBED_THRESHOLD ? s.cosine.toFixed(2) : null;

  if (s.sameLocator || s.sameMaskedSelector) return err ? 'same error and locator' : 'same failing locator';

  const parts: string[] = [];
  if (err) parts.push(err);
  if (s.sameSpec) parts.push('same spec');
  if (cos) parts.push(`similar message (${cos})`);
  if (parts.length) return parts.join(', ');

  if (s.sameTitle) return 'same test';
  return 'similar failure';
}

/**
 * Score one resolved candidate against the open cluster. Returns null when the
 * candidate is the open cluster itself or scores below the threshold.
 */
export function scoreFixedBefore(
  open: MemoryCluster,
  candidate: MemoryCluster,
  cosine: number | null,
): FixedBeforeScore | null {
  if (candidate.id === open.id) return null;

  const signals: Signals = {
    sameErrorType: Boolean(open.errorType && candidate.errorType && open.errorType === candidate.errorType),
    sameMessage: Boolean(open.normalizedMessage) && open.normalizedMessage === candidate.normalizedMessage,
    sameMaskedSelector:
      Boolean(open.maskedSelector && candidate.maskedSelector) && open.maskedSelector === candidate.maskedSelector,
    sameLocator: Boolean(open.locator && candidate.locator) && open.locator === candidate.locator,
    sameSpec: intersects(open.specFiles, candidate.specFiles),
    sameTitle: intersects(open.testTitles, candidate.testTitles),
    cosine,
  };

  let score = 0;
  if (signals.sameErrorType) score += W_ERROR_TYPE;
  if (signals.sameMessage) score += W_MESSAGE;
  if (signals.sameMaskedSelector) score += W_MASKED_SELECTOR;
  if (signals.sameLocator) score += W_LOCATOR;
  if (signals.sameSpec) score += W_SPEC;
  if (signals.sameTitle) score += W_TITLE;
  score += embedWeight(cosine);
  score = clamp01(score);

  if (score < FIXED_BEFORE_THRESHOLD) return null;
  return { clusterId: candidate.id, score, cosine, reason: describeMatch(signals) };
}

/**
 * Rank the resolved candidates that resemble the open cluster, best first.
 * Ties keep the caller's order (which is most-recently-resolved first), so the
 * result is deterministic.
 */
export function rankFixedBefore(
  open: MemoryCluster,
  candidates: MemoryCandidate[],
  limit = FIXED_BEFORE_LIMIT,
): FixedBeforeScore[] {
  const scored: FixedBeforeScore[] = [];
  for (const c of candidates) {
    const s = scoreFixedBefore(open, c.cluster, c.cosine);
    if (s) scored.push(s);
  }
  // Stable sort by score desc; equal scores keep input order.
  return scored
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.score - a.s.score || a.i - b.i)
    .slice(0, limit)
    .map(({ s }) => s);
}
