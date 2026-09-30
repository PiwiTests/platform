/**
 * The lab's arithmetic: a one-sided Fisher exact test of an arm against its
 * control, the verdict rule built on it, and how many clean runs verify a fix.
 * Pure, shared by the command line (which prints a verdict without the
 * dashboard) and the dashboard (which stores it).
 */

/** Significance level for a verdict and confidence level for a verification. */
export const FLAKE_SIGNIFICANCE = 0.05;

/** An arm is reproduced only at or above this rate of matching failures. */
export const FLAKE_REPRODUCED_RATE = 0.5;

/** The fewest clean runs that verify a fix, however high the reproduced rate. */
export const FLAKE_VERIFY_MIN_RUNS = 5;

/** Natural log of n!, summed directly (the counts here stay small). */
function logFactorial(n: number): number {
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function assertCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a whole number from 0`);
}

/**
 * One-sided Fisher exact test: the probability, with every margin fixed, of the
 * arm having at least `armFailures` of all the failures by chance. Small when
 * the arm fails more often than its control.
 */
export function fisherExactGreater(
  armFailures: number,
  armRuns: number,
  controlFailures: number,
  controlRuns: number,
): number {
  assertCount(armFailures, 'armFailures');
  assertCount(armRuns, 'armRuns');
  assertCount(controlFailures, 'controlFailures');
  assertCount(controlRuns, 'controlRuns');
  if (armFailures > armRuns || controlFailures > controlRuns) throw new RangeError('failures cannot exceed runs');
  const failures = armFailures + controlFailures;
  const total = armRuns + controlRuns;
  const denominator = logChoose(total, failures);
  const highest = Math.min(armRuns, failures);
  let p = 0;
  for (let k = armFailures; k <= highest; k++) {
    if (failures - k > controlRuns) continue;
    p += Math.exp(logChoose(armRuns, k) + logChoose(controlRuns, failures - k) - denominator);
  }
  return Math.min(1, p);
}

export type FlakeVerdict = 'reproduced' | 'amplified' | 'not-reproduced';

export interface FlakeArmCounts {
  /** Runs of the arm, and how many failed with a signature seen in history. */
  runs: number;
  matchingFailures: number;
}

export interface FlakeArmVerdict {
  verdict: FlakeVerdict;
  /** The arm's rate of matching failures (0 with no runs). */
  rate: number;
  pValue: number;
}

/**
 * The verdict for one arm against its control: **reproduced** when the arm's
 * rate of matching failures is at least half and the one-sided Fisher test
 * gives p < 0.05; **amplified** when p < 0.05 at a lower rate; **not
 * reproduced** otherwise. Only matching failures count on either side.
 */
export function flakeArmVerdict(arm: FlakeArmCounts, control: FlakeArmCounts): FlakeArmVerdict {
  const pValue = fisherExactGreater(arm.matchingFailures, arm.runs, control.matchingFailures, control.runs);
  const rate = arm.runs > 0 ? arm.matchingFailures / arm.runs : 0;
  const significant = pValue < FLAKE_SIGNIFICANCE;
  const verdict: FlakeVerdict =
    significant && rate >= FLAKE_REPRODUCED_RATE ? 'reproduced' : significant ? 'amplified' : 'not-reproduced';
  return { verdict, rate, pValue };
}

/**
 * How many runs without a matching failure verify a fix, for an arm that
 * reproduced at `rate`: enough that a failure at that rate would have shown
 * with 95% confidence, `⌈ln 0.05 / ln(1 − rate)⌉`, and at least 5.
 */
export function flakeVerifyRuns(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) throw new RangeError('rate must be above 0 and at most 1');
  if (rate === 1) return FLAKE_VERIFY_MIN_RUNS;
  // Rounded before the ceiling so a count that is whole in exact arithmetic
  // (rate 0.5 needs ln 0.05 / ln 0.5 = 4.32…, rate 0.95 exactly 1) is not
  // pushed up by floating-point noise.
  const exact = Math.log(FLAKE_SIGNIFICANCE) / Math.log(1 - rate);
  return Math.max(FLAKE_VERIFY_MIN_RUNS, Math.ceil(Number(exact.toFixed(9))));
}

/** A fix holds when the arm ran at least {@link flakeVerifyRuns} times with no matching failure. */
export function flakeFixVerified(verify: FlakeArmCounts, reproducedRate: number): boolean {
  return verify.matchingFailures === 0 && verify.runs >= flakeVerifyRuns(reproducedRate);
}
