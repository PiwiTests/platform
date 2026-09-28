import { getDatabase } from '../../../database';
import { getBranchFailures } from '../../../utils/branch-failures';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get the latest run on a branch and its failures',
    description:
      'The newest run of the project on `branch` (any branch when omitted) with its counts, and its failed executions (at most 200): `{ executionId, testCaseId, clusterId, title, file, line, status, headline, location, traces, screenshot }`. `location` is the failing call from the error’s first frame outside `node_modules`; `traces` and `screenshot` are stored paths served by `/api/files/<path>`. `run` is null when the branch has no run. Editors show these in their Problems panel and status bar.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'branch', in: 'query', required: false, schema: { type: 'string' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const branch = String(getQuery(event).branch ?? '').trim();
  if (branch.length > 255) throw apiError({ statusCode: 400, message: 'branch is at most 255 characters' });
  return getBranchFailures(await getDatabase(), id, branch || null);
});
