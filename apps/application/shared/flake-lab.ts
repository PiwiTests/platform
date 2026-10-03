/**
 * Flake-lab experiments as the dashboard reads them: the stored shapes the
 * experiments endpoint returns, and each suspect's latest result. Pure, so the
 * Flakiness tab, the MCP tools and the clue engine share it.
 */
import type { FlakeCondition } from '@piwitests/core/flake-plan';

export type FlakeExperimentKind = 'reproduce' | 'verify';
export type FlakeExperimentSource = 'cli' | 'desktop' | 'ci';
export type FlakeReproduceVerdict = 'reproduced' | 'amplified' | 'not-reproduced';
export type FlakeVerifyVerdict = 'verified' | 'still-fails' | 'inconclusive';
export type FlakeArmVerdictValue = FlakeReproduceVerdict | FlakeVerifyVerdict;

export interface FlakeArmRecord {
  id: number;
  key: string;
  label: string;
  suspectId: string | null;
  conditions: FlakeCondition[];
  runs: number;
  matchingFailures: number;
  otherFailures: number;
  discardedRounds: number;
  stoppedEarly: boolean;
  pValue: number | null;
  verdict: FlakeArmVerdictValue | null;
}

export interface FlakeExperimentRecord {
  id: number;
  testCaseId: number;
  kind: FlakeExperimentKind;
  verdict: string | null;
  commit: string | null;
  failureCommit: string | null;
  source: string;
  machine: string | null;
  playwrightProject: string | null;
  /** ISO timestamps. */
  createdAt: string;
  finishedAt: string | null;
  /** The arm that reproduced (reproduce) or was rerun (verify). */
  reproducingArmId: number | null;
  /** Verify only: the experiment and arm it reruns. */
  verifies: { experimentId: number; armId: number; label: string } | null;
  arms: FlakeArmRecord[];
}

/** A suspect's latest lab result: its arm in the newest reproduce experiment that tested it. */
export interface FlakeSuspectResult {
  suspectId: string;
  experimentId: number;
  verdict: FlakeReproduceVerdict;
  runs: number;
  matchingFailures: number;
  controlRuns: number;
  controlMatchingFailures: number;
  pValue: number | null;
  label: string;
  finishedAt: string | null;
}

/** The `piwi flake` command that reproduces a test, or verifies its fix. */
export function flakeCommand(testCaseId: number, kind: FlakeExperimentKind = 'reproduce'): string {
  return kind === 'verify'
    ? `npx @piwitests/reporter flake verify ${testCaseId}`
    : `npx @piwitests/reporter flake ${testCaseId}`;
}

/**
 * Where a test stands in the lab: never run through it, run without a
 * reproduction (not reproduced, amplified), reproduced and waiting for a fix
 * that holds (reproduced, still fails, inconclusive), or fixed (verified, or
 * verified and then flaky again).
 */
export type FlakeLabTestState =
  | 'untested'
  | 'not-reproduced'
  | 'amplified'
  | 'reproduced'
  | 'still-fails'
  | 'inconclusive'
  | 'verified'
  | 'flaked-again';

/** The states in the order the lab lists them: a fix to verify first, a fix that held last. */
export const FLAKE_LAB_STATE_ORDER: readonly FlakeLabTestState[] = [
  'still-fails',
  'inconclusive',
  'reproduced',
  'flaked-again',
  'untested',
  'amplified',
  'not-reproduced',
  'verified',
];

/**
 * A test's lab state from its finished experiments (newest first) and its
 * verified fix, if one marks it. The fix decides when there is one; otherwise
 * the newest verify that did not hold or the newest reproduction does, and
 * without either the newest experiment's verdict. Pure.
 */
export function flakeLabTestState(
  experiments: Array<{ kind: string; verdict: string | null }>,
  verifiedFix: { flakedAgainAt: string | null } | null,
): FlakeLabTestState {
  if (verifiedFix) return verifiedFix.flakedAgainAt ? 'flaked-again' : 'verified';
  if (experiments.length === 0) return 'untested';
  for (const e of experiments) {
    if (e.kind === 'verify' && e.verdict === 'still-fails') return 'still-fails';
    if (e.kind === 'verify' && e.verdict === 'inconclusive') return 'inconclusive';
    if (e.kind === 'reproduce' && e.verdict === 'reproduced') return 'reproduced';
  }
  return experiments[0]!.verdict === 'amplified' ? 'amplified' : 'not-reproduced';
}

/** What a test in this state needs next: a verify once it reproduced, a reproduction otherwise; nothing once fixed. */
export function flakeLabNextStep(state: FlakeLabTestState): FlakeExperimentKind | null {
  if (state === 'verified') return null;
  return state === 'reproduced' || state === 'still-fails' || state === 'inconclusive' ? 'verify' : 'reproduce';
}

/** The command a test in this state needs next; null once its fix holds. */
export function flakeLabNextCommand(testCaseId: number, state: FlakeLabTestState): string | null {
  const step = flakeLabNextStep(state);
  return step ? flakeCommand(testCaseId, step) : null;
}

/**
 * The suspect id an arm tested, as the profile names it today. An arm recorded
 * against a load suspect with its threshold in the id (`load:3`) tested the
 * load suspect (`load`).
 */
export function canonicalSuspectId(suspectId: string): string {
  return suspectId.startsWith('load:') ? 'load' : suspectId;
}

/** The latest result of each suspect in a list of experiments (newest first). Pure. */
export function latestSuspectResults(experiments: FlakeExperimentRecord[]): Map<string, FlakeSuspectResult> {
  const out = new Map<string, FlakeSuspectResult>();
  for (const e of experiments) {
    if (e.kind !== 'reproduce') continue;
    const control = e.arms.find((a) => a.key === 'control');
    for (const a of e.arms) {
      if (!a.suspectId || !a.verdict) continue;
      const suspectId = canonicalSuspectId(a.suspectId);
      if (out.has(suspectId)) continue;
      out.set(suspectId, {
        suspectId,
        experimentId: e.id,
        verdict: a.verdict as FlakeReproduceVerdict,
        runs: a.runs,
        matchingFailures: a.matchingFailures,
        controlRuns: control?.runs ?? 0,
        controlMatchingFailures: control?.matchingFailures ?? 0,
        pValue: a.pValue,
        label: a.label,
        finishedAt: e.finishedAt,
      });
    }
  }
  return out;
}
