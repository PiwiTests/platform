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

/** The latest result of each suspect in a list of experiments (newest first). Pure. */
export function latestSuspectResults(experiments: FlakeExperimentRecord[]): Map<string, FlakeSuspectResult> {
  const out = new Map<string, FlakeSuspectResult>();
  for (const e of experiments) {
    if (e.kind !== 'reproduce') continue;
    const control = e.arms.find((a) => a.key === 'control');
    for (const a of e.arms) {
      if (!a.suspectId || !a.verdict || out.has(a.suspectId)) continue;
      out.set(a.suspectId, {
        suspectId: a.suspectId,
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
