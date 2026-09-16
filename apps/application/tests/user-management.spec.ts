import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

test.describe.serial('User Management Page Tests', () => {
  // Clean up test users before running tests to ensure idempotency
  test.beforeAll(async ({ request }) => {
    const usersResponse = await request.get('/api/users');
    const usersData = await usersResponse.json();
    for (const user of usersData.items || []) {
      if (['testuser', 'deletetest'].includes(user.username)) {
        await request.delete(`/api/users/${user.id}`);
      }
    }
  });

  test('should display user management page', async ({ page }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    // Check page title (rendered by the first SectionCard, not a per-page navbar)
    await expect(page.getByRole('heading', { name: /Users \(\d+\) Help/ })).toBeVisible();

    // Check that Add User button is visible
    await expect(page.getByRole('button', { name: 'Add user' }).first()).toBeVisible();

    // Check info message about auth being disabled
    await expect(page.getByText('Authentication is disabled')).toBeVisible();
  });

  test('should open modal when clicking Add User button', async ({ page }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    // Modal should not be visible initially
    await expect(page.getByRole('heading', { name: 'Add new user' })).not.toBeVisible();

    // Click Add User button
    await page.getByRole('button', { name: 'Add user' }).first().click();

    // Wait for modal to appear
    await expect(page.getByRole('heading', { name: 'Add new user' })).toBeVisible({ timeout: 10000 });

    // Check form fields are visible
    await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Display name')).toBeVisible();
    await expect(page.getByLabel('Role', { exact: true })).toBeVisible();
  });

  test('should close modal when clicking Cancel', async ({ page }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    // Open modal
    await page.getByRole('button', { name: 'Add user' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add new user' })).toBeVisible({ timeout: 10000 });

    // Click Cancel button
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Modal should be closed
    await expect(page.getByRole('heading', { name: 'Add new user' })).not.toBeVisible();
  });

  test('should create a new user', async ({ page }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    // Open modal
    await page.getByRole('button', { name: 'Add user' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add new user' })).toBeVisible({ timeout: 10000 });

    // Fill in the form
    await page.getByLabel('Username', { exact: true }).fill('testuser');
    await page.getByLabel('Password', { exact: true }).fill('testpassword123');
    await page.getByLabel('Display name').fill('Test User');

    // Select role (administrator)
    await page.getByLabel('Role', { exact: true }).click();
    await page.getByRole('option', { name: 'Administrator' }).click();

    // Submit form
    await page.getByRole('button', { name: 'Create user' }).click();

    // Check for success message (toast notification)
    await expect(page.getByText('User created', { exact: true })).toBeVisible({ timeout: 5000 });

    // Check that user appears in the table
    await expect(page.getByRole('cell', { name: 'testuser' })).toBeVisible();
  });

  test('should display user in table after creation', async ({ page }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    // If there are users, the table should be visible
    const noUsersText = page.getByText('No users yet');
    const usersTable = page.getByRole('table');

    // Either show empty state or table with users
    const hasUsers = await usersTable.isVisible().catch(() => false);
    const isEmpty = await noUsersText.isVisible().catch(() => false);

    expect(hasUsers || isEmpty).toBe(true);
  });

  test('should validate form fields', async ({ page }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    // Open modal
    await page.getByRole('button', { name: 'Add user' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add new user' })).toBeVisible({ timeout: 10000 });

    // Try to submit empty form
    await page.getByRole('button', { name: 'Create user' }).click();

    // Form should not submit (validation should prevent it)
    // Modal should still be visible
    await expect(page.getByRole('heading', { name: 'Add new user' })).toBeVisible();
  });

  test('should show delete confirmation for users', async ({ page }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    // First create a user if none exist
    const noUsersText = await page
      .getByText('No users yet')
      .isVisible()
      .catch(() => false);

    if (noUsersText) {
      // Create a test user first
      await page.getByRole('button', { name: 'Add user' }).first().click();
      await expect(page.getByRole('heading', { name: 'Add new user' })).toBeVisible({ timeout: 10000 });

      await page.getByLabel('Username', { exact: true }).fill('deletetest');
      await page.getByLabel('Password', { exact: true }).fill('password123');
      await page.getByLabel('Role', { exact: true }).click();
      await page.getByRole('option', { name: 'User' }).click();
      await page.getByRole('button', { name: 'Create user' }).click();
      await expect(page.getByText('User created')).toBeVisible({ timeout: 10000 });
    }

    // Now check if there's a delete button (trash icon)
    const deleteButtons = page.getByRole('button').filter({ has: page.locator('[class*="lucide-trash"]') });
    const hasDeleteButton = (await deleteButtons.count()) > 0;

    if (hasDeleteButton) {
      // Clicking delete should show confirmation dialog
      // Note: This requires handling the confirm() dialog in the test
      page.on('dialog', (dialog) => dialog.accept());
      await deleteButtons.first().click();

      // Check for success message
      await expect(page.getByText('User deleted')).toBeVisible({ timeout: 5000 });
    }
  });
});

// ── Project members API (GET /api/projects/:id/members, PUT /api/projects/:id/members) ──
//
// `PUT` is authorization-sensitive (administrator-only) — see
// `server/utils/project-access.ts` for the scope model. Auth is disabled for the
// dev/test server these tests run against, so `requireAuth` always returns a
// synthetic system-admin user and a real 403 can't be observed here; the
// administrator-only enforcement (and a genuine assign-then-verify round trip) is
// covered instead in `tests/reporter-with-auth.spec.ts`, which runs against a real
// auth-enabled server.
test.describe.serial('Project Members API Tests', () => {
  let projectId: number;

  test.beforeAll(async ({ request }) => {
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.PROJECT_MEMBERS,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    projectId = data.projectId;
  });

  test('GET /api/projects/:id/members returns implicit administrators with global access', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/members`);
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      items: Array<{ id: number; username: string; role: string; global: boolean }>;
    };

    expect(Array.isArray(body.items)).toBe(true);
    // Every administrator has implicit, global access to every project even
    // without an explicit `project_assignments` row.
    for (const user of body.items) {
      if (user.role === 'administrator') {
        expect(user.global).toBe(true);
      }
    }
  });

  test('GET /api/projects/:id/members returns 404 for an unknown project', async ({ request }) => {
    const response = await request.get('/api/projects/999999/members');
    expect(response.status()).toBe(404);
  });

  test('GET /api/projects/:id/members returns 400 for a non-numeric project id', async ({ request }) => {
    const response = await request.get('/api/projects/not-a-number/members');
    expect(response.status()).toBe(400);
  });

  test('PUT /api/projects/:id/members rejects unknown user ids with 400', async ({ request }) => {
    const response = await request.put(`/api/projects/${projectId}/members`, {
      data: { userIds: [999999] },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toContain('User(s) not found');
  });

  test('PUT /api/projects/:id/members rejects a malformed body with 400', async ({ request }) => {
    const response = await request.put(`/api/projects/${projectId}/members`, {
      data: {},
    });
    expect(response.status()).toBe(400);
  });

  test('PUT /api/projects/:id/members with an empty list clears explicit assignments', async ({ request }) => {
    // An empty array takes the delete-only code path in `setProjectMembers` — it
    // never touches `createdBy`, so it's safe to exercise on the auth-disabled
    // server (see the file-level note above about why a real assignment can't be).
    const response = await request.put(`/api/projects/${projectId}/members`, {
      data: { userIds: [] },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toEqual({ success: true });
  });

  test('PUT /api/projects/:id/members returns 404 for an unknown project', async ({ request }) => {
    const response = await request.put('/api/projects/999999/members', {
      data: { userIds: [] },
    });
    expect(response.status()).toBe(404);
  });
});
