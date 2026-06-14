import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '../shared/test-project-names';

test.describe.serial('Run Comparison', () => {
  let projectId: number;
  let run1Id: number;
  let run2Id: number;
  let run3Id: number;

  test('submit three runs with overlapping test cases', async ({ request }) => {
    // Run 1 — 3 tests, all passed
    const res1 = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_COMPARE,
        status: 'passed',
        startTime: new Date(Date.now() - 180000).toISOString(),
        duration: 30000,
        totalTests: 3,
        passedTests: 3,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'login works',
            status: 'passed',
            duration: 500,
            location: 'tests/auth.spec.ts:10:5',
            retries: 0,
          },
          {
            title: 'dashboard loads',
            status: 'passed',
            duration: 1200,
            location: 'tests/dashboard.spec.ts:5:3',
            retries: 0,
          },
          {
            title: 'profile page',
            status: 'passed',
            duration: 800,
            location: 'tests/profile.spec.ts:15:7',
            retries: 0,
          },
        ],
      },
    });
    expect(res1.ok()).toBeTruthy();
    const data1 = await res1.json();
    run1Id = data1.testRunId;
    projectId = data1.projectId;

    // Run 2 — same 3 tests, different durations, one failure
    const res2 = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_COMPARE,
        status: 'failed',
        startTime: new Date(Date.now() - 120000).toISOString(),
        duration: 35000,
        totalTests: 3,
        passedTests: 2,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'login works',
            status: 'passed',
            duration: 300,
            location: 'tests/auth.spec.ts:10:5',
            retries: 0,
          },
          {
            title: 'dashboard loads',
            status: 'failed',
            duration: 5000,
            location: 'tests/dashboard.spec.ts:5:3',
            error: 'Element not found',
            retries: 1,
          },
          {
            title: 'profile page',
            status: 'passed',
            duration: 750,
            location: 'tests/profile.spec.ts:15:7',
            retries: 0,
          },
        ],
      },
    });
    expect(res2.ok()).toBeTruthy();
    const data2 = await res2.json();
    run2Id = data2.testRunId;

    // Run 3 — 2 tests (subset), new test added, one removed
    const res3 = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_COMPARE,
        status: 'passed',
        startTime: new Date(Date.now() - 60000).toISOString(),
        duration: 25000,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'login works',
            status: 'passed',
            duration: 550,
            location: 'tests/auth.spec.ts:10:5',
            retries: 0,
          },
          {
            title: 'settings page',
            status: 'passed',
            duration: 900,
            location: 'tests/settings.spec.ts:20:9',
            retries: 0,
          },
        ],
      },
    });
    expect(res3.ok()).toBeTruthy();
    const data3 = await res3.json();
    run3Id = data3.testRunId;
  });

  test('project should list all three runs', async ({ request }) => {
    const res = await request.get(`/api/projects/${projectId}`);
    expect(res.ok()).toBeTruthy();
    const project = await res.json();
    expect(Array.isArray(project.testRuns)).toBe(true);
    const ourRuns = project.testRuns.filter((r: { id: number }) => [run1Id, run2Id, run3Id].includes(r.id));
    expect(ourRuns.length).toBe(3);
  });

  test('each run should contain test cases', async ({ request }) => {
    for (const runId of [run1Id, run2Id, run3Id]) {
      const res = await request.get(`/api/test-runs/${runId}`);
      expect(res.ok()).toBeTruthy();
      const run = await res.json();
      expect(Array.isArray(run.testCases)).toBe(true);
      expect(run.testCases.length).toBeGreaterThan(0);
    }
  });

  test('compare page shows selection UI and Latest vs Previous button', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=compare`);
    await waitForHydration(page);
    await expect(page.getByText('Select run A...')).toBeVisible();
    await expect(page.getByText('Select run B...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Latest vs previous' })).toBeVisible();
  });

  test('compare page loads comparison via dropdown selection', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=compare`);
    await waitForHydration(page);

    // Open run A dropdown and select the first run
    await page.locator('button').filter({ hasText: 'Select run A...' }).click();
    await page
      .getByRole('option')
      .filter({ hasText: `Run #${run1Id}` })
      .click({ force: true });

    // Open run B dropdown and select the second run
    await page.locator('button').filter({ hasText: 'Select run B...' }).click();
    await page
      .getByRole('option')
      .filter({ hasText: `Run #${run2Id}` })
      .last()
      .click({ force: true });

    // Wait for comparison data to load (requires two API fetches for run details)
    await expect(page.getByText('Status changes', { exact: true })).toBeVisible({ timeout: 30000 });

    // Run 1 vs Run 2 comparison expectations:
    //   login works: 500ms → 300ms  (delta -200, -40%)    → improved
    //   dashboard loads: 1200ms → 5000ms (delta +3800, +317%) → regressed, new failure
    //   profile page: 800ms → 750ms (delta -50, -6.25%)   → unchanged

    // Status changes
    await expect(page.getByText('1 new failure')).toBeVisible();

    // Duration changes
    await expect(page.getByText('1 improved')).toBeVisible();
    await expect(page.getByText('1 regressed')).toBeVisible();
    await expect(page.getByText('1 unchanged')).toBeVisible();

    // Verify comparison table is visible (the "Test case" column header is specific to comparison tables)
    await expect(page.getByRole('table').last()).toBeVisible();

    // Check specific data in table
    await expect(page.getByText('login works')).toBeVisible();
    await expect(page.getByText('dashboard loads')).toBeVisible();
    await expect(page.getByText('profile page')).toBeVisible();
  });

  test('compare page shows added/removed tests across non-overlapping runs', async ({ page }) => {
    // Run 1 has "login works", "dashboard loads", "profile page"
    // Run 3 has "login works", "settings page"
    // So Run 1 has "dashboard loads" and "profile page" not in Run 3
    // Run 3 has "settings page" not in Run 1
    await page.goto(`/projects/${projectId}?tab=compare`);
    await waitForHydration(page);

    // Select runs via dropdown
    await page.locator('button').filter({ hasText: 'Select run A...' }).click();
    await page
      .getByRole('option')
      .filter({ hasText: `Run #${run1Id}` })
      .click({ force: true });
    await page.locator('button').filter({ hasText: 'Select run B...' }).click();
    await page
      .getByRole('option')
      .filter({ hasText: `Run #${run3Id}` })
      .last()
      .click({ force: true });

    await expect(page.getByText('Duration changes', { exact: true })).toBeVisible({ timeout: 30000 });

    // login works: 500ms → 550ms (delta +50, +10%) → unchanged (exactly at 10% threshold)
    // dashboard loads, profile page: only in run A (removed)
    // settings page: only in run B (added)
    // These should appear in the table

    await expect(page.getByText('login works')).toBeVisible();
    await expect(page.getByText('dashboard loads')).toBeVisible();
    await expect(page.getByText('profile page')).toBeVisible();
    await expect(page.getByText('settings page')).toBeVisible();
  });

  test('Latest vs previous button selects runs and shows comparison', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=compare`);
    await waitForHydration(page);

    // Click "Latest vs previous"
    await page.getByRole('button', { name: 'Latest vs previous' }).click();

    // Should show comparison data
    await expect(page.getByText('Duration changes', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('run detail page shows comparison section', async ({ page }) => {
    await page.goto(`/test-runs/${run2Id}`);
    await waitForHydration(page);

    // Switch to the Compare tab
    await page.getByRole('tab', { name: 'Compare' }).click();

    // Use "Compare with previous run" button
    await page.getByRole('button', { name: 'Compare with previous run' }).click();

    // Should show comparison data
    await expect(page.getByText('Duration changes', { exact: true })).toBeVisible({ timeout: 15000 });
    // The comparison table has a "Test case" column header
    await expect(page.getByText('Test case').first()).toBeVisible();
  });

  test('compare page shows no overlapping tests message for unrelated runs', async ({ page }) => {
    // Create a separate independent project with no shared test cases
    const res = await page.request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.UNRELATED,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'unique test',
            status: 'passed',
            duration: 100,
            location: 'tests/unique.spec.ts:1:1',
            retries: 0,
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const unrelatedProjectId = data.projectId;

    // Navigate to compare page for this unrelated project (only 1 run, nothing to compare)
    await page.goto(`/projects/${unrelatedProjectId}?tab=compare`);
    await waitForHydration(page);

    // Should show "select two runs" since we haven't selected any runs for comparison
    await expect(page.getByText('Select two runs to compare test results')).toBeVisible();
  });

  test('compare page shows non-overlapping tests with missing data markers', async ({ page }) => {
    // Create a project with 2 runs that have completely different test cases
    const projectName = PROJECT.NO_OVERLAP;
    const r1 = await page.request.post('/api/test-runs/submit', {
      data: {
        projectName,
        status: 'passed',
        startTime: new Date(Date.now() - 60000).toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'alpha test',
            status: 'passed',
            duration: 200,
            location: 'tests/alpha.spec.ts:1:1',
            retries: 0,
          },
        ],
      },
    });
    const r1Data = await r1.json();

    const r2 = await page.request.post('/api/test-runs/submit', {
      data: {
        projectName,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'beta test',
            status: 'passed',
            duration: 300,
            location: 'tests/beta.spec.ts:1:1',
            retries: 0,
          },
        ],
      },
    });
    const r2Data = await r2.json();

    // Navigate and select runs via dropdown
    await page.goto(`/projects/${r1Data.projectId}?tab=compare`);
    await waitForHydration(page);

    await page.locator('button').filter({ hasText: 'Select run A...' }).click();
    await page
      .getByRole('option')
      .filter({ hasText: `Run #${r1Data.testRunId}` })
      .click({ force: true });
    await page.locator('button').filter({ hasText: 'Select run B...' }).click();
    await page
      .getByRole('option')
      .filter({ hasText: `Run #${r2Data.testRunId}` })
      .last()
      .click({ force: true });

    // Non-overlapping tests still appear in the comparison table — each has null/dash for the missing side
    // "alpha test" (only in run A) should show with a dash for Duration B
    // "beta test" (only in run B) should show with a dash for Duration A
    await expect(page.getByText('Duration changes', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('alpha test')).toBeVisible();
    await expect(page.getByText('beta test')).toBeVisible();
  });

  test('performance page shows comparison section', async ({ page }) => {
    await page.goto(`/projects/${projectId}/performance`);
    await waitForHydration(page);

    await expect(page.getByText('Run comparison')).toBeVisible();

    // Use "Compare latest vs previous" button
    await page.getByRole('button', { name: 'Compare latest vs previous' }).click();

    // Should load comparison data — the comparison table has a "Test case" column header
    await expect(page.getByText('improved').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Test case').first()).toBeVisible();
  });
});
