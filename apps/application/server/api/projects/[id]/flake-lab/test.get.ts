import { resolveTestCaseByLocation } from '#shared/handlers/flake-lab';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Find the test case at a file and line',
    description:
      'The test case `piwi flake <file:line>` names: the test declared on that line of the spec file, else the last one declared before it (the test whose body holds the line), from each test’s latest execution. The file is the stored path or its end from a folder boundary. 404 when no test fits.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'location',
        in: 'query',
        required: true,
        description: 'A spec path and line, `tests/checkout.spec.ts:42`',
        schema: { type: 'string' },
      },
    ],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const location = String(getQuery(event).location ?? '');
  const match = /^(.+):(\d+)$/.exec(location.trim());
  if (!match) throw apiError({ statusCode: 400, message: 'location must be a spec path and a line, file:line' });
  const db = await getDatabase();
  const found = await resolveTestCaseByLocation(db, projectId, match[1]!, Number(match[2]));
  if (!found) throw apiError({ statusCode: 404, message: `No test case at ${location}` });
  return found;
});
