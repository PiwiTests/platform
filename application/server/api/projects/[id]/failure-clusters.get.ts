import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { projects, testRuns, testRunsCases, failureClusters, failureDiagnoses } from '../../../database/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'List failure clusters for a project',
    description:
      'Returns failure clusters grouped by error fingerprint with occurrence counts, affected tests count, and compact diagnosis info. Supports optional status filter.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

interface DiagnosisCompact {
  status: string;
  category: string | null;
  confidence: string | null;
  summary: string | null;
}

interface ProjectCluster {
  id: number;
  fingerprint: string;
  signature: string;
  errorType: string | null;
  selector: string | null;
  sampleError: string | null;
  status: string;
  triageNote: string | null;
  firstSeenRunId: number;
  lastSeenRunId: number;
  occurrences: number;
  affectedTests: number;
  lastSeenRunStatus: string | null;
  lastSeenAt: string | Date | null;
  diagnosis: DiagnosisCompact | null;
}

export default eventHandler(async (event) => {
  await requireAuth(event);
  const projectId = parseInt(getRouterParam(event, 'id') || '0');
  const statusFilter = getQuery(event).status as string | undefined;

  if (!projectId) {
    throw createError({ statusCode: 400, message: 'Invalid project ID' });
  }

  const db = await getDatabase();

  const projectResults = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));

  if (!projectResults[0]) {
    throw createError({ statusCode: 404, message: 'Project not found' });
  }

  const whereClauses = [eq(failureClusters.projectId, projectId)];
  if (statusFilter && ['open', 'resolved', 'ignored'].includes(statusFilter)) {
    whereClauses.push(eq(failureClusters.status, statusFilter));
  }

  const clusters = await db
    .select({
      id: failureClusters.id,
      fingerprint: failureClusters.fingerprint,
      signature: failureClusters.signature,
      errorType: failureClusters.errorType,
      selector: failureClusters.selector,
      sampleError: failureClusters.sampleError,
      status: failureClusters.status,
      triageNote: failureClusters.triageNote,
      firstSeenRunId: failureClusters.firstSeenRunId,
      lastSeenRunId: failureClusters.lastSeenRunId,
      occurrences: failureClusters.occurrences,
    })
    .from(failureClusters)
    .where(and(...whereClauses))
    .orderBy(desc(failureClusters.lastSeenRunId))
    .limit(100);

  if (clusters.length === 0) return [];

  // Distinct affected test cases per cluster (occurrences counts retries too)
  const clusterIds = clusters.map((c) => c.id);
  const counts = await db
    .select({
      clusterId: testRunsCases.failureClusterId,
      affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})`,
    })
    .from(testRunsCases)
    .where(inArray(testRunsCases.failureClusterId, clusterIds))
    .groupBy(testRunsCases.failureClusterId);
  const affectedById = new Map(counts.map((c) => [c.clusterId, Number(c.affectedTests)]));

  // Resolve lastSeen run status and start time
  const lastSeenRunIds = [...new Set(clusters.map((c) => c.lastSeenRunId))];
  const lastSeenRuns = await db
    .select({
      id: testRuns.id,
      status: testRuns.status,
      startTime: testRuns.startTime,
    })
    .from(testRuns)
    .where(inArray(testRuns.id, lastSeenRunIds));

  const runDataById = new Map(lastSeenRuns.map((r) => [r.id, { status: r.status, startTime: r.startTime }]));

  // Attach compact diagnosis subset
  const diagnosisRows =
    clusterIds.length > 0
      ? await db
          .select({
            clusterId: failureDiagnoses.clusterId,
            status: failureDiagnoses.status,
            category: failureDiagnoses.category,
            confidence: failureDiagnoses.confidence,
            summary: failureDiagnoses.summary,
          })
          .from(failureDiagnoses)
          .where(inArray(failureDiagnoses.clusterId, clusterIds))
      : [];
  const diagnosisById = new Map(diagnosisRows.map((d) => [d.clusterId, d]));

  const result: ProjectCluster[] = clusters.map((c) => {
    const runData = runDataById.get(c.lastSeenRunId);
    return {
      ...c,
      affectedTests: affectedById.get(c.id) ?? 0,
      lastSeenRunStatus: runData?.status ?? null,
      lastSeenAt: runData?.startTime ?? null,
      diagnosis: diagnosisById.get(c.id) ?? null,
    };
  });

  return result;
});
