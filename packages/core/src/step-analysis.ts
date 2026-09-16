/**
 * Playwright step analysis: categorisation, flattening and the derived
 * per-case metrics (slowest step, wasted time, timeline events).
 *
 * Shared because two producers must agree on the shape: the reporter reads
 * `result.steps` from a live run, and the server rebuilds the same structures
 * from an imported blob report's step events.
 */
import { maskTokenLike } from './mask';

/** Max param keys kept per step. */
export const MAX_STEP_PARAM_KEYS = 20;
/** Max characters kept per stored param value. */
export const MAX_STEP_PARAM_VALUE_CHARS = 200;

/**
 * Categorise a Playwright step into `navigation`, `action`, `input`,
 * `assertion`, `wait`, `api`, `hook`, or `other`.
 *
 * Supports two title formats:
 *  - Legacy api-path titles ("page.goto", "locator.click", "page.waitForTimeout")
 *  - Modern human-readable titles introduced in newer Playwright versions
 *    ("Navigate to \"{url}\"", "Click", "Wait for timeout", "Wait for load state").
 * Hook/fixture/expect steps are detected via Playwright's own `category`.
 *
 * `params` is Playwright's curated per-step argument object (the rendered
 * `locator`, a navigation's `url`, …). When present it is the exact signal for
 * a step's kind, preferred over parsing a title that newer Playwright reduced
 * to a bare verb.
 */
export function categorizeStep(title: string, pwCategory?: string, params?: Record<string, unknown>): string {
  if (!title) return 'other';
  if (pwCategory === 'hook' || pwCategory === 'fixture') return pwCategory;
  if (pwCategory === 'expect') return 'assertion';
  const lower = title.toLowerCase();

  // Waits — modern "Wait for timeout/function/selector/state/navigation/load state/url/event"
  // and legacy "*.waitFor*" (locator.waitFor, page.waitForLoadState, frame.waitForTimeout, ...).
  if (
    lower.startsWith('wait for') ||
    lower.startsWith('locator.waitfor') ||
    lower.startsWith('page.waitfor') ||
    lower.startsWith('frame.waitfor')
  )
    return 'wait';

  // A rendered `params.url` is a goto step's exact navigation signal; prefer it
  // over the title, which recent Playwright reduced to a bare "Navigate".
  if (typeof params?.url === 'string' && pwCategory !== 'expect') return 'navigation';

  // Navigation — modern "Navigate"/"Navigate to ...", "Go back", "Go forward", "Reload"; legacy "page.goto" etc.
  if (
    lower.startsWith('navigate') ||
    lower.startsWith('go back') ||
    lower.startsWith('go forward') ||
    lower.startsWith('reload') ||
    lower.startsWith('page.goto') ||
    lower.startsWith('page.reload') ||
    lower.startsWith('page.goback') ||
    lower.startsWith('page.goforward')
  )
    return 'navigation';

  // Actions — clicks, taps, checks, selects, hovers
  if (
    lower.startsWith('click') ||
    lower.startsWith('double click') ||
    lower.startsWith('check') ||
    lower.startsWith('uncheck') ||
    lower.startsWith('tap') ||
    lower.startsWith('hover') ||
    lower.startsWith('select option') ||
    lower.startsWith('drag') ||
    lower.startsWith('locator.click') ||
    lower.startsWith('locator.dblclick') ||
    lower.startsWith('locator.check') ||
    lower.startsWith('locator.uncheck') ||
    lower.startsWith('locator.selectoption') ||
    lower.startsWith('locator.tap')
  )
    return 'action';

  // Input — fill, type, press, insert text, set input files
  if (
    lower.startsWith('fill ') ||
    lower === 'fill' ||
    lower.startsWith('type') ||
    lower.startsWith('press') ||
    lower.startsWith('insert ') ||
    lower.startsWith('set input files') ||
    lower.startsWith('locator.fill') ||
    lower.startsWith('locator.type') ||
    lower.startsWith('locator.press') ||
    lower.startsWith('locator.clear') ||
    lower.startsWith('locator.setinputfiles')
  )
    return 'input';

  // Assertions — legacy "expect..." titles (modern ones caught via pwCategory above)
  if (lower.startsWith('expect') || lower.startsWith('locator.expect') || lower.startsWith('page.expect'))
    return 'assertion';

  if (lower.startsWith('apirequestcontext') || lower.startsWith('apiresponse')) return 'api';
  if (lower === 'before hooks' || lower === 'after hooks' || lower.startsWith('fixture:')) return 'hook';
  return 'other';
}

