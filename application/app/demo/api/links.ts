/**
 * Client-side implementations of the /api/links* endpoints for demo mode.
 *
 * Full CRUD on entity links against the in-browser SQLite database.
 * /api/links?entityType=&entityId= (GET) is already handled inline in the
 * router; this file provides the write/delete/refresh endpoints.
 */

import { eq } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import { entityLinks, testRuns, testRunsCases, testCases } from '~~/server/database/schema.sqlite';
import { detectProvider, extractKey } from '~~/shared/link-detect';

/** GET /api/links?entityType=&entityId= */
export async function apiGetLinks(entityType: string, entityId: number) {
  const db = await getDemoDb();

  const fkColumn =
    entityType === 'test_run'
      ? entityLinks.testRunId
      : entityType === 'test_runs_case'
        ? entityLinks.testRunsCaseId
        : entityLinks.testCaseId;

  const links = await db.select().from(entityLinks).where(eq(fkColumn, entityId));
  return { links };
}

/** POST /api/links */
export async function apiCreateLink(body: {
  entityType: 'test_run' | 'test_runs_case' | 'test_case';
  entityId: number;
  url: string;
  title?: string | null;
}) {
  const db = await getDemoDb();

  const { entityType, entityId, url, title } = body;

  let exists = false;
  if (entityType === 'test_run') {
    const row = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, entityId));
    exists = row.length > 0;
  } else if (entityType === 'test_runs_case') {
    const row = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.id, entityId));
    exists = row.length > 0;
  } else {
    const row = await db.select({ id: testCases.id }).from(testCases).where(eq(testCases.id, entityId));
    exists = row.length > 0;
  }

  if (!exists) throw new Error('Entity not found');

  const provider = detectProvider(url);
  const key = extractKey(url, provider);

  const fkColumn =
    entityType === 'test_run'
      ? { testRunId: entityId }
      : entityType === 'test_runs_case'
        ? { testRunsCaseId: entityId }
        : { testCaseId: entityId };

  const result = await db
    .insert(entityLinks)
    .values({ ...fkColumn, url, provider, key, title: title ?? null })
    .returning();

  return { link: result[0] ?? null };
}

/** PATCH /api/links/:id */
export async function apiPatchLink(id: number, body: { url?: string; title?: string | null }) {
  const db = await getDemoDb();

  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (body.url !== undefined) {
    updates.url = body.url;
    updates.provider = detectProvider(body.url);
    updates.key = extractKey(body.url, updates.provider);
  }
  if (body.title !== undefined) {
    updates.title = body.title;
  }

  await db.update(entityLinks).set(updates).where(eq(entityLinks.id, id));
  const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  return { link: updated[0] ?? null };
}

/** DELETE /api/links/:id */
export async function apiDeleteLink(id: number) {
  const db = await getDemoDb();

  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');

  await db.delete(entityLinks).where(eq(entityLinks.id, id));
  return { success: true };
}

/** POST /api/links/:id/refresh — no-op in demo (no network unfurl) */
export async function apiRefreshLink(id: number) {
  const db = await getDemoDb();

  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');

  const link = existing[0];
  const provider = detectProvider(link.url);
  const key = extractKey(link.url, provider);

  await db.update(entityLinks).set({ provider, key, updatedAt: new Date() }).where(eq(entityLinks.id, id));

  const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  return { link: updated[0] ?? null };
}
