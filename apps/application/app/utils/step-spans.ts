/**
 * Turn an execution's flat step list (the `steps` column) into positioned,
 * depth-nested spans for the workers timeline's per-test detail view.
 *
 * Depth is reconstructed from time-containment — a step whose window sits inside
 * another's is its child — which is exactly how a Perfetto/OTel track derives
 * nesting, so the in-app waterfall matches the Perfetto export without the
 * reporter having to persist a parent pointer. When start times are missing (an
 * older run), the steps are laid end-to-end from the test's start and the result
 * is flagged `estimated`.
 *
 * Pure and DOM-free so it can be unit-tested and shared by the composable.
 */
import type { PerformanceStep } from '~~/types/api';

/** One positioned, depth-tagged step span. */
export interface StepSpan {
  title: string;
  /** The step's target (rendered locator or URL), when carried separately. */
  subtitle?: string;
  category: string;
  /** `failed` when the step carried an error, else `passed`. */
  status: string;
  /** Absolute start time in ms, on the same clock as the execution's `startedAt`. */
  startTime: number;
  duration: number;
  /** 1-based nesting depth by time-containment; 1 is the top level under the test. */
  depth: number;
  failed: boolean;
  params?: Record<string, string | number | boolean>;
  location?: string;
  error?: string | null;
}

export interface StepSpanResult {
  spans: StepSpan[];
  /** Deepest nesting level; 0 when there are no spans. */
  maxDepth: number;
  /** True when positions were derived from durations because start times were missing. */
  estimated: boolean;
}

const EMPTY: StepSpanResult = { spans: [], maxDepth: 0, estimated: false };

/**
 * Build positioned, nested spans from an execution's steps. `testStartMs` is the
 * execution's absolute start, used only as the origin for the estimated layout.
 */
export function buildStepSpans(
  steps: readonly PerformanceStep[] | null | undefined,
  testStartMs: number,
): StepSpanResult {
  const list = (steps ?? []).filter((s): s is PerformanceStep => !!s && typeof s.title === 'string');
  if (list.length === 0) return EMPTY;

  const haveStart = list.every((s) => typeof s.startTime === 'number' && Number.isFinite(s.startTime));

  // Positions: real start times when every step has one, otherwise laid
  // end-to-end from the test start (flagged estimated).
  let cursor = testStartMs;
  const placed = list.map((step) => {
    const duration = typeof step.duration === 'number' && step.duration > 0 ? step.duration : 0;
    const startTime = haveStart ? (step.startTime as number) : cursor;
    cursor = startTime + duration;
    return { step, startTime, duration, end: startTime + duration };
  });

  // Depth by containment: walk the spans in start order (longest first on a tie
  // so a parent is seen before its children) and keep a stack of open ancestors.
  const depthByRef = new Map<(typeof placed)[number], number>();
  if (haveStart) {
    const ordered = [...placed].sort((a, b) => a.startTime - b.startTime || b.duration - a.duration);
    const stack: Array<(typeof placed)[number]> = [];
    for (const p of ordered) {
      while (stack.length && stack[stack.length - 1]!.end <= p.startTime) stack.pop();
      while (stack.length && p.end > stack[stack.length - 1]!.end) stack.pop();
      depthByRef.set(p, stack.length + 1);
      stack.push(p);
    }
  }

  let maxDepth = 0;
  const spans = placed.map((p): StepSpan => {
    const depth = depthByRef.get(p) ?? 1;
    if (depth > maxDepth) maxDepth = depth;
    const failed = Boolean(p.step.failed || p.step.error?.message);
    return {
      title: p.step.title,
      subtitle: p.step.subtitle ?? undefined,
      category: p.step.category || 'other',
      status: failed ? 'failed' : 'passed',
      startTime: p.startTime,
      duration: p.duration,
      depth,
      failed,
      params: p.step.params ?? undefined,
      location: p.step.location ?? undefined,
      error: p.step.error?.message ?? null,
    };
  });

  return { spans, maxDepth, estimated: !haveStart };
}
