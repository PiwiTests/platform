import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { listTags } from '#shared/handlers/tags';

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'List all tags',
    description: 'Returns a list of all tags ordered alphabetically.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  return { items: (await listTags(await getDatabase())).tags };
});
