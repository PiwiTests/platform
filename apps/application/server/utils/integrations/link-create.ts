import { eq } from 'drizzle-orm';
import { createLink, type LinkEntityType } from '#shared/handlers/links';
import { entityLinks, type EntityLink } from '../../database/schema';
import type { DbClient } from '../../database';
import { detectProviderWithConnections } from './link-resolve';
import { unfurlLink } from './link-unfurl';

/**
 * Attach an external URL to an entity, matching it against the tracker
 * connections, then enrich it (title, status) on a best-effort basis. Throws
 * when the entity does not exist. The REST route and the MCP tool both call it.
 */
export async function createEnrichedLink(
  db: DbClient,
  input: { entityType: LinkEntityType; entityId: number; url: string; title?: string | null },
): Promise<EntityLink | null> {
  const { link } = await createLink(db, input, (u) => detectProviderWithConnections(db, u));
  if (!link) return null;

  // Through the connection when the link matched one, otherwise the rich
  // provider / OpenGraph path.
  const { title, statusText, statusColor } = await unfurlLink(db, link);
  if (!title && !statusText) return link;
  await db
    .update(entityLinks)
    .set({
      title: title ?? link.title,
      statusText: statusText ?? null,
      statusColor: statusColor ?? null,
      unfurledAt: new Date(),
    })
    .where(eq(entityLinks.id, link.id));
  const [updated] = await db.select().from(entityLinks).where(eq(entityLinks.id, link.id));
  return updated ?? link;
}
