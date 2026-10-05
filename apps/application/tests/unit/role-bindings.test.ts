import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as schema from '../../server/database/schema.sqlite';
import { openTempDb, type TempDb } from './temp-db';
import { InstanceRole, ProjectRole } from '#shared/permissions';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler module (which imports the barrel) is loaded.
delete process.env.PIWI_DATABASE_URL;
const { getProjectMembers, getUserAccess, getUserGrants, listRoleBindings, replaceProjectBindings, setRoleBinding } =
  await import('../../shared/handlers/role-bindings');

let db: TempDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await openTempDb());
  await db.insert(schema.users).values([
    { id: 1, username: 'avery', password: '', role: 'administrator', name: 'Avery' },
    { id: 2, username: 'robin', password: '', role: 'member', name: 'Robin' },
    { id: 3, username: 'sam', password: '', role: 'member', name: 'Sam' },
    { id: 4, username: 'noah', password: '', role: 'member' },
  ]);
  await db.insert(schema.projects).values([
    { id: 10, name: 'web' },
    { id: 11, name: 'api' },
  ]);
  await db.insert(schema.groups).values([
    { id: 100, name: 'QA' },
    { id: 101, name: 'Product owners' },
  ]);
  await db.insert(schema.groupMembers).values([
    { groupId: 100, userId: 2 },
    { groupId: 101, userId: 2 },
    { groupId: 101, userId: 3 },
  ]);
});

afterEach(async () => {
  await close();
});

async function bind(values: Partial<typeof schema.roleBindings.$inferInsert> & { role: string }) {
  await db.insert(schema.roleBindings).values(values);
}

async function storedBindings() {
  const rows = await db.select().from(schema.roleBindings);
  return rows
    .map((row) => ({ userId: row.userId, groupId: row.groupId, projectId: row.projectId, role: row.role }))
    .sort((a, b) => a.userId! - b.userId! || a.groupId! - b.groupId! || (a.projectId ?? 0) - (b.projectId ?? 0));
}

describe('getUserGrants', () => {
  test("unions the user's own bindings with those of every group they belong to", async () => {
    await bind({ userId: 2, projectId: 10, role: 'project_admin' });
    await bind({ groupId: 100, projectId: null, role: 'maintainer' });
    await bind({ groupId: 101, projectId: 11, role: 'contributor' });
    await bind({ userId: 3, projectId: 10, role: 'viewer' });

    const grants = await getUserGrants(db, 2);
    expect(grants).toHaveLength(3);
    expect(grants).toEqual(
      expect.arrayContaining([
        { projectId: 10, role: 'project_admin' },
        { projectId: null, role: 'maintainer' },
        { projectId: 11, role: 'contributor' },
      ]),
    );
    expect(await getUserGrants(db, 4)).toEqual([]);
  });

  test('skips a role this build does not know', async () => {
    await bind({ userId: 2, projectId: 10, role: 'owner' });
    expect(await getUserGrants(db, 2)).toEqual([]);
  });
});

describe('getUserAccess', () => {
  test('an administrator holds everything, whatever bindings remain', async () => {
    await bind({ userId: 1, projectId: 10, role: 'viewer' });
    expect(await getUserAccess(db, { id: 1, role: 'administrator' })).toEqual({
      instanceRole: InstanceRole.ADMINISTRATOR,
      allProjects: [],
      projects: {},
    });
  });

  test("a member's access folds own and group bindings", async () => {
    await bind({ userId: 2, projectId: 10, role: 'project_admin' });
    await bind({ groupId: 100, projectId: null, role: 'maintainer' });
    await bind({ groupId: 101, projectId: null, role: 'contributor' });
    expect(await getUserAccess(db, { id: 2, role: 'member' })).toEqual({
      instanceRole: InstanceRole.MEMBER,
      allProjects: expect.arrayContaining([ProjectRole.MAINTAINER, ProjectRole.CONTRIBUTOR]),
      projects: { 10: [ProjectRole.PROJECT_ADMIN] },
    });
  });

  test('an unknown instance role counts as a member', async () => {
    await bind({ userId: 4, projectId: 11, role: 'viewer' });
    expect(await getUserAccess(db, { id: 4, role: 'reporter' })).toEqual({
      instanceRole: InstanceRole.MEMBER,
      allProjects: [],
      projects: { 11: [ProjectRole.VIEWER] },
    });
  });
});