/** A single step flattened from the Playwright step tree with its derived category */
export interface FlatStep {
  title: string;
  duration: number;
  category: string;
  /**
   * The step's target, carried separately from the title by newer Playwright:
   * the rendered locator, or a navigation's URL. Composed with the title by
   * {@link stepLabel}.
   */
  subtitle?: string;
  /**
   * Curated per-step arguments: the rendered `locator`, a navigation `url`, an
   * action's `button`/`value`, or a `test.step` author's own values. Primitives
   * are kept as-is; anything else is JSON-stringified. Capped and masked.
   */
  params?: Record<string, string | number | boolean>;
  /** Error message when the step failed (undefined when the step passed). */
  error?: { message: string };
  /** True when the step carried an error — the signal the server needs for inline failure markers. */
  failed?: boolean;
  /** Source pointer `file:line:col` (not a code snippet); present when Playwright reports one. */
  location?: string;
  /** Absolute start time in ms; enables per-step timing/waterfall on the case detail page. */
  startTime?: number;
}

/**
 * A step's display label: the title followed by its subtitle when the subtitle
 * carries a target not already spelled out in the title. The one place the
 * 1.61 (`Click getByRole(…)`) and newer (`Click` + subtitle) title shapes
 * converge, so every consumer labels a step the same way on both.
 */
export function stepLabel(step: { title?: unknown; subtitle?: unknown }): string {
  const title = typeof step.title === 'string' ? step.title : '';
  const subtitle = typeof step.subtitle === 'string' ? step.subtitle.trim() : '';
  if (!subtitle) return title;
  if (!title) return subtitle;
  return title.includes(subtitle) ? title : `${title} ${subtitle}`;
}

/**
 * The title and subtitle split for two-element display: the title, and the
 * subtitle only when it adds a target the title does not already spell out.
 * The visual counterpart of {@link stepLabel} (which joins the same two parts
 * into one plain-text string) — a renderer shows `title` then a muted
 * `subtitle`, and joining them with a space reproduces `stepLabel`.
 */
export function stepLabelParts(step: { title?: unknown; subtitle?: unknown }): {
  title: string;
  subtitle: string | null;
} {
  const title = typeof step.title === 'string' ? step.title : '';
  const subtitle = typeof step.subtitle === 'string' ? step.subtitle.trim() : '';
  if (!subtitle) return { title, subtitle: null };
  if (!title) return { title: subtitle, subtitle: null };
  return title.includes(subtitle) ? { title, subtitle: null } : { title, subtitle };
}

/**
 * A step's params in display order: the rendered `locator` first (it is the
 * step's subject), then the remaining keys in insertion order. Used by the
 * params disclosure and the analysis lines so every surface lists them the same
 * way. Returns an empty array when the step carries none.
 */
export function orderedStepParams(
  params: Record<string, string | number | boolean> | null | undefined,
): Array<[string, string | number | boolean]> {
  if (!params || typeof params !== 'object') return [];
  const entries = Object.entries(params);
  return entries.sort(([a], [b]) => (a === 'locator' ? -1 : b === 'locator' ? 1 : 0));
}

/**
 * Normalize a step's raw `params`: keep primitives as they are, JSON-stringify
 * anything else, mask token-shaped strings, and cap both the key count and each
 * value's length. Returns undefined when nothing survives.
 */
function normalizeStepParams(raw: unknown): Record<string, string | number | boolean> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_STEP_PARAM_KEYS) break;
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      count++;
    } else if (typeof value === 'string') {
      out[key] = maskTokenLike(value).slice(0, MAX_STEP_PARAM_VALUE_CHARS);
      count++;
    } else if (value != null) {
      try {
        out[key] = maskTokenLike(JSON.stringify(value)).slice(0, MAX_STEP_PARAM_VALUE_CHARS);
        count++;
      } catch {
        // Non-serializable (circular) values are dropped.
      }
    }
  }
  return count > 0 ? out : undefined;
}

