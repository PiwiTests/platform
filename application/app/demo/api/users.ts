/**
 * Client-side implementations of the /api/users* endpoints for demo mode.
 *
 * Only contains functions that are NOT trivial shared-handler wrappers
 * (those are inlined directly in router.ts).
 */

import { getDemoDb } from '../db.client';
import { createUserApiKeyRecord } from '#shared/handlers/users';

/** POST /api/users/:id/api-keys */
export async function apiCreateUserApiKey(userId: number, body: { name: string }) {
  const db = await getDemoDb();
  const prefix = Math.random().toString(36).slice(2, 10);
  const hash = Math.random().toString(36).slice(2, 34);
  await createUserApiKeyRecord(db, userId, { name: body.name, hash, prefix });
  return { key: `pd_${prefix}_${hash}`, name: body.name, prefix, createdAt: new Date().toISOString() };
}
