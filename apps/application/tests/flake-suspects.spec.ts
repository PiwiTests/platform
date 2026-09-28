import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * A test that fails when `GET /api/cart` is slow: in six of twenty runs its
 * first attempt waits 2 s on the cart and fails, then passes on retry with a
 * fast cart; two clean passes see a slow cart and pass anyway. The Flakiness
 * tab ranks the slower cart first with counts that add up to the attempts,
 * the Attempts diff of a flaky run links its slower-request row to that
 * suspect, and the flaky list names it as the top suspect.
 */
test.describe('Flake suspects', () => {
  test.describe.configure({ mode: 'serial' });

  const TITLE = 'pays with a saved card';
  const RUNS = 20;
  const FLAKY_RUNS = [1, 4, 7, 10, 13, 16];
  const SLOW_PASSES = [3, 9];

  let projectId: number;
  let testCaseId: number;
  let retryPassId: number;

  const cart = (ms: number, startTime: number) => ({
    method: 'GET',
    url: 'http://localhost:3000/api/cart',
    status: 200,
    duration: ms,
    startTime,
    resourceType: 'fetch',
  });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    const base = Date.now() - RUNS * 3_600_000;
    for (let i = 0; i < RUNS; i++) {
      const start = base + i * 3_600_000;
      const shared = { title: TITLE, location: 'tests/checkout.spec.ts:12:5', workerIndex: 0 };
      const flaky = FLAKY_RUNS.includes(i);
      const testCases = flaky
        ? [
            {
              ...shared,
              status: 'failed',
              duration: 5_000,
              retries: 0,
              startedAt: start,
              attempts: [{ retry: 0, status: 'failed', duration: 5_000, startedAt: start }],
              error: "Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByTestId('cart-total')",
              networkRequests: [cart(2_000 + i * 10, start + 500)],
            },
            {
              ...shared,
              status: 'passed',
              duration: 2_000,
              retries: 1,
              startedAt: start + 6_000,
              attempts: [
                { retry: 0, status: 'failed', duration: 5_000, startedAt: start },
                { retry: 1, status: 'passed', duration: 2_000, startedAt: start + 6_000 },
              ],
              networkRequests: [cart(100, start + 6_500)],
            },
          ]
        : [
            {
              ...shared,
              status: 'passed',
              duration: 2_000,
              retries: 0,
              startedAt: start,
              attempts: [{ retry: 0, status: 'passed', duration: 2_000, startedAt: start }],
              networkRequests: [cart(SLOW_PASSES.includes(i) ? 2_100 : 100 + i, start + 500)],
            },
          ];
      const res = await retryPost(request, '/api/test-runs/submit', {
        data: {
          projectName: PROJECT.FLAKE_SUSPECTS,
          status: 'passed',
          startTime: new Date(start).toISOString(),
          duration: 10_000,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
          testCases,
        },
      });
      projectId = (await res.json()).projectId;
    }

    // The newest flaky run's passing retry carries the Attempts diff.
    const proj = await (await request.get(`/api/projects/${projectId}`)).json();
    for (const { id } of proj.testRuns as Array<{ id: number }>) {
      const run = await (await request.get(`/api/test-runs/${id}`)).json();
      type Case = { status: string; retries: number; executionId: number; testCaseId: number };
      const retryPass = (run.testCases as Case[]).find((c) => c.status === 'passed' && c.retries === 1);
      if (!retryPass) continue;
      retryPassId = retryPass.executionId;
      testCaseId = retryPass.testCaseId;
      break;
    }
  });

  test('the profile ranks the slower cart first, with counts that add up to the attempts', async ({ request }) => {
    const profile = await (await request.get(`/api/test-cases/${testCaseId}/flake-profile`)).json();
    expect(profile.failures).toBe(FLAKY_RUNS.length);
    expect(profile.passes).toBe(RUNS);
    expect(profile.attempts).toBe(FLAKY_RUNS.length + RUNS);
    expect(profile.suspects[0]).toMatchObject({
      kind: 'slow-route',
      route: 'GET /api/cart',
      counts: { failuresWith: 6, failures: 6, passesWith: 2, passes: 20 },
      condition: { kind: 'delay', route: 'GET /api/cart' },
    });
  });

  test('the MCP get_flake_profile tool returns the suspects, context and no experiments', async ({ request }) => {
    const res = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_flake_profile', arguments: { testCaseId } },
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = JSON.parse((await res.json()).result.content[0].text);
    expect(data.suspects[0]).toMatchObject({
      kind: 'slow-route',
      route: 'GET /api/cart',
      counts: { failuresWith: 6, failures: 6, passesWith: 2, passes: 20 },
    });
    expect(data.context.some((c: { kind: string }) => c.kind === 'attempt')).toBe(true);
    expect(data.experiments).toEqual([]);
  });

  test('the Flakiness tab lists GET /api/cart slower first', async ({ page }) => {
    await page.goto(`/test-cases/${testCaseId}?tab=flakiness`);
    await waitForHydration(page);
    await expect(page.getByText('26 attempts in the last 30 days: 6 failed, 20 passed')).toBeVisible();
    const first = page.getByTestId('flake-suspect').first();
    await expect(first).toContainText('GET /api/cart slower (≥2 s)');
    await expect(first).toContainText('6/6');
    await expect(first).toContainText('2/20');
    // The median of the six slow carts (2.01 s to 2.16 s), to the nearest 100 ms.
    await expect(first).toContainText('delay to 2.1 s');
    await expect(page.getByTestId('flake-experiments')).toContainText('None yet');
  });

  test('the Attempts diff links the slower request to its suspect', async ({ page }) => {
    await page.goto(`/test-run-cases/${retryPassId}`);
    await waitForHydration(page);
    await page.getByRole('tab', { name: /^Attempts/ }).click();
    await expect(
      page.getByText(/^GET \/api\/cart 2\.\d s on the failing attempt, 100 ms on the passing one$/),
    ).toBeVisible();
    const link = page.getByTestId('attempt-suspect-link');
    await expect(link).toHaveText(/Flake suspect: 6 of 6 failures/);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/test-cases/${testCaseId}\\?tab=flakiness&suspect=`));
    await expect(page.locator('[data-suspect-id="slow-route:GET /api/cart"]')).toHaveClass(/ring-primary/);
  });

  test('the flaky list names the top suspect', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=flaky-tests`);
    await waitForHydration(page);
    await expect(page.getByTestId('flaky-top-suspect')).toContainText('Top suspect: GET /api/cart slower (≥2 s)');
    await expect(page.getByTestId('flaky-top-suspect')).toContainText('6/6 failures');
  });
});
