import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';
import type { OAuthProfile } from '../../server/utils/oauth-helpers';

// The schema barrel (server/database/schema.ts) picks the PostgreSQL schema at
// import time when PIWI_DATABASE_URL is set, so clear it before oauth.ts (which
// imports the barrel) is loaded.
delete process.env.PIWI_DATABASE_URL;
const { findOrCreateOAuthUser } = await import('../../server/utils/oauth');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

const profile = (over: Partial<OAuthProfile> = {}): OAuthProfile => ({
  provider: 'github',
  providerId: '583231',
  email: 'alice@example.com',
  emailVerified: false,
  name: 'Alice',
  avatar: '',
  login: 'octocat',
  ...over,
});

async function addUser(values: Partial<typeof schema.users.$inferInsert> & { id: number; username: string }) {
  await db.insert(schema.users).values({ password: 'hash', role: 'member', ...values });
}

async function allUsers() {
  return db.select().from(schema.users).orderBy(schema.users.id);
}

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
});

describe('findOrCreateOAuthUser — unverified provider email', () => {
  test('an address no account holds is stored, unverified, and becomes the username', async () => {
    const user = await findOrCreateOAuthUser(profile(), db);
    expect(user).toMatchObject({ username: 'alice@example.com', email: 'alice@example.com', emailVerified: false });
  });

  test.each(['alice@example.com', 'Alice@Example.COM'])(
    'an address another account holds as %s gives a new account without an email',
    async (stored) => {
      await addUser({ id: 1, username: 'alice', email: stored, emailVerified: true });

      const user = await findOrCreateOAuthUser(profile(), db);

      expect(user.id).not.toBe(1);
      expect(user).toMatchObject({
        username: 'octocat',
        email: null,
        emailVerified: false,
        oauthProvider: 'github',
        oauthProviderId: '583231',
      });
      const [existing] = await db.select().from(schema.users).where(eq(schema.users.id, 1));
      expect(existing).toMatchObject({ email: stored, oauthProvider: null });
    },
  );

  test('a taken username gets the first free numbered one', async () => {
    await addUser({ id: 1, username: 'alice@example.com', email: null });
    await addUser({ id: 2, username: 'alice@example.com-2', email: null });

    const user = await findOrCreateOAuthUser(profile(), db);

    expect(user).toMatchObject({ username: 'alice@example.com-3', email: 'alice@example.com' });
  });

  test('without a login, a held address gives a username from the provider id', async () => {
    await addUser({ id: 1, username: 'alice', email: 'alice@example.com' });

    const user = await findOrCreateOAuthUser(profile({ provider: 'google', login: undefined }), db);

    expect(user).toMatchObject({ username: 'google-583231', email: null });
  });

  test('a second identity with the same unverified address gets an account without it', async () => {
    const first = await findOrCreateOAuthUser(profile(), db);
    const second = await findOrCreateOAuthUser(profile({ providerId: '999', login: 'octocat2' }), db);

    expect(first.email).toBe('alice@example.com');
    expect(second).toMatchObject({ username: 'octocat2', email: null });
  });
});

describe('findOrCreateOAuthUser — no email address from the provider', () => {
  test('a GitHub profile without an email takes its login as username and stores no email', async () => {
    await addUser({ id: 1, username: 'octocat', email: null });

    const user = await findOrCreateOAuthUser(profile({ email: '' }), db);

    expect(user).toMatchObject({ username: 'octocat-2', email: null, emailVerified: false });
  });

  test('a value that is not an address is never written to users.email', async () => {
    const user = await findOrCreateOAuthUser(profile({ email: 'octocat', emailVerified: true }), db);

    expect(user).toMatchObject({ username: 'octocat', email: null, emailVerified: false });
  });

  test('a later sign-in clears a stored value that is not an address', async () => {
    await addUser({
      id: 1,
      username: 'octocat',
      email: 'octocat',
      password: '',
      oauthProvider: 'github',
      oauthProviderId: '583231',
    });

    const user = await findOrCreateOAuthUser(profile({ email: '' }), db);

    expect(user).toMatchObject({ id: 1, email: null, emailVerified: false });
  });
});

describe('findOrCreateOAuthUser — linked and verified accounts', () => {
  test('a verified address links the account that verified it, ignoring case', async () => {
    await addUser({ id: 1, username: 'alice', email: 'Alice@Example.com', emailVerified: true });

    const user = await findOrCreateOAuthUser(profile({ emailVerified: true }), db);

    expect(user).toMatchObject({ id: 1, oauthProvider: 'github', oauthProviderId: '583231' });
    expect(await allUsers()).toHaveLength(1);
  });

  test('a returning identity signs in to its account even when its new address is held elsewhere', async () => {
    await addUser({
      id: 1,
      username: 'alice@example.com',
      email: 'alice@example.com',
      emailVerified: true,
      password: '',
      oauthProvider: 'github',
      oauthProviderId: '583231',
    });
    await addUser({ id: 2, username: 'bob', email: 'bob@example.com' });

    const user = await findOrCreateOAuthUser(profile({ email: 'BOB@example.com', emailVerified: true }), db);

    expect(user).toMatchObject({ id: 1, email: 'alice@example.com', emailVerified: true });
    expect(await allUsers()).toHaveLength(2);
  });

  test('a returning identity signs in to the same account', async () => {
    const first = await findOrCreateOAuthUser(profile(), db);
    const again = await findOrCreateOAuthUser(profile(), db);

    expect(again.id).toBe(first.id);
    expect(await allUsers()).toHaveLength(1);
  });
});
