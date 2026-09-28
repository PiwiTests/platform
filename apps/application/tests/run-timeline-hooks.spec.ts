import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

test.describe('Run timeline hooks', () => {
  let runId = 0;
  const t0 = Date.now() - 60_000;

  test.beforeAll(async ({ request }) => {
    const response = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_TIMELINE_HOOKS,
        status: 'failed',
        startTime: new Date(t0).toISOString(),
        duration: 4000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'seeds the catalog',
            status: 'passed',
            // Playwright leaves the beforeAll out of the duration; the hook sections below span 2.3s.
            duration: 800,
            location: 'tests/catalog.spec.ts:10:5',
            workerIndex: 0,
            startedAt: t0,
            stepEvents: [
              {
                title: 'Before Hooks',
                category: 'hook',
                startedAt: t0,
                duration: 1500,
                status: 'passed',
                hooks: [
                  { title: 'beforeAll hook', category: 'hook', duration: 1300 },
                  { title: 'beforeEach hook', category: 'hook', duration: 200 },
                ],
              },
              { title: 'After Hooks', category: 'hook', startedAt: t0 + 2200, duration: 100, status: 'passed' },
            ],
          },
          {
            title: 'removes the catalog',
            status: 'failed',
            duration: 600,
            location: 'tests/catalog.spec.ts:20:5',
            error: 'Error: afterAll: catalog still has 3 items',
            workerIndex: 0,
            startedAt: t0 + 2400,
            stepEvents: [
              { title: 'Before Hooks', category: 'hook', startedAt: t0 + 2400, duration: 100, status: 'passed' },
              {
                title: 'After Hooks',
                category: 'hook',
                startedAt: t0 + 2900,
                duration: 50,
                status: 'failed',
                error: 'Error: afterAll: catalog still has 3 items',
                hooks: [{ title: 'afterAll hook', category: 'hook', duration: 50, failed: true }],
              },
            ],
          },
        ],
      },
      timeout: 20000,
    });
    expect(response.ok()).toBeTruthy();
    runId = ((await response.json()) as { runId: number }).runId;
  });

  test('draws hooks by default, names the failed hook and explains uncounted hook time', async ({ page }) => {
    await page.goto(`/test-runs/${runId}?tab=workers`);
    await waitForHydration(page);

    const hookBars = page.locator('[data-timeline-hook]');
    await expect(hookBars).toHaveCount(4);
    await expect(page.getByTestId('timeline-hook-failures')).toHaveText('1 hook failure');

    // The failed teardown names the hook that broke and its error.
    const failedBox = (await page.locator('[data-timeline-hook][data-status="failed"]').boundingBox())!;
    await page.mouse.move(failedBox.x + failedBox.width / 2, failedBox.y + failedBox.height / 2);
    await expect(page.getByTestId('timeline-tooltip-hooks')).toContainText('afterAll');
    await expect(page.getByText('Error: afterAll: catalog still has 3 items').last()).toBeVisible();

    // With hooks off only the failed one stays drawn.
    const setupBox = (await hookBars.first().boundingBox())!;
    await page.mouse.move(0, 0);
    await page.getByRole('switch', { name: 'Show hooks' }).click();
    await expect(hookBars).toHaveCount(1);

    // The first test's bar spans its beforeAll, and says what Playwright reported.
    await page.mouse.move(setupBox.x + setupBox.width / 2, setupBox.y + setupBox.height / 2);
    await expect(page.getByText('Playwright reports 800ms')).toBeVisible();
  });
});
