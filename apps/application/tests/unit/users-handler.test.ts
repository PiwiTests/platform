import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler module (which imports the barrel) loads.
delete process.env.PIWI_DATABASE_URL;
const { updateUserRecord, deleteUserRecord } = await import('../../shared/handlers/users');

let db: ReturnType<typeof drizzle<typeof schema>>;

async function verifiedFlag(id: number): Promise<boolean> {
  const [row] = await db.select({ v: schema.users.emailVerified }).from(schema.users).where(eq(schema.users.id, id));
  return Boolean(row?.v);
}

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.users).values({
    id: 1,
    username: 'alice',
    password: 'x',
    role: 'user',
    email: 'alice@example.com',
    emailVerified: true,
  });
});

describe('updateUserRecord — email verification', () => {
  test('changing the email clears the verified flag', async () => {
    await updateUserRecord(db as any, 1, { email: 'someone-else@example.com' });
    expect(await verifiedFlag(1)).toBe(false);
  });

  test('clearing the email clears the verified flag', async () => {
    await updateUserRecord(db as any, 1, { email: null });
    expect(await verifiedFlag(1)).toBe(false);
  });

  test('re-sending the same email keeps it verified', async () => {
    await updateUserRecord(db as any, 1, { email: 'alice@example.com', name: 'Alice' });
    expect(await verifiedFlag(1)).toBe(true);
  });

  test('a name-only update keeps it verified', async () => {
    await updateUserRecord(db as any, 1, { name: 'Alice' });
    expect(await verifiedFlag(1)).toBe(true);
  });
});

describe('updateUserRecord — email ownership', () => {
  beforeEach(async () => {
    await db
      .insert(schema.users)
      .values({ id: 2, username: 'bob', password: 'x', role: 'user', email: 'bob@example.com' });
  });

  test('refuses an address another account already uses, ignoring case', async () => {
    await expect(updateUserRecord(db as any, 1, { email: 'BOB@example.com' })).rejects.toThrow('Email already in use');
    const [alice] = await db.select().from(schema.users).where(eq(schema.users.id, 1));
    expect(alice?.email).toBe('alice@example.com');
    expect(alice?.emailVerified).toBe(true);
  });

  test('re-casing its own address is allowed', async () => {
    const updated = await updateUserRecord(db as any, 1, { email: 'Alice@Example.com' });
    expect(updated?.email).toBe('Alice@Example.com');
  });

  test('clearing the email never collides with another account', async () => {
    await updateUserRecord(db as any, 2, { email: null });
    const updated = await updateUserRecord(db as any, 1, { email: null });
    expect(updated?.email).toBeNull();
  });
});

describe('deleteUserRecord', () => {
  beforeEach(async () => {
    // The server enables FK enforcement per connection; mirror it so a
    // dangling reference fails here the way it does in production.
    await db.run(sql`PRAGMA foreign_keys = ON`);
    await db.insert(schema.projects).values({ id: 1, name: 'gaps-project' });
  });

  test('deletes a user who triaged a scenario gap and clears the reference', async () => {
    // `triaged_by` was added by ALTER TABLE, which cannot carry ON DELETE SET
    // NULL on SQLite, so the handler has to clear it before the delete.
    const [gap] = await db
      .insert(schema.scenarioGaps)
      .values({
        projectId: 1,
        detector: 'success-only',
        class: 'blind-spot',
        key: 'GET /api/cart',
        title: 'gap',
        triagedBy: 1,
      })
      .returning({ id: schema.scenarioGaps.id });

    await expect(deleteUserRecord(db as any, 1)).resolves.toEqual({ success: true });

    expect(await db.select().from(schema.users).where(eq(schema.users.id, 1))).toHaveLength(0);
    const [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, gap!.id));
    expect(row?.triagedBy).toBeNull();
  });
});
