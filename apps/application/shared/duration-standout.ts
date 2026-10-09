/**
 * When a duration on an execution's evidence stands out: the one rule the
 * timeline colors a step or a request by. A duration stands out when it lasts
 * at least `STANDOUT_MIN_MS` and takes at least `STANDOUT_SHARE` of the test,
 * so a test of quick steps colors none of them, and a request that held the
 * test up is the row the eye lands on.
 *
 * The module also holds the one "much slower" rule (`isMuchSlower`: twice as
 * long and at least 1 s longer) and the key a step is matched on from one
 * execution to another (`stepMatchKey`): the Attempts tab reads both when it
 * compares a failing attempt's steps to the passing one's.
 */
import { stepLabel } from '@piwitests/core/step-analysis';

/** The shortest duration that can stand out, in ms. */
export const STANDOUT_MIN_MS = 1000;

/** The smallest share of the test a duration must take to stand out. */
export const STANDOUT_SHARE = 1 / 3;

/** A duration is much slower than another when it is at least this many times as long… */
export const SLOWER_FACTOR = 2;

/** …and at least this many ms longer. */
export const SLOWER_MIN_DELTA_MS = 1000;

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

/** Whether `ms` is much slower than `thanMs`: at least `SLOWER_FACTOR` times as long and `SLOWER_MIN_DELTA_MS` longer. */
export function isMuchSlower(ms: number, thanMs: number): boolean {
  return ms - thanMs >= SLOWER_MIN_DELTA_MS && ms >= SLOWER_FACTOR * thanMs;
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

/** The fields a step is matched on from one execution to another. */
export interface MatchableStep {
  title?: unknown;
  /** The step's target (rendered locator or URL), carried separately by newer Playwright. */
  subtitle?: unknown;
  /** The step's curated params: what tells apart two steps that share a label. */
  params?: Record<string, string | number | boolean> | null;
}

/**
 * The key a step is matched on from one execution to another: its label (the
 * title and the target) and its params, so two `Click` steps on different
 * targets stay apart. A step without params matches on its label.
 */
export function stepMatchKey(step: MatchableStep): string {
  return `${stepLabel(step)}\x00${step.params ? JSON.stringify(step.params) : ''}`;
}
