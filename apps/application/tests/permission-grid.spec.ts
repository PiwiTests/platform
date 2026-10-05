import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

// Settings → Permissions and its API (GET/PUT /api/project-access). Auth is off on
// this server, so every request acts as the virtual administrator; the
// administrator-only enforcement is covered in `tests/reporter-with-auth.spec.ts`.

const MEMBER = { username: 'grid-member', password: 'gridpassword123', role: 'member', name: 'Grid Member' };
const ADMIN = { username: 'grid-admin', password: 'gridpassword123', role: 'administrator', name: 'Grid Admin' };
const GROUP = { name: 'grid-group', description: 'Created by the permission grid spec' };

type Subject = { type: 'user' | 'group'; id: number };

interface GridBinding {
  subject: Subject;
  projectId: number | null;
  role: string;
}

interface Grid {
  users: { id: number; username: string; instanceRole: string; groupIds: number[] }[];
  groups: { id: number; name: string; memberCount: number }[];
  projects: { id: number; name: string }[];
  bindings: GridBinding[];
}

async function deleteUserNamed(request: APIRequestContext, username: string) {
  const { items } = (await (await request.get('/api/users')).json()) as { items: { id: number; username: string }[] };
  for (const user of items) if (user.username === username) await request.delete(`/api/users/${user.id}`);
}

async function deleteGroupNamed(request: APIRequestContext, name: string) {
  const { groups } = (await (await request.get('/api/groups')).json()) as { groups: { id: number; name: string }[] };
  for (const group of groups) if (group.name === name) await request.delete(`/api/groups/${group.id}`);
}

async function createUser(request: APIRequestContext, data: typeof MEMBER): Promise<number> {
  const res = await request.post('/api/users', { data });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { user: { id: number } }).user.id;
}

async function grid(request: APIRequestContext): Promise<Grid> {
  const res = await request.get('/api/project-access');
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Grid;
}

const sameSubject = (a: Subject, b: Subject) => a.type === b.type && a.id === b.id;

async function bindingsOf(request: APIRequestContext, subject: Subject) {
  return (await grid(request)).bindings
    .filter((b) => sameSubject(b.subject, subject))
    .map(({ projectId, role }) => ({ projectId, role }));
}

/** A user's own bindings as the UI steps below read them: the all-projects one, and the projects bound one by one. */
async function gridUser(request: APIRequestContext, userId: number) {
  const bindings = await bindingsOf(request, { type: 'user', id: userId });
  return {
    global: bindings.some((b) => b.projectId === null),
    projectIds: bindings.flatMap((b) => (b.projectId === null ? [] : [b.projectId])).sort((a, b) => a - b),
  };
}

async function setAccess(request: APIRequestContext, data: Record<string, unknown>) {
  return request.put('/api/project-access', { data });
}

/** Open the page narrowed to the test's own user(s) and project, so the grid stays small. */
async function openGrid(page: Page) {
  await page.goto('/settings/permissions');
  await waitForHydration(page);
  await page.getByLabel('Filter users').fill('grid-');
  await page.getByLabel('Filter projects').fill(PROJECT.PERMISSION_GRID);
}

function cell(page: Page, user: string, column: string): Locator {
  return page.getByRole('checkbox', { name: `${user} — ${column}`, exact: true });
}

