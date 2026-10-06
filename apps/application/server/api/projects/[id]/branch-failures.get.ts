import { getDatabase } from '../../../database';
import { getBranchFailures } from '../../../utils/branch-failures';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get the latest complete run on a branch and its failures',
    description:
      'The newest complete run of the project on `branch` (any branch when omitted) (a finished run of the whole suite, never a Flake Lab or probe run, a filtered run or a selection run) with its counts, and its failed executions (at most 200): `{ executionId, testCaseId, clusterId, title, file, line, status, headline, location, message, frames, traces, screenshot }`. `location` is the failing call from the error’s first frame outside `node_modules`; `frames` lists those frames innermost first (at most 10), each `file:line:col`; `message` is the error without its stack, at most 12 lines; `traces` and `screenshot` are stored paths served by `/api/files/<path>`. `run` is null when the branch has no complete run. Editors show these in their Problems panel and status bar.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'branch', in: 'query', required: false, schema: { type: 'string' } },
    ],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const branch = String(getQuery(event).branch ?? '').trim();
  if (branch.length > 255) throw apiError({ statusCode: 400, message: 'branch is at most 255 characters' });
  return getBranchFailures(await getDatabase(), id, branch || null);
});
