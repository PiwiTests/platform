import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * The single-column execution page: one situation block — identity, the failure
 * headline, the most likely explanation, the situation sentence and the next
 * step, with the raw error one click away behind *Raw error* — then one evidence
 * card with content-level tabs (Timeline, Screen, Source, Network, Console,
 * State, Performance), then the Fix card and the History block. A passing
 * execution shows identity and facts only, on the Timeline tab, with no Fix card.
 */
test.describe('Test-run-case page', () => {
  test.describe.configure({ mode: 'serial' });

  let failedCaseId: number;
  let passedCaseId: number;

  test.beforeAll(async ({ request }) => {
    const startTime = Date.now();
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.TEST_RUN_CASE_PAGE,
        status: 'failed',
        startTime: new Date(startTime).toISOString(),
        duration: 30000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'checkout completes',
            status: 'failed',
            duration: 8000,
            location: 'tests/checkout.spec.ts:42:18',
            error:
              "TimeoutError: locator.click: Timeout 30000ms exceeded.\n  - waiting for getByRole('button', { name: 'Pay' })",
            retries: 1,
            workerIndex: 0,
            startedAt: startTime,
            steps: [
              {
                title: "page.goto('/checkout')",
                duration: 800,
                category: 'navigation',
                location: 'pages/checkout.ts:11:5',
              },
              {
                title: 'Fill "ada@example.com"',
                subtitle: "getByLabel('Email')",
                duration: 400,
                category: 'input',
                params: { locator: "getByLabel('Email')", value: 'ada@example.com' },
              },
              {
                title: "getByRole('button', { name: 'Pay' }).click()",
                duration: 5000,
                category: 'action',
                failed: true,
                location: 'pages/checkout.ts:42:5',
                params: { locator: "getByRole('button', { name: 'Pay' })" },
              },
            ],
          },
          {
            title: 'homepage loads',
            status: 'passed',
            duration: 1500,
            location: 'tests/home.spec.ts:3:1',
            retries: 0,
            workerIndex: 0,
            startedAt: startTime,
            steps: [{ title: "page.goto('/')", duration: 700, category: 'navigation' }],
          },
        ],
      },
    });

    const data = await res.json();
    const proj = await (await request.get(`/api/projects/${data.projectId}`)).json();
    const runId = proj.testRuns[0].id;
    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    failedCaseId = run.testCases.find((c: { status: string }) => c.status === 'failed').executionId;
    passedCaseId = run.testCases.find((c: { status: string }) => c.status === 'passed').executionId;
  });

  test('failing execution leads with the situation block, the raw error one click away, then evidence and fix', async ({
    page,
  }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);

    // One block frames the top; the headline is its h1.
    const block = page.locator('[data-shot="situation-block"]');
    await expect(block).toBeVisible();
    const headline = page.getByRole('heading', {
      name: /getByRole\('button', \{ name: 'Pay' \}\) was not found on the page — click timed out after 30 s/,
    });
    await expect(headline).toBeVisible();

    // The situation sentence says since when, in one clause; the next step follows.
    const situation = page.locator('[data-shot="situation"]');
    await expect(situation).toBeVisible();
    await expect(situation).toContainText(/failed in this run/i);
    const nextStep = page.locator('[data-shot="next-step"]');
    await expect(nextStep).toBeVisible();
    await expect(nextStep).toContainText('Next:');

    // The raw error is a disclosure on the facts line, collapsed by default,
    // and reachable — with its Copy failure action — in one click.
    const showRaw = page.getByRole('button', { name: 'Raw error' });
    await expect(showRaw).toBeVisible();
    await showRaw.click();
    await expect(page.getByRole('button', { name: 'Copy failure' })).toBeVisible();

    // One evidence card with content-level tabs — no page-level tab strip.
    const tablist = page.getByRole('tablist', { name: 'Evidence sections' });
    await expect(tablist).toBeVisible();
    for (const name of ['Timeline', 'Screen', 'Source', 'Network', 'Console', 'State', 'Performance']) {
      await expect(page.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeVisible();
    }

    // The Fix card gathers what to do (diagnosis, verify, …) below the evidence.
    // With no AI provider its diagnosis is one line, not a placeholder block.
    const fix = page.locator('[data-shot="fix"]');
    await expect(fix).toBeVisible();
    await expect(fix.getByText('AI is not configured')).toBeVisible();

    // Reading order: headline → evidence → fix.
    const headlineY = (await headline.boundingBox())!.y;
    const tabsY = (await tablist.boundingBox())!.y;
    const fixY = (await fix.boundingBox())!.y;
    expect(headlineY).toBeLessThan(tabsY);
    expect(tabsY).toBeLessThan(fixY);
  });

  test('passing execution shows identity and facts only, on the Timeline tab', async ({ page }) => {
    await page.goto(`/test-run-cases/${passedCaseId}`);
    await waitForHydration(page);

    const timelineTab = page.getByRole('tab', { name: /^Timeline/ });
    await expect(timelineTab).toBeVisible();
    await expect(timelineTab).toHaveAttribute('aria-selected', 'true');
    // No failure → no headline, no story, no situation, no next step, no Fix card.
    await expect(page.getByRole('button', { name: 'Raw error' })).toHaveCount(0);
    await expect(page.locator('[data-shot="situation"]')).toHaveCount(0);
    await expect(page.locator('[data-shot="next-step"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Fix', exact: true })).toHaveCount(0);
    // A passing execution shows the steps table without the failure axis or its
    // controls. The tab is the heading now — the block no longer repeats "Steps".
    await expect(page.getByRole('button', { name: 'Around the failure' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Steps/ })).toHaveCount(0);
    await expect(page.locator('table').first()).toBeVisible();
  });

  test('the retry command is in the More menu, not an always-on header button', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    // The header no longer carries a standing Copy retry command button.
    await expect(page.getByRole('button', { name: /Copy retry command/ })).toHaveCount(0);
    // It is reachable in the More actions menu.
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: /Copy retry command/ })).toBeVisible();
  });

  test('the Performance tab opens and shows its Web Vitals block', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    const performanceTab = page.getByRole('tab', { name: /^Performance/ });
    await performanceTab.click();
    // The tab is the heading now; the block no longer repeats "Browser performance".
    await expect(performanceTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/Web Vitals/i).first()).toBeVisible();
  });

  test('GET /api/test-run-cases/:id/timeline places the steps and marks the failure', async ({ request }) => {
    const res = await request.get(`/api/test-run-cases/${failedCaseId}/timeline`);
    expect(res.ok()).toBeTruthy();
    const tl = await res.json();
    // Three steps, none carrying a start time, so positions are estimated.
    expect(tl.lanes.steps).toHaveLength(3);
    expect(tl.estimated).toBe(true);
    // The step marked failed is the failure; its end is the failure moment.
    expect(tl.failedStep.index).toBe(2);
    expect(tl.failureAt).toBe(6200);
    expect(tl.lanes.steps[2].failed).toBe(true);
    expect(tl.window).toBeDefined();
    // Each step is attributed to its reporter call site (file:line; no trace, so no function).
    expect(tl.lanes.steps[2].origin).toEqual({ file: 'pages/checkout.ts', line: 42, function: null, chain: [] });
    // The 1.63-shaped Fill step carries its subtitle and params on the model.
    expect(tl.lanes.steps[1].subtitle).toBe("getByLabel('Email')");
    expect(tl.lanes.steps[1].params).toEqual({ locator: "getByLabel('Email')", value: 'ada@example.com' });
  });

  test('the Timeline tab merges the axis and one steps table', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);

    await page.getByRole('tab', { name: /^Timeline/ }).click();

    // The tab is the heading now — the block no longer repeats "Failure timeline".
    await expect(page.getByRole('heading', { name: 'Failure timeline' })).toHaveCount(0);
    // Both window controls drive the axis and the table together.
    await expect(page.getByRole('button', { name: 'Around the failure' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Whole test' })).toBeVisible();
    // This run recorded no step start times, so the estimated note shows.
    await expect(page.getByText(/Step positions are derived from durations/)).toBeVisible();

    // One merged table — the old duplicate "what happened" list is gone.
    await expect(page.getByRole('heading', { name: 'What happened in this window' })).toHaveCount(0);
    const table = page.getByRole('table');
    await expect(table).toHaveCount(1);
    // The failed step is a highlighted row in that table.
    await expect(table.getByText("getByRole('button', { name: 'Pay' }).click()")).toBeVisible();

    // Whole test keeps every step in the table.
    await page.getByRole('button', { name: 'Whole test' }).click();
    await expect(table.getByText("page.goto('/checkout')")).toBeVisible();
    await expect(table.getByText("getByRole('button', { name: 'Pay' }).click()")).toBeVisible();
  });

  test('the steps table renders the 1.63 subtitle and a params disclosure', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    await page.getByRole('tab', { name: /^Timeline/ }).click();
    await page.getByRole('button', { name: 'Whole test' }).click();

    const table = page.getByRole('table');
    // The Fill step's title reads first; its target renders as a muted subtitle
    // (a <span>, distinct from the same string in the params disclosure's <dd>).
    await expect(table.getByText('Fill "ada@example.com"')).toBeVisible();
    await expect(table.locator('span').filter({ hasText: /^getByLabel\('Email'\)$/ })).toBeVisible();

    // The params disclosure is collapsed until opened, and lists the locator first.
    const disclosure = table.locator('[data-testid="step-params"]').first();
    await expect(disclosure).toContainText('Parameters');
    await expect(disclosure.getByText('ada@example.com')).toBeHidden();
    await disclosure.getByText(/Parameters/).click();
    await expect(disclosure.getByText('ada@example.com')).toBeVisible();
    await expect(disclosure.getByText('locator', { exact: true })).toBeVisible();
  });

  test('the story line folds every clue under a "more" disclosure titled "All clues"', async ({ page }) => {
    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);
    // This synthetic failure has no chained story, but its clues still list under
    // the disclosure — and never as "The one clue" / "Other clues".
    await expect(page.getByText('The one clue')).toHaveCount(0);
    await expect(page.getByText('Other clues')).toHaveCount(0);
  });

  test('History block opens populated from the SSR payload, without refetching or a hydration mismatch', async ({
    page,
  }) => {
    // A client-side call to the history endpoint means the rows are missing from
    // the payload, which is what tears the server and client renders apart.
    const historyCalls: string[] = [];
    page.on('request', (req) => {
      if (/\/api\/test-cases\/\d+\/history/.test(req.url())) historyCalls.push(req.url());
    });
    // Vue only reports mismatches in a dev build; in a production run this stays empty.
    const hydrationErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('Hydration completed but contains mismatches')) hydrationErrors.push(msg.text());
    });

    await page.goto(`/test-run-cases/${failedCaseId}`);
    await waitForHydration(page);

    const historyCard = page.locator('[data-shot="execution-history"]');
    await expect(historyCard.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
    await expect(historyCard.getByRole('link', { name: 'Test history' })).toBeVisible();
    expect(historyCalls).toEqual([]);
    expect(hydrationErrors).toEqual([]);
  });
});

