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
 * The situation block against the demo-seeded clusters (#10, #1, #5 exist on a
 * demo-seeded server; a bare test DB skips them). These clusters are shared,
 * mutable state — another spec on the same database can triage or diagnose one,
 * and the seed order and ids differ between sqlite and postgres — so the block
 * asserts that the UI faithfully renders whatever the server computes for the
 * cluster, not a hardcoded sentence. That is DB-agnostic and pollution-proof.
 */
test.describe('Cluster situation block on seeded clusters', () => {
  const RECONCILE_LABEL: Record<string, string> = {
    'mark-resolved': 'Mark resolved',
    reopen: 'Reopen',
    unsnooze: 'Unsnooze',
    release: 'Release',
  };
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

  let hasSeed = false;
  test.beforeAll(async ({ request }) => {
    hasSeed = (await request.get('/api/failure-clusters/10')).ok();
  });
  test.beforeEach(() => {
    test.skip(!hasSeed, 'demo seed not loaded on this server');
  });

  for (const id of [10, 1, 5]) {
    test(`#${id} renders the server's state sentence, reconcile action and next step`, async ({ page, request }) => {
      const res = await request.get(`/api/failure-clusters/${id}`);
      test.skip(!res.ok(), `no cluster #${id} on this database`);
      const detail = (await res.json()) as {
        clusterState: { sentence: string; action: string | null };
        nextStep: { title: string };
        occurrenceSeries: unknown[];
      };

      await page.goto(`/failure-clusters/${id}`);
      await waitForHydration(page);

      // The state line renders the server's one-verb sentence verbatim (the run
      // links are part of the same prose), whatever kind it is on this database.
      const sentence = page.locator('[data-shot="cluster-state-sentence"]');
      await expect(sentence).toBeVisible();
      await expect.poll(async () => norm(await sentence.innerText())).toBe(norm(detail.clusterState.sentence));

      // The two menus are always present for a writer; the one reconcile action is
      // present exactly when the server reports one.
      const state = page.locator('[data-shot="cluster-state"]');
      await expect(state.getByRole('button', { name: 'Triage' })).toBeVisible();
      await expect(state.getByRole('button', { name: 'Snooze' })).toBeVisible();
      if (detail.clusterState.action) {
        await expect(
          state.getByRole('button', { name: RECONCILE_LABEL[detail.clusterState.action]!, exact: true }),
        ).toHaveCount(1);
      }

      // The occurrence sparkline renders whenever the cluster has run history.
      if (detail.occurrenceSeries.length) {
        await expect(page.locator('[data-shot="occurrence-sparkline"]')).toBeVisible();
      }

      // The next-step line renders the server's chosen step title verbatim.
      await expect(page.locator('[data-shot="next-step"]')).toContainText(detail.nextStep.title);
    });
  }

  // Phase 4: the evidence opens on the story and the toolbox on the next step,
  // independent of which mutable state the seed is in — #10 ships a stored
  // diagnosis whose next step applies the patch, so its toolbox opens Diagnosis.
  test('#10 opens the evidence on Timeline, the toolbox on Diagnosis, and never says "AI is not configured"', async ({
    page,
    request,
  }) => {
    const res = await request.get('/api/failure-clusters/10');
    test.skip(!res.ok(), 'no cluster #10 on this database');
    const detail = (await res.json()) as { nextStep: { kind: string } };
    test.skip(detail.nextStep.kind !== 'apply-patch', '#10 is not on the apply-patch step on this database');

    await page.goto('/failure-clusters/10');
    await waitForHydration(page);

    // Rule 6: the diagnosis leads and its clue is weak, so the Timeline — which
    // places two or more items — is the default tab, not State.
    await expect(page.getByRole('tab', { name: /^Timeline/ })).toHaveAttribute('aria-selected', 'true');

    // The toolbox is "More ways to fix" and opens on Diagnosis (the apply-patch
    // step) with the patch; the reproduce section stays folded.
    await expect(page.getByRole('heading', { name: 'More ways to fix' })).toBeVisible();
    await expect(page.locator('[data-shot="fix-diagnosis"] [aria-expanded="true"]')).toBeVisible();
    await expect(page.locator('[data-shot="fix-reproduce"] [aria-expanded="false"]')).toBeVisible();

    // A stored result renders under no provider, so the "AI is not configured"
    // line never appears — the diagnosis header offers Re-diagnose instead.
    await expect(page.getByText('AI is not configured')).toHaveCount(0);
  });

  test('the affected-tests selector switches the evidence on a two-test cluster', async ({ page, request }) => {
    // Find a seeded cluster with more than one affected test — its selector must
    // switch the evidence. Which id that is differs between databases, so probe.
    let target: number | null = null;
    for (const id of [5, 2, 10, 1, 8]) {
      const res = await request.get(`/api/failure-clusters/${id}`);
      if (!res.ok()) continue;
      const detail = (await res.json()) as { affectedTestCases: unknown[] };
      if ((detail.affectedTestCases?.length ?? 0) > 1) {
        target = id;
        break;
      }
    }
    test.skip(target == null, 'no seeded cluster with two affected tests');

    await page.goto(`/failure-clusters/${target}`);
    await waitForHydration(page);

    const link = page.getByRole('link', { name: 'Open execution' });
    await expect(link).toBeVisible();
    const before = await link.getAttribute('href');
    await page.locator('[data-shot="cluster-affected-tests"] [role="button"][aria-pressed="false"]').first().click();
    await expect
      .poll(async () => page.getByRole('link', { name: 'Open execution' }).getAttribute('href'))
      .not.toBe(before);
  });
});
