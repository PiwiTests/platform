import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

test.describe('Performance UI Tests', () => {
  // fullyParallel can schedule this describe's tests across multiple workers;
  // beforeAll is scoped per-worker, so without serial mode two workers can each
  // run it once, double-submitting the run (see e.g. ai-diagnosis.spec.ts /
  // email-notifications.spec.ts / notifications.spec.ts for the same guard).
  test.describe.configure({ mode: 'serial' });

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
    await expect(page.getByRole('heading', { name: 'Slowest tests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Slow endpoints' })).toBeVisible();
  });

  test('should show slowest tests in performance tab', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=performance`);
    await expect(page.getByRole('heading', { name: 'Slowest tests' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('form submission is slow')).toBeVisible({ timeout: 15000 });
  });

  test('should show performance metrics on test run detail page', async ({ page }) => {
    // Get the test run ID first
    const response = await page.request.get(`/api/projects/${projectId}`);
    const projectData = await response.json();
    const runId = projectData.testRuns[0].id;

    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    // Avg and P90 test duration live in the header's Details popover.
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByText('Avg', { exact: true })).toBeVisible();
    await expect(page.getByText('P90', { exact: true })).toBeVisible();
  });

  test('should show steps and hints on test case detail page', async ({ page }) => {
    // Get a test case ID with performance data
    const response = await page.request.get(`/api/projects/${projectId}`);
    const projectData = await response.json();
    const runId = projectData.testRuns[0].id;

    const runResponse = await page.request.get(`/api/test-runs/${runId}`);
    const runData = await runResponse.json();
    const testCaseWithSteps = runData.testCases.find((tc: { slowestStep: string | null }) => tc.slowestStep !== null);

    if (testCaseWithSteps) {
      await page.goto(`/test-run-cases/${testCaseWithSteps.executionId}`);
      await waitForHydration(page);

      // The step table lives in the evidence Timeline tab now — the tab is the
      // heading, so the block no longer repeats "Failure timeline" / "Steps".
      await page.getByRole('tab', { name: /^Timeline/ }).click();
      await expect(page.getByRole('table')).toBeVisible();
      // The slowest step is tagged in the table (the `md`-and-up view; the phone
      // card list below `md` carries its own copy, hidden at this width).
      await expect(page.getByRole('table').getByText('slowest')).toBeVisible();
    }
  });

  test('should show performance tab in page navigation', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('button', { name: /Performance/ })).toBeVisible();
  });
});
