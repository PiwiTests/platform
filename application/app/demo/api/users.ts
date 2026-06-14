/**
 * Client-side implementations of the /api/users* endpoints for demo mode.
 */

import { eq, desc } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import { users, apiKeys } from '~~/server/database/schema.sqlite';

/** GET /api/users */
export async function apiGetUsers() {
  const db = await getDemoDb();
  const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
  return { users: allUsers };
}

/** POST /api/users */
export async function apiCreateUser(body: { username: string; password: string; role?: string; name?: string }) {
  const db = await getDemoDb();
  const now = new Date();
  const [created] = await db
    .insert(users)
    .values({
      username: body.username,
      password: body.password,
      role: body.role ?? 'user',
      name: body.name ?? null,
      avatarUrl: null,
      oauthProvider: null,
      oauthProviderId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created ?? null;
}

/** DELETE /api/users/:id */
export async function apiDeleteUser(id: number) {
  const db = await getDemoDb();
  await db.delete(apiKeys).where(eq(apiKeys.userId, id));
  await db.delete(users).where(eq(users.id, id));
  return { success: true };
}

/** GET /api/users/:id/api-keys */
export async function apiGetUserApiKeys(userId: number) {
  const db = await getDemoDb();
  const keys = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  return { apiKeys: keys };
}

/** POST /api/users/:id/api-keys */
export async function apiCreateUserApiKey(userId: number, body: { name: string }) {
  const db = await getDemoDb();
  const now = new Date();
  const prefix = Math.random().toString(36).slice(2, 10);
  const hash = Math.random().toString(36).slice(2, 34);
  const [created] = await db
    .insert(apiKeys)
    .values({
      userId,
      name: body.name,
      keyHash: hash,
      keyPrefix: prefix,
      createdAt: now,
      lastUsedAt: null,
      expiresAt: null,
    })
    .returning();
  return created ?? null;
}

/** DELETE /api/users/:id/api-keys/:keyId */
export async function apiDeleteUserApiKey(userId: number, keyId: number) {
  const db = await getDemoDb();
  await db.delete(apiKeys).where(eq(apiKeys.id, keyId));
  return { success: true };
}
