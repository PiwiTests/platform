import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * A verified fix from the API to the pages: a flaky test reproduced by the
 * lab is quarantined, a `verify` experiment holds, and the test reads
 * "verified fixed" on its Flakiness tab and on the flaky list, leaves the
 * ranking, and has its release proposed in quarantine at once. A retry-pass
 * ingested afterwards brings it back.
 */
test.describe('Verified fixes', () => {
  test.describe.configure({ mode: 'serial' });

  const TITLE = 'shows the cart total';
  const RUNS = 8;
  const FLAKY_RUNS = [1, 3, 5, 7];
  const ERROR = "Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByTestId('cart-total')";

  let projectId: number;
  let testCaseId: number;

  const shared = { title: TITLE, location: 'tests/cart.spec.ts:8:3', workerIndex: 0 };
  const cart = (ms: number, startTime: number) => ({
    method: 'GET',
    url: 'http://localhost:3000/api/cart',
    status: 200,
    duration: ms,
    startTime,
    resourceType: 'fetch',
  });

  /** A run of the test at `start`: a retry-pass when `flaky`, else a pass. */
  async function submitRun(request: APIRequestContext, start: number, flaky: boolean, commit: string) {
    const pass = (retries: number, at: number) => ({
      ...shared,
      status: 'passed',
      duration: 2_000,
      retries,
      startedAt: at,
      networkRequests: [cart(100, at + 500)],
    });
    const testCases = flaky
      ? [
          {
            ...shared,
            status: 'failed',
            duration: 5_000,
            retries: 0,
            startedAt: start,
            error: ERROR,
            networkRequests: [cart(2_000, start + 500)],
          },
          pass(1, start + 6_000),
        ]
      : [pass(0, start)];
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.FLAKE_VERIFIED,
        status: 'passed',
        startTime: new Date(start).toISOString(),
        duration: 10_000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        metadata: { scm: { commit } },
        testCases,
      },
    });
    expect(res.ok()).toBeTruthy();
    return res.json();
  }

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    const base = Date.now() - (RUNS + 2) * 3_600_000;
    for (let i = 0; i < RUNS; i++) {
      projectId = (await submitRun(request, base + i * 3_600_000, FLAKY_RUNS.includes(i), 'aaaa111bbbb')).projectId;
    }
    const cases = await (await request.get(`/api/projects/${projectId}/test-cases`)).json();
    testCaseId = cases.items.find((c: { title: string }) => c.title === TITLE).id;

    // The lab reproduced it...
    const plan = await (await request.get(`/api/test-cases/${testCaseId}/flake-plan?commit=aaaa111bbbb`)).json();
    const reproduced = await request.post(`/api/projects/${projectId}/flake-lab/results`, {
      data: {
        experimentId: plan.experimentId,
        arms: [
          { id: 'control', conditions: [], runs: 10, matchingFailures: 0, otherFailures: 0 },
          {
            id: 'suspect-1',
            suspectId: 'slow-route:GET /api/cart',
            conditions: [{ kind: 'delay', route: 'GET /api/cart', ms: 2000 }],
            runs: 4,
            matchingFailures: 3,
            otherFailures: 0,
            stoppedEarly: true,
          },
        ],
      },
    });
    expect((await reproduced.json()).verdict).toBe('reproduced');
    // ...and the test is quarantined meanwhile.
    const quarantined = await request.post(`/api/projects/${projectId}/quarantine`, {
      data: { testCaseId, reason: 'Flaky', source: 'manual' },
    });
    expect(quarantined.ok()).toBeTruthy();
  });

  test('before any verification the test is ranked and quarantine waits for passes', async ({ request }) => {
    const flaky = await (await request.get(`/api/projects/${projectId}/flaky-tests`)).json();
    expect(flaky.items.map((t: { testCaseId: number }) => t.testCaseId)).toContain(testCaseId);
    expect(flaky.verifiedFixed).toEqual([]);
    const quarantine = await (await request.get(`/api/projects/${projectId}/quarantine?candidates=false`)).json();
    expect(quarantine.entries[0]).toMatchObject({ testCaseId, releaseProposed: false, releaseReason: null });
  });

  test('an inconclusive verify marks nothing', async ({ request }) => {
    const plan = await (
      await request.get(`/api/test-cases/${testCaseId}/flake-plan?kind=verify&commit=fix0000`)
    ).json();
    const res = await request.post(`/api/projects/${projectId}/flake-lab/results`, {
      data: {
        experimentId: plan.experimentId,
        arms: [
          { id: 'control', conditions: [], runs: 2, matchingFailures: 0, otherFailures: 0 },
          { id: 'verify', conditions: plan.arms[0].conditions, runs: 2, matchingFailures: 0, otherFailures: 0 },
        ],
      },
    });
    expect((await res.json()).verdict).toBe('inconclusive');
    const flaky = await (await request.get(`/api/projects/${projectId}/flaky-tests`)).json();
    expect(flaky.items.map((t: { testCaseId: number }) => t.testCaseId)).toContain(testCaseId);
  });

  test('a verify that holds takes the test off the ranking and proposes its release', async ({ request }) => {
    const plan = await (
      await request.get(`/api/test-cases/${testCaseId}/flake-plan?kind=verify&commit=fix1234abcd`)
    ).json();
    const res = await request.post(`/api/projects/${projectId}/flake-lab/results`, {
      data: {
        experimentId: plan.experimentId,
        commit: 'fix1234abcd',
        arms: [
          { id: 'control', conditions: [], runs: 5, matchingFailures: 0, otherFailures: 0 },
          { id: 'verify', conditions: plan.arms[0].conditions, runs: 5, matchingFailures: 0, otherFailures: 0 },
        ],
      },
    });
    expect((await res.json()).verdict).toBe('verified');

    const flaky = await (await request.get(`/api/projects/${projectId}/flaky-tests`)).json();
    expect(flaky.items.map((t: { testCaseId: number }) => t.testCaseId)).not.toContain(testCaseId);
    expect(flaky.verifiedFixed).toEqual([
      expect.objectContaining({ testCaseId, verifiedFix: expect.objectContaining({ commit: 'fix1234abcd' }) }),
    ]);
    const quarantine = await (await request.get(`/api/projects/${projectId}/quarantine?candidates=false`)).json();
    expect(quarantine.entries[0]).toMatchObject({
      testCaseId,
      releaseProposed: true,
      releaseReason: 'verified-fix',
      consecutivePasses: 0,
    });
  });

  test('the tab, the flaky list and the quarantine table show it', async ({ page }) => {
    await page.goto(`/test-cases/${testCaseId}?tab=flakiness`);
    await waitForHydration(page);
    const mark = page.getByTestId('flake-verified-fix');
    await expect(mark).toContainText('Verified fixed on fix1234');
    await expect(mark).toHaveAttribute('data-holding', 'true');

    await page.goto(`/projects/${projectId}?tab=flaky-tests`);
    await waitForHydration(page);
    await expect(page.getByTestId('flaky-verified-row')).toHaveCount(1);
    await expect(page.getByTestId('flaky-verified-badge')).toHaveText('Verified fixed on fix1234');
    await expect(page.locator('[data-shot="flaky-table"]').getByRole('link', { name: TITLE })).toHaveCount(1);

    await page.goto(`/projects/${projectId}?tab=quarantine`);
    await waitForHydration(page);
    await expect(page.getByTestId('quarantine-verified-fix')).toContainText('Verified fixed on fix1234 — ready', {
      timeout: 15_000,
    });
  });

  test('a retry-pass after the verification brings it back', async ({ page, request }) => {
    // A run that starts after the verification finished.
    await submitRun(request, Date.now() + 2_000, true, 'fix1234abcd');

    const flaky = await (await request.get(`/api/projects/${projectId}/flaky-tests`)).json();
    expect(flaky.items.map((t: { testCaseId: number }) => t.testCaseId)).toContain(testCaseId);
    expect(flaky.verifiedFixed).toEqual([]);
    const quarantine = await (await request.get(`/api/projects/${projectId}/quarantine?candidates=false`)).json();
    expect(quarantine.entries[0]).toMatchObject({ releaseProposed: false, releaseReason: null, verifiedFix: null });

    await page.goto(`/test-cases/${testCaseId}?tab=flakiness`);
    await waitForHydration(page);
    await expect(page.getByTestId('flake-verified-fix')).toHaveAttribute('data-holding', 'false');
    await expect(page.getByTestId('flake-verified-fix')).toContainText('then it retry-passed again');

    await page.goto(`/projects/${projectId}?tab=flaky-tests`);
    await waitForHydration(page);
    await expect(page.getByTestId('flaky-verified-row')).toHaveCount(0);
  });
});
