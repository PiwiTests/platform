/**
 * UI tests for the project test catalog, folded into the project's Tests tab:
 * server-driven search, status filtering and the group-by-file view on the
 * shared table. The old `/projects/:id/test-cases` route redirects into the tab.
 */
import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';

async function seed(request: APIRequestContext) {
  const res = await retryPost(request, '/api/test-runs/submit', {
    data: {
      projectName: PROJECT.TEST_CASES_CATALOG,
      status: 'failed',
      startTime: new Date().toISOString(),
      duration: 5000,
      totalTests: 4,
      passedTests: 3,
      failedTests: 1,
      skippedTests: 0,
      testCases: [
        { title: 'login works', status: 'passed', duration: 500, location: 'tests/auth/login.spec.ts:1:1' },
        {
          title: 'login validation',
          status: 'passed',
          retries: 2,
          duration: 800,
          location: 'tests/auth/login.spec.ts:20:1',
        },
        {
          title: 'checkout works',
          status: 'failed',
          duration: 1200,
          location: 'tests/shop/checkout.spec.ts:1:1',
          error: 'Error: expected total to update\n    at tests/shop/checkout.spec.ts:5:3',
        },
        { title: 'checkout tax', status: 'passed', duration: 640, location: 'tests/shop/checkout.spec.ts:30:1' },
      ],
    },
    timeout: 20000,
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { projectId: number };
}

test.describe.serial('Project test-cases catalog', () => {
  let projectId = 0;

  test('seeds a project with four test cases', async ({ request }) => {
    const { projectId: id } = await seed(request);
    projectId = id;
    expect(projectId).toBeGreaterThan(0);
  });

  test('lists cases with title and file path', async ({ page }) => {
    await page.goto(`/projects/${projectId}/test-cases`);
    await waitForHydration(page);

    await expect(page.getByText('4 tests')).toBeVisible();
    await expect(page.getByRole('link', { name: 'login works' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'checkout works' })).toBeVisible();
    await expect(page.getByText('tests/auth/login.spec.ts').first()).toBeVisible();
  });

  test('search narrows the list to matching cases', async ({ page }) => {
    await page.goto(`/projects/${projectId}/test-cases`);
    await waitForHydration(page);

    await page.getByRole('textbox', { name: 'Search tests' }).fill('checkout');
    // The query is debounced and refetched server-side; web-first assertions retry.
    await expect(page.getByRole('link', { name: 'checkout works' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'login works' })).toHaveCount(0);
    await expect(page.getByText('2 tests')).toBeVisible();
  });

  test('the Failed status pill filters to failing cases', async ({ page }) => {
    await page.goto(`/projects/${projectId}/test-cases`);
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Failed', exact: true }).click();
    await expect(page.getByRole('link', { name: 'checkout works' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'login works' })).toHaveCount(0);
    await expect(page.getByText('1 test', { exact: true })).toBeVisible();
  });

  test('group by file groups tests under their spec-file prefix', async ({ page }) => {
    await page.goto(`/projects/${projectId}/test-cases`);
    await waitForHydration(page);

    await page.getByRole('button', { name: 'File', exact: true }).click();
    // Each spec-file prefix appears as a group header with its test count.
    await expect(page.getByText('tests/auth', { exact: true })).toBeVisible();
    await expect(page.getByText('tests/shop', { exact: true })).toBeVisible();
    await expect(page.getByText('2 tests').first()).toBeVisible();
  });
});