/** Step-event category restricted to the values `extractTestStepEvents` emits. */
export type StepEventCategory = 'hook' | 'fixture' | 'test.step' | 'expect' | 'wait';

/** Recursively flatten a nested step tree into a flat list. Uses Playwright's built-in category when available. */
export function flattenSteps(steps: any[]): FlatStep[] {
  const result: FlatStep[] = [];
  for (const step of steps) {
    const flat: FlatStep = {
      title: step.title,
      duration: step.duration,
      category: categorizeStep(step.title, step.category, step.params),
    };
    if (typeof step.subtitle === 'string' && step.subtitle.length > 0) flat.subtitle = maskTokenLike(step.subtitle);
    const params = normalizeStepParams(step.params);
    if (params) flat.params = params;
    if (step.error?.message) {
      flat.error = { message: step.error.message };
      flat.failed = true;
    }
    if (step.location) flat.location = `${step.location.file}:${step.location.line}:${step.location.column}`;
    if (step.startTime) flat.startTime = step.startTime instanceof Date ? step.startTime.getTime() : step.startTime;
    result.push(flat);
    if (step.steps?.length > 0) result.push(...flattenSteps(step.steps));
  }
  return result;
}

/** Aggregated step performance data for a single test case */
export interface StepMetrics {
  /** Flattened step list with categories */
  steps: FlatStep[];
  /** Sum of top-level step durations */
  totalStepDuration: number;
  /** The single slowest step (by duration) */
  slowestStep: { title: string; duration: number } | null;
  /** How many navigation steps were executed */
  navigationCount: number;
  /** Total wall-clock time spent in navigation steps */
  navigationTotalDuration: number;
  /** Total wall-clock time spent in wait steps (wasted time) */
  waitTotalDuration: number;
  /** Count of wait steps */
  waitCount: number;
}

/** Collect step metrics (flat steps, slowest step, navigation stats) from a Playwright step array */
export function collectStepMetrics(steps: any[]): StepMetrics {
  const flatSteps = flattenSteps(steps);
  const totalStepDuration = steps.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);

  let slowestStep: { title: string; duration: number } | null = null;
  for (const s of flatSteps) {
    if (!slowestStep || s.duration > slowestStep.duration) slowestStep = { title: s.title, duration: s.duration };
  }

  const navSteps = flatSteps.filter((s) => s.category === 'navigation');
  const waitSteps = flatSteps.filter((s) => s.category === 'wait');
  const waitTotalDuration = waitSteps.reduce((sum, s) => sum + (s.duration || 0), 0);

  return {
    steps: flatSteps,
    totalStepDuration,
    slowestStep,
    navigationCount: navSteps.length,
    navigationTotalDuration: navSteps.reduce((sum: number, s) => sum + (s.duration || 0), 0),
    waitTotalDuration,
    waitCount: waitSteps.length,
  };
}

/** Calculate the p-th percentile from a sorted array of numbers */
export function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.min(sortedArr.length - 1, Math.max(0, Math.ceil((p / 100) * sortedArr.length) - 1));
  return sortedArr[index]!;
}

/** Summary performance statistics for a complete test run */
export interface PerformanceSummary {
  /** Average test-case duration in ms */
  avgTestDuration?: number;
  /** Median (P50) test-case duration in ms */
  p50TestDuration?: number;
  /** P90 test-case duration in ms */
  p90TestDuration?: number;
  /** P95 test-case duration in ms */
  p95TestDuration?: number;
  /** Up to 5 slowest test cases */
  slowestTests?: Array<{ title: string; duration: number }>;
  /** Total time spent in navigation steps across all cases */
  totalNavigationDuration?: number;
  /** Average time per navigation step */
  avgNavigationDuration?: number;
  /** Total time spent in wait steps across all cases */
  totalWastedTimeMs?: number;
}

