import { getDatabase } from '../../database';
import { deleteTag } from '#shared/handlers/tags';
import { requireAuth } from '../../utils/auth';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'Delete a tag',
    description: 'Deletes a tag by ID. Requires `tags:manage` (administrators only).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'tags:manage',
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) {
    throw apiError({ statusCode: 400, message: 'Invalid tag ID' });
  }

  try {
    const db = await getDatabase();
    return await deleteTag(db, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete tag';
    const statusCode = message === 'Tag not found' ? 404 : 400;
    throw apiError({ statusCode, message });
  }
});