describe('the role_bindings table', () => {
  test('refuses a binding with no subject or with both', async () => {
    await expect(bind({ projectId: 10, role: 'viewer' })).rejects.toThrow();
    await expect(bind({ userId: 2, groupId: 100, projectId: 10, role: 'viewer' })).rejects.toThrow();
  });

  test('holds one role per subject per scope, the all-projects scope included', async () => {
    await bind({ userId: 2, projectId: null, role: 'viewer' });
    await expect(bind({ userId: 2, projectId: null, role: 'maintainer' })).rejects.toThrow();
    await bind({ userId: 2, projectId: 10, role: 'viewer' });
    await expect(bind({ userId: 2, projectId: 10, role: 'maintainer' })).rejects.toThrow();
    await bind({ groupId: 100, projectId: null, role: 'viewer' });
    await expect(bind({ groupId: 100, projectId: null, role: 'maintainer' })).rejects.toThrow();
  });
});

describe('listRoleBindings', () => {
  beforeEach(async () => {
    await bind({ userId: 2, projectId: 10, role: 'project_admin', createdBy: 1 });
    await bind({ groupId: 100, projectId: null, role: 'maintainer' });
    await bind({ userId: 3, projectId: null, role: 'viewer' });
    await bind({ groupId: 101, projectId: 10, role: 'contributor' });
  });

  test('lists every binding with its subject', async () => {
    const rows = await listRoleBindings(db);
    expect(rows.map(({ subject, projectId, role }) => ({ subject, projectId, role }))).toEqual([
      { subject: { kind: 'user', id: 2, username: 'robin', name: 'Robin' }, projectId: 10, role: 'project_admin' },
      { subject: { kind: 'group', id: 100, name: 'QA' }, projectId: null, role: 'maintainer' },
      { subject: { kind: 'user', id: 3, username: 'sam', name: 'Sam' }, projectId: null, role: 'viewer' },
      { subject: { kind: 'group', id: 101, name: 'Product owners' }, projectId: 10, role: 'contributor' },
    ]);
    expect(rows[0]).toMatchObject({ createdBy: 1, createdAt: expect.any(Date) });
  });

  test('filters by project, by the all-projects scope, by user and by group', async () => {
    const ids = async (filter: Parameters<typeof listRoleBindings>[1]) =>
      (await listRoleBindings(db, filter)).map((row) => `${row.subject.kind}:${row.subject.id}`);
    expect(await ids({ projectId: 10 })).toEqual(['user:2', 'group:101']);
    expect(await ids({ projectId: null })).toEqual(['group:100', 'user:3']);
    expect(await ids({ userId: 3 })).toEqual(['user:3']);
    expect(await ids({ groupId: 101, projectId: 10 })).toEqual(['group:101']);
    expect(await ids({ projectId: 11 })).toEqual([]);
  });
});

describe('setRoleBinding', () => {
  test('binds, changes the role in place and unbinds', async () => {
    await setRoleBinding(db, { subject: { userId: 2 }, projectId: 10, role: ProjectRole.VIEWER, createdBy: 1 });
    await setRoleBinding(db, { subject: { userId: 2 }, projectId: 10, role: ProjectRole.VIEWER });
    expect(await storedBindings()).toEqual([{ userId: 2, groupId: null, projectId: 10, role: 'viewer' }]);

    await setRoleBinding(db, { subject: { userId: 2 }, projectId: 10, role: ProjectRole.MAINTAINER });
    const [row] = await db.select().from(schema.roleBindings);
    expect(row).toMatchObject({ role: 'maintainer', createdBy: 1 });

    await setRoleBinding(db, { subject: { userId: 2 }, projectId: 10, role: null });
    expect(await storedBindings()).toEqual([]);
  });

  test('keeps the all-projects binding apart from the per-project ones', async () => {
    await setRoleBinding(db, { subject: { groupId: 100 }, projectId: null, role: ProjectRole.MAINTAINER });
    await setRoleBinding(db, { subject: { groupId: 100 }, projectId: 10, role: ProjectRole.PROJECT_ADMIN });
    await setRoleBinding(db, { subject: { groupId: 100 }, projectId: null, role: null });
    expect(await storedBindings()).toEqual([{ userId: null, groupId: 100, projectId: 10, role: 'project_admin' }]);
  });

  test('concurrent calls for the same subject and scope leave one binding', async () => {
    await Promise.all([
      setRoleBinding(db, { subject: { userId: 3 }, projectId: null, role: ProjectRole.VIEWER }),
      setRoleBinding(db, { subject: { userId: 3 }, projectId: null, role: ProjectRole.CONTRIBUTOR }),
      setRoleBinding(db, { subject: { userId: 3 }, projectId: null, role: ProjectRole.CONTRIBUTOR }),
    ]);
    const rows = await storedBindings();
    expect(rows).toHaveLength(1);
    expect(['viewer', 'contributor']).toContain(rows[0]!.role);
  });

  test('refuses a role this build does not know', async () => {
    await expect(
      setRoleBinding(db, { subject: { userId: 2 }, projectId: 10, role: 'owner' as ProjectRole }),
    ).rejects.toThrow('Unknown project role');
  });
});

