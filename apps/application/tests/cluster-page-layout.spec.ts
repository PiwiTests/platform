import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * Failure-cluster detail page layout: one situation block, read top to bottom.
 * The block carries the state line (the sentence, its one reconcile action and
 * the Triage / Snooze menus) and the occurrence sparkline; the raw error is a
 * "Raw error" disclosure on the facts line; the affected tests are the evidence
 * selector above the tabbed evidence; What changed collapses to one line.
 */

// Two cases sharing one fingerprint (identical error, different spec files) so
// the cluster has two affected test cases → a selector. The stack frame is not
// hashed, so they cluster together.
const sharedError = (frame: string) =>
  `TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Submit' })\n    at ${frame}`;

let clusterId = 0;

async function seedCluster(request: APIRequestContext) {
  await retryPost(request, '/api/test-runs/submit', {
    data: {
      projectName: PROJECT.CLUSTER_PAGE_LAYOUT,
      status: 'failed',
      startTime: new Date().toISOString(),
      duration: 30000,
      totalTests: 2,
      passedTests: 0,
      failedTests: 2,
      skippedTests: 0,
      testCases: [
        {
          title: 'login submits the form',
          status: 'failed',
          duration: 1000,
          location: 'tests/auth.spec.ts:5:3',
          error: sharedError('tests/auth.spec.ts:5:3'),
        },
        {
          title: 'checkout completes payment',
          status: 'failed',
          duration: 1200,
          location: 'tests/checkout.spec.ts:9:1',
          error: sharedError('tests/checkout.spec.ts:9:1'),
        },
      ],
    },
    timeout: 20000,
  });

  const { items: projects } = await (await request.get('/api/projects')).json();
  const project = projects.find((p: { name: string }) => p.name === PROJECT.CLUSTER_PAGE_LAYOUT);
  expect(project).toBeTruthy();
  const detail = await (await request.get(`/api/projects/${project.id}`)).json();
  const runId = detail.testRuns[0].id as number;
  const run = await (await request.get(`/api/test-runs/${runId}`)).json();
  const failed = (run.testCases as Array<{ status: string; failureClusterId?: number }>).find(
    (c) => c.status === 'failed' && c.failureClusterId,
  );
  expect(failed?.failureClusterId).toBeTruthy();
  return failed!.failureClusterId!;
}

