import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { testRuns, testCases, testRunsCases, failureClusters, failureDiagnoses } from '../../../database/schema';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get failure groups for a test run',
    description:
      'Returns clustered failure groups for a test run, grouping failed test cases by their failure cluster. Includes compact diagnosis data, flakiness detection, and worker correlation analysis.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

interface GroupCase {
  testRunsCaseId: number;
  testCaseId: number;
  title: string;
  filePath: string;
  retries: number;
  workerIndex: number | null;
  passedOnRetry: boolean;
}

interface DiagnosisCompact {
  status: string;
  category: string | null;
  confidence: string | null;
  summary: string | null;
}

interface FailureGroup {
  clusterId: number;
  signature: string;
  errorType: string | null;
  selector: string | null;
  status: string;
  triageNote: string | null;
  caseCount: number;
  isNew: boolean;
  firstSeenRunId: number;
  firstSeenAt: Date | null;
  occurrences: number;
  flaky: boolean;
  workerCorrelated: boolean;
  cases: GroupCase[];
  diagnosis: DiagnosisCompact | null;
}

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid test run ID' });
  }

  const db = await getDatabase();

  const runResults = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.id, id));

  if (!runResults[0]) {
    throw createError({ statusCode: 404, message: 'Test run not found' });
  }

  // All rows of the run (any status) — used for retry-pass and worker analysis
  const allRows = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
      workerIndex: testRunsCases.workerIndex,
    })
    .from(testRunsCases)
    .where(eq(testRunsCases.testRunId, id));

  const passedCaseIds = new Set(allRows.filter((r) => r.status === 'passed').map((r) => r.testCaseId));
  const runWorkers = new Set(allRows.map((r) => r.workerIndex).filter((w) => w !== null));

  // Clustered failure rows joined with their cluster and shared test case
  const clusteredRows = await db
    .select({
      testRunsCaseId: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      retries: testRunsCases.retries,
      workerIndex: testRunsCases.workerIndex,
      title: testCases.title,
      filePath: testCases.filePath,
      clusterId: failureClusters.id,
      signature: failureClusters.signature,
      errorType: failureClusters.errorType,
      selector: failureClusters.selector,
      status: failureClusters.status,
      triageNote: failureClusters.triageNote,
      firstSeenRunId: failureClusters.firstSeenRunId,
      occurrences: failureClusters.occurrences,
    })
    .from(testRunsCases)
    .innerJoin(failureClusters, eq(testRunsCases.failureClusterId, failureClusters.id))
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(and(eq(testRunsCases.testRunId, id), isNotNull(testRunsCases.failureClusterId)));

  if (clusteredRows.length === 0) return [];

  // Resolve firstSeen run start times (runs may have been deleted — nulls tolerated)
  const firstSeenRunIds = [...new Set(clusteredRows.map((r) => r.firstSeenRunId))];
  const firstSeenRuns = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(inArray(testRuns.id, firstSeenRunIds));
  const firstSeenAtById = new Map(firstSeenRuns.map((r) => [r.id, r.startTime]));

  // Group rows by cluster, one entry per distinct test case (retries collapse)
  const groups = new Map<number, FailureGroup & { caseById: Map<number, GroupCase> }>();

  for (const row of clusteredRows) {
    let group = groups.get(row.clusterId);
    if (!group) {
      group = {
        clusterId: row.clusterId,
        signature: row.signature,
        errorType: row.errorType,
        selector: row.selector,
        status: row.status ?? 'open',
        triageNote: row.triageNote ?? null,
        caseCount: 0,
        isNew: row.firstSeenRunId === id,
        firstSeenRunId: row.firstSeenRunId,
        firstSeenAt: firstSeenAtById.get(row.firstSeenRunId) ?? null,
        occurrences: row.occurrences,
        flaky: false,
        workerCorrelated: false,
        cases: [],
        diagnosis: null,
        caseById: new Map(),
      };
      groups.set(row.clusterId, group);
    }

    const existing = group.caseById.get(row.testCaseId);
    if (existing) {
      // Keep the latest retry attempt for display
      if ((row.retries ?? 0) > existing.retries) {
        existing.retries = row.retries ?? 0;
        existing.testRunsCaseId = row.testRunsCaseId;
        existing.workerIndex = row.workerIndex;
      }
    } else {
      group.caseById.set(row.testCaseId, {
        testRunsCaseId: row.testRunsCaseId,
        testCaseId: row.testCaseId,
        title: row.title,
        filePath: row.filePath,
        retries: row.retries ?? 0,
        workerIndex: row.workerIndex,
        passedOnRetry: passedCaseIds.has(row.testCaseId),
      });
    }
  }

  const result: FailureGroup[] = [];
  for (const group of groups.values()) {
    const { caseById, ...rest } = group;
    const cases = [...caseById.values()].sort((a, b) => a.title.localeCompare(b.title));
    const caseWorkers = new Set(cases.map((c) => c.workerIndex).filter((w) => w !== null));

    result.push({
      ...rest,
      cases,
      caseCount: cases.length,
      // A test that also passed in this run (later retry) points at flakiness
      flaky: cases.some((c) => c.passedOnRetry),
      // Multiple cases all failing on the same worker while the run used several
      // workers suggests an infrastructure problem rather than broken tests
      workerCorrelated: cases.length >= 2 && caseWorkers.size === 1 && runWorkers.size > 1,
    });
  }

  result.sort((a, b) => b.caseCount - a.caseCount);

  // Attach compact diagnosis subset
  const allClusterIds = result.map((g) => g.clusterId);
  const diagnosisRows =
    allClusterIds.length > 0
      ? await db
          .select({
            clusterId: failureDiagnoses.clusterId,
            status: failureDiagnoses.status,
            category: failureDiagnoses.category,
            confidence: failureDiagnoses.confidence,
            summary: failureDiagnoses.summary,
          })
          .from(failureDiagnoses)
          .where(inArray(failureDiagnoses.clusterId, allClusterIds))
      : [];
  const diagnosisById = new Map(diagnosisRows.map((d) => [d.clusterId, d]));

  return result.map((g) => ({
    ...g,
    diagnosis: diagnosisById.get(g.clusterId) ?? null,
  }));
});
