import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

// Settings → Groups end to end: a group created and given a member in the UI,
// then a role on a project in the permission grid, which its member holds.
// Auth is off on this server, so every request acts as the virtual
// administrator; the members list shows the member's effective role.

const GROUP = { name: 'groups-spec-qa', description: 'Created by the groups spec' };
const MEMBER = { username: 'groups-spec-member', password: 'groupspassword123', role: 'member', name: 'Groups Member' };

interface MemberRow {
  subject: { type: 'user' | 'group'; id: number };
  role: string;
  source: string;
  groupName?: string;
}

async function cleanUp(request: APIRequestContext) {
  const { groups } = (await (await request.get('/api/groups')).json()) as { groups: { id: number; name: string }[] };
  for (const group of groups) if (group.name.startsWith(GROUP.name)) await request.delete(`/api/groups/${group.id}`);
  const { items } = (await (await request.get('/api/users')).json()) as { items: { id: number; username: string }[] };
  for (const user of items) if (user.username === MEMBER.username) await request.delete(`/api/users/${user.id}`);
}

async function groupNamed(request: APIRequestContext, name: string) {
  const { groups } = (await (await request.get('/api/groups')).json()) as {
    groups: { id: number; name: string; description: string | null; memberCount: number }[];
  };
  return groups.find((group) => group.name === name);
}

test.describe.serial('Groups', () => {
  let projectId: number;
  let memberId: number;

  test.beforeAll(async ({ request }) => {
    await cleanUp(request);
    const submit = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.GROUPS,
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

    const created = await request.post('/api/users', { data: MEMBER });
    expect(created.ok()).toBeTruthy();
    memberId = ((await created.json()) as { user: { id: number } }).user.id;
  });

  test.afterAll(async ({ request }) => cleanUp(request));

  test('a group is created with a member from Settings → Groups', async ({ page, request }) => {
    await page.goto('/settings/groups');
    await waitForHydration(page);

    await page.getByRole('button', { name: 'Add group' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add group' })).toBeVisible();
    await dialog.getByLabel('Name').fill(GROUP.name);
    await dialog.getByLabel('Description').fill(GROUP.description);
    await dialog.getByRole('button', { name: 'Members', exact: true }).click();
    await page.getByRole('option', { name: MEMBER.name }).click();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Create group' }).click();

    await expect(page.getByText('Group created', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('cell', { name: GROUP.name, exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(GROUP.name) })).toContainText('1 member');
    expect(await groupNamed(request, GROUP.name)).toMatchObject({ description: GROUP.description, memberCount: 1 });
  });

  test("the group's role on a project in the grid is held by its member", async ({ page, request }) => {
    await page.goto('/settings/permissions');
    await waitForHydration(page);
    await page.getByLabel('Filter users and groups').fill('groups-spec');
    await page.getByLabel('Filter projects').fill(PROJECT.GROUPS);

    await page.getByRole('button', { name: `${GROUP.name} — ${PROJECT.GROUPS}`, exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: /^Maintainer/ }).click();

    const memberCell = page.getByRole('button', { name: `${MEMBER.name} — ${PROJECT.GROUPS}`, exact: true });
    await expect(memberCell).toHaveText('Maintainer');
    await expect(memberCell).toHaveAttribute('title', new RegExp(`Maintainer through ${GROUP.name}`));

    // The project's members list the group's role, and the member holding it through the group.
    await expect
      .poll(async () => {
        const body = (await (await request.get(`/api/projects/${projectId}/members`)).json()) as {
          members: MemberRow[];
        };
        return body.members.filter((m) => m.subject.type === 'user' && m.subject.id === memberId);
      })
      .toEqual([expect.objectContaining({ role: 'maintainer', source: 'group', groupName: GROUP.name })]);
  });

  test('a group is renamed, emptied and deleted after a confirmation', async ({ page, request }) => {
    await page.goto('/settings/groups');
    await waitForHydration(page);

    await page.getByRole('button', { name: `Edit ${GROUP.name}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Members', exact: true })).toContainText(MEMBER.name);
    await dialog.getByLabel('Name').fill(`${GROUP.name}-renamed`);
    await dialog.getByRole('button', { name: 'Members', exact: true }).click();
    await page.getByRole('option', { name: MEMBER.name }).click();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Save group' }).click();
    await expect(page.getByText('Group saved', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('row', { name: new RegExp(`${GROUP.name}-renamed`) })).toContainText('0 members');

    // Without the group, the member no longer holds its role.
    const members = (await (await request.get(`/api/projects/${projectId}/members`)).json()) as {
      members: MemberRow[];
    };
    expect(members.members.filter((m) => m.subject.type === 'user' && m.subject.id === memberId)).toEqual([]);

    await page.getByRole('button', { name: `Delete ${GROUP.name}-renamed` }).click();
    await expect(page.getByRole('dialog').getByText('Its members stay')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete group' }).click();
    await expect(page.getByText('Group deleted', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect.poll(() => groupNamed(request, `${GROUP.name}-renamed`)).toBeUndefined();
  });
});
