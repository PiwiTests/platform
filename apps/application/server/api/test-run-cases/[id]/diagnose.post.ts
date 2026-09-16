import { testRunsCases, failureClusters, failureDiagnoses } from '../../../database/schema';
import { queryFlag } from '../../../utils/query-params';
import { eq, and } from 'drizzle-orm';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import { resolveAiConfig } from '../../../utils/ai-provider';
import type { AiAttachedImage } from '../../../utils/ai-provider';
import {
  runClusterDiagnosis,
  isDiagnosisRunning,
  isDiagnosisRunningForExecution,
  isDiagnosisStale,
} from '../../../utils/ai-diagnosis';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Run AI diagnosis for a test run case',
    description:
      'Triggers an AI-powered diagnosis for the specified test run case (execution scope). Uses its failure cluster for context if available.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'force',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
        description: 'Re-run the diagnosis even if one already exists (default false).',
      },
    ],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db, projectId } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const force = queryFlag(event, 'force');
  const body = (await readBody(event).catch(() => null)) as {
    additionalContext?: string;
    images?: AiAttachedImage[];
    baseCommit?: string;
    selectedCommitShas?: string[];
  } | null;

  const [trc] = await db
    .select({
      id: testRunsCases.id,
      testRunId: testRunsCases.testRunId,
      failureClusterId: testRunsCases.failureClusterId,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, id))
    .limit(1);
  if (!trc) throw apiError({ statusCode: 404, message: 'Test run case not found' });

  const config = await resolveAiConfig(db);
  if (!config)
    throw apiError({ statusCode: 503, errorCode: 'AI_NOT_CONFIGURED', message: 'AI diagnosis is not configured' });

  // Resolve the cluster (if any)
  let cluster = null;
  if (trc.failureClusterId) {
    [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, trc.failureClusterId));
  }

  // Check if already running — execution-scope uses its own key to avoid sharing slot 0 with other executions
  if (cluster && isDiagnosisRunning(cluster.id)) {
    throw apiError({ statusCode: 409, message: 'Diagnosis is already running' });
  }
  if (!cluster && isDiagnosisRunningForExecution(id)) {
    throw apiError({ statusCode: 409, message: 'Diagnosis is already running' });
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
        throw apiError({ statusCode: 409, message: 'Diagnosis is already running' });
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
      additionalContext: body?.additionalContext,
      images: body?.images,
      baseCommit: body?.baseCommit,
      selectedCommitShas: body?.selectedCommitShas,
      testRunsCaseId: id,
    },
  );
});
