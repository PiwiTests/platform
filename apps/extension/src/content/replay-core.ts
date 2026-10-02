import type { RecordedStep, StepAssertion } from '@piwitests/core/recording';
import { t, tn } from '../shared/i18n.js';
import type { ReplayEvidence, ReplayState, ReplayStepResult } from '../shared/replay-storage.js';

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

/** A page text quoted the interface language's way: `"Total: 40"`, `« Total: 40 »`. */
export function quoted(text: string): string {
  return t('replay_quotedText', { text });
}

/** What an assertion found, in words: `"Total: 40"`, `hidden`, `nothing on the page`. */
function foundText(assertion: StepAssertion, o: Observation): string {
  if (assertion.matcher === 'toHaveURL') return o.url;
  if (o.count === 0) return t('replay_foundMissing');
  if (o.count > 1) return tn('replay_foundCount', o.count);
  switch (assertion.matcher) {
    case 'toHaveText':
      return quoted(normalizeText(o.text ?? ''));
    case 'toHaveValue':
      return quoted(o.value ?? '');
    case 'toHaveAccessibleName':
      return quoted(normalizeText(o.name ?? ''));
    case 'toBeVisible':
    case 'toBeHidden':
      return o.visible ? t('replay_foundVisible') : t('replay_foundHidden');
    case 'toBeEnabled':
    case 'toBeDisabled':
      return o.enabled ? t('replay_foundEnabled') : t('replay_foundDisabled');
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
    const sameAsReported = actual != null && (found === quoted(normalizeText(actual)) || found === actual);
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
      const step = verdict.step + 1;
      const found = verdict.found;
      let detail: string;
      if (expected != null) {
        detail = verdict.sameAsReported
          ? t('replay_verdictExpectedFoundAsReported', { step, expected, found })
          : t('replay_verdictExpectedFound', { step, expected, found });
      } else {
        detail = verdict.sameAsReported
          ? t('replay_verdictFoundAsReported', { step, found })
          : t('replay_verdictFound', { step, found });
      }
      return { title: t('replay_verdictReproduced'), detail };
    }
    case 'not-reproduced':
      return { title: t('replay_verdictNotReproduced'), detail: t('replay_verdictNotReproducedDetail') };
    case 'diverged':
      return {
        title: t('replay_verdictDiverged', { step: verdict.step + 1 }),
        detail: t('replay_verdictDivergedDetail', { reason: verdict.reason }),
      };
    case 'completed':
      return { title: t('replay_verdictCompleted'), detail: t('replay_verdictCompletedDetail') };
    case 'stopped':
      return {
        title: t('replay_verdictStopped'),
        detail: t('replay_verdictStoppedDetail', { step: verdict.step + 1 }),
      };
  }
}

/** How the replay acts on the page, in words: trusted input, or the page's own events and why. */
export function driverText(choice: ReplayState['driver']): string {
  if (!choice) return '';
  if (choice.driver === 'cdp') return t('replay_driverTrusted');
  switch (choice.reason) {
    case 'unavailable':
      return t('replay_driverEventsUnavailable');
    case 'canceled':
      return t('replay_driverEventsCanceled');
    case 'lost':
      return t('replay_driverEventsLost');
    default:
      return t('replay_driverEventsRefused');
  }
}

export interface Waker {
  /** Resolves on the next `wake`, or at once when one came since the last wait. */
  wait(): Promise<void>;
  /**
   * Waits for the next wake or for `other`, whichever comes first. When
   * `other` does, the wait ends there, and a wake that comes with it or after
   * it is kept for the next wait.
   */
  until<T>(other: Promise<T>): Promise<{ woken: true } | { woken: false; value: T }>;
  wake(): void;
  /** Lets a wait in progress through, and keeps nothing when the loop is busy. */
  wakeWaiting(): void;
  /** Forgets a wake that came before this loop started. */
  reset(): void;
}

/**
 * What the replay loop waits on in step mode and when paused: Next, turning
 * step mode off or Stop, kept when they come while the loop is still busy
 * with a step (waiting for the page to settle) rather than lost with the loop
 * left waiting for a click already made. Pause and Continue only let a wait
 * in progress through: a busy loop reads them from the state at its next
 * step, and a kept wake would play the step after it without its Next.
 */
export function createWaker(): Waker {
  let release: (() => void) | null = null;
  let early = false;
  const wait = (): Promise<void> => {
    if (early) {
      early = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      release = () => {
        release = null;
        resolve();
      };
    });
  };
  return {
    wait,
    async until<T>(other: Promise<T>) {
      let woken = false;
      const waiting = wait().then(() => {
        woken = true;
      });
      const ours = release;
      const first = await Promise.race([
        waiting.then(() => ({ woken: true }) as const),
        other.then((value) => ({ woken: false, value }) as const),
      ]);
      if (!first.woken) {
        if (release === ours) release = null;
        if (woken) early = true;
      }
      return first;
    },
    wake() {
      if (release) release();
      else early = true;
    },
    wakeWaiting() {
      release?.();
    },
    reset() {
      early = false;
    },
  };
}

/** Lines of evidence shown under a verdict; more are counted. */
const EVIDENCE_SHOWN = 5;

/**
 * What the page showed during the replay, as lines under the verdict: failed
 * requests first ("POST /api/cart/coupon answered 500"), then console errors.
 * Empty when it showed nothing.
 */
export function evidenceLines(evidence: ReplayEvidence | null): { lines: string[]; more: number } {
  if (!evidence) return { lines: [], more: 0 };
  const all = [
    ...evidence.requests.map((r) =>
      r.status
        ? t('replay_seenRequest', { method: r.method, url: r.url, status: String(r.status) })
        : t('replay_seenRequestFailed', { method: r.method, url: r.url }),
    ),
    ...evidence.console.filter((c) => c.level === 'error').map((c) => t('replay_seenConsole', { message: c.message })),
  ];
  return { lines: all.slice(0, EVIDENCE_SHOWN), more: Math.max(0, all.length - EVIDENCE_SHOWN) };
}
