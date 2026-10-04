// A failure cluster's activity: the fix attempts reported on it with each
// outcome the runs gave them, and what agents wrote to it over MCP.
import { getClusterActivity } from '#shared/handlers/cluster-activity';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: "Get a cluster's activity",
    description:
      'The fix attempts reported on this cluster (applied, then verified or regressed by the runs) and the write tools agents called on it over MCP, newest first, at most 100. Each item has `type` (`fix-attempt` or `agent-call`), `at`, the sentence the timeline shows (`text`), `status`, `channel`, the `user` and `apiKey` names when known, and the `runId` and `commit` of a verdict.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');
  return { items: await getClusterActivity(db, id) };
});
