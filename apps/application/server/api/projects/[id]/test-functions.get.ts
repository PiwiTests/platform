import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { listProjectTestFunctions } from '#shared/handlers/test-functions';

defineRouteMeta({
  openAPI: {
    tags: ['Test Functions'],
    summary: 'List a project’s test function catalog',
    description:
      'Returns the page-object methods and helpers recorded or registered for a project, used to match against a recorded browser-extension session and substitute raw locator steps with calls to the project’s own code.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);

  const db = await getDatabase();
  return { items: (await listProjectTestFunctions(db, id)).testFunctions };
});