test.describe('Failure cluster page layout', () => {
  // fullyParallel can schedule these tests across multiple workers; beforeAll
  // is scoped per-worker, so without serial mode two workers could each seed
  // their own cluster, doubling the shared data these tests assert against.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90000);

  test.beforeAll(async ({ request }) => {
    clusterId = await seedCluster(request);
  });

  test('the state line carries the sentence, the Triage and Snooze menus and the occurrence facts', async ({
    page,
  }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // The one-verb state line, with its two menus (auth is disabled → the virtual
    // admin can write). There is no segmented "Triage status" control any more.
    const state = page.locator('[data-shot="cluster-state"]');
    await expect(state).toBeVisible();
    await expect(state).toContainText('Still failing');
    await expect(state.getByRole('button', { name: 'Triage' })).toBeVisible();
    await expect(state.getByRole('button', { name: 'Snooze' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Triage status' })).toHaveCount(0);

    // The occurrence sparkline and its sentence carry the "2 tests" count; there
    // is no "Runs" card.
    await expect(page.locator('[data-shot="occurrence-sparkline"]')).toBeVisible();
    await expect(page.getByText(/2 tests/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toHaveCount(0);
  });

  test('the affected-tests selector switches the evidence', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // The tabbed evidence card is open, and the selected affected-test row carries
    // the "Open execution" link.
    await expect(page.getByRole('tablist', { name: 'Evidence sections' })).toBeVisible();
    const link = page.getByRole('link', { name: 'Open execution' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/test-run-cases\/\d+/);

    // Selecting the other affected test retargets the evidence (and the link).
    const before = await link.getAttribute('href');
    await page.locator('[data-shot="cluster-affected-tests"] [role="button"][aria-pressed="false"]').first().click();
    await expect
      .poll(async () => page.getByRole('link', { name: 'Open execution' }).getAttribute('href'))
      .not.toBe(before);
  });

  test('the raw error is behind a "Raw error" disclosure', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // Collapsed by default: the signature is not on the first screen.
    const disclosure = page.getByRole('button', { name: 'Raw error' });
    await expect(disclosure).toBeVisible();
    await expect(page.getByText('TimeoutError: locator.click', { exact: false })).toBeHidden();

    await disclosure.click();
    await expect(page.getByText('TimeoutError: locator.click', { exact: false }).first()).toBeVisible();
  });

  test('what changed collapses to one line when there is no SCM', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);
    // The seeded run has no SCM metadata, so What changed is one line, not a card.
    await expect(page.getByText(/What changed:/)).toBeVisible();
  });

  test('selecting an affected test offers "Move to a new cluster"', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    await expect(page.getByRole('heading', { name: /Affected tests/ })).toBeVisible();

    // Checking a row reveals the bulk bar; the move action opens its confirm dialog.
    await page
      .getByRole('checkbox', { name: /^Select / })
      .first()
      .check();
    const move = page.getByRole('button', { name: 'Move to a new cluster' });
    await expect(move).toBeVisible();
    await move.click();
    await expect(page.getByRole('button', { name: /Move \d+ test/ })).toBeVisible();
  });
});

/**
 * The situation block against the deterministic demo seed: #10 is fixed and
 * verified but still open, #1 regressed, #5 replaces a locator over two affected
 * tests. These run only on a demo-seeded server; a bare test DB skips them.
 */
test.describe('Cluster situation block on seeded clusters', () => {
  let hasSeed = false;
  test.beforeAll(async ({ request }) => {
    hasSeed = (await request.get('/api/failure-clusters/10')).ok();
  });
  test.beforeEach(() => {
    test.skip(!hasSeed, 'demo seed not loaded on this server');
  });

  test('#10 states "fixed and verified, still open" with one Mark resolved and the sparkline', async ({ page }) => {
    await page.goto('/failure-clusters/10');
    await waitForHydration(page);

    const state = page.locator('[data-shot="cluster-state"]');
    await expect(state).toContainText('Fixed in');
    await expect(state).toContainText('verified, still marked open');
    await expect(state.getByRole('button', { name: 'Mark resolved' })).toHaveCount(1);
    await expect(state.getByRole('button', { name: 'Triage' })).toBeVisible();
    await expect(state.getByRole('button', { name: 'Snooze' })).toBeVisible();

    // The occurrence sparkline and its sentence.
    await expect(page.locator('[data-shot="occurrence-sparkline"]')).toBeVisible();
    await expect(page.getByText(/occurrences? in 1 test/)).toBeVisible();

    // The next step applies the diagnosed fix.
    await expect(page.locator('[data-shot="next-step"]')).toContainText('Apply the diagnosed fix');
  });

  test('#10 opens the evidence on Timeline, the toolbox on Diagnosis, and never says "AI is not configured"', async ({
    page,
  }) => {
    await page.goto('/failure-clusters/10');
    await waitForHydration(page);

    // Rule 6: the diagnosis leads and its clue is weak, so the Timeline — which
    // places two or more items — is the default tab, not State.
    await expect(page.getByRole('tab', { name: /^Timeline/ })).toHaveAttribute('aria-selected', 'true');

    // The toolbox is "More ways to fix" and opens on Diagnosis (the apply-patch
    // step) with the patch; the reproduce and verify sections stay folded.
    await expect(page.getByRole('heading', { name: 'More ways to fix' })).toBeVisible();
    await expect(page.locator('[data-shot="fix-diagnosis"] [aria-expanded="true"]')).toBeVisible();
    await expect(page.locator('[data-shot="fix-reproduce"] [aria-expanded="false"]')).toBeVisible();

    // A stored result renders under no provider, so the "AI is not configured"
    // line never appears — the diagnosis header offers Re-diagnose instead.
    await expect(page.getByText('AI is not configured')).toHaveCount(0);
  });

  test('#1 states the fix regressed', async ({ page }) => {
    test.skip(!(await (await page.request.get('/api/failure-clusters/1')).ok()), 'no #1');
    await page.goto('/failure-clusters/1');
    await waitForHydration(page);
    const state = page.locator('[data-shot="cluster-state"]');
    await expect(state).toContainText('the fix did not hold');
    await expect(state).toContainText(/back since run #\d+/);
  });

  test('#5 replaces a locator and its affected-test selector switches the evidence', async ({ page }) => {
    test.skip(!(await (await page.request.get('/api/failure-clusters/5')).ok()), 'no #5');
    await page.goto('/failure-clusters/5');
    await waitForHydration(page);

    await expect(page.locator('[data-shot="next-step"]')).toContainText('Replace the locator');

    // Two affected tests → selecting the other row retargets the evidence.
    const rows = page.locator('[data-shot="cluster-affected-tests"] [role="button"]');
    if ((await rows.count()) > 1) {
      const link = page.getByRole('link', { name: 'Open execution' });
      const before = await link.getAttribute('href');
      await page.locator('[data-shot="cluster-affected-tests"] [role="button"][aria-pressed="false"]').first().click();
      await expect
        .poll(async () => page.getByRole('link', { name: 'Open execution' }).getAttribute('href'))
        .not.toBe(before);
    }
  });
});
