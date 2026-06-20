import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { entityLinks } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Role } from '../../../shared/types';
import { detectProvider, extractKey } from '../../../shared/link-detect';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Links'],
    summary: 'Update an entity link',
    description: 'Update the URL and/or title of an entity link. Provider is re-detected if the URL changes.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

const updateLinkSchema = z.object({
  url: z.string().url('Must be a valid URL').optional(),
  title: z.string().max(200).nullable().optional(),
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

  const body = await readBody(event);
  const validation = updateLinkSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (validation.data.url !== undefined) {
    updates.url = validation.data.url;
    const detectedProvider = detectProvider(validation.data.url);
    updates.provider = detectedProvider;
    updates.key = extractKey(validation.data.url, detectedProvider);
  }

  if (validation.data.title !== undefined) {
    updates.title = validation.data.title;
  }

  await db.update(entityLinks).set(updates).where(eq(entityLinks.id, id));

  const updated = await db.select().from(entityLinks).where(eq(entityLinks.id, id));
  return { link: updated[0] };
});
