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

/** Where one suspect stands in the lab: never tested, or its latest arm's verdict. */
export type FlakeSuspectStanding = 'untested' | FlakeReproduceVerdict;

export function flakeSuspectStanding(result: FlakeSuspectResult | null | undefined): FlakeSuspectStanding {
  return result ? result.verdict : 'untested';
}

/** The order the lab runs suspects in: those it never tested first, one that did not reproduce last. */
const PLAN_STANDING_ORDER: readonly FlakeSuspectStanding[] = ['untested', 'reproduced', 'amplified', 'not-reproduced'];
/** The order a test's top suspect is picked in: a reproduction first, one that did not reproduce last. */
const TOP_STANDING_ORDER: readonly FlakeSuspectStanding[] = ['reproduced', 'untested', 'amplified', 'not-reproduced'];

function orderByStanding<T extends { id: string }>(
  suspects: readonly T[],
  results: ReadonlyMap<string, FlakeSuspectResult>,
  order: readonly FlakeSuspectStanding[],
): T[] {
  const place = (s: T) => order.indexOf(flakeSuspectStanding(results.get(s.id)));
  return suspects
    .map((s, rank) => ({ s, rank }))
    .sort((a, b) => place(a.s) - place(b.s) || a.rank - b.rank)
    .map(({ s }) => s);
}

/**
 * Suspects in the order a reproduce experiment runs them: the untested ones in
 * rank order, then a reproduced one, then an amplified one, then those that did
 * not reproduce. Every suspect stays in the list. Pure.
 */
export function planFlakeSuspectOrder<T extends { id: string }>(
  suspects: readonly T[],
  results: ReadonlyMap<string, FlakeSuspectResult>,
): T[] {
  return orderByStanding(suspects, results, PLAN_STANDING_ORDER);
}

/**
 * The suspect a test is shown with: the highest-ranked one the lab reproduced,
 * else the highest-ranked untested one, else an amplified one, else the
 * highest-ranked one that did not reproduce; null without suspects. Pure.
 */
export function topFlakeSuspect<T extends { id: string }>(
  suspects: readonly T[],
  results: ReadonlyMap<string, FlakeSuspectResult>,
): T | null {
  return orderByStanding(suspects, results, TOP_STANDING_ORDER)[0] ?? null;
}

function binomialCdf(k: number, n: number, p: number): number {
  let term = Math.pow(1 - p, n);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= ((n - i + 1) / i) * (p / (1 - p));
    sum += term;
  }
  return sum;
}

/**
 * The highest failure rate still consistent with `failures` in `runs` at the
 * given confidence (the one-sided Clopper–Pearson bound): ten runs without a
 * failure only say the rate is below about 26%. 1 with no runs. Pure.
 */
export function failureRateUpperBound(failures: number, runs: number, confidence = 0.95): number {
  if (runs <= 0) return 1;
  const k = Math.max(0, Math.min(failures, runs));
  if (k >= runs) return 1;
  const alpha = 1 - confidence;
  if (k === 0) return 1 - Math.pow(alpha, 1 / runs);
  let low = k / runs;
  let high = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (binomialCdf(k, runs, mid) > alpha) low = mid;
    else high = mid;
  }
  return high;
}

/** A rate as a whole percentage, at least 1%. */
function percent(rate: number): string {
  return `${Math.max(1, Math.round(rate * 100))}%`;
}

/**
 * What a suspect's latest lab result says, in one sentence; null when it was
 * never tested. A suspect that did not reproduce keeps its place at the end of
 * the plan, and the sentence says what its runs can and cannot rule out. Pure.
 */
export function flakeSuspectLabNote(result: FlakeSuspectResult | null | undefined): string | null {
  if (!result) return null;
  const under = `${result.matchingFailures} of ${result.runs} runs under it failed the same way`;
  const control =
    result.controlRuns > 0 ? `, against ${result.controlMatchingFailures} of ${result.controlRuns} without it` : '';
  if (result.verdict === 'reproduced') return `Reproduced: ${under}${control}.`;
  if (result.verdict === 'amplified') return `Amplified: ${under}${control}, too few to call it reproduced.`;
  const bound = percent(failureRateUpperBound(result.matchingFailures, result.runs));
  return `Not reproduced: ${under}${control}. ${result.runs} runs only show it fails in fewer than ${bound} of runs under it, so a rarer flake can still come from it; the lab runs it after the untested suspects.`;
}

/** A suspect's lab result in a few words: `reproduced 7 of 10`, `not reproduced 0 of 10 (below 26%)`, `untested`. Pure. */
export function flakeSuspectLabShort(result: FlakeSuspectResult | null | undefined): string {
  if (!result) return 'untested';
  const counts = `${result.matchingFailures} of ${result.runs}`;
  if (result.verdict === 'reproduced') return `reproduced ${counts}`;
  if (result.verdict === 'amplified') return `amplified ${counts}`;
  return `not reproduced ${counts} (below ${percent(failureRateUpperBound(result.matchingFailures, result.runs))})`;
}
