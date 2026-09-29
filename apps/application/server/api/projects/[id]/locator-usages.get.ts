import { getDatabase } from '../../../database';
import { getLocatorUsages } from '../../../utils/locator-usages';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { parseLocatorBranchQuery, parseLocatorUsageQuery } from '#shared/locator-usages.types';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Find the tests that use a locator',
    description:
      'Returns the call sites and tests whose recorded steps used a matching locator chain, most-shared call site first. `match=locator` finds this exact chain, `target` any chain ending on the same call whatever its containers, `scope` this chain and every chain that continues inside it, `search` chains containing the text.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'match',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['locator', 'target', 'scope', 'search'] },
      },
      {
        name: 'value',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'The chain, target call, container or search text (1 to 2000 characters)',
      },
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

  const query = getQuery(event);
  const parsed = parseLocatorUsageQuery(query.match, query.value);
  if ('error' in parsed) throw apiError({ statusCode: 400, message: parsed.error });
  const branch = parseLocatorBranchQuery(query.branch);
  if ('error' in branch) throw apiError({ statusCode: 400, message: branch.error });

  const db = await getDatabase();
  return getLocatorUsages(db, id, parsed.match, parsed.value, { branch: branch.branch });
});
