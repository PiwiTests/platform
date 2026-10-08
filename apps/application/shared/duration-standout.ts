/**
 * When a duration on an execution's evidence stands out: the one rule the
 * timeline colors a step or a request by. A duration stands out when it lasts
 * at least `STANDOUT_MIN_MS` and takes at least `STANDOUT_SHARE` of the test,
 * so a test of quick steps colors none of them, and a request that held the
 * test up is the row the eye lands on.
 */

/** The shortest duration that can stand out, in ms. */
export const STANDOUT_MIN_MS = 1000;

/** The smallest share of the test a duration must take to stand out. */
export const STANDOUT_SHARE = 1 / 3;

/** Why a duration stands out: `share`, it takes a large part of the test. */
export type DurationStandoutReason = 'share';

export interface DurationStandout {
  reason: DurationStandoutReason;
  /** The duration's share of the test: 0.41 for 41%, above 1 for a request that outlasts the test. */
  share: number;
}

export interface DurationStandoutInput {
  /** The duration, in ms. */
  ms: number | null | undefined;
  /** The test's duration, in ms; without one, nothing stands out by share. */
  testMs: number | null | undefined;
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Whether a duration stands out in its test, and why; null when it does not. */
export function durationStandout({ ms, testMs }: DurationStandoutInput): DurationStandout | null {
  if (!positive(ms) || ms < STANDOUT_MIN_MS || !positive(testMs)) return null;
  const share = ms / testMs;
  return share >= STANDOUT_SHARE ? { reason: 'share', share } : null;
}

/** Why a duration stands out, in words: `41% of the test`, or `longer than the whole test`. */
export function standoutReasonText(standout: DurationStandout): string {
  return standout.share > 1 ? 'longer than the whole test' : `${Math.round(standout.share * 100)}% of the test`;
}

/**
 * A duration's share of the test as a label: `19%`, `<1%` for a sliver, and
 * `>100%` for a request that outlasts the test. Empty without a test duration.
 */
export function shareOfTestLabel(ms: number | null | undefined, testMs: number | null | undefined): string {
  if (!positive(testMs)) return '';
  const pct = ((positive(ms) ? ms : 0) / testMs) * 100;
  if (pct > 100) return '>100%';
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}