/** Compute run-level performance summary (averages, percentiles, slowest tests) from all test cases */
export function computePerformanceSummary(testCases: any[]): PerformanceSummary {
  const durations = testCases.filter((tc: any) => tc.duration != null).map((tc: any) => tc.duration);

  if (durations.length === 0) return {};

  const sorted = [...durations].sort((a: number, b: number) => a - b);
  const sum = durations.reduce((a: number, b: number) => a + b, 0);

  const result: PerformanceSummary = {
    avgTestDuration: Math.round(sum / durations.length),
    p50TestDuration: percentile(sorted, 50),
    p90TestDuration: percentile(sorted, 90),
    p95TestDuration: percentile(sorted, 95),
    slowestTests: [...testCases]
      .filter((tc: any) => tc.duration != null)
      .sort((a: any, b: any) => b.duration - a.duration)
      .slice(0, 5)
      .map((tc: any) => ({ title: tc.title, duration: tc.duration })),
  };

  let totalNavDur = 0;
  let totalNavCount = 0;
  for (const tc of testCases) {
    if (tc.performanceMetrics) {
      totalNavDur += tc.performanceMetrics.navigationTotalDuration || 0;
      totalNavCount += tc.performanceMetrics.navigationCount || 0;
    }
  }

  result.totalNavigationDuration = totalNavDur;
  result.avgNavigationDuration = totalNavCount > 0 ? Math.round(totalNavDur / totalNavCount) : 0;

  let totalWasted = 0;
  for (const tc of testCases) {
    if (tc.performanceMetrics) {
      totalWasted += tc.performanceMetrics.waitTotalDuration || 0;
    }
  }
  result.totalWastedTimeMs = totalWasted;

  return result;
}

/**
 * Extract hook and fixture step events with absolute timings from a Playwright
 * step tree. These are used by the WorkersTimeline to render hook segments.
 *
 * Returns only top-level hook/fixture steps (beforeEach, afterEach, fixture
 * setup/teardown) — their sub-steps are included implicitly in their duration.
 */
export function extractTestStepEvents(
  steps: any[],
  _testStartTime: Date,
): Array<{
  title: string;
  category: StepEventCategory;
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
}> {
  const events: Array<{
    title: string;
    category: StepEventCategory;
    startedAt: number;
    duration: number;
    status: string;
    location?: string | null;
  }> = [];

  for (const step of steps) {
    const cat = categorizeStep(step.title, step.category);
    if (cat !== 'hook' && cat !== 'fixture') continue;
    if (!step.startTime) continue;

    const startedAt = step.startTime instanceof Date ? step.startTime.getTime() : step.startTime;
    events.push({
      title: step.title,
      category: cat as StepEventCategory,
      startedAt,
      duration: step.duration || 0,
      status: step.error ? 'failed' : 'passed',
      location: step.location ? `${step.location.file}:${step.location.line}:${step.location.column}` : null,
    });
  }

  return events;
}

/**
 * Recursively extract wait-category steps from the Playwright step tree
 * with absolute timings. These are rendered as semi-transparent amber bars
 * on WorkersTimeline to visualize wasted time.
 */
export function extractWaitEvents(
  steps: any[],
  insideWait: boolean = false,
): Array<{
  title: string;
  category: StepEventCategory;
  startedAt: number;
  duration: number;
  status: string;
  location?: string | null;
}> {
  const events: Array<{
    title: string;
    category: StepEventCategory;
    startedAt: number;
    duration: number;
    status: string;
    location?: string | null;
  }> = [];
  for (const step of steps) {
    const cat = categorizeStep(step.title, step.category);
    const isWait = cat === 'wait';
    if (isWait && !insideWait && step.startTime) {
      const startedAt = step.startTime instanceof Date ? step.startTime.getTime() : step.startTime;
      events.push({
        title: step.title,
        category: 'wait' as StepEventCategory,
        startedAt,
        duration: step.duration || 0,
        status: 'wasted',
        location: step.location ? `${step.location.file}:${step.location.line}:${step.location.column}` : null,
      });
    }
    if (step.steps?.length > 0) {
      events.push(...extractWaitEvents(step.steps, insideWait || isWait));
    }
  }
  return events;
}
