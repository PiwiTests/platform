import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { listResolvedSelections, listSelections } from '#shared/handlers/selections';

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'List a project’s test selections',
    description:
      'Returns the project’s saved selections plus the built-in ones (`failed`, `quarantine-free`). A selection is a named, declarative subset of the suite resolved on demand from run history — see the resolve endpoint to turn one into a runnable command. With `resolve=true`, each item also carries `resolved`: what it resolves to now (`testCaseIds`, `resolvedHash`, `estimate`, `warnings`, and the `command` of the resolve endpoint’s default `args` format), every selection read against one load of the run history.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'resolve', in: 'query', required: false, schema: { type: 'boolean', default: false } },
    ],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const resolve = getQuery(event).resolve;
  const db = await getDatabase();
  return {
    items:
      resolve === 'true' || resolve === '1'
        ? await listResolvedSelections(db, projectId)
        : await listSelections(db, projectId),
  };
});
