import { getDatabase } from '../../../database';
import { getLocatorIndex } from '../../../utils/locator-usages';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { parseLocatorBranchQuery } from '#shared/locator-usages.types';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Download a project’s locator index',
    description:
      'Returns every distinct locator chain the project’s tests used, the chains reaching the most tests first, each with the tests that use it and how (actions, call sites, Playwright projects). Tests carry their latest outcome, and `testIdAttributes` names the attributes `getByTestId` reads when a run reported Playwright’s `testIdAttribute`. The Piwi Picker browser extension evaluates these chains against a live page to show which elements are tested. Describes one branch (`branch`, the default branch when absent), and lists the branches with uses of their own. Capped at 20000 chains; `truncated` says when more exist.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'branch',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description:
          'The branch to describe: its tests’ uses where they ran on it, the default branch’s for the others. `*` for every branch together; the default branch when absent.',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);

  const branch = parseLocatorBranchQuery(getQuery(event).branch);
  if ('error' in branch) throw apiError({ statusCode: 400, message: branch.error });

  const db = await getDatabase();
  const index = await getLocatorIndex(db, id, { branch: branch.branch });
  if (!index) throw apiError({ statusCode: 404, message: 'Project not found' });
  return index;
});
