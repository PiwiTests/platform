import { TOP_SUSPECTS_MAX_TESTS } from '#shared/handlers/flake-profile';
import { getFlakyListSuspects } from '#shared/handlers/flake-lab';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Top flake suspect of several tests',
    description:
      'For each listed test case of the project, the suspect of its flake profile it is shown with (see `GET /api/test-cases/{id}/flake-profile`): the highest-ranked one a flake-lab experiment reproduced, else the highest-ranked untested one, else one that did not reproduce, with the failures and passes it was read from; `suspect` is null when the history names none. `lab` is the test’s latest finished flake-lab experiment (`{ experimentId, verdict, label, finishedAt }`: the verdict, and the reproducing arm’s label when it reproduced), or null. Test cases outside the project are left out. The flaky list reads it after listing the tests.',
    'x-required-permission': 'project:read',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'testCaseIds',
        in: 'query',
        required: true,
        description: `Comma-separated test case ids, at most ${TOP_SUSPECTS_MAX_TESTS}`,
        schema: { type: 'string' },
      },
    ],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const raw = getQuery(event).testCaseIds;
  const ids = (typeof raw === 'string' ? raw.split(',') : [])
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const db = await getDatabase();
  return { items: await getFlakyListSuspects(db, projectId, ids) };
});
