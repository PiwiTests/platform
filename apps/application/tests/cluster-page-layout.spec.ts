import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';
import { pickMostLikely, type MostLikely } from '#shared/most-likely';
import type { FailureClue, FailureStory } from '#shared/failure-clues';

/**
 * Failure-cluster detail page layout: one situation block, read top to bottom.
 * The block carries the state line (the sentence, its one reconcile action and
 * the Triage panel, which also snoozes) and the occurrence sparkline; the raw error is a
 * "Raw error" disclosure on the facts line; the affected tests are the evidence
 * selector above the tabbed evidence; What changed is a line of the block, and
 * a card below it only with a diff to browse.
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

  test('the state line carries the sentence, the Triage panel and the occurrence facts', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // The one-verb state line, with its Triage panel (auth is disabled → the virtual
    // admin can write). There is no segmented "Triage status" control any more.
    const state = page.locator('[data-shot="cluster-state"]');
    await expect(state).toBeVisible();
    await expect(state).toContainText('Still failing');
    await expect(page.getByRole('group', { name: 'Triage status' })).toHaveCount(0);

    // Snooze lives inside Triage, not as a second menu on the line.
    await expect(state.getByRole('button', { name: 'Snooze' })).toHaveCount(0);
    await state.getByRole('button', { name: 'Triage' }).click();
    const snooze = page.getByRole('group', { name: 'Snooze' });
    await expect(snooze.getByRole('button', { name: '1 day' })).toBeVisible();
    await expect(snooze.getByRole('button', { name: 'Until it recurs' })).toBeVisible();
    await page.keyboard.press('Escape');

    // The occurrence sparkline and its sentence carry the "2 tests" count; there
    // is no "Runs" card.
    await expect(page.locator('[data-shot="occurrence-sparkline"]')).toBeVisible();
    await expect(page.getByText(/2 tests/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Runs', exact: true })).toHaveCount(0);
  });

  test('the block reads the explanation, then the state and the next step, then the context', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    const labels = (await page.locator('[data-shot="situation-block"] dl > dt').allInnerTexts()).map((t) => t.trim());
    const order = ['State', 'Next', 'Issue', 'Occurrences', 'What changed'];
    expect(labels.filter((label) => order.includes(label))).toEqual(order);
    if (labels.includes('Most likely')) expect(labels[0]).toBe('Most likely');
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

  test('what changed is a line of the block, not a card, when there is no SCM', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);
    // The seeded run has no SCM metadata, so What changed is a line of the block
    // saying why there is no diff, and no card.
    const whatChanged = page.locator('[data-shot="what-changed"]');
    await expect(whatChanged).toBeVisible();
    await expect(page.locator('[data-shot="situation-block"]')).toContainText('What changed');
    await expect(page.getByRole('heading', { name: 'What changed' })).toHaveCount(0);
  });

  test('More actions › Copy prompt copies with the Diagnosis section folded', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);

    // A folded section renders no body, so its diagnosis panel is not mounted.
    const diagnosis = page.locator('[data-shot="fix-diagnosis"] button[aria-expanded]').first();
    if ((await diagnosis.getAttribute('aria-expanded')) === 'true') await diagnosis.click();
    await expect(diagnosis).toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Copy prompt' }).click();
    await expect(page.getByText('AI prompt copied', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('REQUEST');
  });

  test('More actions lists the ticket, the test actions, the copies, then Refresh', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusterId}`);
    await waitForHydration(page);
    await page.getByRole('button', { name: 'More actions' }).click();

    // The same grouping and order as the execution page's menu.
    const menu = page.getByRole('menu');
    const items = menu.getByRole('menuitem');
    await expect(items.last()).toHaveText('Refresh');
    const order = ['Link an issue', 'Quarantine all affected tests', 'Copy summary', 'Copy prompt', 'Refresh'];
    const labels = (await items.allInnerTexts()).map((t) => t.trim());
    expect(labels.filter((label) => order.includes(label))).toEqual(order);
    // One group each, Refresh alone in the last.
    const groups = menu.getByRole('group');
    await expect(groups).toHaveCount(4);
    await expect(groups.last().getByRole('menuitem')).toHaveText(['Refresh']);
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
  // Relative ages ("44 seconds ago", "since 44 seconds") keep ticking between the
  // API read and the render, so a cluster seen seconds ago would flip a second
  // across the two reads. Compare everything else verbatim and an age by its unit.
  const norm = (s: string) =>
    s
      .replace(/\s+/g, ' ')
      .replace(/\b\d+ (second|minute|hour|day|week|month|year)s?\b/g, 'N $1s')
      .trim();

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
        nextStep: { title: string; primary: { label: string; action: string } | null };
        occurrenceSeries: unknown[];
      };

      await page.goto(`/failure-clusters/${id}`);
      await waitForHydration(page);

      // The state line renders the server's one-verb sentence verbatim (the run
      // links are part of the same prose), whatever kind it is on this database.
      const sentence = page.locator('[data-shot="cluster-state-sentence"]');
      await expect(sentence).toBeVisible();
      await expect.poll(async () => norm(await sentence.innerText())).toBe(norm(detail.clusterState.sentence));

      // Triage is always present for a writer; the one reconcile action is present
      // exactly when the server reports one, on the state line unless the next step
      // already offers it.
      const state = page.locator('[data-shot="cluster-state"]');
      await expect(state.getByRole('button', { name: 'Triage' })).toBeVisible();
      if (detail.clusterState.action) {
        const reconcile = RECONCILE_LABEL[detail.clusterState.action]!;
        const inNext = detail.nextStep.primary?.action === detail.clusterState.action;
        await expect(state.getByRole('button', { name: reconcile, exact: true })).toHaveCount(inNext ? 0 : 1);
        if (inNext) {
          await expect(
            page.locator('[data-shot="next-step"]').getByRole('button', { name: detail.nextStep.primary!.label }),
          ).toHaveCount(1);
        }
      }

      // The occurrence sparkline renders whenever the cluster has run history.
      if (detail.occurrenceSeries.length) {
        await expect(page.locator('[data-shot="occurrence-sparkline"]')).toBeVisible();
      }

      // The next-step line renders the server's chosen step title verbatim.
      await expect(page.locator('[data-shot="next-step"]')).toContainText(detail.nextStep.title);

      // The state sits right above the next step.
      const labels = (await page.locator('[data-shot="situation-block"] dl > dt').allInnerTexts()).map((t) => t.trim());
      expect(labels.indexOf('Next')).toBe(labels.indexOf('State') + 1);
    });
  }

  // A verified fix at whose commit the diagnosed patch still applied is not
  // confirmed: the state line offers no reconcile, and Mark resolved waits in the
  // Next line's menu. The seed's verified fix (#10) landed the diagnosed change,
  // so this runs on a database where another change fixed a diagnosed cluster.
  test('a verified fix whose patch still applies leaves Mark resolved to the Next menu', async ({ page, request }) => {
    let target: number | null = null;
    for (const id of [10, 1, 3, 6, 7]) {
      const res = await request.get(`/api/failure-clusters/${id}`);
      if (!res.ok()) continue;
      const detail = (await res.json()) as { clusterState: { kind: string; action: string | null } };
      if (detail.clusterState.kind === 'fix-unconfirmed') {
        expect(detail.clusterState.action).toBeNull();
        target = id;
        break;
      }
    }
    test.skip(target == null, 'no seeded cluster with a verified fix whose diagnosed patch still applies');

    await page.goto(`/failure-clusters/${target}`);
    await waitForHydration(page);
    const state = page.locator('[data-shot="cluster-state"]');
    await expect(state.locator('[data-shot="cluster-state-sentence"]')).toContainText(
      'the diagnosed patch still applies',
    );
    await expect(state.getByRole('button', { name: 'Mark resolved', exact: true })).toHaveCount(0);

    const next = page.locator('[data-shot="next-step"]');
    await expect(next).toHaveAttribute('data-next-kind', 'apply-patch');
    await next.getByRole('button', { name: 'More next-step actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Mark resolved' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  // A Done ticket on a failure that stopped: the Issue line names the ticket and
  // the Next line asks to resolve, so the state line says what happened.
  test('a Done ticket on a stopped failure: the state says it stopped, without the ticket', async ({
    page,
    request,
  }) => {
    let target: { id: number; key: string } | null = null;
    for (const id of [10, 2, 1]) {
      const res = await request.get(`/api/failure-clusters/${id}`);
      if (!res.ok()) continue;
      const detail = (await res.json()) as {
        clusterState: { kind: string };
        knownIssue: { key: string } | null;
      };
      if (detail.clusterState.kind === 'ticket-done' && detail.knownIssue) {
        target = { id, key: detail.knownIssue.key };
        break;
      }
    }
    test.skip(target == null, 'no seeded cluster whose Done ticket stopped failing');

    await page.goto(`/failure-clusters/${target!.id}`);
    await waitForHydration(page);
    const sentence = page.locator('[data-shot="cluster-state-sentence"]');
    await expect(sentence).toContainText(/^Stopped failing, last seen .* in run #\d+\.$/);
    await expect(sentence).not.toContainText(target!.key);
    await expect(page.locator('[data-shot="issue-line"]')).toContainText(target!.key);
    await expect(page.locator('[data-shot="next-step"]')).toHaveAttribute('data-next-kind', 'mark-resolved');
  });

  // One Most likely rule on both failure pages: the expected line is computed
  // from the API with the shared helper, then read on each page.
  type DiagnosisFacts = { status: string; summary: string | null; confidence: string | null; provider?: string | null };
  async function clusterMostLikely(request: APIRequestContext, id: number) {
    const res = await request.get(`/api/failure-clusters/${id}`);
    if (!res.ok()) return null;
    const detail = (await res.json()) as {
      latestTestRunsCaseId: number | null;
      diagnosis: DiagnosisFacts | null;
      nextStep: { kind: string; source: string | null };
    };
    if (!detail.latestTestRunsCaseId) return null;
    const clues = (await (await request.get(`/api/test-run-cases/${detail.latestTestRunsCaseId}/clues`)).json()) as {
      clues: FailureClue[];
      story: FailureStory | null;
    };
    const d = detail.diagnosis;
    const diagnosis =
      d?.status === 'completed' && d.summary
        ? { summary: d.summary, confidence: d.confidence, provider: d.provider ?? null }
        : null;
    const mostLikely: MostLikely | null = pickMostLikely({ story: clues.story, clues: clues.clues, diagnosis });
    return { detail, diagnosis, mostLikely };
  }

  for (const id of [1, 3]) {
    test(`#${id} and its latest occurrence lead with the same Most likely`, async ({ page, request }) => {
      const facts = await clusterMostLikely(request, id);
      test.skip(!facts?.mostLikely, `no cluster #${id} with an explanation on this database`);
      const { detail, diagnosis, mostLikely } = facts!;
      // A clue detail's backticks render as code, without the backticks.
      const sentence = mostLikely!.sentence.replace(/`/g, '');

      for (const path of [`/failure-clusters/${id}`, `/test-run-cases/${detail.latestTestRunsCaseId}`]) {
        await page.goto(path);
        await waitForHydration(page);
        const line = page.locator('[data-shot="most-likely"]');
        await expect(line).toHaveAttribute('data-most-likely', mostLikely!.source);
        await expect(line).toContainText(sentence);
      }

      // When Most likely is not the diagnosis, the step built on it names it in full.
      if (detail.nextStep.source === 'diagnosis' && mostLikely!.source !== 'diagnosis' && diagnosis) {
        await page.goto(`/failure-clusters/${id}`);
        await waitForHydration(page);
        const source = page.locator('[data-shot="next-step"] [data-shot="next-step-source"]');
        await expect(source).toContainText('diagnosis');
        await expect(source).toContainText(diagnosis.summary.slice(0, 40));
      }
    });
  }

  test('a step from the diagnosis Most likely shows names it in the short form', async ({ page, request }) => {
    let target: number | null = null;
    for (const id of [10, 7, 3, 1]) {
      const facts = await clusterMostLikely(request, id);
      if (facts?.detail.nextStep.source === 'diagnosis' && facts.mostLikely?.source === 'diagnosis') {
        target = id;
        break;
      }
    }
    test.skip(target == null, 'no seeded cluster whose step and Most likely both come from its diagnosis');

    await page.goto(`/failure-clusters/${target}`);
    await waitForHydration(page);
    await expect(page.locator('[data-shot="next-step"] [data-shot="next-step-source"]')).toHaveText(
      /^From the (AI|agent's) diagnosis above\b/,
    );
  });

  for (const id of [6, 2]) {
    test(`#${id}'s locator step names locator healing as its source`, async ({ page, request }) => {
      const res = await request.get(`/api/failure-clusters/${id}`);
      test.skip(!res.ok(), `no cluster #${id} on this database`);
      const detail = (await res.json()) as { nextStep: { kind: string; source: string | null } };
      test.skip(
        detail.nextStep.kind !== 'replace-locator',
        `#${id} is not on the replace-locator step on this database`,
      );
      expect(detail.nextStep.source).toBe('healing');

      await page.goto(`/failure-clusters/${id}`);
      await waitForHydration(page);
      await expect(page.locator('[data-shot="next-step"] [data-shot="next-step-source"]')).toHaveText(
        /^From locator healing\b/,
      );
    });
  }

  // Phase 4: the evidence opens on the story and the toolbox on the next step,
  // independent of which mutable state the seed is in. #10 ships a stored
  // diagnosis: a step from it opens Diagnosis, and marking the cluster resolved
  // (its verified fix, while it is open) opens no section.
  test('#10 opens the evidence on Timeline, the toolbox on its next step, and never says "AI is not configured"', async ({
    page,
    request,
  }) => {
    const res = await request.get('/api/failure-clusters/10');
    test.skip(!res.ok(), 'no cluster #10 on this database');
    const detail = (await res.json()) as { nextStep: { kind: string } };
    const fromDiagnosis = ['apply-patch', 'follow-diagnosis'].includes(detail.nextStep.kind);
    test.skip(
      !fromDiagnosis && detail.nextStep.kind !== 'mark-resolved',
      `#10 is on the ${detail.nextStep.kind} step on this database`,
    );

    await page.goto('/failure-clusters/10');
    await waitForHydration(page);

    // Rule 6: the diagnosis leads and its clue is weak, so the Timeline — which
    // places two or more items — is the default tab, not State.
    await expect(page.getByRole('tab', { name: /^Timeline/ })).toHaveAttribute('aria-selected', 'true');

    // The toolbox is "More ways to fix" and opens on Diagnosis for a step from
    // the diagnosis; the reproduce section stays folded.
    await expect(page.getByRole('heading', { name: 'More ways to fix' })).toBeVisible();
    await expect(
      page.locator(`[data-shot="fix-diagnosis"] [aria-expanded="${fromDiagnosis ? 'true' : 'false'}"]`),
    ).toBeVisible();
    await expect(page.locator('[data-shot="fix-reproduce"] [aria-expanded="false"]')).toBeVisible();

    // A stored result renders under no provider, so the "AI is not configured"
    // line never appears — the diagnosis header offers Re-diagnose instead.
    await expect(page.getByText('AI is not configured')).toHaveCount(0);
  });

  // The Locator fix section reads the execution the next step checked (the
  // latest occurrence). After a client-side navigation the section and its
  // panel are in the page's first render, from one healing request.
  for (const id of [2, 5]) {
    test(`#${id} reads its Locator fix from the latest occurrence, in the first render`, async ({ page, request }) => {
      const res = await request.get(`/api/failure-clusters/${id}`);
      test.skip(!res.ok(), `no cluster #${id} on this database`);
      const detail = (await res.json()) as {
        latestTestRunsCaseId: number | null;
        nextStep: { kind: string };
        project: { id: number } | null;
      };
      test.skip(
        detail.nextStep.kind !== 'replace-locator' || !detail.latestTestRunsCaseId || !detail.project,
        `#${id} is not on the replace-locator step on this database`,
      );
      const latest = detail.latestTestRunsCaseId!;
      const healing = (await (await request.get(`/api/test-run-cases/${latest}/locator-healing`)).json()) as {
        recommendation?: { recommended?: { locator: string } | null } | null;
      };

      await page.goto(`/projects/${detail.project!.id}?tab=failure-clusters`);
      await waitForHydration(page);
      // A slow healing answer: a page or a panel that does not wait for it renders
      // without the section or without its body.
      const healingFetches: number[] = [];
      await page.route(/\/api\/test-run-cases\/\d+\/locator-healing/, async (route) => {
        const executionId = /test-run-cases\/(\d+)\//.exec(route.request().url())?.[1];
        healingFetches.push(Number(executionId));
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      await page.locator(`a[href="/failure-clusters/${id}"]:visible`).first().click();
      await expect(page.locator('[data-shot="situation-block"]')).toBeVisible();

      // Counted at once, without auto-waiting: the section opens on the next step
      // with its panel's body rendered.
      const section = page.locator('[data-shot="fix-locator-fix"]');
      expect(await section.count()).toBe(1);
      expect(await section.locator('[data-shot="alternative-locators"]').count()).toBe(1);

      const recommended = healing.recommendation?.recommended?.locator;
      if (recommended) await expect(section).toContainText(recommended);
      // One request, for the latest occurrence: the panel renders the page's answer.
      expect(healingFetches).toEqual([latest]);
    });
  }

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
