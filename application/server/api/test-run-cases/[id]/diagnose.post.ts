import { getDatabase } from '../../../database';
import { testRunsCases, testRuns, failureClusters, failureDiagnoses } from '../../../database/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../../../utils/auth';
import { Role } from '../../../../shared/types';
import { resolveAiConfig } from '../../../utils/ai-provider';
import type { AiAttachedImage } from '../../../utils/ai-provider';
import { runClusterDiagnosis, isDiagnosisRunning, isDiagnosisStale } from '../../../utils/ai-diagnosis';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Run AI diagnosis for a test run case',
    description:
      'Triggers an AI-powered diagnosis for the specified test run case (execution scope). Uses its failure cluster for context if available.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid test run case ID' });

  await requireAuth(event);

  const force = getQuery(event).force === 'true';
  const body = (await readBody(event).catch(() => null)) as {
    additionalContext?: string;
    images?: AiAttachedImage[];
    baseCommit?: string;
    selectedCommitShas?: string[];
  } | null;

  const db = await getDatabase();

  const [trc] = await db
    .select({
      id: testRunsCases.id,
      testRunId: testRunsCases.testRunId,
      failureClusterId: testRunsCases.failureClusterId,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, id))
    .limit(1);
  if (!trc) throw createError({ statusCode: 404, message: 'Test run case not found' });

  const config = await resolveAiConfig(db);
  if (!config) throw createError({ statusCode: 503, message: 'AI diagnosis is not configured' });

  // Resolve the cluster (if any) and project ID
  let cluster = null;
  let projectId = 0;
  if (trc.failureClusterId) {
    [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, trc.failureClusterId));
    if (cluster) projectId = cluster.projectId;
  }
  if (!projectId) {
    const [run] = await db
      .select({ projectId: testRuns.projectId })
      .from(testRuns)
      .where(eq(testRuns.id, trc.testRunId))
      .limit(1);
    if (run) projectId = run.projectId;
  }

  // Check if already running
  if (cluster && isDiagnosisRunning(cluster.id)) {
    throw createError({ statusCode: 409, message: 'Diagnosis is already running' });
  }

  // Return existing completed diagnosis if not forcing
  if (!force) {
    const existingRows = await db
      .select()
      .from(failureDiagnoses)
      .where(and(eq(failureDiagnoses.testRunsCaseId, id), eq(failureDiagnoses.scope, 'execution')))
      .limit(1);
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

  return runClusterDiagnosis(
    db,
    (cluster as any) ?? {
      id: 0,
      projectId,
      signature: 'execution-scoped',
      errorType: null,
      selector: null,
      sampleError: null,
      firstSeenRunId: trc.testRunId,
      lastSeenRunId: trc.testRunId,
      status: 'open',
      triageNote: null,
      manualBaseCommit: null,
      occurrences: 1,
      fingerprint: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    config,
    {
      force,
      additionalContext: body?.additionalContext,
      images: body?.images,
      baseCommit: body?.baseCommit,
      selectedCommitShas: body?.selectedCommitShas,
      testRunsCaseId: id,
    },
  );
});
