import {
  failureClusters,
  failureDiagnoses,
  testRuns,
  testRunsCases,
  testCases,
  projects,
} from '../../server/database/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';

import type { DrizzleDB } from './db';
import { recomputeClusterOccurrences } from './failure-cluster-ops';

const VALID_STATUSES = ['open', 'resolved', 'ignored'];

export async function getFailureCluster(db: DrizzleDB, clusterId: number) {
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const [[countRow], [lastRun], [diag], [project], affectedTestCases, recentRuns] = await Promise.all([
    db
      .select({ affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})` })
      .from(testRunsCases)
      .where(eq(testRunsCases.failureClusterId, clusterId)),

    db
      .select({ status: testRuns.status, startTime: testRuns.startTime })
      .from(testRuns)
      .where(eq(testRuns.id, cluster.lastSeenRunId)),

    db
      .select()
      .from(failureDiagnoses)
      .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.scope, 'cluster'))),

    db
      .select({ id: projects.id, name: projects.name, label: projects.label })
      .from(projects)
      .where(eq(projects.id, cluster.projectId)),

    db
      .select({
        testCaseId: testCases.id,
        title: testCases.title,
        filePath: testCases.filePath,
        runCount: sql<number>`count(${testRunsCases.id})`,
        recentTestRunsCaseId: sql<number>`max(${testRunsCases.id})`,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testRunsCases.failureClusterId, clusterId))
      .groupBy(testCases.id, testCases.title, testCases.filePath)
      .orderBy(desc(sql`count(${testRunsCases.id})`))
      .limit(50),

    db
      .select({ id: testRuns.id })
      .from(testRunsCases)
      .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
      .where(eq(testRunsCases.failureClusterId, clusterId))
      .groupBy(testRuns.id)
      .orderBy(desc(testRuns.startTime))
      .limit(3),
  ]);

  return {
    ...cluster,
    affectedTests: Number(countRow?.affectedTests ?? 0),
    lastSeenRunStatus: lastRun?.status ?? null,
    lastSeenAt: lastRun?.startTime ?? null,
    diagnosis: diag
      ? {
          status: diag.status,
          category: diag.category,
          confidence: diag.confidence,
          summary: diag.summary,
        }
      : null,
    project: project ?? null,
    affectedTestCases: affectedTestCases.map((t: any) => ({ ...t, runCount: Number(t.runCount) })),
    recentRunIds: recentRuns.map((r) => r.id),
  };
}

export async function getClusterDiagnosis(db: DrizzleDB, clusterId: number) {
  const [diag] = await db
    .select()
    .from(failureDiagnoses)
    .where(and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.scope, 'cluster')));
  const [cluster] = await db
    .select({ manualBaseCommit: failureClusters.manualBaseCommit })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  return {
    diagnosis: diag ?? null,
    manualBaseCommit: cluster?.manualBaseCommit ?? null,
  };
}

export async function patchClusterStatus(db: DrizzleDB, clusterId: number, status: string, triageNote?: string | null) {
  if (!status || !VALID_STATUSES.includes(status)) {
    return null;
  }

  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const note = triageNote ?? null;
  await db
    .update(failureClusters)
    .set({ status, triageNote: note, updatedAt: new Date() })
    .where(eq(failureClusters.id, clusterId));

  return { success: true, id: clusterId, status, triageNote: note };
}

export async function patchClusterBaseCommit(db: DrizzleDB, clusterId: number, commit?: string | null) {
  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  const manualBaseCommit = typeof commit === 'string' && commit.trim() ? commit.trim() : null;
  await db
    .update(failureClusters)
    .set({ manualBaseCommit, updatedAt: new Date() })
    .where(eq(failureClusters.id, clusterId));

  return { success: true, manualBaseCommit };
}

export async function getClusterCommits(_db: DrizzleDB, _clusterId: number) {
  return { commits: [], repositoryUrl: null, aggregate: null, error: null, hasMore: false };
}

export async function getClusterBranches(_db: DrizzleDB, _clusterId: number) {
  return { branches: [] };
}

export async function getClusterCommitDiff(_db: DrizzleDB, _clusterId: number) {
  return { files: [], totalAdditions: 0, totalDeletions: 0 };
}

export async function getClusterContext(_db: DrizzleDB, _clusterId: number) {
  return {
    text: 'Demo mode — no real AI context is generated. Configure a real AI provider to see the full diagnosis context with evidence sections.',
    sections: [],
    tokenEstimate: 0,
    coverage: {
      scm: {
        hasLastGreen: false,
        hasCommitRange: false,
        baseCommitUsed: null,
        provider: null,
        commitsCount: 0,
        filesCount: 0,
        patchedFilesCount: 0,
        patchesOmitted: false,
        patchesTruncated: false,
      },
    },
    scmChanges: null,
  };
}

export async function extractClusterCases(
  db: DrizzleDB,
  clusterId: number,
  testCaseIds: number[],
  triageNote?: string,
) {
  if (!testCaseIds || !Array.isArray(testCaseIds) || testCaseIds.length === 0) {
    return null;
  }

  const [cluster] = await db
    .select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;

  await db
    .update(testRunsCases)
    .set({ failureClusterId: null })
    .where(and(eq(testRunsCases.failureClusterId, clusterId), inArray(testRunsCases.testCaseId, testCaseIds)));

  const remainingOccurrences = await recomputeClusterOccurrences(db, clusterId);

  if (triageNote !== undefined) {
    await db
      .update(failureClusters)
      .set({ triageNote, updatedAt: new Date() })
      .where(eq(failureClusters.id, clusterId));
  }

  return { success: true, extractedCount: testCaseIds.length, remainingOccurrences };
}
