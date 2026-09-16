import { requireProjectAccess, requireRouteId } from '../../../../../utils/project-access';
import { getDatabase } from '../../../../../database';
import { getSelection, resolveSelectionDefinition } from '#shared/handlers/selections';
import { parseRankBy, parseShard, type SelectionDefinition, type SelectionFormat } from '#shared/selection';

const FORMATS: SelectionFormat[] = ['args', 'grep', 'files', 'json'];

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Resolve a selection to a runnable command',
    description:
      'Evaluates a saved (or built-in) selection against the current test catalog and returns the matching tests, an estimate, any warnings, and a materialized `playwright test` command. `format` picks the materialization (`args` file:line, `grep`, `files`, or `json`); `budgetMs` overrides the definition’s time budget for this resolution. This is what `piwi select` / `piwi run` call.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: FORMATS } },
      { name: 'budgetMs', in: 'query', required: false, schema: { type: 'integer' } },
      {
        name: 'shard',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Keep only shard i of n (e.g. "2/4"), balanced by duration',
      },
      { name: 'pkgRunner', in: 'query', required: false, schema: { type: 'string' } },
      {
        name: 'order',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['failureLikelihood', 'recentFailure', 'priority', 'slowest', 'fastest'] },
        description: 'Emit tests in this rank order (fail-fast): failure ranks put the least-reliable tests first',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const key = String(getRouterParam(event, 'key') ?? '');

  const query = getQuery(event);
  const format = FORMATS.includes(query.format as SelectionFormat) ? (query.format as SelectionFormat) : 'args';
  const budgetMs = Number(query.budgetMs);
  const pkgRunner = typeof query.pkgRunner === 'string' && query.pkgRunner.trim() ? query.pkgRunner.trim() : undefined;

  const db = await getDatabase();
  const selection = await getSelection(db, projectId, key);
  if (!selection) throw apiError({ statusCode: 404, message: `No selection "${key}" in this project` });

  let definition: SelectionDefinition = selection.definition;
  if (Number.isFinite(budgetMs) && budgetMs > 0) {
    definition = { ...definition, budget: { ...definition.budget, maxTotalDurationMs: budgetMs } };
  }

  return resolveSelectionDefinition(db, projectId, definition, {
    key: selection.key,
    version: selection.version,
    format,
    pkgRunner,
    shard: parseShard(query.shard) ?? undefined,
    order: parseRankBy(query.order) ?? undefined,
  });
});
