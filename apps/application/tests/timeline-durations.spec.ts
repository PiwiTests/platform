import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The durations on the failure timeline: a step's and a request's duration read
 * the same way (a number in seconds or milliseconds, a share of the test, a bar),
 * and only one that stands out (at least 1 s, and a third of the test or twice
 * its usual time over the last passing runs) is colored. The window around the
 * failure cuts a request that runs on past it, and the axis marks the cut with
 * an arrow at the edge.
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

/**
 * A step and a request much slower than in the test's last passing runs stand
 * out against their usual time, though neither takes a third of the test: the
 * timeline sends each one's usual duration, and the row says it.
 */
test.describe('Usual durations', () => {
  test.describe.configure({ mode: 'serial' });

  let failedCaseId: number;

  const TITLE = 'opens the monthly report';
  const LOAD_REPORT = "getByRole('button', { name: 'Load report' }).click()";
  const REPORT_REQUEST = 'GET http://localhost:3000/api/report/2';
  const PAGE_REQUEST = 'GET http://localhost:3000/reports';

  /** One run of the report test: its steps and requests at the given durations, placed from `startTime`. */
  function reportRun(
    startTime: number,
    opts: { status: 'passed' | 'failed'; duration: number; clickMs: number; reportId: number; reportMs: number },
  ) {
    const failed = opts.status === 'failed';
    return {
      projectName: PROJECT.TIMELINE_DURATIONS,
      status: opts.status,
      startTime: new Date(startTime).toISOString(),
      duration: opts.duration,
      totalTests: 1,
      passedTests: failed ? 0 : 1,
      failedTests: failed ? 1 : 0,
      skippedTests: 0,
      testCases: [
        {
          title: TITLE,
          status: opts.status,
          duration: opts.duration,
          location: 'tests/reports.spec.ts:8:3',
          retries: 0,
          workerIndex: 0,
          startedAt: startTime,
          ...(failed
            ? { error: 'Error: expect(received).toBe(expected)\n\nExpected: "12 rows"\nReceived: "0 rows"' }
            : {}),
          steps: [
            { title: "page.goto('/reports')", duration: 1200, category: 'navigation', startTime },
            {
              title: "page.waitForLoadState('networkidle')",
              duration: 2600,
              category: 'wait',
              startTime: startTime + 1300,
            },
            { title: LOAD_REPORT, duration: opts.clickMs, category: 'action', startTime: startTime + 4000 },
            {
              title: 'Expect "toBe"',
              duration: 3,
              category: 'assertion',
              startTime: startTime + 4000 + opts.clickMs + 100,
              ...(failed ? { failed: true } : {}),
            },
          ],
          networkRequests: [
            {
              method: 'GET',
              url: 'http://localhost:3000/reports',
              status: 200,
              duration: 180,
              startTime: startTime + 100,
              resourceType: 'document',
            },
            {
              method: 'GET',
              url: `http://localhost:3000/api/report/${opts.reportId}`,
              status: 200,
              duration: opts.reportMs,
              startTime: startTime + 4100,
              resourceType: 'fetch',
            },
          ],
        },
      ],
    };
  }

  test.beforeAll(async ({ request }) => {
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    // Two passing runs: the click takes 600 ms, the report request 300 ms.
    for (const [i, ago] of [2 * hour, hour].entries()) {
      await retryPost(request, '/api/test-runs/submit', {
        data: reportRun(now - ago, { status: 'passed', duration: 5000, clickMs: 600, reportId: i + 1, reportMs: 300 }),
      });
    }
    // Then the failure: the click takes 2.5 s and the request 1.6 s of a 9 s test, under a third each.
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: reportRun(now - 60_000, { status: 'failed', duration: 9000, clickMs: 2500, reportId: 2, reportMs: 1600 }),
    });
    const data = await res.json();
    const proj = await (await request.get(`/api/projects/${data.projectId}`)).json();
    const runs = proj.testRuns as Array<{ id: number; status: string }>;
    for (const run of runs.filter((r) => r.status === 'failed')) {
      const detail = await (await request.get(`/api/test-runs/${run.id}`)).json();
      const execution = detail.testCases.find((c: { title: string }) => c.title === TITLE);
      if (execution) failedCaseId = execution.executionId;
    }
    expect(failedCaseId).toBeTruthy();
  });

  test('the timeline sends the usual duration of each step and request', async ({ request }) => {
    const timeline = await (await request.get(`/api/test-run-cases/${failedCaseId}/timeline`)).json();
    const step = timeline.lanes.steps.find((item: { label: string }) => item.label === LOAD_REPORT);
    const report = timeline.lanes.network.find((item: { label: string }) => item.label === REPORT_REQUEST);
    expect(step?.usual).toBe(600);
    expect(report?.usual).toBe(300);
  });

  test('a step and a request much slower than usual stand out, and say their usual time', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    await page
      .getByRole('tablist', { name: 'Evidence sections' })
      .getByRole('tab', { name: 'Timeline', exact: true })
      .click();
    await page.getByRole('group', { name: 'Timeline window' }).getByRole('button', { name: 'Whole test' }).click();
    const table = page.getByRole('table');
    const row = (text: string) => table.locator('tr', { hasText: text });

    const click = row(LOAD_REPORT).locator('[data-standout]');
    await expect(click).toHaveAttribute('data-standout', 'usual');
    await expect(click).toContainText('usually 600ms');
    await expect(click).toHaveAttribute('title', /usually/);

    const report = row(REPORT_REQUEST).locator('[data-standout]');
    await expect(report).toHaveAttribute('data-standout', 'usual');
    await expect(report).toContainText('usually 300ms');

    // Steps and requests as quick as usual stay neutral.
    await expect(row("page.waitForLoadState('networkidle')").locator('[data-standout]')).toHaveCount(0);
    await expect(row(PAGE_REQUEST).locator('[data-standout]')).toHaveCount(0);
  });
});
