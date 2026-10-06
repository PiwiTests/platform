import { test, expect, type APIRequestContext, type Page } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The runs list of a project's Runs tab builds its heavy parts on first use: a
 * row's menu on its first click, a row's tooltips on the pointer's first
 * entry, and the card list that replaces the table below `md` only where it
 * shows. Each still works as it did when built with the page.
 */

async function submitRun(request: APIRequestContext, minutesAgo: number) {
  const response = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.RUNS_LIST,
      status: 'failed',
      startTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      duration: 2000,
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      skippedTests: 0,
      testCases: [
        { title: 'lists the runs', status: 'passed', duration: 100, location: 'tests/runs.spec.ts:1:1' },
        { title: 'pages the runs', status: 'failed', duration: 100, location: 'tests/runs.spec.ts:9:1' },
      ],
    },
  });
  expect(response.ok(), `submit failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()) as { runId: number; projectId: number };
}

async function openRuns(page: Page, projectId: number) {
  await page.goto(`/projects/${projectId}?tab=runs`);
  await waitForHydration(page);
}

test.describe('Runs list', () => {
  let projectId: number;
  let runId: number;

  test.beforeAll(async ({ request }) => {
    await submitRun(request, 20);
    ({ projectId, runId } = await submitRun(request, 10));
  });

  test('a run’s menu opens on its first click, closes and opens again', async ({ page }) => {
    await openRuns(page, projectId);
    const trigger = page.getByRole('button', { name: `Run #${runId} actions` });

    await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'Keep forever…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'Delete run' })).toBeVisible();
  });

  test('a run’s results bar shows its breakdown once the pointer rests on it', async ({ page }) => {
    await openRuns(page, projectId);
    const bar = page.getByRole('progressbar', { name: 'Test results: 1 passed, 1 failed' }).first();
    await bar.hover();
    // The tooltip is built on the pointer's entry and opens as it moves on.
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2);
    const breakdown = page.getByText('2 tests total', { exact: true });
    await expect(breakdown).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(breakdown).toHaveCount(0);
  });

  test('at phone width the runs are cards that select and open their menu', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openRuns(page, projectId);

    await page.getByRole('checkbox', { name: `Select run #${runId}` }).check();
    await expect(page.getByText('1 run selected')).toBeVisible();
    await page.getByRole('button', { name: `Run #${runId} actions` }).click();
    await expect(page.getByRole('menuitem', { name: 'Keep forever…' })).toBeVisible();
    await page.keyboard.press('Escape');

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
