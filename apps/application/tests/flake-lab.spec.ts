import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * A flake-lab experiment from plan to page: a test whose failures wait on a
 * slow `GET /api/cart` gets a plan with a delay arm, `piwi flake` posts the
 * arms' counts (here, by hand), the server judges them, and the Flakiness tab
 * and the flaky list show the result.
 */
test.describe('Flake Lab', () => {
  test.describe.configure({ mode: 'serial' });

  const TITLE = 'shows the cart total';
  const RUNS = 12;
  const FLAKY_RUNS = [1, 4, 7, 10];
  const ERROR = "Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByTestId('cart-total')";

  let projectId: number;
  let testCaseId: number;
  let experimentId: string;

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
      const shared = { title: TITLE, location: 'tests/cart.spec.ts:8:3', workerIndex: 0 };
      const pass = (retries: number, at: number) => ({
        ...shared,
        status: 'passed',
        duration: 2_000,
        retries,
        startedAt: at,
        networkRequests: [cart(100 + i, at + 500)],
      });
      const testCases = FLAKY_RUNS.includes(i)
        ? [
            {
              ...shared,
              status: 'failed',
              duration: 5_000,
              retries: 0,
              startedAt: start,
              error: ERROR,
              networkRequests: [cart(2_000 + i * 10, start + 500)],
            },
            pass(1, start + 6_000),
          ]
        : [pass(0, start)];
      const res = await retryPost(request, '/api/test-runs/submit', {
        data: {
          projectName: PROJECT.FLAKE_LAB,
          status: 'passed',
          startTime: new Date(start).toISOString(),
          duration: 10_000,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
          metadata: { scm: { commit: 'aaaa111bbbb' } },
          testCases,
        },
      });
      projectId = (await res.json()).projectId;
    }
    const cases = await (await request.get(`/api/projects/${projectId}/test-cases`)).json();
    testCaseId = cases.items.find((c: { title: string }) => c.title === TITLE).id;
  });

  test('the plan puts a control before the delay arm, and records an experiment unless asked not to', async ({
    request,
  }) => {
    const preview = await (await request.get(`/api/test-cases/${testCaseId}/flake-plan?record=false`)).json();
    expect(preview.experimentId).toBeNull();
    expect(preview.control).toMatchObject({ id: 'control', conditions: [], runs: 10 });
    expect(preview.arms[0]).toMatchObject({
      id: 'suspect-1',
      suspectId: 'slow-route:GET /api/cart',
      conditions: [{ kind: 'delay', route: 'GET /api/cart', match: 'all' }],
      stopAt: 3,
    });
    expect(preview.errorSignatures).toHaveLength(1);
    expect(preview.failureCommit).toBe('aaaa111bbbb');

    const res = await request.get(`/api/test-cases/${testCaseId}/flake-plan?commit=cccc222&machine=ci-box`);
    expect(res.status()).toBe(200);
    experimentId = (await res.json()).experimentId;
    expect(experimentId).toMatch(/^\d+$/);

    expect((await request.get(`/api/test-cases/${testCaseId}/flake-plan?kind=verify`)).status()).toBe(409);
    expect((await request.get(`/api/test-cases/${testCaseId}/flake-plan?runs=0`)).status()).toBe(400);
  });

  test('the results endpoint validates the body and judges the arms itself', async ({ request }) => {
    const url = `/api/projects/${projectId}/flake-lab/results`;
    const control = { id: 'control', conditions: [], runs: 10, matchingFailures: 0, otherFailures: 0 };
    const delay = {
      id: 'suspect-1',
      suspectId: 'slow-route:GET /api/cart',
      conditions: [{ kind: 'delay', route: 'GET /api/cart', ms: 2000 }],
      runs: 4,
      matchingFailures: 3,
      otherFailures: 0,
      stoppedEarly: true,
    };
    expect((await request.post(url, { data: { experimentId } })).status()).toBe(400);
    expect((await request.post(url, { data: { experimentId, arms: [delay] } })).status()).toBe(400);
    expect(
      (
        await request.post(url, { data: { experimentId, arms: [control, { ...delay, matchingFailures: 5 }] } })
      ).status(),
    ).toBe(400);

    const res = await request.post(url, {
      data: { experimentId, commit: 'cccc222', arms: [control, { ...delay, verdict: 'not-reproduced' }] },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe('reproduced');
    expect(body.arms[1].verdict).toBe('reproduced');
    expect(body.arms[1].pValue).toBeCloseTo(0.011, 3);

    expect((await request.post(url, { data: { experimentId, arms: [control] } })).status()).toBe(409);
  });

  test('the verify plan reruns the reproducing arm for the runs that prove a fix', async ({ request }) => {
    const plan = await (await request.get(`/api/test-cases/${testCaseId}/flake-plan?kind=verify&record=false`)).json();
    expect(plan.kind).toBe('verify');
    expect(plan.arms).toEqual([
      expect.objectContaining({ id: 'verify', runs: 5, stopAt: 1, label: 'delay GET /api/cart 2 s' }),
    ]);
    expect(plan.verifies).toMatchObject({ rate: 0.75 });
  });

  test('MCP returns the experiment and plans the next one', async ({ request }) => {
    const call = async (name: string) => {
      const res = await request.post('/mcp', {
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { testCaseId } } },
      });
      return JSON.parse((await res.json()).result.content[0].text);
    };
    const profile = await call('get_flake_profile');
    expect(profile.experiments).toHaveLength(1);
    expect(profile.experiments[0]).toMatchObject({ kind: 'reproduce', verdict: 'reproduced', commit: 'cccc222' });
    expect(profile.suspects[0].lab).toMatchObject({ verdict: 'reproduced', matchingFailures: 3, runs: 4 });

    const plan = await call('plan_flake_experiment');
    expect(plan.commands).toMatchObject({
      reproduce: `npx @piwitests/reporter flake ${testCaseId}`,
      verify: `npx @piwitests/reporter flake verify ${testCaseId}`,
    });
    expect(plan.arms.map((a: { id: string }) => a.id)).toEqual(['control', 'suspect-1']);
    expect(plan.plan.experimentId).toBeNull();
  });

  test('the Flakiness tab lists the experiment and the suspect’s result', async ({ page }) => {
    await page.goto(`/test-cases/${testCaseId}?tab=flakiness`);
    await waitForHydration(page);
    const experiments = page.getByTestId('flake-experiments');
    await expect(experiments.getByTestId('flake-experiment')).toHaveCount(1);
    await expect(experiments.getByTestId('flake-experiment')).toContainText(
      'Reproduced by delay GET /api/cart 2 s (3/4 against 0/10, p = 0.011)',
    );
    await expect(page.locator('[data-shot="flake-experiments"]')).toContainText(
      '1 experiment · last: reproduced on cccc222',
    );
    await expect(page.getByTestId('flake-suspect-lab').first()).toContainText(/reproduced 3\/4 · /);
    await expect(page.getByTestId('copy-flake-command')).toBeVisible();
    await expect(page.getByTestId('copy-flake-verify-command')).toBeVisible();
    await expect(experiments).toContainText(`npx @piwitests/reporter flake verify ${testCaseId}`);
  });

  test('the flaky list marks the test reproduced', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=flaky-tests`);
    await waitForHydration(page);
    await expect(page.getByTestId('flaky-reproduced')).toHaveText('Reproduced');
    await expect(page.getByTestId('flaky-reproduced')).toHaveAttribute(
      'title',
      'Reproduced by delay GET /api/cart 2 s',
    );
  });
});
