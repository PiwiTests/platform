const { execSync } = require('child_process');

/**
 * Categorize a step based on its title
 * @param {string} title - The step title
 * @returns {string} The category
 */
function categorizeStep(title) {
  if (!title) return 'other';
  const lower = title.toLowerCase();
  if (lower.startsWith('page.goto') || lower.startsWith('page.reload') || lower.startsWith('page.goback') || lower.startsWith('page.goforward')) {
    return 'navigation';
  }
  if (lower.startsWith('locator.click') || lower.startsWith('locator.dblclick') || lower.startsWith('locator.check') || lower.startsWith('locator.uncheck') || lower.startsWith('locator.selectoption') || lower.startsWith('locator.tap')) {
    return 'action';
  }
  if (lower.startsWith('locator.fill') || lower.startsWith('locator.type') || lower.startsWith('locator.press') || lower.startsWith('locator.clear') || lower.startsWith('locator.setinputfiles')) {
    return 'input';
  }
  if (lower.startsWith('expect') || lower.startsWith('locator.expect') || lower.startsWith('page.expect')) {
    return 'assertion';
  }
  if (lower.startsWith('locator.waitfor') || lower.startsWith('page.waitfor') || lower.startsWith('page.waitforloadstate') || lower.startsWith('page.waitforurl')) {
    return 'wait';
  }
  if (lower.startsWith('apirequestcontext') || lower.startsWith('apiresponse')) {
    return 'api';
  }
  return 'other';
}

/**
 * Flatten nested steps into a single array
 * @param {Array} steps - Array of step objects (may contain nested steps)
 * @returns {Array} Flattened array of { title, duration, category }
 */
function flattenSteps(steps) {
  const result = [];
  for (const step of steps) {
    result.push({
      title: step.title,
      duration: step.duration,
      category: categorizeStep(step.title)
    });
    if (step.steps && step.steps.length > 0) {
      result.push(...flattenSteps(step.steps));
    }
  }
  return result;
}

/**
 * Collect performance metrics from test steps
 * @param {Array} steps - Playwright TestResult.steps array
 * @returns {Object} Performance metrics
 */
function collectStepMetrics(steps) {
  const flatSteps = flattenSteps(steps);

  // Compute total duration from top-level steps only
  const totalStepDuration = steps.reduce((sum, s) => sum + (s.duration || 0), 0);

  // Find slowest step
  let slowestStep = null;
  for (const step of flatSteps) {
    if (!slowestStep || step.duration > slowestStep.duration) {
      slowestStep = { title: step.title, duration: step.duration };
    }
  }

  // Navigation metrics
  const navigationSteps = flatSteps.filter(s => s.category === 'navigation');
  const navigationCount = navigationSteps.length;
  const navigationTotalDuration = navigationSteps.reduce((sum, s) => sum + (s.duration || 0), 0);

  return {
    steps: flatSteps,
    totalStepDuration,
    slowestStep,
    navigationCount,
    navigationTotalDuration
  };
}

/**
 * Compute percentile value from a sorted array
 * @param {number[]} sortedArr - Sorted array of numbers
 * @param {number} p - Percentile (0-100)
 * @returns {number} The percentile value
 */
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)];
}

/**
 * Compute run-level performance summary from all test cases
 * @param {Array} testCases - Array of test case objects
 * @returns {Object} Performance summary
 */
function computePerformanceSummary(testCases) {
  const durations = testCases
    .filter(tc => tc.duration !== null && tc.duration !== undefined)
    .map(tc => tc.duration);

  if (durations.length === 0) {
    return {};
  }

  const sortedDurations = [...durations].sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);

  const avgTestDuration = Math.round(sum / durations.length);
  const p50TestDuration = percentile(sortedDurations, 50);
  const p90TestDuration = percentile(sortedDurations, 90);
  const p95TestDuration = percentile(sortedDurations, 95);

  // Top 5 slowest tests
  const slowestTests = [...testCases]
    .filter(tc => tc.duration !== null && tc.duration !== undefined)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5)
    .map(tc => ({ title: tc.title, duration: tc.duration }));

  // Aggregate navigation metrics
  let totalNavigationDuration = 0;
  let totalNavigationCount = 0;
  for (const tc of testCases) {
    if (tc.performanceMetrics) {
      totalNavigationDuration += tc.performanceMetrics.navigationTotalDuration || 0;
      totalNavigationCount += tc.performanceMetrics.navigationCount || 0;
    }
  }

  const avgNavigationDuration = totalNavigationCount > 0
    ? Math.round(totalNavigationDuration / totalNavigationCount)
    : 0;

  return {
    avgTestDuration,
    p50TestDuration,
    p90TestDuration,
    p95TestDuration,
    slowestTests,
    totalNavigationDuration,
    avgNavigationDuration
  };
}

module.exports = {
  categorizeStep,
  flattenSteps,
  collectStepMetrics,
  percentile,
  computePerformanceSummary
};
