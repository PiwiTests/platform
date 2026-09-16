import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

test.describe.serial('Project Edit Tests', () => {
  let projectId: number;

  test.beforeAll(async ({ request }) => {
    // Create a test project
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.EDIT_TEST,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 120000,
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'test case 1',
            status: 'passed',
            duration: 1000,
            location: 'tests/test.spec.ts:10:5',
            retries: 0,
          },
        ],
      },
    });

    const data = await response.json();
    projectId = data.projectId;
  });

  test('should update project label, an description via API', async ({ request }) => {
    const response = await request.patch(`/api/projects/${projectId}`, {
      data: {
        label: 'My Custom Label',
        description: 'This is a custom description',
      },
    });

    expect(response.ok()).toBeTruthy();
    const { project: updatedProject } = await response.json();

    expect(updatedProject.label).toBe('My Custom Label');
    expect(updatedProject.description).toBe('This is a custom description');
    expect(updatedProject.name).toBe(PROJECT.EDIT_TEST); // Name should not change
  });

  test('should allow nullable fields', async ({ request }) => {
    const response = await request.patch(`/api/projects/${projectId}`, {
      data: {
        label: null,
        description: null,
      },
    });

    expect(response.ok()).toBeTruthy();
    const { project: updatedProject } = await response.json();

    expect(updatedProject.label).toBeNull();
    expect(updatedProject.description).toBeNull();
  });

  test('should display edit button on projects list page', async ({ page }) => {
    await page.goto('/projects');

    // Wait for table to load
    await page.waitForSelector('table', { timeout: 5000 });

    // Check for Edit button (there should be at least one)
    const editButton = page.getByRole('link', { name: 'Edit' }).first();
    await expect(editButton).toBeVisible();
  });

  test('should redirect the edit route into the Settings tab', async ({ page }) => {
    // The edit page folded into the project's Settings tab.
    await page.goto(`/projects/${projectId}/edit`);

    await page.waitForURL(new RegExp(`/projects/${projectId}\\?tab=settings`));
    await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible();
  });

  test('should display edit form', async ({ page }) => {
    await page.goto(`/projects/${projectId}?tab=settings`);

    // Check form is visible
    await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible();

    // Check that form fields are present
    await expect(page.locator('input').first()).toBeVisible();
    await expect(page.locator('textarea').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  });

  test('should display custom label in project list', async ({ page, request }) => {
    // Update the project via API
    await request.patch(`/api/projects/${projectId}`, {
      data: {
        label: 'Custom Display Label',
      },
    });

    // Navigate to projects list
    await page.goto('/projects');

    // Wait for content to load
    await page.waitForSelector('table', { timeout: 5000 });

    // Check that custom label is displayed
    const label = page.locator('a').filter({ hasText: 'Custom Display Label' }).first();
    await expect(label).toBeVisible();
  });

  test('should use custom label when set', async ({ request }) => {
    // Set a custom label via API
    const response = await request.patch(`/api/projects/${projectId}`, {
      data: {
        label: 'API Test Label',
      },
    });

    expect(response.ok()).toBeTruthy();
    const { project: updated } = await response.json();
    expect(updated.label).toBe('API Test Label');

    // Verify by fetching the project
    const getResponse = await request.get(`/api/projects/${projectId}`);
    expect(getResponse.ok()).toBeTruthy();
    const project = await getResponse.json();
    expect(project.label).toBe('API Test Label');
  });

  test('should reach Settings from the navbar More menu', async ({ page }) => {
    await page.goto(`/projects/${projectId}`);
    await waitForHydration(page);

    // Edit moved into the navbar's More menu, and opens the Settings tab.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?tab=settings`));
    await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible();
  });
});
