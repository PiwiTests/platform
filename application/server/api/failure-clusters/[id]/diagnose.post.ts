import { getDatabase } from '../../../database';
import { failureClusters, failureDiagnoses, testRunsCases } from '../../../database/schema';
import { eq, and } from 'drizzle-orm';
import { requireProjectAccess, resolveClusterProjectId } from '../../../utils/project-access';
import { Role } from '../../../../shared/types';
import { resolveAiConfig } from '../../../utils/ai-provider';
import type { AiAttachedImage } from '../../../utils/ai-provider';
import { runClusterDiagnosis, isDiagnosisRunning, isDiagnosisStale } from '../../../utils/ai-diagnosis';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Run AI diagnosis for a cluster',
    description:
      'Triggers an AI-powered diagnosis for the specified failure cluster. Accepts optional force flag, additional context, images, base commit, and selected commit SHAs in the request body.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const db = await getDatabase();
  const projectId = await resolveClusterProjectId(db, id);
  if (!projectId) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  await requireProjectAccess(event, projectId);

  const force = getQuery(event).force === 'true';
  const body = (await readBody(event).catch(() => null)) as {
    additionalContext?: string;
    images?: AiAttachedImage[];
    baseCommit?: string;
    selectedCommitShas?: string[];
    scope?: string;
    testRunsCaseId?: number;
  } | null;

  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  const config = await resolveAiConfig(db);
  if (!config) throw createError({ statusCode: 503, message: 'AI diagnosis is not configured' });

  const isExecutionScope = body?.scope === 'execution' && Boolean(body?.testRunsCaseId);

  // Validate testRunsCaseId if execution scope
  if (isExecutionScope) {
    const [trc] = await db
      .select({ id: testRunsCases.id })
      .from(testRunsCases)
      .where(eq(testRunsCases.id, body!.testRunsCaseId!))
      .limit(1);
    if (!trc) throw createError({ statusCode: 404, message: 'Test run case not found' });
  }

  // Check if already running
  if (isDiagnosisRunning(id)) {
    throw createError({ statusCode: 409, message: 'Diagnosis is already running for this cluster' });
  }

  // Return existing completed diagnosis if not forcing
  if (!force) {
    const whereClause = isExecutionScope
      ? and(eq(failureDiagnoses.testRunsCaseId, body!.testRunsCaseId!), eq(failureDiagnoses.scope, 'execution'))
      : and(eq(failureDiagnoses.clusterId, id), eq(failureDiagnoses.scope, 'cluster'));

    const existingRows = await db.select().from(failureDiagnoses).where(whereClause).limit(1);
    const existing = existingRows[0];
    if (existing) {
      if (existing.status === 'running' && !isDiagnosisStale(existing)) {
        throw createError({ statusCode: 409, message: 'Diagnosis is already running' });
      }
      if (existing.status === 'completed') {
        return existing;
      }
    }
  }

  return runClusterDiagnosis(db, cluster, config, {
    force,
    additionalContext: body?.additionalContext,
    images: body?.images,
    baseCommit: body?.baseCommit,
    selectedCommitShas: body?.selectedCommitShas,
    testRunsCaseId: isExecutionScope ? body!.testRunsCaseId : undefined,
  });
});