const background = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe.serial('Permission grid', () => {
  let projectId: number;
  let memberId: number;
  let adminId: number;
  let groupId: number;

  test.beforeAll(async ({ request }) => {
    await deleteUserNamed(request, MEMBER.username);
    await deleteUserNamed(request, ADMIN.username);
    await deleteGroupNamed(request, GROUP.name);

    const submit = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.PERMISSION_GRID,
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

    memberId = await createUser(request, MEMBER);
    adminId = await createUser(request, ADMIN);

    const created = await request.post('/api/groups', { data: GROUP });
    expect(created.ok()).toBeTruthy();
    groupId = ((await created.json()) as { group: { id: number } }).group.id;
    expect((await request.put(`/api/groups/${groupId}/members`, { data: { userIds: [memberId] } })).ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await deleteGroupNamed(request, GROUP.name);
    await deleteUserNamed(request, MEMBER.username);
    await deleteUserNamed(request, ADMIN.username);
  });

  test('GET /api/project-access lists every user, group, project and binding', async ({ request }) => {
    const body = await grid(request);

    expect(body.projects.some((project) => project.id === projectId)).toBe(true);
    expect(body.users.find((user) => user.id === memberId)).toMatchObject({
      instanceRole: 'member',
      groupIds: [groupId],
    });
    expect(body.users.find((user) => user.id === adminId)).toMatchObject({ instanceRole: 'administrator' });
    expect(body.groups.find((group) => group.id === groupId)).toMatchObject({ name: GROUP.name, memberCount: 1 });
    // A new member holds no role at all, and an administrator needs none.
    expect(body.bindings.filter((b) => sameSubject(b.subject, { type: 'user', id: memberId }))).toEqual([]);
    expect(body.bindings.filter((b) => sameSubject(b.subject, { type: 'user', id: adminId }))).toEqual([]);
  });

  test('PUT sets, replaces and removes one cell, idempotently', async ({ request }) => {
    const subject = { type: 'user', id: memberId };
    for (let i = 0; i < 2; i++) {
      const res = await setAccess(request, { subject, projectId, role: 'viewer' });
      expect(res.ok()).toBeTruthy();
      expect(((await res.json()) as { bindings: GridBinding[] }).bindings).toEqual([
        { subject, projectId, role: 'viewer' },
      ]);
    }

    const replaced = await setAccess(request, { subject, projectId, role: 'maintainer' });
    expect(((await replaced.json()) as { bindings: GridBinding[] }).bindings).toEqual([
      { subject, projectId, role: 'maintainer' },
    ]);

    const removed = await setAccess(request, { subject, projectId, role: null });
    expect(removed.ok()).toBeTruthy();
    expect(await bindingsOf(request, { type: 'user', id: memberId })).toEqual([]);
  });

  test('removing the all-projects binding keeps the per-project ones', async ({ request }) => {
    const subject = { type: 'user', id: memberId };
    await setAccess(request, { subject, projectId, role: 'contributor' });
    await setAccess(request, { subject, projectId: null, role: 'viewer' });
    expect(await bindingsOf(request, { type: 'user', id: memberId })).toEqual(
      expect.arrayContaining([
        { projectId, role: 'contributor' },
        { projectId: null, role: 'viewer' },
      ]),
    );

    await setAccess(request, { subject, projectId: null, role: null });
    expect(await bindingsOf(request, { type: 'user', id: memberId })).toEqual([{ projectId, role: 'contributor' }]);

    await setAccess(request, { subject, projectId, role: null });
  });

  test('a group holds a role like a user', async ({ request }) => {
    const subject = { type: 'group', id: groupId };
    const res = await setAccess(request, { subject, projectId, role: 'maintainer' });
    expect(res.ok()).toBeTruthy();
    expect(await bindingsOf(request, { type: 'group', id: groupId })).toEqual([{ projectId, role: 'maintainer' }]);

    await setAccess(request, { subject, projectId, role: null });
    expect(await bindingsOf(request, { type: 'group', id: groupId })).toEqual([]);
  });

  test('PUT rejects a malformed body, unknown ids and administrators', async ({ request }) => {
    const member = { type: 'user', id: memberId };
    expect((await setAccess(request, { subject: member, projectId, role: 'owner' })).status()).toBe(400);
    expect((await setAccess(request, { userId: memberId, projectId, granted: true })).status()).toBe(400);
    expect(
      (await setAccess(request, { subject: { type: 'user', id: 999999 }, projectId, role: 'viewer' })).status(),
    ).toBe(404);
    expect(
      (await setAccess(request, { subject: { type: 'group', id: 999999 }, projectId, role: 'viewer' })).status(),
    ).toBe(404);
    expect((await setAccess(request, { subject: member, projectId: 999999, role: 'viewer' })).status()).toBe(404);

    const admin = await setAccess(request, { subject: { type: 'user', id: adminId }, projectId, role: null });
    expect(admin.status()).toBe(400);
    expect(((await admin.json()) as { message: string }).message).toBe('Administrators can open every project');
  });

  test('a click grants the project and a second click revokes it', async ({ page, request }) => {
    await openGrid(page);
    const box = cell(page, MEMBER.name, PROJECT.PERMISSION_GRID);

    await expect(box).toHaveAttribute('aria-checked', 'false');
    await box.click();
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await gridUser(request, memberId)).projectIds).toEqual([projectId]);

    // A cell ignores clicks while its change is saving.
    await expect(box).toHaveAttribute('aria-disabled', 'false');
    await box.click();
    await expect(box).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await gridUser(request, memberId)).projectIds).toEqual([]);
  });

  test('All projects covers every project cell until it is unticked', async ({ page, request }) => {
    await openGrid(page);
    const all = cell(page, MEMBER.name, 'All projects');
    const box = cell(page, MEMBER.name, PROJECT.PERMISSION_GRID);

    await all.click();
    await expect(all).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await gridUser(request, memberId)).global).toBe(true);
    // Covered by All projects: shown as open, and not toggled on its own.
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await expect(box).toHaveAttribute('aria-disabled', 'true');
    await box.click({ force: true });
    await expect(box).toHaveAttribute('aria-checked', 'true');
    expect((await gridUser(request, memberId)).projectIds).toEqual([]);

    await expect(all).toHaveAttribute('aria-disabled', 'false');
    await all.click();
    await expect(all).toHaveAttribute('aria-checked', 'false');
    await expect(box).toHaveAttribute('aria-checked', 'false');
    await expect(box).toHaveAttribute('aria-disabled', 'false');
    await expect.poll(async () => (await gridUser(request, memberId)).global).toBe(false);
  });

  test("an administrator's cells are open and locked", async ({ page }) => {
    await openGrid(page);
    for (const column of ['All projects', PROJECT.PERMISSION_GRID]) {
      const box = cell(page, ADMIN.name, column);
      await expect(box).toHaveAttribute('aria-checked', 'true');
      await expect(box).toHaveAttribute('aria-disabled', 'true');
    }
  });

  test("hovering a cell highlights its user's row and its project's column", async ({ page }) => {
    await openGrid(page);
    const rowHeader = page.locator(`th[data-row="${memberId}"]`);
    const columnHeader = page.locator(`thead th[data-col="${projectId}"]`);
    const otherRowHeader = page.locator(`th[data-row="${adminId}"]`);
    const [rowBefore, columnBefore, otherBefore] = await Promise.all(
      [rowHeader, columnHeader, otherRowHeader].map(background),
    );

    await cell(page, MEMBER.name, PROJECT.PERMISSION_GRID).hover();
    await expect.poll(() => background(rowHeader)).not.toBe(rowBefore);
    await expect.poll(() => background(columnHeader)).not.toBe(columnBefore);
    expect(await background(otherRowHeader)).toBe(otherBefore);

    // Leaving the grid clears the highlight.
    await page.mouse.move(0, 0);
    await expect.poll(() => background(rowHeader)).toBe(rowBefore);
    await expect.poll(() => background(columnHeader)).toBe(columnBefore);
  });

  test('arrow keys move between cells', async ({ page }) => {
    await openGrid(page);
    const all = cell(page, MEMBER.name, 'All projects');
    const box = cell(page, MEMBER.name, PROJECT.PERMISSION_GRID);

    await all.focus();
    await page.keyboard.press('ArrowRight');
    await expect(box).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(all).toBeFocused();
    // Space toggles the focused cell like a click.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(box).toHaveAttribute('aria-checked', 'true');
    await expect(box).toHaveAttribute('aria-disabled', 'false');
    await page.keyboard.press('Space');
    await expect(box).toHaveAttribute('aria-checked', 'false');
  });

  test('the filters narrow the rows and the columns', async ({ page }) => {
    await openGrid(page);
    await expect(page.getByRole('rowheader', { name: /Grid Member/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: PROJECT.PERMISSION_GRID })).toBeVisible();

    await page.getByLabel('Filter users').fill('no-such-user');
    await expect(page.getByText('No user matches this filter.')).toBeVisible();

    await page.getByLabel('Filter users').fill('grid-');
    await page.getByLabel('Filter projects').fill('no-such-project');
    await expect(page.getByText('No project matches this filter.')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: PROJECT.PERMISSION_GRID })).toHaveCount(0);
  });
});
