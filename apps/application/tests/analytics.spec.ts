/**
 * Tests for the cross-project analytics platform:
 *   GET /api/analytics/:widget — generic widget dispatch (registry-driven)
 *   /analytics                 — the Overview dashboard: scope bar and widget bands
 */
import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';
import { ANALYTICS_WIDGETS } from '#shared/analytics/registry';

test.describe.serial('Analytics API', () => {
  let projectId: number;

  test.beforeAll(async ({ request }) => {
    const passing = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.ANALYTICS_TEST,
        status: 'passed',
        startTime: new Date(Date.now() - 60_000).toISOString(),
        duration: 30_000,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          { title: 'stable test', status: 'passed', duration: 500, location: 'tests/a.spec.ts:1:1' },
          { title: 'other test', status: 'passed', duration: 700, location: 'tests/a.spec.ts:9:1' },
        ],
      },
    });
    expect(passing.ok()).toBeTruthy();
    projectId = (await passing.json()).projectId;

    const failing = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.ANALYTICS_TEST,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 45_000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          { title: 'stable test', status: 'passed', duration: 500, location: 'tests/a.spec.ts:1:1' },
          {
            title: 'other test',
            status: 'failed',
            duration: 900,
            location: 'tests/a.spec.ts:9:1',
            error: 'Error: expect(received).toBe(expected)',
          },
        ],
      },
    });
    expect(failing.ok()).toBeTruthy();
  });

  test('GET /api/analytics/portfolio aggregates the project over the period', async ({ request }) => {
    const response = await request.get('/api/analytics/portfolio?days=7');
    expect(response.ok()).toBeTruthy();
    const rows = await response.json();

    const row = rows.find((r: { projectId: number }) => r.projectId === projectId);
    expect(row).toBeTruthy();
    expect(row.runCount).toBe(2);
    expect(row.passRate).toBe(75); // 3 of 4 tests passed across both runs
    expect(row.latestRun.status).toBe('failed');
    expect(row.recentRuns).toHaveLength(2);
  });

  test('GET /api/analytics/ci-time-trend sums run minutes', async ({ request }) => {
    const response = await request.get('/api/analytics/ci-time-trend?days=7&projects=' + projectId);
    expect(response.ok()).toBeTruthy();
    const trend = await response.json();
    expect(trend.runCount).toBe(2);
    expect(trend.totalMinutes).toBeCloseTo(1.3, 1); // 30s + 45s
  });

  test('scope filters apply: an environment with no runs empties the result', async ({ request }) => {
    const response = await request.get('/api/analytics/portfolio?days=7&environment=nonexistent-env');
    expect(response.ok()).toBeTruthy();
    const rows = await response.json();
    const row = rows.find((r: { projectId: number }) => r.projectId === projectId);
    expect(row.runCount).toBe(0);
  });

  test('GET /api/analytics/:widget 404s on an unknown widget id', async ({ request }) => {
    const response = await request.get('/api/analytics/not-a-widget');
    expect(response.status()).toBe(404);
  });

  test('every registered widget responds', async ({ request }) => {
    // Driven by the registry so a newly added widget is covered automatically.
    for (const widget of ANALYTICS_WIDGETS) {
      const response = await request.get(`/api/analytics/${widget.id}?days=7`);
      expect(response.ok(), `widget ${widget.id} should respond`).toBeTruthy();
    }
  });

  test('GET /api/analytics/scope resolves the period, and new keys filter the widgets', async ({ request }) => {
    const scope = await (await request.get(`/api/analytics/scope?period=last-7d&projects=${projectId}`)).json();
    expect(scope.period.label).toBe('Last 7 days');
    expect(scope.comparison.label).toBe('The previous period');
    expect(scope.projectCount).toBe(1);

    // Runs without a branch count under the default-branch policy and under All branches.
    for (const branchKey of ['', '&allBranches=true']) {
      const rows = await (await request.get(`/api/analytics/portfolio?period=last-7d${branchKey}`)).json();
      expect(rows.find((r: { projectId: number }) => r.projectId === projectId).runCount).toBe(2);
    }

    // A branch picked by hand that no run carries empties the project.
    const onBranch = await (
      await request.get('/api/analytics/portfolio?period=last-7d&branches=no-such-branch')
    ).json();
    expect(onBranch.find((r: { projectId: number }) => r.projectId === projectId)?.runCount ?? 0).toBe(0);
  });
});

test.describe('Analytics page', () => {
  let projectIdForPage: number;

  test.beforeAll(async ({ request }) => {
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.ANALYTICS_SCOPE_TEST,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 10_000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [{ title: 'stable test', status: 'passed', duration: 500, location: 'tests/a.spec.ts:1:1' }],
      },
    });
    projectIdForPage = (await response.json()).projectId;
  });

  test('renders every registered widget card', async ({ page }) => {
    await page.goto('/analytics');

    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Portfolio health' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pass rate heatmap' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^CI time/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Wasted CI time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Flakiest tests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Failure clusters' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Regression velocity' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Browser matrix' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Slow endpoints' })).toBeVisible();
    // The Overview dashboard adds the headline tiles and the pass rate over time.
    await expect(page.getByRole('heading', { name: 'Headline numbers' })).toBeVisible();
    await expect(page.getByTestId('stat-test-pass-rate')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pass rate over time' })).toBeVisible();
  });

  test('opens on the scope of an existing piwi-analytics-scope cookie', async ({ page, context, baseURL }) => {
    await context.addCookies([
      {
        name: 'piwi-analytics-scope',
        value: JSON.stringify({
          days: 90,
          projectIds: [projectIdForPage],
          environments: [],
          branches: [],
          fullRunsOnly: true,
        }),
        url: baseURL!,
      },
    ]);
    await page.goto('/analytics');
    await expect(page.getByTestId('analytics-period')).toHaveText(/Last 90 days/);
    // The address is written once the page hydrated, which a dev server under parallel workers can take a while to do.
    await expect(page).toHaveURL(new RegExp(`period=last-90d.*projects=${projectIdForPage}`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /Portfolio health \(1\)/ })).toBeVisible({ timeout: 20_000 });
  });

  test('a copied link opens on the scope it carries', async ({ page }) => {
    await page.goto('/analytics?period=last-month&allBranches=true');
    await expect(page.getByTestId('analytics-period')).toHaveText(/Last month/);
    await expect(page.getByTestId('analytics-branch-policy')).toHaveText(/All branches/);
    // The scope line comes from a client-side fetch, after hydration.
    await expect(page.getByTestId('analytics-scope-line')).toContainText('compared with', { timeout: 20_000 });
  });

  test('is reachable from the sidebar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'Analytics' }).first().click();
    await expect(page).toHaveURL(/\/analytics$/);
    await expect(page.getByRole('heading', { name: 'Portfolio health' })).toBeVisible();
  });
});
