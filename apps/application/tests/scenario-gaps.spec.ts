import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The Gaps tab: its triage verbs and the feature-graph view. A run reaching one
 * route seeds a single-covering-test gap after a recompute; the spec then drives
 * the tab against it.
 */
test.describe('Scenario gaps tab', () => {
  test.setTimeout(90000);

  let projectId: number;

  test.beforeEach(async ({ request }) => {
    await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.SCENARIO_GAPS,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 3000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'places an order',
            status: 'passed',
            duration: 1200,
            location: 'tests/orders.spec.ts:10:5',
            retries: 0,
            networkRequests: [{ method: 'POST', url: 'https://app.test/api/orders', status: 201 }],
          },
        ],
      },
      timeout: 20000,
    });

    // Resolve the project id and recompute gaps against the ingested graph.
    const menu = await (await request.get('/api/projects/menu')).json();
    projectId = (menu.items as Array<{ id: number; name: string }>).find((p) => p.name === PROJECT.SCENARIO_GAPS)!.id;
    await retryPost(request, `/api/projects/${projectId}/gaps/recompute`, { data: {}, timeout: 20000 });

    const gaps = await (await request.get(`/api/projects/${projectId}/gaps`)).json();
    expect(gaps.items.length).toBeGreaterThan(0);
  });

  test('lists gaps and opens the feature-graph view', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=gaps`);
    await waitForHydration(page);

    await expect(page.locator('[data-shot="gaps-panel"]')).toBeVisible();
    const firstGap = page.locator('[data-shot^="gap-"]').first();
    await expect(firstGap).toBeVisible();

    // Open the graph view from the gap's graph button, and expect the SVG.
    await firstGap.getByRole('button', { name: 'View', exact: false }).click();
    await expect(page.locator('svg').last()).toBeVisible();
  });

  test('accepting a gap removes it from the open list', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=gaps`);
    await waitForHydration(page);

    const rows = page.locator('[data-shot^="gap-"]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await rows.first().getByRole('button', { name: 'Accept' }).click();
    await expect(async () => {
      expect(await rows.count()).toBeLessThan(before);
    }).toPass({ timeout: 10000 });
  });

  test('snoozing a gap removes it from the open list', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=gaps`);
    await waitForHydration(page);

    const rows = page.locator('[data-shot^="gap-"]');
    const before = await rows.count();
    await rows.first().getByRole('button', { name: 'Snooze' }).click();
    await page.getByRole('menuitem', { name: 'For 1 week' }).click();
    await expect(async () => {
      expect(await rows.count()).toBeLessThan(before);
    }).toPass({ timeout: 10000 });
  });
});
