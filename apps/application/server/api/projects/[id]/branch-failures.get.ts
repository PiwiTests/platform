import { getDatabase } from '../../../database';
import { getBranchFailures } from '../../../utils/branch-failures';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get the latest complete run on a branch and its failures',
    description:
      'The newest complete run of the project on `branch` (any branch when omitted) (a finished run of the whole suite, never a Flake Lab or probe run, a filtered run or a selection run; a CI run first, else a local one) with its counts, `origin` and `commit`, and its failed executions (at most 200): `{ executionId, testCaseId, clusterId, title, file, line, status, headline, location, message, frames, traces, screenshot, source, runId, browserName, duration, isNew, clusterTitle, owner, note? }`. `location` is the failing call from the error’s first frame outside `node_modules`; `frames` lists those frames innermost first (at most 10), each `file:line:col`; `message` is the error without its stack, at most 12 lines; `traces` and `screenshot` are stored paths served by `/api/files/<path>`; `browserName` is the Playwright project; `duration` is in milliseconds; `clusterTitle` and `owner` are those of the failure cluster and of the test. `run` is null when the branch has no complete run. With `overlays=1`, the finished runs of that run’s branch started after it, whole or partial, of any origin but Flake Lab, probe, bisect and reproduction runs and environment incidents (at most 20, newest first), are laid over it in `overlays`: `{ id, status, origin, isFullRun, startTime, commit, totalTests, passedTests, failedTests, flakyTests, skippedTests }`. For each test and Playwright project, the newest result of those runs and the complete run wins: a failure a later run passed moves to `resolved` (`{ testCaseId, title, file, line, browserName, runId, executionId, baselineExecutionId }`, at most 200), a failure a later run failed again is listed from that run’s execution, and a test that fails in a later run only is listed with `isNew: true`. `source` says which run a failure is listed from (`baseline` or `overlay`), and `runId` names it; `isNew` is, for the complete run, whether the failure is a new regression there, and for a later run, whether the test did not fail on that project in the complete run. A skipped test resolves nothing, nor does a pass on another Playwright project, which the failure notes (`note`: `passed on chromium in run #124`). Without `overlays`, `overlays` and `resolved` are empty. Editors show these in their Problems panel and status bar.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'branch', in: 'query', required: false, schema: { type: 'string' } },
      {
        name: 'overlays',
        in: 'query',
        required: false,
        description: 'Lay the finished runs of the branch started after the complete run over it (`1` or `true`).',
        schema: { type: 'boolean', default: false },
      },
    ],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const query = getQuery(event);
  const branch = String(query.branch ?? '').trim();
  if (branch.length > 255) throw apiError({ statusCode: 400, message: 'branch is at most 255 characters' });
  const overlays = query.overlays === '1' || query.overlays === 'true';
  return getBranchFailures(await getDatabase(), id, branch || null, { overlays });
});
