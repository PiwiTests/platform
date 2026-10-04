import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDatabase } from '../../../../database';
import { graphNodes, projects } from '../../../../database/schema';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { parseRouteNodeKey } from '#shared/graph';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'Get a project’s declared surface',
    description:
      'Returns the declared routes and pages stored as graph nodes (origin `manifest` or `openapi`) plus the configured OpenAPI URL. Declared surface is what the application says it exposes, ahead of any test reaching it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();

  const projectRows = await db
    .select({ openApiUrl: projects.openApiUrl })
    .from(projects)
    .where(eq(projects.id, projectId));

  const nodes = await db
    .select({ kind: graphNodes.kind, key: graphNodes.key, origin: graphNodes.origin, attrs: graphNodes.attrs })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.projectId, projectId),
        isNull(graphNodes.branch),
        isNull(graphNodes.prunedAt),
        inArray(graphNodes.origin, ['manifest', 'openapi']),
      ),
    );

  const routes = nodes
    .filter((n) => n.kind === 'route')
    .map((n) => {
      const { method, pattern } = parseRouteNodeKey(n.key);
      const responses = (n.attrs as { responses?: number[] } | null)?.responses ?? [];
      return { method, pattern, origin: n.origin, responses };
    });
  const pages = nodes
    .filter((n) => n.kind === 'page')
    .map((n) => ({ pattern: n.key, origin: n.origin, name: (n.attrs as { name?: string } | null)?.name ?? null }));

  return { openApiUrl: projectRows[0]?.openApiUrl ?? null, routes, pages };
});
