/** Categorise a Playwright step title into `navigation`, `action`, `input`, `assertion`, `wait`, `api`, or `other` */
export function categorizeStep(title: string): string {
  if (!title) return 'other';
  const lower = title.toLowerCase();
  if (
    lower.startsWith('page.goto') ||
    lower.startsWith('page.reload') ||
    lower.startsWith('page.goback') ||
    lower.startsWith('page.goforward')
  )
    return 'navigation';
  if (
    lower.startsWith('locator.click') ||
    lower.startsWith('locator.dblclick') ||
    lower.startsWith('locator.check') ||
    lower.startsWith('locator.uncheck') ||
    lower.startsWith('locator.selectoption') ||
    lower.startsWith('locator.tap')
  )
    return 'action';
  if (
    lower.startsWith('locator.fill') ||
    lower.startsWith('locator.type') ||
    lower.startsWith('locator.press') ||
    lower.startsWith('locator.clear') ||
    lower.startsWith('locator.setinputfiles')
  )
    return 'input';
  if (lower.startsWith('expect') || lower.startsWith('locator.expect') || lower.startsWith('page.expect'))
    return 'assertion';
  if (
    lower.startsWith('locator.waitfor') ||
    lower.startsWith('page.waitfor') ||
    lower.startsWith('page.waitforloadstate') ||
    lower.startsWith('page.waitforurl')
  )
    return 'wait';
  if (lower.startsWith('apirequestcontext') || lower.startsWith('apiresponse')) return 'api';
  return 'other';
}

/** A single step flattened from the Playwright step tree with its derived category */
export interface FlatStep {
  title: string;
  duration: number;
  category: string;
}

/** Recursively flatten a nested step tree into a flat list */
export function flattenSteps(steps: any[]): FlatStep[] {
  const result: FlatStep[] = [];
  for (const step of steps) {
    result.push({
      title: step.title,
      duration: step.duration,
      category: categorizeStep(step.title),
    });
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

  return {
    steps: flatSteps,
    totalStepDuration,
    slowestStep,
    navigationCount: navSteps.length,
    navigationTotalDuration: navSteps.reduce((sum: number, s) => sum + (s.duration || 0), 0),
  };
}

/** Calculate the p-th percentile from a sorted array of numbers */
export function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
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

  return result;
}
