import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler module (which imports the barrel) loads.
delete process.env.PIWI_DATABASE_URL;
const { updateUserRecord } = await import('../../shared/handlers/users');

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
