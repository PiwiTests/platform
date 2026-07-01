import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { patchLink } from '#shared/handlers/links';
import { z } from 'zod';
import { Role } from '#shared/types';

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

  const body = await readBody(event);
  const validation = updateLinkSchema.safeParse(body);

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues,
    });
  }

  try {
    const db = await getDatabase();
    return await patchLink(db, id, validation.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update link';
    const statusCode = message === 'Link not found' ? 404 : 400;
    throw createError({ statusCode, message });
  }
});
