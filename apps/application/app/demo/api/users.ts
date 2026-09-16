/**
 * Client-side implementations of the /api/users* endpoints for demo mode.
 *
 * Only contains functions that are NOT trivial shared-handler wrappers
 * (those are inlined directly in router.ts).
 */

import { getDemoDb } from '../db.client';
import { createUserApiKeyRecord } from '#shared/handlers/users';
import { demoHttpError } from './http-error';

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** POST /api/users/:id/api-keys — same shape and rules as the server route. */
export async function apiCreateUserApiKey(userId: number, body: { name?: string; expiresAt?: string | null }) {
  const db = await getDemoDb();
  const name = typeof body.name === 'string' ? body.name : '';
  if (name.length < 1 || name.length > 100) throw demoHttpError(400, 'name must be between 1 and 100 characters');

  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) throw demoHttpError(400, 'expiresAt must be a valid ISO date');
    expiresAt = parsed;
  }

  // Real random key material (32 bytes), hashed for storage like the server —
  // the plaintext is shown once in the response and never stored.
  const plaintext = `pd_${randomHex(32)}`;
  const prefix = plaintext.slice(3, 11);
  const hash = await sha256Hex(plaintext);
  await createUserApiKeyRecord(db, userId, { name, hash, prefix, expiresAt });
  return { key: plaintext, prefix, name };
}
