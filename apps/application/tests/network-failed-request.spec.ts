import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * A flaky execution whose failing attempt lost a request to a connection reset
 * and waited 2.1 s on another: the Network tab marks the reset request failed
 * with the browser's error, and the Attempts tab names both differences.
 */
test.describe('Failed and slow requests', () => {
  test.describe.configure({ mode: 'serial' });

  let failingId: number;
  let passingId: number;

  test.beforeAll(async ({ request }) => {
    const startTime = Date.now();
    const attempts = [
      { retry: 0, status: 'failed', duration: 9000, startedAt: startTime },
      { retry: 1, status: 'passed', duration: 2500, startedAt: startTime + 10_000 },
    ];
    const shared = { title: 'cart shows the saved card', location: 'tests/cart.spec.ts:12:5', workerIndex: 0 };
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.NETWORK_FAILED_REQUEST,
        status: 'passed',
        startTime: new Date(startTime).toISOString(),
        duration: 20_000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            ...shared,
            status: 'failed',
            duration: 9000,
            retries: 0,
            attempts: attempts.slice(0, 1),
            startedAt: startTime,
            error: "Error: expect(locator).toBeVisible() failed\n  - waiting for getByText('Visa ending 4242')",
            networkRequests: [
              {
                method: 'GET',
                url: 'http://localhost:3000/api/cart',
                status: 0,
                duration: 1800,
                startTime: startTime + 1000,
                resourceType: 'fetch',
                failure: 'net::ERR_CONNECTION_RESET',
              },
              {
                method: 'GET',
                url: 'http://localhost:3000/api/cards',
                status: 200,
                duration: 2100,
                startTime: startTime + 1200,
                resourceType: 'fetch',
              },
            ],
          },
          {
            ...shared,
            status: 'passed',
            duration: 2500,
            retries: 1,
            attempts,
            startedAt: startTime + 10_000,
            networkRequests: [
              {
                method: 'GET',
                url: 'http://localhost:3000/api/cart',
                status: 200,
                duration: 150,
                startTime: startTime + 11_000,
                resourceType: 'fetch',
              },
              {
                method: 'GET',
                url: 'http://localhost:3000/api/cards',
                status: 200,
                duration: 200,
                startTime: startTime + 11_200,
                resourceType: 'fetch',
              },
            ],
          },
        ],
      },
    });
    const data = await res.json();
    const proj = await (await request.get(`/api/projects/${data.projectId}`)).json();
    const run = await (await request.get(`/api/test-runs/${proj.testRuns[0].id}`)).json();
    failingId = run.testCases.find((c: { status: string }) => c.status === 'failed').executionId;
    passingId = run.testCases.find((c: { status: string }) => c.status === 'passed').executionId;
  });

  test('the Network tab marks a request that got no response failed, with its error', async ({ page }) => {
    await page.goto(`/test-run-cases/${failingId}`);
    await waitForHydration(page);
    await page.getByRole('tab', { name: /^Network/ }).click();
    const resetRow = page.getByRole('button', { name: 'GET failed /api/cart net::ERR_CONNECTION_RESET' });
    await expect(resetRow).toBeVisible();
    await page.getByRole('tab', { name: 'Failed (1)' }).click();
    await expect(resetRow).toBeVisible();
    await expect(page.getByRole('button', { name: /\/api\/cards/ })).toBeHidden();
  });

  test('the Attempts tab names the reset request and the slower one', async ({ page }) => {
    // The final attempt carries every attempt so far, so it opens the Attempts tab.
    await page.goto(`/test-run-cases/${passingId}`);
    await waitForHydration(page);
    await page.getByRole('tab', { name: /^Attempts/ }).click();
    await expect(page.getByText('GET /api/cart → net::ERR_CONNECTION_RESET')).toBeVisible();
    await expect(
      page.getByText('GET /api/cards 2.1 s on the failing attempt, 200 ms on the passing one'),
    ).toBeVisible();
  });
});
