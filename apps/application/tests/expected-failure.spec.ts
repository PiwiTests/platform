import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

// A `test.fail()` test that passed is stored as failed, as Playwright reports it,
// and read as good news: it forms no cluster and shows as "Looks fixed".
test.describe.serial('Expected failures that pass', () => {
  let runId = 0;

  test('are stored with their expected status and form no cluster', async ({ request }) => {
    const passedMessage = 'Expected to fail, but passed.';
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.EXPECTED_FAILURE,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 3,
        passedTests: 0,
        failedTests: 3,
        skippedTests: 0,
        testCases: [
          {
            title: 'bug: coupon not applied to the total',
            status: 'failed',
            expectedStatus: 'failed',
            duration: 900,
            location: 'tests/bugs/coupon.spec.ts:3:5',
            error: passedMessage,
            testAnnotations: [{ type: 'fail' }, { type: 'piwi:bug', description: '37' }],
          },
          {
            // A reporter that predates the field: the `fail` annotation says it.
            title: 'bug: total rounds down',
            status: 'failed',
            duration: 800,
            location: 'tests/bugs/rounding.spec.ts:3:5',
            error: passedMessage,
            testAnnotations: [{ type: 'fail' }],
          },
          {
            title: 'cart shows items',
            status: 'failed',
            expectedStatus: 'passed',
            duration: 2000,
            location: 'tests/cart.spec.ts:12:5',
            error: `Error: expect(locator).toHaveText(expected)\n\nLocator: getByTestId('cart-total')\nExpected string: "3 items"\nReceived string: "0 items"`,
          },
        ],
      },
    });
    expect(response.ok()).toBeTruthy();
    runId = ((await response.json()) as { runId: number }).runId;

    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    const byTitle = Object.fromEntries(run.testCases.map((tc: { title: string }) => [tc.title, tc])) as Record<
      string,
      { expectedStatus: string | null; failureClusterId: number | null; testMeta: unknown }
    >;

    expect(byTitle['bug: coupon not applied to the total']!.expectedStatus).toBe('failed');
    expect(byTitle['bug: coupon not applied to the total']!.failureClusterId).toBeNull();
    expect(byTitle['bug: coupon not applied to the total']!.testMeta).toEqual({ bug: '37' });
    expect(byTitle['bug: total rounds down']!.expectedStatus).toBe('failed');
    expect(byTitle['bug: total rounds down']!.failureClusterId).toBeNull();
    expect(byTitle['cart shows items']!.expectedStatus).toBe('passed');
    expect(byTitle['cart shows items']!.failureClusterId).toEqual(expect.any(Number));
  });

  test('show as Looks fixed on the run and on the execution', async ({ page, request }) => {
    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    const bug = run.testCases.find((tc: { title: string }) => tc.title === 'bug: coupon not applied to the total');

    await page.goto(`/test-runs/${runId}`);
    await expect(page.getByText('bug: coupon not applied to the total')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Looks fixed').first()).toBeVisible();

    await page.goto(`/test-run-cases/${bug.executionId}`);
    // A route compiles on its first visit in dev mode.
    await expect(page.getByText('Looks fixed').first()).toBeVisible({ timeout: 60_000 });
  });
});
