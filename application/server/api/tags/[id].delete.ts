import { getDatabase } from '../../database';
import { deleteTag } from '~~/shared/handlers/tags';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Delete a tag',
    description: 'Deletes a tag by ID. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid tag ID' });
  }

  try {
    const db = await getDatabase();
    return await deleteTag(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete tag';
    const statusCode = message === 'Tag not found' ? 404 : 400;
    throw createError({ statusCode, message });
  }
});
