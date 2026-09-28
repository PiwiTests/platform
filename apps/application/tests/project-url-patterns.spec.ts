import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';
import { waitForHydration } from './utils';

/**
 * A project's URL patterns: the endpoints the browser extension reads and
 * writes, and the editor in the project's Settings tab, which suggests one
 * pattern per origin the suite visited.
 */
test.describe.serial('project URL patterns', () => {
  let projectId: number;

  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.URL_PATTERNS,
        status: 'passed',
        startTime: new Date(Date.now() - 60_000).toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        metadata: { htmlReport: { projects: [{ use: { baseURL: 'https://staging.shop.example/app' } }] } },
        testCases: [{ title: 'opens the shop', status: 'passed', duration: 100, location: 'tests/shop.spec.ts:3:1' }],
      },
    });
    expect(res.ok()).toBeTruthy();
    projectId = ((await res.json()) as { projectId: number }).projectId;
    await request.put(`/api/projects/${projectId}/url-patterns`, { data: { items: [] } });
  });

  test('replace, add, refuse a duplicate and an address without a scheme', async ({ request }) => {
    const put = await request.put(`/api/projects/${projectId}/url-patterns`, {
      data: { items: [{ pattern: 'https://shop.example/**', environment: 'production' }] },
    });
    expect(put.ok()).toBeTruthy();

    const post = await request.post(`/api/projects/${projectId}/url-patterns`, {
      data: { pattern: 'https://qa.shop.example/**', branch: 'develop', pathPrefix: 'app/' },
    });
    expect(post.status()).toBe(201);

    const list = (await (await request.get(`/api/projects/${projectId}/url-patterns`)).json()) as {
      items: Array<{ pattern: string; environment: string | null; branch: string | null; pathPrefix: string | null }>;
    };
    expect(list.items.map((i) => [i.pattern, i.environment, i.branch, i.pathPrefix])).toEqual([
      ['https://shop.example/**', 'production', null, null],
      ['https://qa.shop.example/**', null, 'develop', '/app'],
    ]);

    const badPrefix = await request.post(`/api/projects/${projectId}/url-patterns`, {
      data: { pattern: 'https://eu.shop.example/**', pathPrefix: '/app?lang=fr' },
    });
    expect(badPrefix.status()).toBe(400);

    const duplicate = await request.post(`/api/projects/${projectId}/url-patterns`, {
      data: { pattern: 'https://shop.example/**' },
    });
    expect(duplicate.status()).toBe(409);
    const invalid = await request.post(`/api/projects/${projectId}/url-patterns`, {
      data: { pattern: 'shop.example/**' },
    });
    expect(invalid.status()).toBe(400);

    const visible = (await (await request.get('/api/extension/url-patterns')).json()) as {
      user: unknown;
      items: Array<{ projectId: number; pattern: string; pathPrefix: string | null }>;
      projects: Array<{ id: number; canEdit: boolean }>;
    };
    expect(visible.user).toBeNull(); // authentication is off on this server
    expect(visible.items.filter((i) => i.projectId === projectId).map((i) => [i.pattern, i.pathPrefix])).toEqual([
      ['https://shop.example/**', null],
      ['https://qa.shop.example/**', '/app'],
    ]);
    expect(visible.projects.find((p) => p.id === projectId)?.canEdit).toBe(true);
  });

  test('suggestions come from the base URL of the project’s runs', async ({ request }) => {
    await request.put(`/api/projects/${projectId}/url-patterns`, { data: { items: [] } });
    const suggestions = (await (await request.get(`/api/projects/${projectId}/url-patterns/suggestions`)).json()) as {
      items: Array<{ pattern: string; sources: string[] }>;
    };
    expect(suggestions.items).toContainEqual(
      expect.objectContaining({ pattern: 'https://staging.shop.example/**', sources: ['base-url'] }),
    );
  });

  test('the Settings tab adds a suggestion and saves the list', async ({ page, request }) => {
    await request.put(`/api/projects/${projectId}/url-patterns`, { data: { items: [] } });
    await page.goto(`/projects/${projectId}?tab=settings`);
    await waitForHydration(page);

    const card = page.locator('[data-shot="project-url-patterns"]');
    await expect(card.getByRole('heading', { name: 'Browser extension URLs' })).toBeVisible();
    await expect(card.getByText('No pattern yet.')).toBeVisible();
    await card.getByRole('button', { name: 'Add https://staging.shop.example/**' }).click();
    await card.getByLabel('Environment').fill('staging');
    await expect(card.getByTestId('url-pattern-prefix-hint')).toContainText(
      'your site serves the pages under this path, the tests did not, e.g. /app',
    );
    await card.getByLabel('Path prefix').fill('app/');
    await card.getByRole('button', { name: 'Save patterns' }).click();
    await expect(page.getByText('URL patterns saved', { exact: true })).toBeVisible();

    const list = (await (await request.get(`/api/projects/${projectId}/url-patterns`)).json()) as {
      items: Array<{ pattern: string; environment: string | null; pathPrefix: string | null }>;
    };
    expect(list.items).toEqual([
      expect.objectContaining({
        pattern: 'https://staging.shop.example/**',
        environment: 'staging',
        pathPrefix: '/app',
      }),
    ]);

    await page.reload();
    await waitForHydration(page);
    await expect(card.getByLabel('URL pattern')).toHaveValue('https://staging.shop.example/**');
    await expect(card.getByLabel('Path prefix')).toHaveValue('/app');
    // A pattern already in the list is no longer suggested.
    await expect(card.getByTestId('url-pattern-suggestions')).toBeHidden();
  });

  test('the editor flags a pattern without a scheme and does not save it', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=settings`);
    await waitForHydration(page);
    const card = page.locator('[data-shot="project-url-patterns"]');
    await card.getByRole('button', { name: 'Add a pattern' }).click();
    await card.getByLabel('URL pattern').last().fill('shop.example/**');
    await expect(card.getByText('Start with http://, https:// or a wildcard')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Save patterns' })).toBeDisabled();
  });

  test('the editor flags a path prefix with a query and does not save it', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=settings`);
    await waitForHydration(page);
    const card = page.locator('[data-shot="project-url-patterns"]');
    await card.getByLabel('Path prefix').first().fill('/app?lang=fr');
    await expect(card.getByText('No query or hash')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Save patterns' })).toBeDisabled();
  });
});
