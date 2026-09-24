import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The failure timeline's type filter: one chip per item type the execution has
 * (Steps, Network, Console, Backend here), each hiding or showing that type on
 * both the axis and the steps table. The failing step always stays, a line says
 * what is hidden and names the failed request among it, Alt-click shows only one
 * type, and the choice persists per browser — rendered by the server, so a
 * reload arrives already filtered.
 */
test.describe('Timeline type filter', () => {
  test.describe.configure({ mode: 'serial' });

  let failedCaseId: number;
  let passedCaseId: number;

  const QUOTE_REQUEST = 'GET http://localhost:3000/api/quote';
  const FAILING_STEP = "getByRole('button', { name: 'Pay' }).click()";

  test.beforeAll(async ({ request }) => {
    const startTime = Date.now();
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.TIMELINE_TYPE_FILTER,
        status: 'failed',
        startTime: new Date(startTime).toISOString(),
        duration: 10000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'checkout shows the quote',
            status: 'failed',
            duration: 6500,
            location: 'tests/checkout.spec.ts:12:3',
            error:
              "TimeoutError: locator.click: Timeout 5000ms exceeded.\n  - waiting for getByRole('button', { name: 'Pay' })",
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
              },
              {
                title: FAILING_STEP,
                duration: 5000,
                category: 'action',
                failed: true,
                startTime: startTime + 1400,
              },
            ],
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
                method: 'GET',
                url: 'http://localhost:3000/api/quote',
                status: 504,
                duration: 900,
                startTime: startTime + 1500,
                resourceType: 'fetch',
                serverLogs: [{ timestamp: startTime + 2300, level: 'error', message: 'quote upstream timed out' }],
              },
            ],
            consoleLogs: [{ type: 'error', text: 'quote request failed', timestamp: startTime + 2500 }],
          },
          {
            title: 'homepage loads',
            status: 'passed',
            duration: 1500,
            location: 'tests/home.spec.ts:3:1',
            retries: 0,
            workerIndex: 0,
            startedAt: startTime,
            steps: [{ title: "page.goto('/')", duration: 700, category: 'navigation' }],
          },
        ],
      },
    });

    const data = await res.json();
    const proj = await (await request.get(`/api/projects/${data.projectId}`)).json();
    const run = await (await request.get(`/api/test-runs/${proj.testRuns[0].id}`)).json();
    failedCaseId = run.testCases.find((c: { status: string }) => c.status === 'failed').executionId;
    passedCaseId = run.testCases.find((c: { status: string }) => c.status === 'passed').executionId;
  });

  async function openTimeline(page: Page, id: number) {
    await page.goto(`/test-run-cases/${id}`);
    await waitForHydration(page);
    await page
      .getByRole('tablist', { name: 'Evidence sections' })
      .getByRole('tab', { name: 'Timeline', exact: true })
      .click();
  }

  const chipGroup = (page: Page) => page.getByRole('group', { name: 'Show on the timeline' });
  const chip = (page: Page, label: string) => chipGroup(page).getByRole('button', { name: new RegExp(`^${label}`) });
  const axisLane = (page: Page, label: string) =>
    page.locator('[data-shot="evidence-card"] svg').getByText(label, { exact: true });

  test('one chip per type with its count; hiding a type drops its rows and its axis lane', async ({ page }) => {
    await openTimeline(page, failedCaseId);

    // Every type the execution has, in lane order, all shown to begin with.
    await expect(chipGroup(page).getByRole('button')).toHaveText([
      /Steps\s*3/,
      /Network\s*2/,
      /Console\s*1/,
      /Backend\s*1/,
    ]);
    for (const label of ['Steps', 'Network', 'Console', 'Backend']) {
      await expect(chip(page, label)).toHaveAttribute('aria-pressed', 'true');
    }
    const table = page.getByRole('table');
    await expect(table.getByText(QUOTE_REQUEST)).toBeVisible();
    await expect(axisLane(page, 'Network')).toHaveCount(1);
    await expect(page.getByTestId('timeline-hidden-summary')).toHaveCount(0);

    await chip(page, 'Network').click();

    await expect(chip(page, 'Network')).toHaveAttribute('aria-pressed', 'false');
    await expect(table.getByText(QUOTE_REQUEST)).toHaveCount(0);
    await expect(axisLane(page, 'Network')).toHaveCount(0);
    // The line names what the filter leaves out — the failed request among it.
    await expect(page.getByTestId('timeline-hidden-summary')).toHaveText('Hidden: 2 requests (1 failed) · Show all');

    await chip(page, 'Network').click();
    await expect(table.getByText(QUOTE_REQUEST)).toBeVisible();
    await expect(page.getByTestId('timeline-hidden-summary')).toHaveCount(0);
  });

  test('hiding steps keeps the failing step, the moment the timeline reads against', async ({ page }) => {
    await openTimeline(page, failedCaseId);
    const table = page.getByRole('table');

    await chip(page, 'Steps').click();

    await expect(table.getByText(FAILING_STEP)).toBeVisible();
    await expect(table.getByText("page.goto('/checkout')")).toHaveCount(0);
    await expect(page.getByTestId('timeline-hidden-summary')).toHaveText('Hidden: 2 steps · Show all');
  });

  test('Alt-click shows only one type; again, or Show all, brings every type back', async ({ page }) => {
    await openTimeline(page, failedCaseId);
    const table = page.getByRole('table');

    await chip(page, 'Console').click({ modifiers: ['Alt'] });
    for (const [label, pressed] of [
      ['Steps', 'false'],
      ['Network', 'false'],
      ['Console', 'true'],
      ['Backend', 'false'],
    ]) {
      await expect(chip(page, label)).toHaveAttribute('aria-pressed', pressed);
    }
    await expect(table.getByText('quote request failed')).toBeVisible();
    await expect(table.getByText(FAILING_STEP)).toBeVisible();
    await expect(page.getByTestId('timeline-hidden-summary')).toHaveText(
      'Hidden: 2 steps, 2 requests (1 failed), 1 backend log (1 error) · Show all',
    );

    await chip(page, 'Console').click({ modifiers: ['Alt'] });
    await expect(page.getByTestId('timeline-hidden-summary')).toHaveCount(0);

    await chip(page, 'Backend').click();
    await page.getByRole('button', { name: 'Show all' }).click();
    for (const label of ['Steps', 'Network', 'Console', 'Backend']) {
      await expect(chip(page, label)).toHaveAttribute('aria-pressed', 'true');
    }
    // The line that held Show all is gone, so focus moves to the first chip.
    await expect(chip(page, 'Steps')).toBeFocused();
  });

  test('the choice persists per browser and the server renders it, with no hydration mismatch', async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Hydration completed but contains mismatches')) hydrationErrors.push(msg.text());
    });

    await openTimeline(page, failedCaseId);
    await chip(page, 'Network').click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('piwi-timeline-hidden-types')))
      .toBe('["network"]');

    // The server reads the cookie mirror, so the page arrives already filtered.
    const html = await (await page.request.get(`/test-run-cases/${failedCaseId}`)).text();
    expect(html).toContain('data-testid="timeline-hidden-summary"');

    await page.reload();
    await waitForHydration(page);
    await page
      .getByRole('tablist', { name: 'Evidence sections' })
      .getByRole('tab', { name: 'Timeline', exact: true })
      .click();
    await expect(chip(page, 'Network')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('table').getByText(QUOTE_REQUEST)).toHaveCount(0);
    expect(hydrationErrors).toEqual([]);
  });

  test('a passing execution has nothing to filter and shows no chips', async ({ page }) => {
    await openTimeline(page, passedCaseId);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(chipGroup(page)).toHaveCount(0);
  });

  test('the chips wrap at phone width without scrolling the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openTimeline(page, failedCaseId);
    await chip(page, 'Network').click();
    await expect(page.getByTestId('timeline-hidden-summary')).toBeVisible();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
