import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The first screen of an execution that is not a plain failure. A test that
 * failed its first attempt and passed its retry: the status chip says so, the
 * headline is the failed attempt's error with the line under it naming that
 * attempt, the evidence opens on Attempts and the next step compares them, with
 * no Most likely and no toolbox. A test that did not run: Most likely says why
 * (the run's failure budget, or the test that blocked it, linked), no evidence
 * card shows, and the next step opens the run or the blocking failure.
 */
test.describe('Execution states', () => {
  test.describe.configure({ mode: 'serial' });

  let failedAttemptId: number;
  let retryPassId: number;
  let cutoffRunId: number;
  let blockerId: number;
  let maxFailuresId: number;
  let blockedId: number;

  test.beforeAll(async ({ request }) => {
    const startTime = Date.now();
    const attempts = [
      { retry: 0, status: 'failed', duration: 8000, startedAt: startTime },
      { retry: 1, status: 'passed', duration: 1500, startedAt: startTime + 9000 },
    ];
    const pay = { title: 'pays with a saved card', location: 'tests/checkout.spec.ts:42:18', workerIndex: 0 };
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.EXECUTION_STATES,
        status: 'passed',
        startTime: new Date(startTime).toISOString(),
        duration: 20_000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            ...pay,
            status: 'failed',
            duration: 8000,
            retries: 0,
            attempts: attempts.slice(0, 1),
            startedAt: startTime,
            error:
              "TimeoutError: locator.click: Timeout 30000ms exceeded.\n  - waiting for getByRole('button', { name: 'Pay' })",
            steps: [
              { title: "page.goto('/checkout')", duration: 800, category: 'navigation' },
              {
                title: "getByRole('button', { name: 'Pay' }).click()",
                duration: 7000,
                category: 'action',
                failed: true,
                params: { locator: "getByRole('button', { name: 'Pay' })" },
              },
            ],
          },
          {
            ...pay,
            status: 'passed',
            duration: 1500,
            retries: 1,
            attempts,
            startedAt: startTime + 9000,
            steps: [
              { title: "page.goto('/checkout')", duration: 700, category: 'navigation' },
              { title: "getByRole('button', { name: 'Pay' }).click()", duration: 600, category: 'action' },
            ],
          },
        ],
      },
    });
    const { runId } = (await res.json()) as { runId: number };
    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    type Case = { status: string; executionId: number };
    failedAttemptId = (run.testCases as Case[]).find((c) => c.status === 'failed')!.executionId;
    retryPassId = (run.testCases as Case[]).find((c) => c.status === 'passed')!.executionId;

    // A run cut at its failure budget after two failures: one test never started,
    // and one was blocked by the first failure of its serial group.
    const cutoff = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.EXECUTION_STATES,
        status: 'failed',
        startTime: new Date(startTime + 60_000).toISOString(),
        duration: 20_000,
        totalTests: 4,
        passedTests: 0,
        failedTests: 2,
        skippedTests: 0,
        didNotRunTests: 2,
        testCases: [
          {
            title: 'saves the address',
            location: 'tests/address.spec.ts:4:3',
            status: 'failed',
            duration: 3000,
            retries: 0,
            error: "Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByTestId('address')",
          },
          {
            title: 'saves the phone number',
            location: 'tests/phone.spec.ts:8:3',
            status: 'failed',
            duration: 2000,
            retries: 0,
            error: "Error: expect(locator).toHaveValue(expected) failed\n\nLocator: getByLabel('Phone')",
          },
          {
            title: 'saves the billing address',
            location: 'tests/address.spec.ts:12:3',
            status: 'didnotrun',
            duration: 0,
            retries: 0,
            didNotRunReason: 'previous-failure',
            blockedBy: 'tests/address.spec.ts:4:3',
          },
          {
            title: 'saves the card',
            location: 'tests/card.spec.ts:6:3',
            status: 'didnotrun',
            duration: 0,
            retries: 0,
            didNotRunReason: 'max-failures',
          },
        ],
      },
    });
    cutoffRunId = ((await cutoff.json()) as { runId: number }).runId;
    const cutoffRun = await (await request.get(`/api/test-runs/${cutoffRunId}`)).json();
    type Titled = { title: string; executionId: number };
    const byTitle = (title: string) => (cutoffRun.testCases as Titled[]).find((c) => c.title === title)!.executionId;
    blockerId = byTitle('saves the address');
    blockedId = byTitle('saves the billing address');
    maxFailuresId = byTitle('saves the card');
  });

  test("a retry pass leads with its failed attempt's error and compares the attempts", async ({ page }) => {
    await page.goto(`/test-run-cases/${retryPassId}`);
    await waitForHydration(page);

    // The status chip says it passed on retry, and nothing else on the page repeats it.
    await expect(page.getByText('Passed on retry', { exact: true })).toHaveCount(1);

    // The headline is the failed attempt's, and the line under it names that attempt.
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /getByRole\('button', \{ name: 'Pay' \}\) was not found on the page — click timed out after 30 s/,
      }),
    ).toBeVisible();
    const meta = page.locator('[data-shot="execution-meta"]');
    await expect(meta).toContainText('Failed on attempt 1, passed on attempt 2');
    await expect(meta.getByRole('link', { name: 'attempt 1' })).toHaveAttribute(
      'href',
      `/test-run-cases/${failedAttemptId}`,
    );
    // The facts line's 1/2 opens the same execution.
    await expect(
      page.getByRole('group', { name: 'Attempts of this test in this run' }).getByRole('link', { name: /1\/2/ }),
    ).toHaveAttribute('href', `/test-run-cases/${failedAttemptId}`);

    // The evidence opens on Attempts, and the next step compares them.
    await expect(page.getByRole('tab', { name: /^Attempts/ })).toHaveAttribute('aria-selected', 'true');
    const next = page.locator('[data-shot="next-step"]');
    await expect(next).toContainText('Compare the failing attempt with the passing one');
    await expect(next).toHaveAttribute('data-next-kind', 'compare-attempts');

    // A passing attempt has nothing to explain or fix here.
    await expect(page.getByText('Most likely', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-shot="fix"]')).toHaveCount(0);
  });

  test('the failed attempt keeps its own page, linked back from the retry pass', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedAttemptId}`);
    await waitForHydration(page);
    await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible();
    await expect(page.locator('[data-shot="execution-meta"]')).toContainText(
      'Not the latest: attempt 2 of this run passed',
    );
  });

  test('a retry pass fits a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/test-run-cases/${retryPassId}`);
    await waitForHydration(page);
    await expect(page.locator('[data-shot="next-step"]')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a test the run never started says why as Most likely, and opens the run', async ({ page }) => {
    await page.goto(`/test-run-cases/${maxFailuresId}`);
    await waitForHydration(page);

    await expect(page.getByText("Didn't run", { exact: true })).toBeVisible();
    const mostLikely = page.locator('[data-shot="most-likely"]');
    await expect(mostLikely).toContainText('maximum number of failures (2 failed)');
    await expect(mostLikely).toContainText('Reported by Playwright');
    await expect(page.getByRole('heading', { name: 'Did not run' })).toHaveCount(0);
    // Nothing ran, so there is no evidence to show.
    await expect(page.locator('[data-shot="evidence-card"]')).toHaveCount(0);

    const next = page.locator('[data-shot="next-step"]');
    await expect(next).toHaveAttribute('data-next-kind', 'open-run');
    await expect(next).not.toContainText('Reproduce locally');
    await next.getByRole('button', { name: 'Open the failures' }).click();
    await page.waitForURL(new RegExp(`/test-runs/${cutoffRunId}(\\?|$)`));
  });

  test('a test an earlier failure blocked links that failure and opens it next', async ({ page }) => {
    await page.goto(`/test-run-cases/${blockedId}`);
    await waitForHydration(page);

    const mostLikely = page.locator('[data-shot="most-likely"]');
    await expect(mostLikely).toContainText('failed earlier in the same serial group');
    await expect(mostLikely.getByRole('link', { name: 'saves the address' })).toHaveAttribute(
      'href',
      `/test-run-cases/${blockerId}`,
    );
    await expect(page.locator('[data-shot="next-step"]')).toContainText('Open the failure that blocked this test');
  });

  test('a test that did not run fits a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const id of [maxFailuresId, blockedId]) {
      await page.goto(`/test-run-cases/${id}`);
      await waitForHydration(page);
      await expect(page.locator('[data-shot="most-likely"]')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
