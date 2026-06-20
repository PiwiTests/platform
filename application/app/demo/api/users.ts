/**
 * Client-side implementations of the /api/users* endpoints for demo mode.
 *
 * Thin wrappers that delegate to shared handler functions.
 */

import { getDemoDb } from '../db.client';
import {
  listUsers,
  createUserRecord,
  deleteUserRecord,
  listUserApiKeys,
  createUserApiKeyRecord,
  deleteUserApiKeyRecord,
} from '~~/shared/handlers/users';

/** GET /api/users */
export async function apiGetUsers() {
  return listUsers(await getDemoDb());
}

/** POST /api/users */
export async function apiCreateUser(body: { username: string; password: string; role?: string; name?: string }) {
  return createUserRecord(await getDemoDb(), {
    username: body.username,
    password: body.password,
    role: body.role ?? 'user',
    name: body.name,
  });
}

/** DELETE /api/users/:id */
export async function apiDeleteUser(id: number) {
  return deleteUserRecord(await getDemoDb(), id);
}

/** GET /api/users/:id/api-keys */
export async function apiGetUserApiKeys(userId: number) {
  return listUserApiKeys(await getDemoDb(), userId);
}

/** POST /api/users/:id/api-keys */
export async function apiCreateUserApiKey(userId: number, body: { name: string }) {
  const db = await getDemoDb();
  const prefix = Math.random().toString(36).slice(2, 10);
  const hash = Math.random().toString(36).slice(2, 34);
  await createUserApiKeyRecord(db, userId, { name: body.name, hash, prefix });
  return { key: `pd_${prefix}_${hash}`, name: body.name, prefix, createdAt: new Date().toISOString() };
}

/** DELETE /api/users/:id/api-keys/:keyId */
export async function apiDeleteUserApiKey(userId: number, keyId: number) {
  return deleteUserApiKeyRecord(await getDemoDb(), userId, keyId);
}
