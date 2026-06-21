import { users, apiKeys } from '../../server/database/schema';
import { eq, and } from 'drizzle-orm';

import type { DrizzleDB } from './db';

export async function listUsers(db: DrizzleDB) {
  const allUsers = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      name: users.name,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users);
  return { users: allUsers };
}

export async function createUserRecord(
  db: DrizzleDB,
  data: { username: string; password: string; role: string; name?: string },
) {
  const existing = await db.select().from(users).where(eq(users.username, data.username));
  if (existing.length > 0) throw new Error('Username already exists');
  const [created] = await db
    .insert(users)
    .values({
      username: data.username,
      password: data.password,
      role: data.role,
      name: data.name ?? null,
      avatarUrl: null,
      oauthProvider: null,
      oauthProviderId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return created ?? null;
}

export async function deleteUserRecord(db: DrizzleDB, id: number) {
  const userResults = await db.select().from(users).where(eq(users.id, id));
  if (!userResults[0]) throw new Error('User not found');
  await db.delete(apiKeys).where(eq(apiKeys.userId, id));
  await db.delete(users).where(eq(users.id, id));
  return { success: true };
}

export async function listUserApiKeys(db: DrizzleDB, userId: number) {
  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));
  return { apiKeys: keys };
}

export async function createUserApiKeyRecord(
  db: DrizzleDB,
  userId: number,
  data: { name: string; hash: string; prefix: string; expiresAt?: Date | null },
) {
  await db.insert(apiKeys).values({
    userId,
    name: data.name,
    keyHash: data.hash,
    keyPrefix: data.prefix,
    expiresAt: data.expiresAt ?? null,
  });
  return { success: true };
}

export async function deleteUserApiKeyRecord(db: DrizzleDB, userId: number, keyId: number) {
  const keyResults = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
  if (!keyResults[0]) throw new Error('API key not found');
  await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
  return { success: true };
}
