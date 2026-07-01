import { failureDiagnosisVersions } from '../../../database/schema';
import { eq, desc } from 'drizzle-orm';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get diagnosis history for a cluster',
    description: 'Returns previous diagnosis versions for a failure cluster, ordered by creation date descending.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const clusterId = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, clusterId, resolveClusterProjectId, 'Failure cluster');

  const versions = await db
    .select()
    .from(failureDiagnosisVersions)
    .where(eq(failureDiagnosisVersions.clusterId, clusterId))
    .orderBy(desc(failureDiagnosisVersions.createdAt))
    .limit(50);

  return versions.map((v) => ({
    id: v.id,
    status: v.status,
    category: v.category,
    confidence: v.confidence,
    summary: v.summary,
    rootCause: v.rootCause,
    model: v.model,
    inputTokens: v.inputTokens,
    outputTokens: v.outputTokens,
    durationMs: v.durationMs,
    createdAt: v.createdAt,
  }));
});
