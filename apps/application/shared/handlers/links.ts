import { entityLinks, testRuns, testRunsCases, testCases, failureClusters } from '../../server/database/schema';
import { eq } from 'drizzle-orm';
import { detectProvider, extractKey, type LinkProvider } from '../link-detect';

import type { DrizzleDB } from './db';

/**
 * How a URL resolved against the configured connections. Injected by the server
 * (which reaches the connection clients) so this shared handler stays free of
 * server-only code and keeps running in the browser demo.
 */
export type LinkConnectionResolver = (
  url: string,
) => Promise<{ provider: LinkProvider; connectionId: number | null; key: string | null }>;

/** Resolve a URL's provider/key/connection, using the resolver when given. */
async function resolveUrl(
  url: string,
  resolver?: LinkConnectionResolver,
): Promise<{ provider: string; key: string | null; connectionId: number | null; externalId: string | null }> {
  if (resolver) {
    const r = await resolver(url);
    return {
      provider: r.provider,
      key: r.key,
      connectionId: r.connectionId,
      externalId: r.connectionId ? r.key : null,
    };
  }
  const provider = detectProvider(url);
  return { provider, key: extractKey(url, provider), connectionId: null, externalId: null };
}

/** The entities an external link can be pinned to. */
export type LinkEntityType = 'test_run' | 'test_runs_case' | 'test_case' | 'failure_cluster';

export const LINK_ENTITY_TYPES: readonly LinkEntityType[] = [
  'test_run',
  'test_runs_case',
  'test_case',
  'failure_cluster',
];

/** The `entity_links` FK column that holds an id of the given entity type. */
function fkColumnFor(entityType: LinkEntityType) {
  switch (entityType) {
    case 'test_run':
      return entityLinks.testRunId;
    case 'test_runs_case':
      return entityLinks.testRunsCaseId;
    case 'failure_cluster':
      return entityLinks.failureClusterId;
    default:
      return entityLinks.testCaseId;
  }
}

/** The `entity_links` insert field name for the given entity type. */
function fkFieldFor(entityType: LinkEntityType, entityId: number): Record<string, number> {
  switch (entityType) {
    case 'test_run':
      return { testRunId: entityId };
    case 'test_runs_case':
      return { testRunsCaseId: entityId };
    case 'failure_cluster':
      return { failureClusterId: entityId };
    default:
      return { testCaseId: entityId };
  }
}

export async function listLinks(db: DrizzleDB, entityType: LinkEntityType, entityId: number) {
  const links = await db
    .select()
    .from(entityLinks)
    .where(eq(fkColumnFor(entityType), entityId));
  return { links };
}

export async function createLink(
  db: DrizzleDB,
  data: {
    entityType: LinkEntityType;
    entityId: number;
    url: string;
    title?: string | null;
  },
  resolver?: LinkConnectionResolver,
) {
  const { entityType, entityId, url, title } = data;

  let exists = false;
  if (entityType === 'test_run') {
    const row = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, entityId));
    exists = row.length > 0;
  } else if (entityType === 'test_runs_case') {
    const row = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.id, entityId));
    exists = row.length > 0;
  } else if (entityType === 'failure_cluster') {
    const row = await db
      .select({ id: failureClusters.id })
      .from(failureClusters)
      .where(eq(failureClusters.id, entityId));
    exists = row.length > 0;
  } else {
    const row = await db.select({ id: testCases.id }).from(testCases).where(eq(testCases.id, entityId));
    exists = row.length > 0;
  }
  if (!exists) throw new Error('Entity not found');

  const { provider, key, connectionId, externalId } = await resolveUrl(url, resolver);

  const result = await db
    .insert(entityLinks)
    .values({
      ...fkFieldFor(entityType, entityId),
      url,
      provider,
      key,
      connectionId,
      externalId,
      title: title ?? null,
    })
    .returning();
  return { success: true, link: result[0] ?? null };
}

export async function patchLink(
  db: DrizzleDB,
  id: number,
  data: { url?: string; title?: string | null },
  resolver?: LinkConnectionResolver,
) {
  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');

  const updates: any = { updatedAt: new Date() };
  if (data.url !== undefined) {
    const resolved = await resolveUrl(data.url, resolver);
    updates.url = data.url;
    updates.provider = resolved.provider;
    updates.key = resolved.key;
    updates.connectionId = resolved.connectionId;
    updates.externalId = resolved.externalId;
  }
  if (data.title !== undefined) updates.title = data.title;
  await db.update(entityLinks).set(updates).where(eq(entityLinks.id, id));
  const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  return { success: true, link: updated[0] ?? null };
}

export async function deleteLink(db: DrizzleDB, id: number) {
  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');
  await db.delete(entityLinks).where(eq(entityLinks.id, id));
  return { success: true };
}

export async function refreshLinkMeta(db: DrizzleDB, id: number, resolver?: LinkConnectionResolver) {
  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) throw new Error('Link not found');
  const link = existing[0];
  const { provider, key, connectionId, externalId } = await resolveUrl(link.url, resolver);
  await db
    .update(entityLinks)
    .set({ provider, key, connectionId, externalId, updatedAt: new Date() })
    .where(eq(entityLinks.id, id));
  const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  return { success: true, link: updated[0] ?? null };
}
