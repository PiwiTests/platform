import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

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
    run1Id = data1.runId;
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
    run2Id = data2.runId;

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
    run3Id = data3.runId;
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

  test('selecting two runs and comparing opens the newer run’s Changes tab', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=runs`);
    await waitForHydration(page);

    await page.getByRole('checkbox', { name: `Select run #${run1Id}` }).check();
    await page.getByRole('checkbox', { name: `Select run #${run2Id}` }).check();

    await page.getByRole('button', { name: 'Compare', exact: true }).click();

    const newer = Math.max(run1Id, run2Id);
    const older = Math.min(run1Id, run2Id);
    await page.waitForURL(new RegExp(`/test-runs/${newer}\\?tab=changes&baseline=${older}`));
  });

  test('the retired compare tab and route both land on the Runs tab', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=compare`);
    await waitForHydration(page);
    await expect(page).toHaveURL(/[?&]tab=runs/);

    await page.goto(`/projects/${projectId}/compare`);
    await page.waitForURL(new RegExp(`/projects/${projectId}\\?tab=runs`));
  });

  test('run detail Changes tab compares against a baseline', async ({ page }) => {
    await page.goto(`/test-runs/${run2Id}?tab=changes`);
    await waitForHydration(page);

    // The Changes tab reads run 2 against one baseline (run 1, the last passing run).
    await expect(page.getByText('Compared with')).toBeVisible({ timeout: 15000 });

    // "dashboard loads" passed in run 1 and failed in run 2, so it is a new failure.
    await expect(page.getByText('New failures')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('dashboard loads')).toBeVisible();
  });
});
