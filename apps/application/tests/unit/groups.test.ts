import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';
import { openTempDb, type TempDb } from './temp-db';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler module (which imports the barrel) is loaded.
delete process.env.PIWI_DATABASE_URL;
const { GroupError, createGroup, deleteGroup, getGroup, getUserGroups, listGroups, setGroupMembers, updateGroup } =
  await import('../../shared/handlers/groups');

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
  await db.insert(schema.projects).values({ id: 10, name: 'web' });
});

afterEach(async () => {
  await close();
});

async function expectGroupError(promise: Promise<unknown>, statusCode: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GroupError);
  expect((error as InstanceType<typeof GroupError>).statusCode).toBe(statusCode);
}

describe('createGroup / listGroups', () => {
  test('creates groups and lists them by name with their member counts', async () => {
    const qa = await createGroup(db, { name: '  QA ', description: ' Testers ', createdBy: 1 });
    expect(qa).toMatchObject({ name: 'QA', description: 'Testers', memberCount: 0, createdBy: 1 });
    const po = await createGroup(db, { name: 'product owners', description: '  ' });
    expect(po.description).toBeNull();
    await createGroup(db, { name: 'CI' });
    await setGroupMembers(db, qa.id, [2, 3]);

    const groups = await listGroups(db);
    expect(groups.map((g) => [g.name, g.memberCount])).toEqual([
      ['CI', 0],
      ['product owners', 0],
      ['QA', 2],
    ]);
  });

  test('refuses a name already taken (409) and an empty one (400)', async () => {
    await createGroup(db, { name: 'QA' });
    await expectGroupError(createGroup(db, { name: 'QA' }), 409);
    await expectGroupError(createGroup(db, { name: '   ' }), 400);
    expect(await listGroups(db)).toHaveLength(1);
  });
});

describe('getGroup', () => {
  test('returns the group with its members, by name', async () => {
    const qa = await createGroup(db, { name: 'QA' });
    await setGroupMembers(db, qa.id, [3, 2], 1);

    const group = await getGroup(db, qa.id);
    expect(group).toMatchObject({ id: qa.id, name: 'QA', memberCount: 2 });
    expect(group!.members).toEqual([
      { id: 2, username: 'robin', name: 'Robin', addedBy: 1, addedAt: expect.any(Date) },
      { id: 3, username: 'sam', name: 'Sam', addedBy: 1, addedAt: expect.any(Date) },
    ]);
  });

  test('returns null for a missing group', async () => {
    expect(await getGroup(db, 999)).toBeNull();
  });
});

describe('updateGroup', () => {
  test('renames a group and changes its description', async () => {
    const qa = await createGroup(db, { name: 'QA', description: 'Testers' });
    await setGroupMembers(db, qa.id, [2]);

    const renamed = await updateGroup(db, qa.id, { name: 'Quality' });
    expect(renamed).toMatchObject({ name: 'Quality', description: 'Testers', memberCount: 1 });
    expect(await updateGroup(db, qa.id, { name: 'Quality', description: null })).toMatchObject({
      name: 'Quality',
      description: null,
    });
  });

  test("refuses another group's name (409) and a missing group (404)", async () => {
    await createGroup(db, { name: 'QA' });
    const po = await createGroup(db, { name: 'Product owners' });
    await expectGroupError(updateGroup(db, po.id, { name: 'QA' }), 409);
    await expectGroupError(updateGroup(db, 999, { name: 'Nobody' }), 404);
  });
});

describe('deleteGroup', () => {
  test('deletes the group with its memberships and role bindings', async () => {
    const qa = await createGroup(db, { name: 'QA' });
    await setGroupMembers(db, qa.id, [2, 3]);
    await db.insert(schema.roleBindings).values([
      { groupId: qa.id, projectId: null, role: 'maintainer' },
      { userId: 2, projectId: 10, role: 'viewer' },
    ]);

    await deleteGroup(db, qa.id);

    expect(await getGroup(db, qa.id)).toBeNull();
    expect(await db.select().from(schema.groupMembers)).toEqual([]);
    expect((await db.select().from(schema.roleBindings)).map((row) => row.userId)).toEqual([2]);
  });

  test('refuses a missing group (404)', async () => {
    await expectGroupError(deleteGroup(db, 999), 404);
  });
});

describe('setGroupMembers', () => {
  test('adds and removes members; those staying keep who added them', async () => {
    const qa = await createGroup(db, { name: 'QA' });
    await setGroupMembers(db, qa.id, [2, 3, 3], 1);
    await setGroupMembers(db, qa.id, [3, 4], 2);

    const rows = await db
      .select({ userId: schema.groupMembers.userId, addedBy: schema.groupMembers.addedBy })
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, qa.id));
    expect(rows.sort((a, b) => a.userId - b.userId)).toEqual([
      { userId: 3, addedBy: 1 },
      { userId: 4, addedBy: 2 },
    ]);

    await setGroupMembers(db, qa.id, []);
    expect(await db.select().from(schema.groupMembers)).toEqual([]);
  });

  test('refuses an unknown user (400) and a missing group (404), changing nothing', async () => {
    const qa = await createGroup(db, { name: 'QA' });
    await setGroupMembers(db, qa.id, [2]);
    await expectGroupError(setGroupMembers(db, qa.id, [2, 999]), 400);
    await expectGroupError(setGroupMembers(db, 999, [2]), 404);
    expect((await getGroup(db, qa.id))!.members.map((m) => m.id)).toEqual([2]);
  });
});

test('getUserGroups lists the groups a user belongs to, by name', async () => {
  const qa = await createGroup(db, { name: 'QA' });
  const ci = await createGroup(db, { name: 'CI' });
  await createGroup(db, { name: 'Product owners' });
  await setGroupMembers(db, qa.id, [2]);
  await setGroupMembers(db, ci.id, [2, 3]);

  expect(await getUserGroups(db, 2)).toEqual([
    { id: ci.id, name: 'CI' },
    { id: qa.id, name: 'QA' },
  ]);
  expect(await getUserGroups(db, 4)).toEqual([]);
});
