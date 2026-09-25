import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

// Settings → Permissions and its API (GET/PUT /api/project-access). Auth is off on
// this server, so every request acts as the virtual administrator; the
// administrator-only enforcement is covered in `tests/reporter-with-auth.spec.ts`.

const MEMBER = { username: 'grid-member', password: 'gridpassword123', role: 'user', name: 'Grid Member' };
const ADMIN = { username: 'grid-admin', password: 'gridpassword123', role: 'administrator', name: 'Grid Admin' };

interface GridUser {
  id: number;
  username: string;
  role: string;
  global: boolean;
  projectIds: number[];
}

async function deleteUserNamed(request: APIRequestContext, username: string) {
  const { items } = (await (await request.get('/api/users')).json()) as { items: { id: number; username: string }[] };
  for (const user of items) if (user.username === username) await request.delete(`/api/users/${user.id}`);
}

async function createUser(request: APIRequestContext, data: typeof MEMBER): Promise<number> {
  const res = await request.post('/api/users', { data });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { user: { id: number } }).user.id;
}

async function gridUser(request: APIRequestContext, userId: number): Promise<GridUser> {
  const res = await request.get('/api/project-access');
  expect(res.ok()).toBeTruthy();
  const { users } = (await res.json()) as { users: GridUser[] };
  return users.find((user) => user.id === userId)!;
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

  test.beforeAll(async ({ request }) => {
    await deleteUserNamed(request, MEMBER.username);
    await deleteUserNamed(request, ADMIN.username);

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
  });

  test.afterAll(async ({ request }) => {
    await deleteUserNamed(request, MEMBER.username);
    await deleteUserNamed(request, ADMIN.username);
  });

  test('GET /api/project-access lists every user and project', async ({ request }) => {
    const res = await request.get('/api/project-access');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { users: GridUser[]; projects: { id: number; name: string }[] };

    expect(body.projects.some((project) => project.id === projectId)).toBe(true);
    // A new user starts with no access at all.
    expect(body.users.find((user) => user.id === memberId)).toMatchObject({ global: false, projectIds: [] });
    // Administrators open every project, so their row always reads global.
    expect(body.users.find((user) => user.id === adminId)).toMatchObject({ global: true, projectIds: [] });
  });

  test('PUT grants and revokes one project, idempotently', async ({ request }) => {
    for (let i = 0; i < 2; i++) {
      const res = await setAccess(request, { userId: memberId, projectId, granted: true });
      expect(res.ok()).toBeTruthy();
      expect(((await res.json()) as { user: GridUser }).user.projectIds).toEqual([projectId]);
    }

    const revoke = await setAccess(request, { userId: memberId, projectId, granted: false });
    expect(revoke.ok()).toBeTruthy();
    expect((await gridUser(request, memberId)).projectIds).toEqual([]);
  });

  test('revoking the all-projects grant keeps the projects granted one by one', async ({ request }) => {
    await setAccess(request, { userId: memberId, projectId, granted: true });
    await setAccess(request, { userId: memberId, projectId: null, granted: true });
    expect(await gridUser(request, memberId)).toMatchObject({ global: true, projectIds: [projectId] });

    await setAccess(request, { userId: memberId, projectId: null, granted: false });
    expect(await gridUser(request, memberId)).toMatchObject({ global: false, projectIds: [projectId] });

    await setAccess(request, { userId: memberId, projectId, granted: false });
  });

  test('PUT rejects a malformed body, unknown ids and administrators', async ({ request }) => {
    expect((await setAccess(request, { userId: memberId, granted: 'yes' })).status()).toBe(400);
    expect((await setAccess(request, { userId: 999999, projectId, granted: true })).status()).toBe(404);
    expect((await setAccess(request, { userId: memberId, projectId: 999999, granted: true })).status()).toBe(404);

    const admin = await setAccess(request, { userId: adminId, projectId, granted: false });
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