/**
 * The story line, the situation sentence and the next step read from the
 * deterministic demo seed: #37 chains the blocked-by-pending-request story and
 * proposes the diagnosed patch, #587 replaces a locator, #682 reproduces. These
 * run only when the seeded cases are present (a demo-seeded server); a bare test
 * DB has no such ids, so the block skips rather than fails.
 */
test.describe('Situation block on seeded cases', () => {
  let hasSeed = false;
  test.beforeAll(async ({ request }) => {
    hasSeed = (await request.get('/api/test-run-cases/37')).ok();
  });
  test.beforeEach(() => {
    test.skip(!hasSeed, 'demo seed not loaded on this server');
  });

  test('#37 reads the story, the regression situation and the diagnosed-fix next step', async ({ page }) => {
    await page.goto('/test-run-cases/37');
    await waitForHydration(page);

    // Most likely — the blocked-by-pending-request story, Strong, 3 clues agree.
    await expect(page.getByText('Most likely:')).toBeVisible();
    await expect(page.getByText('Strong', { exact: true })).toBeVisible();
    await expect(page.getByText(/3 clues agree/)).toBeVisible();

    // The situation sentence names the regression once, and links the cluster.
    const situation = page.locator('[data-shot="situation"]');
    await expect(situation).toContainText('New regression');
    await expect(situation.getByRole('link', { name: /cluster #/ })).toBeVisible();

    // The next step applies the diagnosed fix, with the trailing retry command.
    const next = page.locator('[data-shot="next-step"]');
    await expect(next).toContainText('Apply the diagnosed fix');
    await expect(next.getByRole('button', { name: 'Copy git apply' })).toBeVisible();
    await expect(next.getByRole('button', { name: 'Copy retry command' })).toBeVisible();

    // "New regression" appears exactly once on the page.
    await expect(page.getByText('New regression')).toHaveCount(1);
  });

  test('#37 opens the evidence on the Timeline and the toolbox on Diagnosis', async ({ page }) => {
    await page.goto('/test-run-cases/37');
    await waitForHydration(page);

    // The story cites network, console and ARIA; the Timeline places them, so it
    // is the default tab rather than the single tab the leading clue cites.
    await expect(page.getByRole('tab', { name: /^Timeline/ })).toHaveAttribute('aria-selected', 'true');

    // The toolbox is "More ways to fix" and opens on the next step's section —
    // the diagnosed-fix step opens Diagnosis; the others are folded to one line.
    await expect(page.getByRole('heading', { name: 'More ways to fix' })).toBeVisible();
    await expect(page.locator('[data-shot="fix-diagnosis"] [aria-expanded="true"]')).toBeVisible();
    await expect(page.locator('[data-shot="fix-reproduce"] [aria-expanded="false"]')).toBeVisible();
  });

  test('#37 folds the raw page structure behind a disclosure on the Screen tab', async ({ page }) => {
    await page.goto('/test-run-cases/37');
    await waitForHydration(page);
    await page.getByRole('tab', { name: /^Screen/ }).click();
    // The ARIA tree and the DOM are folded away under Page structure, not open.
    const disclosure = page.getByRole('button', { name: /Page structure/ });
    await expect(disclosure).toBeVisible();
    await disclosure.click();
    // Opening it renders the failure-time page — an iframe, never escaped XML.
    await expect(page.locator('iframe[title="Failure-time page"]')).toBeVisible();
  });

  test('#587 proposes replacing the locator and opens the Locator fix section', async ({ page }) => {
    test.skip(!(await (await page.request.get('/api/test-run-cases/587')).ok()), 'no #587');
    await page.goto('/test-run-cases/587');
    await waitForHydration(page);
    const next = page.locator('[data-shot="next-step"]');
    await expect(next).toContainText('Replace the locator');
    await expect(next.getByRole('button', { name: 'Copy patch' })).toBeVisible();
    await expect(page.locator('[data-shot="fix-locator-fix"] [aria-expanded="true"]')).toBeVisible();
  });

  test('#682 proposes reproducing locally and opens the Reproduce section, run line first', async ({ page }) => {
    test.skip(!(await (await page.request.get('/api/test-run-cases/682')).ok()), 'no #682');
    await page.goto('/test-run-cases/682');
    await waitForHydration(page);
    const next = page.locator('[data-shot="next-step"]');
    await expect(next).toContainText('Reproduce locally');
    await expect(next.getByRole('button', { name: 'Copy recipe' })).toBeVisible();
    // The Reproduce section opens with the page; the run line leads, the full
    // recipe folds behind "Show the full recipe".
    await expect(page.locator('[data-shot="fix-reproduce"] [aria-expanded="true"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Show the full recipe/ })).toBeVisible();
  });

  test('#13 leads with the most-likely explanation', async ({ page }) => {
    test.skip(!(await (await page.request.get('/api/test-run-cases/13')).ok()), 'no #13');
    await page.goto('/test-run-cases/13');
    await waitForHydration(page);
    await expect(page.getByText('Most likely:')).toBeVisible();
  });
});
