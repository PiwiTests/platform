/**
 * Whether the execution page shows the one contextual line that offers to
 * decline capture fixtures, at the point where their absence is felt.
 *
 * The nudge is rare by design: it fires only when the capture fixtures are
 * undecided for the project and this failure is one whose leading clue would
 * have used a source the fixtures capture — a timeout (where a captured network
 * timeline shows the request that hung) or a clue that already cites the network
 * requests. A declined or not-applicable capability never nudges, and a project
 * that captures fixtures has nothing to offer.
 */
import type { CapabilityState } from '#shared/capabilities';

export interface FixturesNudgeInput {
  /** The leading clue's cited section, from the evidence hint, or null. */
  clueSection: string | null;
  /** Whether this execution failed on a timeout. */
  isTimeout: boolean;
  /** The resolved fixtures state for this project. */
  fixturesState: CapabilityState;
}

/**
 * The clue sections whose evidence the capture fixtures provide, so a failure
 * leading with one of them would read better with the fixtures switched on.
 */
const FIXTURE_BACKED_SECTIONS = new Set<string>(['networkRequests', 'serverLogs', 'console']);

/** Decide whether to show the capture-fixtures nudge under the headline. */
export function shouldNudgeFixtures(input: FixturesNudgeInput): boolean {
  if (input.fixturesState !== 'undecided') return false;
  return input.isTimeout || (input.clueSection != null && FIXTURE_BACKED_SECTIONS.has(input.clueSection));
}
