import { getDatabase } from '../../../database';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getAriaSampling } from '#shared/handlers/aria-sampling';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List tests due a fresh green ARIA sample',
    description:
      'Returns the tests whose most recent passing-page ARIA snapshot is older than 24 hours, or that have none. The reporter calls this once at run start and captures the ARIA snapshot only at the end of those passing tests, so steady-state sampling costs nothing.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const db = await getDatabase();
  return getAriaSampling(db, id);
});
