import { entityLinks, testRuns, testRunsCases, testCases } from '../../server/database/schema.sqlite';
import { eq } from 'drizzle-orm';
import { detectProvider, extractKey } from '../link-detect';

import type { DrizzleDB } from './db';

export async function listLinks(db: DrizzleDB, entityType: string, entityId: number) {
  const fkColumn =
    entityType === 'test_run'
      ? entityLinks.testRunId
      : entityType === 'test_runs_case'
        ? entityLinks.testRunsCaseId
        : entityLinks.testCaseId;
  const links = await db.select().from(entityLinks).where(eq(fkColumn, entityId));
  return { links };
}

export async function createLink(
  db: DrizzleDB,
  data: {
    entityType: 'test_run' | 'test_runs_case' | 'test_case';
    entityId: number;
    url: string;
    title?: string | null;
  },
) {
  const { entityType, entityId, url, title } = data;

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

export async function patchLink(db: DrizzleDB, id: number, data: { url?: string; title?: string | null }) {
  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');

  const updates: any = { updatedAt: new Date() };
  if (data.url !== undefined) {
    updates.url = data.url;
    updates.provider = detectProvider(data.url);
    updates.key = extractKey(data.url, updates.provider);
  }
  if (data.title !== undefined) updates.title = data.title;
  await db.update(entityLinks).set(updates).where(eq(entityLinks.id, id));
  const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  return { link: updated[0] ?? null };
}

export async function deleteLink(db: DrizzleDB, id: number) {
  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');
  await db.delete(entityLinks).where(eq(entityLinks.id, id));
  return { success: true };
}

export async function refreshLinkMeta(db: DrizzleDB, id: number) {
  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');
  const link = existing[0];
  const provider = detectProvider(link.url);
  const key = extractKey(link.url, provider);
  await db.update(entityLinks).set({ provider, key, updatedAt: new Date() }).where(eq(entityLinks.id, id));
  const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  return { link: updated[0] ?? null };
}
