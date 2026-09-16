import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { optionalIntQuery, queryFlag } from '../../../utils/query-params';
import { getDatabase } from '../../../database';
import { getProjectPerformance } from '#shared/handlers/projects';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Performance trend data',
    description:
      'Returns test run duration, average test duration, and p90 test duration for trend charts with optional date range filtering',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'runs',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 50, maximum: 200 },
        description: 'Number of recent runs to include (default 50, max 200). Domain window, not row pagination.',
      },
      {
        name: 'from',
        in: 'query',
        required: false,
        schema: { type: 'string', format: 'date-time' },
        description: 'Start of the date range (inclusive).',
      },
      {
        name: 'to',
        in: 'query',
        required: false,
        schema: { type: 'string', format: 'date-time' },
        description: 'End of the date range (inclusive).',
      },
      {
        name: 'fullRunsOnly',
        in: 'query',
        required: false,
        schema: { type: 'boolean', default: true },
        description: 'Restrict to full runs; pass "false" to include partial runs.',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const query = getQuery(event);
  const runs = optionalIntQuery(event, 'runs', { default: 50, min: 1, max: 200 });
  const from = query.from as string | undefined;
  const to = query.to as string | undefined;
  const fullRunsOnly = queryFlag(event, 'fullRunsOnly', { default: true });

  const db = await getDatabase();

  try {
    return { items: await getProjectPerformance(db, id, runs, from, to, fullRunsOnly) };
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw apiError({ statusCode: 404, message: 'Project not found' });
    }
    if (e?.message === 'Invalid from date' || e?.message === 'Invalid to date') {
      throw apiError({ statusCode: 400, message: e.message });
    }
    throw e;
  }
});