describe('replaceProjectBindings', () => {
  test("replaces one project's bindings, leaving all-projects and other projects alone", async () => {
    await bind({ userId: 2, projectId: 10, role: 'viewer' });
    await bind({ userId: 3, projectId: 10, role: 'viewer' });
    await bind({ userId: 3, projectId: 11, role: 'maintainer' });
    await bind({ groupId: 100, projectId: null, role: 'maintainer' });

    await replaceProjectBindings(
      db,
      10,
      [
        { subject: { userId: 2 }, role: ProjectRole.CONTRIBUTOR },
        { subject: { groupId: 101 }, role: ProjectRole.VIEWER },
        { subject: { userId: 2 }, role: ProjectRole.PROJECT_ADMIN },
      ],
      1,
    );

    expect(await storedBindings()).toEqual([
      { userId: null, groupId: 100, projectId: null, role: 'maintainer' },
      { userId: null, groupId: 101, projectId: 10, role: 'viewer' },
      { userId: 2, groupId: null, projectId: 10, role: 'project_admin' },
      { userId: 3, groupId: null, projectId: 11, role: 'maintainer' },
    ]);
  });

  test('an empty list clears the project', async () => {
    await bind({ userId: 2, projectId: 10, role: 'viewer' });
    await replaceProjectBindings(db, 10, []);
    expect(await storedBindings()).toEqual([]);
  });
});

describe('getProjectMembers', () => {
  test('tells direct, all-projects, group and administrator access apart', async () => {
    await bind({ userId: 3, projectId: 10, role: 'project_admin' });
    await bind({ userId: 4, projectId: null, role: 'viewer' });
    await bind({ groupId: 100, projectId: null, role: 'maintainer' });
    await bind({ groupId: 101, projectId: 10, role: 'contributor' });
    await bind({ groupId: 101, projectId: 11, role: 'maintainer' });
    await bind({ userId: 4, projectId: 11, role: 'uploader' });

    const members = await getProjectMembers(db, 10);

    expect(members.users).toEqual([
      { id: 1, username: 'avery', name: 'Avery', administrator: true, grants: [] },
      {
        id: 4,
        username: 'noah',
        name: null,
        administrator: false,
        grants: [{ role: 'viewer', source: { via: 'all-projects' } }],
      },
      {
        id: 2,
        username: 'robin',
        name: 'Robin',
        administrator: false,
        grants: [
          { role: 'maintainer', source: { via: 'group', groupId: 100, groupName: 'QA', allProjects: true } },
          {
            role: 'contributor',
            source: { via: 'group', groupId: 101, groupName: 'Product owners', allProjects: false },
          },
        ],
      },
      {
        id: 3,
        username: 'sam',
        name: 'Sam',
        administrator: false,
        grants: [
          { role: 'project_admin', source: { via: 'project' } },
          {
            role: 'contributor',
            source: { via: 'group', groupId: 101, groupName: 'Product owners', allProjects: false },
          },
        ],
      },
    ]);
    expect(members.groups).toEqual([
      {
        id: 101,
        name: 'Product owners',
        grants: [{ role: 'contributor', source: { via: 'project' } }],
        memberIds: [2, 3],
      },
      { id: 100, name: 'QA', grants: [{ role: 'maintainer', source: { via: 'all-projects' } }], memberIds: [2] },
    ]);
  });

  test('a project nobody is bound to lists the administrators only', async () => {
    const members = await getProjectMembers(db, 11);
    expect(members).toEqual({
      users: [{ id: 1, username: 'avery', name: 'Avery', administrator: true, grants: [] }],
      groups: [],
    });
  });
});
