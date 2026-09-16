import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The Screen evidence tab's Screenshot · Page diff toggle: a failing execution
 * with an ARIA snapshot, diffed against the same test's last passing (green)
 * snapshot. The demo pair renames the "Pay" button to "Pay now" and disables
 * it, so the diff reads as a renamed node the failing locator points at.
 */
const GREEN_ARIA = '- document:\n  - form "Checkout":\n    - textbox "Email"\n    - button "Pay"';
const FAILING_ARIA = '- document:\n  - form "Checkout":\n    - textbox "Email"\n    - button "Pay now" [disabled]';

test.describe('Page diff', () => {
  test.describe.configure({ mode: 'serial' });

  let failedCaseId: number;

  test.beforeAll(async ({ request }) => {
    const greenTime = Date.now() - 60_000;
    // A passing run first — it carries the green sample the diff compares against.
    await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.PAGE_DIFF,
        status: 'passed',
        startTime: new Date(greenTime).toISOString(),
        duration: 2000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'checkout completes',
            status: 'passed',
            duration: 1500,
            location: 'tests/checkout.spec.ts:42:18',
            ariaSnapshot: GREEN_ARIA,
            startedAt: greenTime,
          },
        ],
      },
    });

    const failTime = Date.now();
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.PAGE_DIFF,
        status: 'failed',
        startTime: new Date(failTime).toISOString(),
        duration: 30000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'checkout completes',
            status: 'failed',
            duration: 8000,
            location: 'tests/checkout.spec.ts:42:18',
            error:
              "TimeoutError: locator.click: Timeout 30000ms exceeded.\n  - waiting for getByRole('button', { name: 'Pay' })",
            ariaSnapshot: FAILING_ARIA,
            startedAt: failTime,
          },
        ],
      },
    });

    const data = await res.json();
    const proj = await (await request.get(`/api/projects/${data.projectId}`)).json();
    const failingRunId = proj.testRuns.find((r: { status: string }) => r.status === 'failed').id;
    const run = await (await request.get(`/api/test-runs/${failingRunId}`)).json();
    failedCaseId = run.testCases.find((c: { status: string }) => c.status === 'failed').executionId;
  });

  test('the Screen tab toggles to a structural page diff of the failing page', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);

    // Open the Screen tab from the evidence strip.
    await page
      .getByRole('tablist', { name: 'Evidence sections' })
      .getByRole('tab', { name: 'Screen', exact: true })
      .click();

    // The Screenshot · Page diff toggle appears once the diff loads.
    const toggle = page.getByRole('tablist', { name: 'Screen view' }).getByRole('tab', { name: 'Page diff' });
    await expect(toggle).toBeVisible();
    await toggle.click();

    // The diff card states its baseline and shows the renamed button, with the
    // failing locator's node highlighted.
    await expect(page.getByText(/vs last green — run #\d+/)).toBeVisible();
    // The renamed summary and the highlighted failing-locator node prove the diff rendered.
    await expect(page.getByText('The failing locator points here')).toBeVisible();
    await expect(page.getByText('~1', { exact: true })).toBeVisible();
  });
});
