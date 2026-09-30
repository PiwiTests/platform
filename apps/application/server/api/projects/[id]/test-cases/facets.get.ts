import { getDatabase } from '../../../../database';
import { getProjectTestCaseFacets } from '#shared/handlers/projects';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'List the values the test catalog search can filter on',
    description:
      'Every spec file, describe block, tag, lock, owner, priority and feature among a project’s test cases, each with the number of test cases carrying it — the completions of the catalog’s search qualifiers (`file:`, `describe:`, `tag:`…). Returns `{ values: { file?, describe?, tag?, lock?, owner?, priority?, feature? } }`, each a list of `{ value, count }`, most common first; a field no test case has a value for is left out.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'maxAgeDays',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 0, minimum: 0 },
        description: 'Only count cases executed within the last N days (0 = all time)',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const maxAgeDays = Math.max(0, Math.floor(Number(getQuery(event).maxAgeDays) || 0));
  const db = await getDatabase();
  return getProjectTestCaseFacets(db, id, { maxAgeDays });
});
