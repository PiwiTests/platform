import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { resolveImpact } from '../../../../utils/selection-impact';
import { parseRankBy, parseShard, type SelectionFormat } from '#shared/selection';

const FORMATS: SelectionFormat[] = ['args', 'grep', 'files', 'json'];

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Resolve which tests a set of changed files impacts',
    description:
      'Maps changed files (computed by the client from a git diff) to the tests they affect — directly when a changed file is a test file, and by reach when a test’s captured source frames ran through it. Returns the impacted tests and a `playwright test` command. A changed source file that maps to no test widens the result to the full suite (with a warning) rather than silently skipping it. This is what `piwi run impact --base <ref>` calls; route/page-level mapping is not attempted.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              changedFiles: { type: 'array', items: { type: 'string' } },
              format: { type: 'string', enum: FORMATS },
              shard: { type: 'string', description: 'Keep only shard i of n (e.g. "2/4")' },
              order: {
                type: 'string',
                enum: ['failureLikelihood', 'recentFailure', 'priority', 'slowest', 'fastest'],
                description: 'Emit tests in this rank order (fail-fast)',
              },
            },
            required: ['changedFiles'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const body = (await readBody(event)) as {
    changedFiles?: unknown;
    format?: unknown;
    shard?: unknown;
    order?: unknown;
  };
  const changedFiles = Array.isArray(body.changedFiles)
    ? body.changedFiles.filter((f): f is string => typeof f === 'string')
    : [];
  const format = FORMATS.includes(body.format as SelectionFormat) ? (body.format as SelectionFormat) : 'args';

  const db = await getDatabase();
  return resolveImpact(db, projectId, changedFiles, {
    format,
    shard: parseShard(body.shard) ?? undefined,
    order: parseRankBy(body.order) ?? undefined,
  });
});
