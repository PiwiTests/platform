interface PerformanceHint {
  type: 'warning' | 'info';
  message: string;
  details: string;
}

interface TestCaseData {
  duration?: number | null;
  retries?: number | null;
  status?: string;
  steps?: Array<{ title: string; duration: number; category: string }> | null;
  slowestStep?: string | null;
  slowestStepDuration?: number | null;
}

/**
 * Generate performance hints based on test case data
 */
export function getPerformanceHints(testCase: TestCaseData): PerformanceHint[] {
  const hints: PerformanceHint[] = [];

  if (!testCase) return hints;

  const steps = testCase.steps || [];

  // Slow navigation hint
  const navigationSteps = steps.filter((s) => s.category === 'navigation');
  const slowNavigations = navigationSteps.filter((s) => s.duration > 3000);
  if (slowNavigations.length > 0) {
    const slowest = slowNavigations.sort((a, b) => b.duration - a.duration)[0]!;
    hints.push({
      type: 'warning',
      message: 'Slow navigation detected',
      details: `"${slowest.title}" took ${(slowest.duration / 1000).toFixed(1)}s. The tested page may have performance issues (slow server response, heavy JS bundles, etc.).`,
    });
  }

  // Many sequential actions
  if (steps.length > 20) {
    hints.push({
      type: 'info',
      message: 'Many sequential actions',
      details: `This test has ${steps.length} steps. Consider splitting it into smaller, focused tests for better isolation and faster feedback.`,
    });
  }

  // Unstable locator (flaky test)
  if (testCase.status === 'passed' && (testCase.retries || 0) > 0) {
    hints.push({
      type: 'warning',
      message: 'Flaky test — passed after retries',
      details: `This test needed ${testCase.retries} ${testCase.retries === 1 ? 'retry' : 'retries'} to pass. Consider reviewing locator strategies, adding explicit waits, or checking for race conditions.`,
    });
  }

  // Slow assertions
  const slowAssertions = steps.filter((s) => s.category === 'assertion' && s.duration > 2000);
  if (slowAssertions.length > 0) {
    const slowest = slowAssertions.sort((a, b) => b.duration - a.duration)[0]!;
    hints.push({
      type: 'info',
      message: 'Slow assertions detected',
      details: `"${slowest.title}" took ${(slowest.duration / 1000).toFixed(1)}s. The UI may be slow to render or the assertion timeout may need tuning.`,
    });
  }

  return hints;
}
