import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

test.describe.serial('Run page Tests tab', () => {
  const loginTimeout = (ms: number) =>
    `TimeoutError: locator.click: Timeout ${ms}ms exceeded.\nCall log:\n  - waiting for getByTestId('login-button')`;
  const cartAssertion = `Error: expect(locator).toHaveText(expected)\n\nLocator: getByTestId('cart-total')\nExpected string: "3 items"\nReceived string: "0 items"`;

  let runId = 0;
  let loginClusterId = 0;

  // The test-row title links — the visible copy at the test viewport.
  const visibleTitles = (page: import('@playwright/test').Page) => page.locator('a[href^="/test-run-cases/"]:visible');
  const groupBy = (page: import('@playwright/test').Page) => page.getByRole('combobox', { name: 'Group tests by' });

  async function selectGroup(page: import('@playwright/test').Page, label: string) {
    await groupBy(page).click();
    await page.getByRole('option', { name: label }).click();
  }

  async function submitRun(request: APIRequestContext) {
    const response = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_PAGE_FILTERS,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 60000,
        totalTests: 4,
        passedTests: 1,
        failedTests: 3,
        skippedTests: 0,
        testCases: [
          {
            title: 'login via header',
            status: 'failed',
            duration: 31000,
            location: 'tests/auth.spec.ts:10:5',
            suitePath: ['Authentication'],
            error: loginTimeout(30000),
          },
          {
            title: 'login via modal',
            status: 'failed',
            duration: 16000,
            location: 'tests/auth.spec.ts:30:5',
            suitePath: ['Authentication'],
            error: loginTimeout(15000),
          },
          {
            title: 'cart shows items',
            status: 'failed',
            duration: 2000,
            location: 'tests/cart.spec.ts:12:5',
            error: cartAssertion,
          },
          { title: 'homepage loads', status: 'passed', duration: 900, location: 'tests/home.spec.ts:5:5' },
        ],
      },
      timeout: 20000,
    });
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { runId: number; projectId: number };
    runId = body.runId;
  }

  test('seeds a failed run with two failure clusters', async ({ request }) => {
    await submitRun(request);

    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    const loginHeader = run.testCases.find((tc: { title: string }) => tc.title === 'login via header');
    const cart = run.testCases.find((tc: { title: string }) => tc.title === 'cart shows items');
    expect(loginHeader.failureClusterId).toEqual(expect.any(Number));
    expect(cart.failureClusterId).toEqual(expect.any(Number));
    expect(cart.failureClusterId).not.toBe(loginHeader.failureClusterId);
    loginClusterId = loginHeader.failureClusterId;
  });

  test('the None grouping lists failures first with their error text and a cluster chip', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);
    await selectGroup(page, 'None');

    // Failure-first default order, stable within each status.
    await expect(visibleTitles(page)).toHaveCount(4);
    await expect(visibleTitles(page).nth(0)).toHaveText('login via header');
    await expect(visibleTitles(page).nth(1)).toHaveText('login via modal');
    await expect(visibleTitles(page).nth(2)).toHaveText('cart shows items');
    await expect(visibleTitles(page).nth(3)).toHaveText('homepage loads');

    // The one-line headline under each failed title, with the raw error as its tooltip.
    const loginHeadline = page
      .getByText("getByTestId('login-button') was not found on the page — click timed out after 30 s")
      .filter({ visible: true });
    await expect(loginHeadline).toBeVisible();
    await expect(loginHeadline).toHaveAttribute('title', /TimeoutError: locator\.click: Timeout 30000ms exceeded\./);
    await expect(
      page
        .getByText('Expected text "3 items", got "0 items" — getByTestId(\'cart-total\') toHaveText')
        .filter({ visible: true }),
    ).toBeVisible();

    // A cluster chip on every failing row links to the cluster page.
    const clusterLinks = page.locator('a[href^="/failure-clusters/"]:visible');
    await expect(clusterLinks).toHaveCount(3, { timeout: 15000 });
    await expect(clusterLinks.first()).toHaveAttribute('href', `/failure-clusters/${loginClusterId}`);
  });

  test('the cluster grouping is the default on a red run and hides passing tests under a group', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    // Two clusters, each with an "Open cluster" link in its group header.
    await expect(page.getByRole('link', { name: /Open cluster/ })).toHaveCount(2, { timeout: 15000 });

    // The passing row lives in a collapsed Passed group, so only the failures show.
    await expect(visibleTitles(page)).toHaveCount(3);
    await expect(page.getByText('homepage loads')).toHaveCount(0);

    // Switching to None reveals every row.
    await selectGroup(page, 'None');
    await expect(visibleTitles(page)).toHaveCount(4);
  });

  test('the File + Describe grouping nests tests under their describe block', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);
    await selectGroup(page, 'File + Describe');

    // The two auth tests share a describe block, so a nested "Authentication"
    // group header appears (under its file) with both tests beneath it.
    await expect(page.getByText('Authentication', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(visibleTitles(page).filter({ hasText: 'login via header' })).toHaveCount(1);
    await expect(visibleTitles(page).filter({ hasText: 'login via modal' })).toHaveCount(1);
  });

  test('the count bar filters the list and switches to the Tests tab from another tab', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    // Move to another tab first, then click a count-bar segment.
    await page
      .getByRole('button', { name: /^Timeline/ })
      .first()
      .click();
    await expect(page).toHaveURL(/tab=workers/);

    await page.getByRole('button', { name: '3 failed' }).first().click();

    // It lands back on the Tests tab with only the failing rows.
    await expect(page).toHaveURL(/tab=test-cases/);
    await expect(groupBy(page)).toBeVisible();
    await expect(visibleTitles(page)).toHaveCount(3);
    await expect(page.getByText('homepage loads')).toHaveCount(0);
  });

  test('search matches the error text, not only the title', async ({ page }) => {
    await page.goto(`/test-runs/${runId}`);
    await waitForHydration(page);

    // "0 items" only appears in the cart assertion's error, never in a title.
    await page.getByPlaceholder('Search title').fill('0 items');
    await expect(visibleTitles(page)).toHaveCount(1);
    await expect(visibleTitles(page).first()).toHaveText('cart shows items');
  });

  test('?tab=failure-groups redirects to the Tests tab with the cluster grouping', async ({ page }) => {
    await page.goto(`/test-runs/${runId}?tab=failure-groups`);
    await waitForHydration(page);

    await expect(page).toHaveURL(/tab=test-cases/);
    await expect(page.getByRole('link', { name: /Open cluster/ })).toHaveCount(2, { timeout: 15000 });
  });
});
