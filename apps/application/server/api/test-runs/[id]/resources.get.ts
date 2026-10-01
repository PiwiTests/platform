import { getRunResources } from '#shared/handlers/run-resources';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Run resources',
    description:
      "Returns what a run's reporters measured about resources: `report.parts`, one per reporter (one per shard of a sharded run), each with the findings (objects left open past the test or describe block that opened them, pages opened and never used, pages, listeners or route handlers piling up on a long-lived page, Node handles left in a worker, and probable leaks counted from steps) and what the run cost its machine (CPU by process role, time waiting for a CPU, peak memory, disk); and `costliest`, the executions that used the most CPU in their worker and browser processes, at most 20, with `measuredExecutions` counting every execution that carried its cost. `report` is null when no reporter sent one, or when the project declined the resources capability.",
    'x-required-roles': ['administrator', 'reporter', 'user'],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const runId = requireRouteId(event, 'id', 'run ID');
  const { db } = await requireResolvedProjectAccess(event, runId, resolveRunProjectId, 'Run');
  const resources = await getRunResources(db, runId);
  if (!resources) throw apiError({ statusCode: 404, message: 'Run not found' });
  return resources;
});
