/**
 * Baseline candidate ordering shared by the environment diff and the visual
 * diff. A failing execution is compared against the same test's last passing
 * execution — preferably one from the same deployment environment, then the
 * same branch, then simply the most recent. Comparing a `development` failure
 * with a `production` pass would report the environment label itself as the
 * change, so the fallback is named in a note the cards show.
 */

export interface BaselineScope {
  /** Deployment environment label of the run (`production`, `staging`, …). */
  environment: string | null;
  /** Git branch of the run. */
  branch: string | null;
}

/**
 * Order passing candidates, most suitable first: same environment before other
 * environments, same branch before other branches, and the input order (most
 * recent first) within a tier. An unknown failing environment or branch does
 * not rank the candidates on that axis.
 */
export function rankBaselineCandidates<T extends BaselineScope>(failing: BaselineScope, candidates: T[]): T[] {
  const tier = (c: BaselineScope): number => {
    const otherEnvironment = failing.environment != null && c.environment !== failing.environment ? 2 : 0;
    const otherBranch = failing.branch != null && c.branch !== failing.branch ? 1 : 0;
    return otherEnvironment + otherBranch;
  };
  return candidates
    .map((candidate, index) => ({ candidate, index, tier: tier(candidate) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.candidate);
}

/**
 * The note shown next to a baseline chosen from another environment, e.g.
 * "compared with a production run; no passing development run of this test
 * exists". Null when the baseline is from the failing execution's environment
 * or the failing execution has no environment label.
 */
export function baselineEnvironmentNote(failing: BaselineScope, chosen: BaselineScope): string | null {
  if (failing.environment == null || chosen.environment === failing.environment) return null;
  const chosenLabel = chosen.environment ? `a ${chosen.environment} run` : 'a run with no environment label';
  return `compared with ${chosenLabel}; no passing ${failing.environment} run of this test exists`;
}
