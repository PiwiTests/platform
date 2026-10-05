import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

test.describe.serial('User Management Page Tests', () => {
  const GROUP_NAME = 'user-page-group';
  let projectId: number;

  async function cleanUp(request: APIRequestContext) {
    const usersData = (await (await request.get('/api/users')).json()) as {
      items?: { id: number; username: string }[];
    };
    for (const user of usersData.items || []) {
      if (['testuser', 'deletetest'].includes(user.username)) await request.delete(`/api/users/${user.id}`);
    }
    const { groups } = (await (await request.get('/api/groups')).json()) as { groups: { id: number; name: string }[] };
    for (const group of groups) if (group.name === GROUP_NAME) await request.delete(`/api/groups/${group.id}`);
  }

  // Clean up test users and groups before running tests to ensure idempotency
  test.beforeAll(async ({ request }) => {
    await cleanUp(request);
    expect((await request.post('/api/groups', { data: { name: GROUP_NAME } })).ok()).toBeTruthy();
    const submit = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.USER_PROJECT_ROLES,
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
    expect(submit.ok()).toBeTruthy();
    projectId = ((await submit.json()) as { projectId: number }).projectId;
  });

  test.afterAll(async ({ request }) => cleanUp(request));

  async function userNamed(request: APIRequestContext, username: string) {
    const { items } = (await (await request.get('/api/users')).json()) as {
      items: { id: number; username: string; instanceRole: string; groupIds: number[] }[];
    };
    return items.find((u) => u.username === username);
  }

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
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Groups', exact: true })).toBeVisible();

    // The instance roles are Member and Administrator; the roles of earlier versions are gone.
    await page.getByLabel('Role', { exact: true }).click();
    await expect(page.getByRole('option')).toHaveText(['Member', 'Administrator']);
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

  test('should create a new user', async ({ page, request }) => {
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
    await expect(page.getByRole('cell', { name: 'Test User @testuser' })).toBeVisible();
    expect(await userNamed(request, 'testuser')).toMatchObject({ instanceRole: 'administrator', groupIds: [] });
  });

  test('admin can change an existing user role from the table', async ({ page, request }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    // `testuser` was created as an administrator by the previous test; make it a
    // member through the inline role selector in the table.
    const roleSelect = page.getByRole('combobox', { name: 'Change role for testuser' });
    await expect(roleSelect).toBeVisible();
    await roleSelect.click();
    await page.getByRole('option', { name: 'Member', exact: true }).click();

    await expect(page.getByText('Role updated', { exact: true })).toBeVisible({ timeout: 5000 });

    // The change is persisted server-side.
    await expect.poll(async () => (await userNamed(request, 'testuser'))?.instanceRole).toBe('member');
  });

  test("the groups column saves a user's groups", async ({ page, request }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    const groupsSelect = page.getByRole('button', { name: 'Groups of testuser' });
    await groupsSelect.click();
    await page.getByRole('option', { name: GROUP_NAME }).click();
    // The pick is saved once the menu closes.
    await page.keyboard.press('Escape');
    await expect(page.getByText('Groups updated', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(groupsSelect).toContainText(GROUP_NAME);

    const { groups } = (await (await request.get('/api/groups')).json()) as { groups: { id: number; name: string }[] };
    const groupId = groups.find((g) => g.name === GROUP_NAME)!.id;
    await expect.poll(async () => (await userNamed(request, 'testuser'))?.groupIds).toEqual([groupId]);
  });

  test("Project roles edits a member's roles on all projects and on one project", async ({ page, request }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Project roles of testuser' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Project roles – testuser/ })).toBeVisible();
    // The groups the user belongs to are named, read-only.
    await expect(dialog.getByText(`Also holds the roles of ${GROUP_NAME}`)).toBeVisible();

    await dialog.getByLabel('All projects').click();
    await page.getByRole('option', { name: 'Viewer', exact: true }).click();

    await dialog.getByRole('button', { name: 'Add a project' }).click();
    await page.getByRole('option', { name: PROJECT.USER_PROJECT_ROLES }).click();
    const projectRole = dialog.getByRole('combobox', { name: `Role on ${PROJECT.USER_PROJECT_ROLES}` });
    await expect(projectRole).toHaveText('Viewer');
    await projectRole.click();
    await page.getByRole('option', { name: 'Maintainer', exact: true }).click();

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Project roles updated', { exact: true })).toBeVisible({ timeout: 5000 });

    const user = await userNamed(request, 'testuser');
    expect(await (await request.get(`/api/users/${user!.id}/projects`)).json()).toMatchObject({
      allProjects: 'viewer',
      projects: [{ projectId, role: 'maintainer' }],
      groups: [expect.objectContaining({ name: GROUP_NAME })],
    });
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

  test('deleting a user asks for confirmation first', async ({ page, request }) => {
    await page.goto('/settings/users');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Delete testuser' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Are you sure you want to delete user')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete user' }).click();

    await expect(page.getByText('User deleted', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => await userNamed(request, 'testuser')).toBeUndefined();
  });
});

// ── Project members API (GET /api/projects/:id/members, PUT /api/projects/:id/members) ──
//
// `PUT` is authorization-sensitive (`project:members`, Project admin or
// administrator) — see `server/utils/project-access.ts`. Auth is disabled for
// the dev/test server these tests run against, so `requireAuth` always returns
// a synthetic system-admin user and a real 403 can't be observed here; the
// Project admin grant rules are covered by `tests/unit/project-access-handlers.test.ts`.
interface MemberRow {
  subject: { type: 'user' | 'group'; id: number };
  username: string | null;
  role: string;
  source: string;
}

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

  test('GET /api/projects/:id/members lists the administrators, who need no binding', async ({ request }) => {
    const response = await request.get(`/api/projects/${projectId}/members`);
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { members: MemberRow[]; canManage: boolean; grantableRoles: string[] };

    expect(Array.isArray(body.members)).toBe(true);
    expect(body.canManage).toBe(true);
    expect(body.grantableRoles).toEqual(['viewer', 'contributor', 'maintainer', 'project_admin', 'uploader']);
    const { items: users } = (await (await request.get('/api/users')).json()) as {
      items: { id: number; instanceRole: string }[];
    };
    // Every administrator opens every project without a role binding.
    for (const admin of users.filter((u) => u.instanceRole === 'administrator')) {
      expect(body.members).toContainEqual(
        expect.objectContaining({
          subject: { type: 'user', id: admin.id },
          source: 'administrator',
          role: 'project_admin',
        }),
      );
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

  test('PUT /api/projects/:id/members rejects unknown users and groups with 400', async ({ request }) => {
    const user = await request.put(`/api/projects/${projectId}/members`, {
      data: { entries: [{ subject: { type: 'user', id: 999999 }, role: 'viewer' }] },
    });
    expect(user.status()).toBe(400);
    expect((await user.json()).message).toContain('User(s) not found');

    const group = await request.put(`/api/projects/${projectId}/members`, {
      data: { entries: [{ subject: { type: 'group', id: 999999 }, role: 'viewer' }] },
    });
    expect(group.status()).toBe(400);
    expect((await group.json()).message).toContain('Group(s) not found');
  });

  test('PUT /api/projects/:id/members rejects a malformed body with 400', async ({ request }) => {
    expect((await request.put(`/api/projects/${projectId}/members`, { data: {} })).status()).toBe(400);
    expect((await request.put(`/api/projects/${projectId}/members`, { data: { userIds: [] } })).status()).toBe(400);
    const unknownRole = await request.put(`/api/projects/${projectId}/members`, {
      data: { entries: [{ subject: { type: 'user', id: 1 }, role: 'owner' }] },
    });
    expect(unknownRole.status()).toBe(400);
  });

  test('PUT /api/projects/:id/members with no entries clears the direct bindings', async ({ request }) => {
    const response = await request.put(`/api/projects/${projectId}/members`, { data: { entries: [] } });
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { success: boolean; members: MemberRow[] };
    expect(body.success).toBe(true);
    expect(body.members.filter((m) => m.source === 'direct')).toEqual([]);
  });

  test('roles save with authentication off, from either direction', async ({ request }) => {
    // The caller is the virtual administrator, which has no users row to record as the grantor.
    const username = 'members-api-user';
    const existing = (await (await request.get('/api/users')).json()) as { items: { id: number; username: string }[] };
    for (const user of existing.items) if (user.username === username) await request.delete(`/api/users/${user.id}`);
    const created = await request.post('/api/users', {
      data: { username, password: 'memberspassword123', role: 'member' },
    });
    expect(created.ok()).toBeTruthy();
    const userId = ((await created.json()) as { user: { id: number } }).user.id;

    try {
      const perProject = await request.put(`/api/projects/${projectId}/members`, {
        data: { entries: [{ subject: { type: 'user', id: userId }, role: 'contributor' }] },
      });
      expect(perProject.ok()).toBeTruthy();
      const members = (await (await request.get(`/api/projects/${projectId}/members`)).json()) as {
        members: MemberRow[];
      };
      expect(members.members).toContainEqual(
        expect.objectContaining({ subject: { type: 'user', id: userId }, role: 'contributor', source: 'direct' }),
      );

      const perUser = await request.put(`/api/users/${userId}/projects`, {
        data: { allProjects: 'viewer', projects: [{ projectId, role: 'maintainer' }] },
      });
      expect(perUser.ok()).toBeTruthy();
      expect(await (await request.get(`/api/users/${userId}/projects`)).json()).toEqual({
        allProjects: 'viewer',
        projects: [{ projectId, role: 'maintainer' }],
        groups: [],
      });
    } finally {
      await request.delete(`/api/users/${userId}`);
    }
  });

  test('PUT /api/projects/:id/members returns 404 for an unknown project', async ({ request }) => {
    const response = await request.put('/api/projects/999999/members', {
      data: { entries: [] },
    });
    expect(response.status()).toBe(404);
  });
});

// ── Users and groups API (/api/users, /api/groups) ──────────────────────────────
test.describe.serial('Users and Groups API Tests', () => {
  const USERNAME = 'users-api-legacy';
  const GROUP_NAME = 'users-api-group';

  async function cleanUp(request: import('@playwright/test').APIRequestContext) {
    const { items } = (await (await request.get('/api/users')).json()) as { items: { id: number; username: string }[] };
    for (const user of items) if (user.username === USERNAME) await request.delete(`/api/users/${user.id}`);
    const { groups } = (await (await request.get('/api/groups')).json()) as { groups: { id: number; name: string }[] };
    for (const group of groups) {
      if (group.name.startsWith(GROUP_NAME)) await request.delete(`/api/groups/${group.id}`);
    }
  }

  test.beforeAll(async ({ request }) => cleanUp(request));
  test.afterAll(async ({ request }) => cleanUp(request));

  test('a group is created, renamed, given members and deleted', async ({ request }) => {
    const created = await request.post('/api/groups', { data: { name: GROUP_NAME, description: 'QA' } });
    expect(created.status()).toBe(201);
    const group = ((await created.json()) as { group: { id: number; name: string; memberCount: number } }).group;
    expect(group).toMatchObject({ name: GROUP_NAME, memberCount: 0 });

    const duplicate = await request.post('/api/groups', { data: { name: GROUP_NAME } });
    expect(duplicate.status()).toBe(409);
    expect((await request.post('/api/groups', { data: { name: '  ' } })).status()).toBe(400);

    const renamed = await request.patch(`/api/groups/${group.id}`, { data: { name: `${GROUP_NAME}-qa` } });
    expect(renamed.ok()).toBeTruthy();
    expect(((await renamed.json()) as { group: { name: string } }).group.name).toBe(`${GROUP_NAME}-qa`);

    const user = await request.post('/api/users', {
      data: { username: USERNAME, password: 'legacypassword123', role: 'member', groupIds: [group.id] },
    });
    expect(user.ok()).toBeTruthy();
    const userId = ((await user.json()) as { user: { id: number; groupIds: number[] } }).user.id;

    const details = (await (await request.get(`/api/groups/${group.id}`)).json()) as {
      members: { id: number; username: string }[];
    };
    expect(details.members).toEqual([expect.objectContaining({ id: userId, username: USERNAME })]);

    const emptied = await request.put(`/api/groups/${group.id}/members`, { data: { userIds: [] } });
    expect(((await emptied.json()) as { group: { memberCount: number } }).group.memberCount).toBe(0);
    expect((await request.put(`/api/groups/${group.id}/members`, { data: { userIds: [999999] } })).status()).toBe(400);

    expect((await request.delete(`/api/groups/${group.id}`)).ok()).toBeTruthy();
    expect((await request.get(`/api/groups/${group.id}`)).status()).toBe(404);
    expect((await request.delete(`/api/groups/${group.id}`)).status()).toBe(404);
    await request.delete(`/api/users/${userId}`);
  });

  test('POST /api/users still accepts a role of an earlier version, stored as member', async ({ request }) => {
    const created = await request.post('/api/users', {
      data: { username: USERNAME, password: 'legacypassword123', role: 'reporter' },
    });
    expect(created.ok()).toBeTruthy();
    const user = ((await created.json()) as { user: { id: number; role: string; instanceRole: string } }).user;
    expect(user).toMatchObject({ role: 'member', instanceRole: 'member' });
    // A new member holds no project role until one is granted.
    expect(await (await request.get(`/api/users/${user.id}/projects`)).json()).toEqual({
      allProjects: null,
      projects: [],
      groups: [],
    });
    expect((await request.post('/api/users', { data: { username: 'x-unknown-role', role: 'owner' } })).status()).toBe(
      400,
    );
    await request.delete(`/api/users/${user.id}`);
  });

  test('PATCH /api/users/:id sets the instance role and the groups', async ({ request }) => {
    const created = await request.post('/api/users', {
      data: { username: USERNAME, password: 'legacypassword123', role: 'member' },
    });
    const userId = ((await created.json()) as { user: { id: number } }).user.id;
    const group = await request.post('/api/groups', { data: { name: `${GROUP_NAME}-patch` } });
    const groupId = ((await group.json()) as { group: { id: number } }).group.id;

    const patched = await request.patch(`/api/users/${userId}`, {
      data: { role: 'administrator', groupIds: [groupId] },
    });
    expect(patched.ok()).toBeTruthy();
    expect(((await patched.json()) as { user: unknown }).user).toMatchObject({
      instanceRole: 'administrator',
      groupIds: [groupId],
    });
    expect((await request.patch(`/api/users/${userId}`, { data: { role: 'reporter' } })).status()).toBe(400);

    await request.delete(`/api/users/${userId}`);
    await request.delete(`/api/groups/${groupId}`);
  });
});
