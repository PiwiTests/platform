import { getDatabase } from '../../../database';
import { getProjectTestCases, parseTestCasesQuery } from '#shared/handlers/projects';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'List test cases for a project with aggregated stats',
    description:
      'Paginated test-case catalog with per-case aggregates: total runs, pass/fail/skip/flaky counts, executed-only pass rate and average duration, derived status category, and last run. Returns `{ items, total, limit, offset }`. Timed-out runs are folded into the failed counts.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 50, minimum: 1, maximum: 1000 },
        description: 'Page size',
      },
      {
        name: 'offset',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 0, minimum: 0 },
        description: 'Row offset for paging',
      },
      {
        name: 'q',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Case-insensitive substring filter on title or file path',
      },
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated status categories to include: passed, failed, flaky, skipped, didnotrun',
      },
      {
        name: 'tags',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description:
          'Comma-separated tags; a case must carry every one of them to match. A leading `@` is optional (`@smoke` and `smoke` are the same tag).',
      },
      {
        name: 'locks',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated lock names; a case must carry every one of them to match.',
      },
      {
        name: 'owner',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Exact owner declared via the `piwi:owner` annotation',
      },
      {
        name: 'priority',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        description: 'Priority declared via the `piwi:priority` annotation',
      },
      {
        name: 'maxAgeDays',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 0, minimum: 0 },
        description: 'Only include cases executed within the last N days (0 = all time)',
      },
      {
        name: 'sort',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: ['lastRun', 'title', 'totalRuns', 'passRate', 'avgDuration', 'status'],
          default: 'lastRun',
        },
        description: 'Sort column',
      },
      {
        name: 'dir',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        description: 'Sort direction',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const db = await getDatabase();
  return getProjectTestCases(db, id, parseTestCasesQuery(getQuery(event)));
});
