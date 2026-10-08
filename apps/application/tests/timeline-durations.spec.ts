import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The durations on the failure timeline: a step's and a request's duration read
 * the same way (a number in seconds or milliseconds, a share of the test, a bar),
 * and only one that stands out in the test (at least 1 s, and a third of the
 * test) is colored. The window around the failure cuts a request that runs on
 * past it, and the axis marks the cut with an arrow at the edge.
 */
test.describe('Timeline durations', () => {
  test.describe.configure({ mode: 'serial' });

  let failedCaseId: number;

  const QUOTE_REQUEST = 'POST http://localhost:3000/api/quote';
  const PAGE_REQUEST = 'GET http://localhost:3000/checkout';

  test.beforeAll(async ({ request }) => {
    const startTime = Date.now();
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.TIMELINE_DURATIONS,
        status: 'failed',
        startTime: new Date(startTime).toISOString(),
        duration: 12000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'checkout waits for the quote',
            status: 'failed',
            duration: 6000,
            location: 'tests/checkout.spec.ts:20:3',
            error:
              "TimeoutError: locator.click: Timeout 3000ms exceeded.\n  - waiting for getByRole('button', { name: 'Pay' })",
            retries: 0,
            workerIndex: 0,
            startedAt: startTime,
            steps: [
              { title: "page.goto('/checkout')", duration: 800, category: 'navigation', startTime },
              {
                title: 'Fill "ada@example.com"',
                duration: 400,
                category: 'input',
                startTime: startTime + 900,
                params: { locator: "getByLabel('Email')", value: 'ada@example.com' },
              },
              {
                title: "getByRole('button', { name: 'Pay' }).click()",
                duration: 3000,
                category: 'action',
                failed: true,
                startTime: startTime + 1400,
              },
            ],
            // The quote request outlasts the test: it starts at 1 s and runs
            // 9 s, past the window around the failure (which ends 2 s after the
            // failing step, at 6.4 s).
            networkRequests: [
              {
                method: 'GET',
                url: 'http://localhost:3000/checkout',
                status: 200,
                duration: 180,
                startTime: startTime + 100,
                resourceType: 'document',
              },
              {
                method: 'POST',
                url: 'http://localhost:3000/api/quote',
                status: 200,
                duration: 9000,
                startTime: startTime + 1000,
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
    failedCaseId = run.testCases[0].executionId;
  });

  async function openTimeline(page: Page) {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    await page
      .getByRole('tablist', { name: 'Evidence sections' })
      .getByRole('tab', { name: 'Timeline', exact: true })
      .click();
  }

  test('a request reads like a step, and only the durations that stand out are colored', async ({ page }) => {
    await openTimeline(page);
    const table = page.getByRole('table');
    const row = (text: string) => table.locator('tr', { hasText: text });

    // The 9 s request outlasts the 6 s test: it stands out, in seconds, never as raw milliseconds.
    const quote = row(QUOTE_REQUEST).locator('[data-standout]');
    await expect(quote).toHaveAttribute('data-standout', 'share');
    await expect(quote).toHaveAttribute('title', /longer than the whole test/);
    await expect(quote).toContainText('9s');
    await expect(quote).toContainText('>100%');
    await expect(row(QUOTE_REQUEST)).not.toContainText('9000');

    // The 3 s failing click takes half the test: it stands out too.
    await expect(row("getByRole('button', { name: 'Pay' }).click()").locator('[data-standout]')).toHaveAttribute(
      'data-standout',
      'share',
    );

    // A quick request and a quick step stay neutral.
    await expect(row(PAGE_REQUEST)).toContainText('180ms');
    await expect(row(PAGE_REQUEST).locator('[data-standout]')).toHaveCount(0);
    await expect(row("page.goto('/checkout')").locator('[data-standout]')).toHaveCount(0);
  });

  test('a bar the window cuts ends in an arrow; the whole test cuts none', async ({ page }) => {
    await openTimeline(page);
    const arrows = page.locator('[data-shot="evidence-card"] svg [data-testid="timeline-cut-arrow"]');

    // Around the failure, the quote request runs on past the window's end.
    await expect(arrows).toHaveCount(1);

    await page.getByRole('group', { name: 'Timeline window' }).getByRole('button', { name: 'Whole test' }).click();
    await expect(arrows).toHaveCount(0);
  });
});
