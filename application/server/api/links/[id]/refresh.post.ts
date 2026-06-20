import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { entityLinks } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { Role } from '../../../../shared/types';
import { detectProvider, extractKey } from '../../../../shared/link-detect';
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

  const existing = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  if (!existing[0]) {
    throw createError({ statusCode: 404, message: 'Link not found' });
  }

  const link = existing[0];
  const provider = detectProvider(link.url);
  const key = extractKey(link.url, provider);

  // Generic unfurl: fetch the page and extract title
  const { title, statusText, statusColor } = await unfurlUrl(link.url);

  await db
    .update(entityLinks)
    .set({
      provider,
      key,
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
