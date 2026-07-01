import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { entityLinks } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { refreshLinkMeta } from '#shared/handlers/links';
import { Role } from '#shared/types';
import { unfurlUrl } from '../../../utils/unfurl';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Links'],
    summary: 'Refresh entity link enrichment',
    description: 'Re-run provider detection, key extraction, and unfurl (fetch title) for a link.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid link ID' });
  }

  const db = await getDatabase();

  let result: { link: any };
  try {
    result = await refreshLinkMeta(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to refresh link';
    const statusCode = message === 'Link not found' ? 404 : 400;
    throw createError({ statusCode, message });
  }

  const link = result.link;
  if (!link) {
    throw createError({ statusCode: 500, message: 'Failed to refresh link' });
  }

  // Unfurl enrichment (server-only) — tries rich provider first, falls back to OpenGraph
  const { title, statusText, statusColor } = await unfurlUrl(link.url, db);

  await db
    .update(entityLinks)
    .set({
      title: title ?? link.title,
      statusText: statusText ?? link.statusText,
      statusColor: statusColor ?? link.statusColor,
      unfurledAt: title || statusText ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(entityLinks.id, id));

  const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  return { link: updated[0] };
});
