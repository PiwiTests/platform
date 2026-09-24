import { getDatabase } from '../../../database';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { optionalIntQuery } from '../../../utils/query-params';
import { getFeatureGraph, MAX_GRAPH_DEPTH } from '../../../utils/feature-graph';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'The feature-graph neighborhood around a node',
    description:
      'Walks the typed feature graph outward from `node` (`kind:key`, e.g. `route:POST /api/orders`) to `depth` hops (capped at six), returning the nodes — each with its gap class and the tests that reach it — and the edges between them. Reach is observed reach, never instrumented coverage.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'node', in: 'query', required: true, schema: { type: 'string' }, description: 'Seed node as kind:key' },
      {
        name: 'depth',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 2, maximum: MAX_GRAPH_DEPTH },
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();

  const nodeParam = String(getQuery(event).node ?? '').trim();
  const sep = nodeParam.indexOf(':');
  if (sep <= 0) {
    throw apiError({ statusCode: 400, message: 'node must be "kind:key", e.g. route:POST /api/orders' });
  }
  const kind = nodeParam.slice(0, sep);
  const key = nodeParam.slice(sep + 1);
  const depth = optionalIntQuery(event, 'depth', { min: 1, max: MAX_GRAPH_DEPTH }) ?? 2;

  return getFeatureGraph(db, projectId, { kind, key }, depth);
});
