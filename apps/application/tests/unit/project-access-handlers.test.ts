import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler module (which imports the barrel) is loaded.
delete process.env.PIWI_DATABASE_URL;
const { getProjectAccessGrid, getProjectAccessUser, setProjectAccess } =
  await import('../../shared/handlers/project-assignments');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
});

async function addUser(id: number, username: string, role: string, name: string | null = null) {
  await db.insert(schema.users).values({ id, username, password: '', role, name });
}

async function addProject(id: number, name: string, label: string | null = null) {
  await db.insert(schema.projects).values({ id, name, label });
}

async function grants(userId: number): Promise<(number | null)[]> {
  const rows = await db
    .select({ projectId: schema.projectAssignments.projectId })
    .from(schema.projectAssignments)
    .where(eq(schema.projectAssignments.userId, userId));
  return rows.map((row) => row.projectId).sort((a, b) => (a ?? -1) - (b ?? -1));
}

describe('getProjectAccessGrid', () => {
  test('lists every user with their grants and every project, sorted by the names shown', async () => {
    await addUser(1, 'avery', 'administrator');
    await addUser(2, 'robin', 'reporter', 'Robin');
    await addUser(3, 'sam', 'user', 'Sam');
    await addUser(4, 'noah', 'user');
    await addProject(1, 'web', 'Web');
    await addProject(2, 'api', 'API');
    await db.insert(schema.projectAssignments).values([
      { userId: 2, projectId: null },
      { userId: 3, projectId: 2 },
      { userId: 3, projectId: 1 },
    ]);

    const grid = await getProjectAccessGrid(db);
    expect(grid.projects.map((p) => p.name)).toEqual(['api', 'web']);
    expect(grid.users).toEqual([
      { id: 1, username: 'avery', name: null, role: 'administrator', global: true, projectIds: [] },
      { id: 4, username: 'noah', name: null, role: 'user', global: false, projectIds: [] },
      { id: 2, username: 'robin', name: 'Robin', role: 'reporter', global: true, projectIds: [] },
      { id: 3, username: 'sam', name: 'Sam', role: 'user', global: false, projectIds: [1, 2] },
    ]);
  });

  test('an empty instance yields an empty grid', async () => {
    expect(await getProjectAccessGrid(db)).toEqual({ users: [], projects: [] });
  });
});

describe('setProjectAccess', () => {
  beforeEach(async () => {
    await addUser(3, 'sam', 'user');
    await addProject(1, 'web');
    await addProject(2, 'api');
  });

  test('grants and revokes one project, idempotently', async () => {
    await setProjectAccess(db, 3, 1, true);
    await setProjectAccess(db, 3, 1, true);
    expect(await grants(3)).toEqual([1]);

    await setProjectAccess(db, 3, 1, false);
    await setProjectAccess(db, 3, 1, false);
    expect(await grants(3)).toEqual([]);
  });

  test('the all-projects grant is one row, independent of the per-project ones', async () => {
    await setProjectAccess(db, 3, 2, true);
    await setProjectAccess(db, 3, null, true);
    await setProjectAccess(db, 3, null, true);
    expect(await grants(3)).toEqual([null, 2]);

    await setProjectAccess(db, 3, null, false);
    expect(await grants(3)).toEqual([2]);
  });

  test('records who granted it', async () => {
    await addUser(1, 'avery', 'administrator');
    await setProjectAccess(db, 3, 1, true, 1);
    const [row] = await db.select().from(schema.projectAssignments);
    expect(row).toMatchObject({ userId: 3, projectId: 1, createdBy: 1 });
  });

  test('getProjectAccessUser returns the updated row, or null for an unknown user', async () => {
    await setProjectAccess(db, 3, 2, true);
    expect(await getProjectAccessUser(db, 3)).toMatchObject({ id: 3, global: false, projectIds: [2] });
    expect(await getProjectAccessUser(db, 99)).toBeNull();
  });
});
