import { test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';
import { sqliteMigrationTarget } from '../../server/database/migration-targets';

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

  await backfillProjectAssignments(db, { tableIsNew: true });

  expect(await grants(1)).toEqual([]);
  expect(await grants(2)).toEqual([null]);
  expect(await grants(3)).toEqual([null]);
});

test('runs once: a user left without access stays without access on the next startup', async () => {
  await backfillProjectAssignments(db, { tableIsNew: true });
  await addUser(3, 'sam', 'user');

  await backfillProjectAssignments(db, { tableIsNew: true });

  expect(await grants(3)).toEqual([]);
});

test('grants nothing on a database that already holds assignments', async () => {
  await addUser(2, 'robin', 'reporter');
  await addUser(3, 'sam', 'user');
  await db.insert(schema.projects).values({ id: 1, name: 'web' });
  await db.insert(schema.projectAssignments).values({ userId: 2, projectId: 1 });

  await backfillProjectAssignments(db, { tableIsNew: true });

  expect(await grants(2)).toEqual([1]);
  expect(await grants(3)).toEqual([]);
});

test('grants nothing when the table predates this startup, even with no assignment left in it', async () => {
  // An install that already enforced project access, where an administrator
  // has revoked every reporter's and user's projects before upgrading.
  await addUser(2, 'robin', 'reporter');
  await addUser(3, 'sam', 'user');

  await backfillProjectAssignments(db, { tableIsNew: false });

  expect(await grants(2)).toEqual([]);
  expect(await grants(3)).toEqual([]);
});

test('a grant left owed by a failed first attempt is made at the next startup', async () => {
  await addUser(3, 'sam', 'user');
  // The first startup recorded the grant as owed, then failed before making it.
  await db.insert(schema.appSettings).values({ key: PROJECT_ASSIGNMENTS_BACKFILL_KEY, value: 'owed' });

  // The next startup finds the table already there.
  await backfillProjectAssignments(db, { tableIsNew: false });
  await backfillProjectAssignments(db, { tableIsNew: false });

  expect(await grants(3)).toEqual([null]);
});

test('concurrent startups grant once', async () => {
  await addUser(3, 'sam', 'user');

  await Promise.all([
    backfillProjectAssignments(db, { tableIsNew: true }),
    backfillProjectAssignments(db, { tableIsNew: true }),
  ]);

  expect(await grants(3)).toEqual([null]);
  const claims = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, PROJECT_ASSIGNMENTS_BACKFILL_KEY));
  expect(claims).toHaveLength(1);
});

test('startup reads whether the table exists before migrating, which is what tells the two cases apart', async () => {
  const client = createClient({ url: ':memory:' });
  const fresh = drizzle(client, { schema });
  const migrationsFolder = fileURLToPath(new URL('../../server/database/migrations', import.meta.url));
  const target = sqliteMigrationTarget(client, () => migrate(fresh, { migrationsFolder }));

  expect(await target.tableExists('project_assignments')).toBe(false);
  await target.migrate();
  expect(await target.tableExists('project_assignments')).toBe(true);
});
