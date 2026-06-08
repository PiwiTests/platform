export function categorizeStep(title: string): string {
  if (!title) return "other";
  const lower = title.toLowerCase();
  if (
    lower.startsWith("page.goto") ||
    lower.startsWith("page.reload") ||
    lower.startsWith("page.goback") ||
    lower.startsWith("page.goforward")
  )
    return "navigation";
  if (
    lower.startsWith("locator.click") ||
    lower.startsWith("locator.dblclick") ||
    lower.startsWith("locator.check") ||
    lower.startsWith("locator.uncheck") ||
    lower.startsWith("locator.selectoption") ||
    lower.startsWith("locator.tap")
  )
    return "action";
  if (
    lower.startsWith("locator.fill") ||
    lower.startsWith("locator.type") ||
    lower.startsWith("locator.press") ||
    lower.startsWith("locator.clear") ||
    lower.startsWith("locator.setinputfiles")
  )
    return "input";
  if (lower.startsWith("expect") || lower.startsWith("locator.expect") || lower.startsWith("page.expect"))
    return "assertion";
  if (
    lower.startsWith("locator.waitfor") ||
    lower.startsWith("page.waitfor") ||
    lower.startsWith("page.waitforloadstate") ||
    lower.startsWith("page.waitforurl")
  )
    return "wait";
  if (lower.startsWith("apirequestcontext") || lower.startsWith("apiresponse")) return "api";
  return "other";
}

export interface FlatStep {
  title: string;
  duration: number;
  category: string;
}

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

export interface StepMetrics {
  steps: FlatStep[];
  totalStepDuration: number;
  slowestStep: { title: string; duration: number } | null;
  navigationCount: number;
  navigationTotalDuration: number;
}

export function collectStepMetrics(steps: any[]): StepMetrics {
  const flatSteps = flattenSteps(steps);
  const totalStepDuration = steps.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);

  let slowestStep: { title: string; duration: number } | null = null;
  for (const s of flatSteps) {
    if (!slowestStep || s.duration > slowestStep.duration) slowestStep = { title: s.title, duration: s.duration };
  }

  const navSteps = flatSteps.filter((s) => s.category === "navigation");

  return {
    steps: flatSteps,
    totalStepDuration,
    slowestStep,
    navigationCount: navSteps.length,
    navigationTotalDuration: navSteps.reduce((sum: number, s) => sum + (s.duration || 0), 0),
  };
}

export function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

export interface PerformanceSummary {
  avgTestDuration?: number;
  p50TestDuration?: number;
  p90TestDuration?: number;
  p95TestDuration?: number;
  slowestTests?: Array<{ title: string; duration: number }>;
  totalNavigationDuration?: number;
  avgNavigationDuration?: number;
}

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
