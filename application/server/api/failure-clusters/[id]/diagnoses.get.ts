import { getDatabase } from '../../../database';
import { failureDiagnosisVersions } from '../../../database/schema';
import { eq, desc } from 'drizzle-orm';
import { Role } from '../../../../shared/types';
import { requireProjectAccess, resolveClusterProjectId } from '../../../utils/project-access';

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
  const clusterId = parseInt(getRouterParam(event, 'id') || '0');
  if (!clusterId) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const db = await getDatabase();

  const projectId = await resolveClusterProjectId(db, clusterId);
  if (!projectId) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  await requireProjectAccess(event, projectId);

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
