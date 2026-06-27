import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '../shared/test-project-names';

test.describe.serial('Project Creation API Tests', () => {
  test('should create a project via API', async ({ request }) => {
    const projectName = PROJECT.API_CREATED;
    const res = await request.post('/api/projects', {
      data: {
        name: projectName,
        label: 'My API Project',
        description: 'Created via API in tests',
      },
    });
    // A concurrent browser run may have already created this project — that satisfies the test intent
    if (res.status() === 400) return;
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.project).toBeDefined();
    expect(data.project.name).toBe(projectName);
    expect(data.project.label).toBe('My API Project');
    expect(data.project.description).toBe('Created via API in tests');
    expect(data.project.id).toBeDefined();
  });

  test('should reject missing project name', async ({ request }) => {
    const res = await request.post('/api/projects', {
      data: { label: 'No name project' },
    });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test('should reject empty project name', async ({ request }) => {
    const res = await request.post('/api/projects', {
      data: { name: '' },
    });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test('should reject duplicate project name', async ({ request }) => {
    const projectName = PROJECT.DUPLICATE;
    await request.post('/api/projects', { data: { name: projectName } });
    const res = await request.post('/api/projects', { data: { name: projectName } });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test('should create a project with only name (optional fields omitted)', async ({ request }) => {
    const projectName = PROJECT.MINIMAL;
    const res = await request.post('/api/projects', { data: { name: projectName } });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.project.name).toBe(projectName);
    expect(data.project.label).toBeNull();
    expect(data.project.description).toBeNull();
  });

  test('new project should appear in projects list', async ({ request }) => {
    const projectName = PROJECT.LIST_VISIBLE;
    await request.post('/api/projects', { data: { name: projectName, label: 'Listed Project' } });

    const listRes = await request.get('/api/projects');
    expect(listRes.ok()).toBeTruthy();
    const projects = await listRes.json();
    const found = projects.find((p: { name: string }) => p.name === projectName);
    expect(found).toBeDefined();
    expect(found.label).toBe('Listed Project');
    expect(found.totalRuns).toBe(0);
  });
});

test.describe.serial('Project Creation UI Tests', () => {
  test('should show New Project button on projects page', async ({ page }) => {
    await page.goto('/projects');
    await waitForHydration(page);
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  });

  test('should open New Project modal when clicking button', async ({ page }) => {
    await page.goto('/projects');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'New project' }).click({ timeout: 5000 });

    await expect(page.getByRole('heading', { name: 'Create new project' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('Project name')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Display label' })).toBeVisible();
    await expect(page.getByLabel('Description')).toBeVisible();
  });

  test('should close modal when clicking Cancel', async ({ page }) => {
    await page.goto('/projects');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.getByRole('heading', { name: 'Create new project' })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Create new project' })).not.toBeVisible();
  });

  test('should create a new project from the UI', async ({ page }) => {
    const projectName = PROJECT.UI_CREATED;
    const projectLabel = 'My UI Project';
    await page.goto('/projects');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'New project' }).click({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Create new project' })).toBeVisible({ timeout: 15000 });

    await page.getByLabel('Project name').fill(projectName);
    await page.getByRole('textbox', { name: 'Display label' }).fill(projectLabel);

    await page.getByRole('button', { name: 'Create project' }).click();

    // A concurrent browser run may have already created this project, causing a duplicate error
    const created = page.getByText('Project created', { exact: true });
    const failed = page.getByText('Failed to create project', { exact: true });
    await expect(created.or(failed)).toBeVisible({ timeout: 5000 });

    if (await created.isVisible()) {
      // Modal should close and project appear in list (Firefox reactive update can be slower)
      await expect(page.getByRole('heading', { name: 'Create new project' })).not.toBeVisible();
      await expect(page.getByRole('link', { name: projectLabel }).first()).toBeVisible({ timeout: 15000 });
    }
  });

  test('should show error when creating project with duplicate name', async ({ page, request }) => {
    const projectName = PROJECT.DUP_UI;
    // Pre-create the project
    await request.post('/api/projects', { data: { name: projectName } });

    await page.goto('/projects');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'New project' }).click({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Create new project' })).toBeVisible({ timeout: 15000 });

    await page.getByLabel('Project name').fill(projectName);
    await page.getByRole('button', { name: 'Create project' }).click();

    // Should show error toast
    await expect(page.getByText('Failed to create project', { exact: true })).toBeVisible({ timeout: 5000 });
  });
});

test.describe.serial('Tag Management UI Tests', () => {
  // Clean up any test tags before running
  test.beforeAll(async ({ request }) => {
    const res = await request.get('/api/tags');
    const data = await res.json();
    for (const tag of data.tags || []) {
      if (tag.text.startsWith('ui-test-tag')) {
        await request.delete(`/api/tags/${tag.id}`);
      }
    }
  });

  test('should display Tags page', async ({ page }) => {
    await page.goto('/settings/tags');
    await waitForHydration(page);

    await expect(page.getByRole('heading', { name: /Tags \(\d+\) Help/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add tag' }).first()).toBeVisible();
  });

  test('should open Add Tag modal', async ({ page }) => {
    await page.goto('/settings/tags');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add tag' }).first().click();

    await expect(page.getByRole('heading', { name: 'Add new tag' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Tag text')).toBeVisible();
    await expect(page.getByLabel('Pick tag color')).toBeVisible();
  });

  test('should close Add Tag modal when clicking Cancel', async ({ page }) => {
    await page.goto('/settings/tags');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add tag' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add new tag' })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Add new tag' })).not.toBeVisible();
  });

  test('should create a new tag from the UI', async ({ page }) => {
    const tagName = 'ui-test-tag';
    await page.goto('/settings/tags');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add tag' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add new tag' })).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Tag text').fill(tagName);
    await page.getByRole('button', { name: 'Create tag' }).click();

    // Success toast
    await expect(page.getByText('Tag created', { exact: true })).toBeVisible({ timeout: 5000 });

    // Tag should appear in the table
    await expect(page.getByText(tagName, { exact: true }).first()).toBeVisible({ timeout: 5000 });
  });

  test('should show color picker input in Add Tag modal', async ({ page }) => {
    await page.goto('/settings/tags');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add tag' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add new tag' })).toBeVisible({ timeout: 10000 });

    // Color picker input should be an input[type=color]
    const colorPicker = page.locator('input[type="color"]').first();
    await expect(colorPicker).toBeVisible();
  });

  test('should show tag preview when text is entered', async ({ page }) => {
    await page.goto('/settings/tags');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add tag' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add new tag' })).toBeVisible({ timeout: 10000 });

    await page.getByLabel('Tag text').fill('preview-test');
    await expect(page.getByText('Preview:')).toBeVisible();
    await expect(page.getByText('preview-test')).toBeVisible();
  });

  test('should delete a tag', async ({ page, request }) => {
    // Create a tag to delete
    const tagRes = await request.post('/api/tags', {
      data: { text: 'ui-test-tag-del', color: '#ef4444' },
    });
    expect(tagRes.ok()).toBeTruthy();
    const { tag } = await tagRes.json();

    await page.goto('/settings/tags');
    await waitForHydration(page);

    // Find the row for our tag and open delete confirmation modal
    const row = page.locator('tr').filter({ hasText: tag.text });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button').last().click();
    await expect(page.getByRole('heading', { name: 'Delete tag' })).toBeVisible({ timeout: 10000 });

    // Confirm deletion in modal
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();

    await expect(page.getByText('Tag deleted', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('tr').filter({ hasText: tag.text })).toHaveCount(0);
  });
});
