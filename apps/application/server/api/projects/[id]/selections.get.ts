import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { listSelections } from '#shared/handlers/selections';

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'List a project’s test selections',
    description:
      'Returns the project’s saved selections plus the built-in ones (`failed`, `quarantine-free`). A selection is a named, declarative subset of the suite resolved on demand from run history — see the resolve endpoint to turn one into a runnable command.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const db = await getDatabase();
  return { items: await listSelections(db, projectId) };
});
