import { test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler module (which imports the barrel) is loaded.
delete process.env.PIWI_DATABASE_URL;
const { backfillProjectAssignments, PROJECT_ASSIGNMENTS_BACKFILL_KEY } =
  await import('../../shared/handlers/project-assignments');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
});

async function addUser(id: number, username: string, role: string) {
  await db.insert(schema.users).values({ id, username, password: '', role });
}

async function grants(userId: number): Promise<(number | null)[]> {
  const rows = await db
    .select({ projectId: schema.projectAssignments.projectId })
    .from(schema.projectAssignments)
    .where(eq(schema.projectAssignments.userId, userId));
  return rows.map((row) => row.projectId).sort((a, b) => (a ?? -1) - (b ?? -1));
}

test('grants every reporter and user global access on a database without assignments', async () => {
  await addUser(1, 'avery', 'administrator');
  await addUser(2, 'robin', 'reporter');
  await addUser(3, 'sam', 'user');

  await backfillProjectAssignments(db);

  expect(await grants(1)).toEqual([]);
  expect(await grants(2)).toEqual([null]);
  expect(await grants(3)).toEqual([null]);
});

test('runs once: a user left without access stays without access on the next startup', async () => {
  await backfillProjectAssignments(db);
  await addUser(3, 'sam', 'user');

  await backfillProjectAssignments(db);

  expect(await grants(3)).toEqual([]);
});

test('grants nothing on a database that already holds assignments', async () => {
  await addUser(2, 'robin', 'reporter');
  await addUser(3, 'sam', 'user');
  await db.insert(schema.projects).values({ id: 1, name: 'web' });
  await db.insert(schema.projectAssignments).values({ userId: 2, projectId: 1 });

  await backfillProjectAssignments(db);

  expect(await grants(2)).toEqual([1]);
  expect(await grants(3)).toEqual([]);
});

test('concurrent startups grant once', async () => {
  await addUser(3, 'sam', 'user');

  await Promise.all([backfillProjectAssignments(db), backfillProjectAssignments(db)]);

  expect(await grants(3)).toEqual([null]);
  const claims = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, PROJECT_ASSIGNMENTS_BACKFILL_KEY));
  expect(claims).toHaveLength(1);
});
