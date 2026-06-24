import { test, expect } from './fixtures';
import { PROJECT } from '../shared/test-project-names';

test.describe('Performance UI Tests', () => {
  let projectId: number;

  test.beforeAll(async ({ request }) => {
    const runStartTime = Date.now();

    // Submit test data with performance metrics
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.DASHBOARD_PERF,
        status: 'passed',
        startTime: new Date(runStartTime).toISOString(),
        duration: 60000,
        totalTests: 3,
        passedTests: 2,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'homepage loads quickly',
            status: 'passed',
            duration: 2000,
            location: 'tests/home.spec.ts:1:1',
            retries: 0,
            workerIndex: 0,
            startedAt: runStartTime,
            steps: [
              { title: 'page.goto(http://localhost)', duration: 800, category: 'navigation' },
              { title: 'expect(locator).toBeVisible()', duration: 100, category: 'assertion' },
            ],
            stepEvents: [],
            slowestStep: 'page.goto(http://localhost)',
            slowestStepDuration: 800,
            wastedTimeMs: 0,
          },
          {
            title: 'form submission is slow',
            status: 'passed',
            duration: 15000,
            location: 'tests/form.spec.ts:1:1',
            retries: 0,
            workerIndex: 0,
            startedAt: runStartTime,
            steps: [
              { title: 'page.goto(http://localhost/form)', duration: 5000, category: 'navigation' },
              { title: 'locator.fill(email)', duration: 100, category: 'input' },
              { title: 'page.waitForTimeout', duration: 2000, category: 'wait' },
              { title: 'locator.click(submit)', duration: 3000, category: 'action' },
              { title: 'expect(locator).toHaveText(success)', duration: 4000, category: 'assertion' },
            ],
            stepEvents: [
              {
                title: 'page.waitForTimeout',
                category: 'wait',
                startedAt: runStartTime + 5100,
                duration: 2000,
                status: 'wasted',
              },
            ],
            slowestStep: 'page.goto(http://localhost/form)',
            slowestStepDuration: 5000,
            wastedTimeMs: 2000,
          },
          {
            title: 'broken page',
            status: 'failed',
            duration: 8000,
            location: 'tests/broken.spec.ts:1:1',
            error: 'Timeout',
            retries: 1,
            workerIndex: 0,
          },
        ],
      },
    });

    const data = await response.json();
    projectId = data.projectId;
  });

  test('should show performance tab content', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=performance`);
    await expect(page.getByText('Performance trend')).toBeVisible();
    await expect(page.getByText('Slowest tests')).toBeVisible();
    await expect(page.getByText('Run comparison')).toBeVisible();
  });

  test('should show slowest tests in performance tab', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=performance`);
    await expect(page.getByText('Slowest tests')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('form submission is slow')).toBeVisible({ timeout: 15000 });
  });

  test('should show performance metrics on test run detail page', async ({ page }) => {
    // Get the test run ID first
    const response = await page.request.get(`/api/projects/${projectId}`);
    const projectData = await response.json();
    const testRunId = projectData.testRuns[0].id;

    await page.goto(`/test-runs/${testRunId}`);

    // Should show avg and p90 test duration
    await expect(page.getByText('Avg', { exact: true })).toBeVisible();
    await expect(page.getByText('P90', { exact: true })).toBeVisible();
  });

  test('should show steps and hints on test case detail page', async ({ page }) => {
    // Get a test case ID with performance data
    const response = await page.request.get(`/api/projects/${projectId}`);
    const projectData = await response.json();
    const testRunId = projectData.testRuns[0].id;

    const runResponse = await page.request.get(`/api/test-runs/${testRunId}`);
    const runData = await runResponse.json();
    const testCaseWithSteps = runData.testCases.find((tc: { slowestStep: string | null }) => tc.slowestStep !== null);

    if (testCaseWithSteps) {
      await page.goto(`/test-run-cases/${testCaseWithSteps.id}`);
      await expect(page.getByText('Slowest step')).toBeVisible();

      // Should show steps section
      await expect(page.getByRole('tab', { name: /Steps/ })).toBeVisible();
    }
  });

  test('should show performance tab in page navigation', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('tab', { name: /Performance/ })).toBeVisible();
  });
});
