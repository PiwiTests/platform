/**
 * The structure of a flattened Playwright step list: each step's parent, the
 * phase it ran in (setup, the test body, teardown), the step that actually
 * failed, and the steps Piwi's own capture added.
 *
 * Playwright reports steps as a tree: `Before Hooks` holds the `beforeAll` /
 * `beforeEach` hooks and the fixtures they set up, the test body follows, and
 * `After Hooks` (then `Worker Cleanup`) holds the teardown. A failing step marks
 * every step around it failed too, so the step that failed is the innermost one
 * of the first failing chain. Stored steps are flat: the tree is rebuilt from
 * each step's `depth` when every step records one, else from start times and
 * durations (a step contains the steps that run inside its span), else every
 * step is top level.
 */
import { stripAnsi } from './error-parse';

/** The fields of a stored step the structure reads. */
export interface TreeStepLike {
  title?: unknown;
  category?: unknown;
  failed?: boolean | null;
  /** `{ message }` as the reporter records it; a bare string on some older rows. */
  error?: { message?: unknown } | string | null;
  depth?: unknown;
  startTime?: unknown;
  duration?: unknown;
  location?: unknown;
}

/** Where a step ran: before the test body, in it, or after it. */
export type StepPhase = 'setup' | 'body' | 'teardown';

/** Where a failure happened when the failing step ran outside the test body. */
export interface FailureHookContext {
  phase: 'setup' | 'teardown';
  /** What failed, by its short name: `beforeAll`, `fixture "db"`, `hook "seed"`, or the phase itself. */
  hook: string;
}

/** Slack for millisecond rounding when a step's span is compared with its parent's. */
const SPAN_TOLERANCE_MS = 1;

const SETUP_CONTAINER_RE = /^before hooks$/i;
const TEARDOWN_CONTAINER_RE = /^(?:after hooks|worker cleanup|worker teardown)$/i;
const NAMED_HOOK_RE = /^(before|after)(each|all) hook$/i;
const FIXTURE_TITLE_RE = /^fixture\s+["“](.+)["”]$/i;

