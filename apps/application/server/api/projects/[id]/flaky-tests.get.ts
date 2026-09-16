import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { optionalIntQuery } from '../../../utils/query-params';
import { getDatabase } from '../../../database';
import { getProjectFlakyTests } from '#shared/handlers/projects';
import { parseTagFilter } from '#shared/utils/tag-filter';
import { withResolvedOwners } from '../../../utils/scm/ownership';
import { TEST_PRIORITIES } from '@piwitests/core/test-meta';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Flaky test analysis',
    description:
      'Analyzes test flakiness across recent runs using retry-pass detection and pass/fail alternation scoring. Pass an environment and/or branch to scope the analysis to runs from that deployment environment or SCM branch.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'runs', in: 'query', required: false, schema: { type: 'integer' } },
      { name: 'environment', in: 'query', required: false, schema: { type: 'string' } },
      { name: 'branch', in: 'query', required: false, schema: { type: 'string' } },
      {
        name: 'tags',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated tags; a test must carry every one of them to appear',
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
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const query = getQuery(event);
  const runsLimit = optionalIntQuery(event, 'runs', { default: 50, min: 1, max: 200 });
  const environment = typeof query.environment === 'string' && query.environment ? query.environment : undefined;
  const branch = typeof query.branch === 'string' && query.branch ? query.branch : undefined;

  const tags = parseTagFilter(typeof query.tags === 'string' ? query.tags : undefined);
  const rawPriority = typeof query.priority === 'string' ? query.priority.trim().toLowerCase() : '';
  const filter = {
    tags: tags.length > 0 ? tags : undefined,
    owner: typeof query.owner === 'string' && query.owner.trim() ? query.owner.trim() : undefined,
    priority: (TEST_PRIORITIES as readonly string[]).includes(rawPriority) ? rawPriority : undefined,
  };

  const db = await getDatabase();

  try {
    const rows = await getProjectFlakyTests(db, projectId, runsLimit, environment, filter, branch);
    // Fill in the owner from CODEOWNERS for tests that declare none, so the
    // leaderboard can be read per team without anyone annotating a test.
    return { items: await withResolvedOwners(db, projectId, rows) };
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw apiError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
