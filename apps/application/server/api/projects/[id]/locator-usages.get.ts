import { getDatabase } from '../../../database';
import { getLocatorUsages } from '../../../utils/locator-usages';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import type { LocatorUsageMatch } from '#shared/locator-usages.types';

const MATCHES: ReadonlySet<LocatorUsageMatch> = new Set(['locator', 'target', 'scope', 'search']);

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
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);

  const query = getQuery(event);
  const match = String(query.match ?? '') as LocatorUsageMatch;
  const value = typeof query.value === 'string' ? query.value.trim() : '';
  if (!MATCHES.has(match))
    throw apiError({ statusCode: 400, message: 'match must be locator, target, scope or search' });
  if (!value || value.length > 2000) throw apiError({ statusCode: 400, message: 'value must be 1 to 2000 characters' });

  const db = await getDatabase();
  return getLocatorUsages(db, id, match, value);
});
