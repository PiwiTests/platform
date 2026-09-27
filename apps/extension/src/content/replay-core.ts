import type { RecordedStep, StepAssertion } from '@piwitests/core/recording';
import type { ReplayStepResult } from '../shared/replay-storage.js';

/**
 * The replay's decisions, apart from the page: whether an assertion holds on
 * what the page shows, and what a finished replay says about the bug.
 */

/** What the page shows for an assertion's element (or for the page itself). */
export interface Observation {
  /** How many elements the step's locator finds. */
  count: number;
  /** The first element's text, value, name and states. */
  text: string | null;
  value: string | null;
  name: string | null;
  visible: boolean;
  enabled: boolean;
  /** The page's address. */
  url: string;
}

/** Whitespace collapsed and trimmed, as Playwright compares text. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** An expected URL made absolute on the replay's origin: a path is joined to it, a full URL is kept. */
export function absoluteUrl(expected: string, origin: string): string {
  try {
    return new URL(expected, `${origin}/`).href;
  } catch {
    return expected;
  }
}

/** What an assertion found, in words: `"Total: 40"`, `hidden`, `not on the page`. */
function foundText(assertion: StepAssertion, o: Observation): string {
  if (assertion.matcher === 'toHaveURL') return o.url;
  if (o.count === 0) return 'not on the page';
  if (o.count > 1) return `${o.count} elements`;
  switch (assertion.matcher) {
    case 'toHaveText':
      return `"${normalizeText(o.text ?? '')}"`;
    case 'toHaveValue':
      return `"${o.value ?? ''}"`;
    case 'toHaveAccessibleName':
      return `"${normalizeText(o.name ?? '')}"`;
    case 'toBeVisible':
    case 'toBeHidden':
      return o.visible ? 'visible' : 'hidden';
    case 'toBeEnabled':
    case 'toBeDisabled':
      return o.enabled ? 'enabled' : 'disabled';
  }
}

/**
 * Whether an assertion holds on an observation, with Playwright's rules: text
 * and names compare whole after collapsing whitespace, values compare exactly,
 * a URL compares in full, and an element that is not there is hidden.
 */
export function evaluateAssertion(
  assertion: StepAssertion,
  o: Observation,
  origin: string,
): { holds: boolean; found: string } {
  const expected = assertion.expected ?? '';
  const one = o.count === 1;
  let positive: boolean;
  switch (assertion.matcher) {
    case 'toHaveText':
      positive = one && normalizeText(o.text ?? '') === normalizeText(expected);
      break;
    case 'toHaveValue':
      positive = one && (o.value ?? '') === expected;
      break;
    case 'toHaveAccessibleName':
      positive = one && normalizeText(o.name ?? '') === normalizeText(expected);
      break;
    case 'toBeVisible':
      positive = one && o.visible;
      break;
    case 'toBeHidden':
      positive = o.count === 0 || (one && !o.visible);
      break;
    case 'toBeEnabled':
      positive = one && o.enabled;
      break;
    case 'toBeDisabled':
      positive = one && !o.enabled;
      break;
    case 'toHaveURL':
      positive = o.url === absoluteUrl(expected, origin);
      break;
  }
  return { holds: assertion.negated ? !positive : positive, found: foundText(assertion, o) };
}

export type ReplayVerdict =
  | { kind: 'reproduced'; step: number; found: string; sameAsReported: boolean }
  | { kind: 'not-reproduced' }
  | { kind: 'diverged'; step: number; reason: string }
  | { kind: 'completed' }
  | { kind: 'stopped'; step: number };

/**
 * What a finished replay says. A step that could not be done means the page
 * differs here (diverged). Otherwise a bug report's expected result that does
 * not hold is the bug showing (reproduced), and every one holding means it did
 * not show. A recording with nothing expected just completed.
 */
export function replayVerdict(steps: RecordedStep[], results: ReplayStepResult[], stopped: boolean): ReplayVerdict {
  const diverged = results.findIndex((r) => r?.status === 'diverged');
  if (diverged >= 0) return { kind: 'diverged', step: diverged, reason: results[diverged]!.detail ?? '' };
  const failed = results.findIndex((r) => r?.status === 'failed');
  if (failed >= 0) {
    const found = results[failed]!.found ?? '';
    const actual = steps[failed]?.assertion?.actual;
    const sameAsReported = actual != null && (found === `"${normalizeText(actual)}"` || found === actual);
    return { kind: 'reproduced', step: failed, found, sameAsReported };
  }
  if (stopped) return { kind: 'stopped', step: results.length };
  return steps.some((s) => s.action === 'assert' || s.action === 'assertVisible')
    ? { kind: 'not-reproduced' }
    : { kind: 'completed' };
}

/** The verdict as the replay panel says it. */
export function verdictText(verdict: ReplayVerdict, steps: RecordedStep[]): { title: string; detail: string } {
  switch (verdict.kind) {
    case 'reproduced': {
      const expected = steps[verdict.step]?.assertion?.expected;
      const wanted = expected != null ? `expected "${expected}", ` : '';
      return {
        title: 'Reproduced: the bug shows here',
        detail: `Step ${verdict.step + 1}: ${wanted}found ${verdict.found}${verdict.sameAsReported ? ', as reported' : ''}.`,
      };
    }
    case 'not-reproduced':
      return { title: 'Not reproduced', detail: 'Every expected result holds on this page.' };
    case 'diverged':
      return {
        title: `Could not reach the bug: stopped at step ${verdict.step + 1}`,
        detail: `${verdict.reason} The page differs here: other data, another login, a flag.`,
      };
    case 'completed':
      return { title: 'Replayed every step', detail: 'Nothing in these steps says what to expect.' };
    case 'stopped':
      return { title: 'Stopped', detail: `Stopped before step ${verdict.step + 1}.` };
  }
}
