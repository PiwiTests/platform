import { getDatabase } from '../../../database';
import { getCodeReachForFile } from '../../../utils/code-reach';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { parseLocatorBranchQuery } from '#shared/locator-usages.types';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List the tests that reach a source file',
    description:
      'The tests whose execution reached one application source file: `client` when the file’s functions ran in the page (the reporter’s opt-in `captureCodeReach`, from Chromium’s JavaScript coverage), `server` when the test called a route the Test Map knows is handled by that file. `file` matches a stored repository-relative path or a path suffix of it. Each test carries its latest outcome on the branch. Observed reach, not line coverage.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'file',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Repository-relative path, or a path suffix.',
      },
      {
        name: 'branch',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description:
          'The branch to read: its tests’ own reach where they ran on it, the default branch’s for the others. The default branch when absent.',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const query = getQuery(event);
  const file = typeof query.file === 'string' ? query.file.trim() : '';
  if (!file || file.length > 500)
    throw apiError({ statusCode: 400, message: 'file is required (at most 500 characters)' });
  const branch = parseLocatorBranchQuery(query.branch);
  if ('error' in branch) throw apiError({ statusCode: 400, message: branch.error });
  return getCodeReachForFile(await getDatabase(), id, file, branch.branch);
});