/** A step Piwi's capture attached (`Attach "piwi-…"`), and its own auto fixture. */
const CAPTURE_ATTACH_RE = /^attach\s+["“]piwi-/i;
const CAPTURE_FIXTURE_RE = /^fixture\s+["“]piwiCapture["”]$/i;
/** A capture read made through the reporter bundle (recorded by reporters that did not keep them internal). */
const CAPTURE_PROBE_TITLE_RE = /^(?:evaluate|aria snapshot|locator\.(?:evaluate|ariasnapshot)|page\.evaluate)\b/i;
const REPORTER_BUNDLE_RE = /[\\/](?:@piwitests[\\/]reporter|packages[\\/]reporter)[\\/]dist[\\/]/;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A stored step's error message, whichever shape the row keeps it in. */
function errorMessage(step: TreeStepLike): string {
  const error = step.error;
  if (typeof error === 'string') return error;
  return str(error?.message);
}

/** Whether a stored step failed: marked failed, or carrying an error. */
export function isFailedStep(step: TreeStepLike): boolean {
  return step.failed === true || errorMessage(step).trim().length > 0;
}

/**
 * Whether a step belongs to Piwi's own capture rather than to the test: its
 * `piwiCapture` fixture, an `Attach "piwi-…"` step, or a page read the capture
 * fixtures made through the reporter bundle.
 */
export function isCaptureStep(step: TreeStepLike): boolean {
  const title = str(step.title).trim();
  if (CAPTURE_ATTACH_RE.test(title) || CAPTURE_FIXTURE_RE.test(title)) return true;
  return CAPTURE_PROBE_TITLE_RE.test(title) && REPORTER_BUNDLE_RE.test(str(step.location));
}

/** Whether a step is one of Playwright's phase containers (`Before Hooks`, `After Hooks`, `Worker Cleanup`). */
export function isPhaseContainer(step: TreeStepLike): boolean {
  const title = str(step.title).trim();
  return SETUP_CONTAINER_RE.test(title) || TEARDOWN_CONTAINER_RE.test(title);
}

/** The parent index of every step, -1 for a top-level step. */
export function stepParents(steps: readonly TreeStepLike[]): number[] {
  const parents = steps.map(() => -1);
  if (steps.length === 0) return parents;

  if (steps.every((s) => num(s.depth) !== null)) {
    const stack: number[] = [];
    steps.forEach((step, i) => {
      const depth = num(step.depth)!;
      while (stack.length > 0 && num(steps[stack[stack.length - 1]!]!.depth)! >= depth) stack.pop();
      parents[i] = stack.length > 0 ? stack[stack.length - 1]! : -1;
      stack.push(i);
    });
    return parents;
  }

  if (steps.every((s) => num(s.startTime) !== null && num(s.duration) !== null)) {
    const start = (i: number) => num(steps[i]!.startTime)!;
    const end = (i: number) => start(i) + Math.max(0, num(steps[i]!.duration)!);
    // A step contains a later one that starts before it ends and finishes by
    // its end; a zero-length step contains nothing. Millisecond timestamps
    // leave a zero-length step at a parent's last instant ambiguous: it is read
    // as the parent's next sibling.
    const contains = (a: number, b: number) =>
      end(a) > start(a) &&
      start(b) >= start(a) - SPAN_TOLERANCE_MS &&
      start(b) < end(a) &&
      end(b) <= end(a) + SPAN_TOLERANCE_MS;
    const stack: number[] = [];
    steps.forEach((_, i) => {
      while (stack.length > 0 && !contains(stack[stack.length - 1]!, i)) stack.pop();
      parents[i] = stack.length > 0 ? stack[stack.length - 1]! : -1;
      stack.push(i);
    });
  }
  return parents;
}

/** Whether step `descendant` sits somewhere under step `ancestor`. */
function isDescendant(descendant: number, ancestor: number, parents: readonly number[]): boolean {
  for (let p = parents[descendant] ?? -1; p !== -1; p = parents[p] ?? -1) {
    if (p === ancestor) return true;
  }
  return false;
}

/** The top-level step each step sits under (itself when top level). */
function topAncestor(index: number, parents: readonly number[]): number {
  let top = index;
  while ((parents[top] ?? -1) !== -1) top = parents[top]!;
  return top;
}

/**
 * The phase every step ran in: a step under `Before Hooks` ran in setup, one
 * under `After Hooks` or `Worker Cleanup` in teardown, the rest in the test
 * body. The containers themselves take the phase they hold.
 */
export function stepPhases(steps: readonly TreeStepLike[], parents = stepParents(steps)): StepPhase[] {
  return steps.map((_, i) => {
    const top = str(steps[topAncestor(i, parents)]!.title).trim();
    if (SETUP_CONTAINER_RE.test(top)) return 'setup';
    if (TEARDOWN_CONTAINER_RE.test(top)) return 'teardown';
    return 'body';
  });
}

/**
 * The step that failed: the innermost step of the first failing chain, skipping
 * the capture's own steps. Null when no step failed.
 */
export function failingStepIndex(steps: readonly TreeStepLike[], parents = stepParents(steps)): number | null {
  const candidates: number[] = [];
  steps.forEach((step, i) => {
    if (isFailedStep(step) && !isCaptureStep(step)) candidates.push(i);
  });
  if (candidates.length === 0) return null;
  let current = candidates[0]!;
  for (;;) {
    const inner = candidates.find((c) => c > current && isDescendant(c, current, parents));
    if (inner === undefined) return current;
    current = inner;
  }
}

/** The hook or fixture a step is, by its short name (`beforeAll`, `fixture "db"`); null for any other step. */
export function stepHookName(step: TreeStepLike): string | null {
  const title = str(step.title).trim();
  const category = str(step.category);
  const named = NAMED_HOOK_RE.exec(title);
  if (named) return `${named[1]!.toLowerCase()}${named[2]![0]!.toUpperCase()}${named[2]!.slice(1).toLowerCase()}`;
  const fixture = FIXTURE_TITLE_RE.exec(title);
  if (fixture) return `fixture "${fixture[1]}"`;
  if (category === 'fixture') return title ? `fixture "${title.replace(/^fixture:\s*/i, '')}"` : null;
  if (category === 'hook' && title && !isPhaseContainer(step)) return `hook "${title}"`;
  return null;
}

/** The first line of an error message, without ANSI codes. */
function firstLine(message: unknown): string {
  return stripAnsi(str(message)).split('\n')[0]!.trim();
}

/**
 * Where the failure happened when it happened in a hook or a fixture rather
 * than in the test body: the phase, and the innermost hook or fixture around
 * the failing step. `error` is the execution's own error — when given, the
 * failing step must carry that error, so a teardown failure that followed an
 * error in the body is never named as the failure. Null for a failure in the
 * body, or when no step failed.
 */
export function failureHookContext(
  steps: readonly TreeStepLike[],
  error?: string | null,
  parents = stepParents(steps),
): FailureHookContext | null {
  const index = failingStepIndex(steps, parents);
  if (index === null) return null;
  const phase = stepPhases(steps, parents)[index]!;
  if (phase === 'body') return null;
  if (error != null) {
    const stepError = firstLine(errorMessage(steps[index]!));
    if (stepError && firstLine(error) !== stepError) return null;
  }
  for (let i: number = index; i !== -1; i = parents[i] ?? -1) {
    const name = stepHookName(steps[i]!);
    if (name) return { phase, hook: name };
  }
  return { phase, hook: phase };
}
