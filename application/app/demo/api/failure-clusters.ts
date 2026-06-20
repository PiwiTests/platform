/**
 * Client-side implementations of the /api/failure-clusters* endpoints for demo mode.
 */

import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { getDemoDb } from '../db.client';
import {
  failureClusters,
  failureDiagnoses,
  testRuns,
  testRunsCases,
  testCases,
  projects,
} from '~~/server/database/schema.sqlite';

const VALID_STATUSES = ['open', 'resolved', 'ignored'];

/** GET /api/failure-clusters/:id */
export async function apiGetFailureCluster(id: number) {
  const db = await getDemoDb();

  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) return null;

  const [[countRow], [lastRun], [diag], [project], affectedTestCases] = await Promise.all([
    db
      .select({ affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})` })
      .from(testRunsCases)
      .where(eq(testRunsCases.failureClusterId, id)),

    db
      .select({ status: testRuns.status, startTime: testRuns.startTime })
      .from(testRuns)
      .where(eq(testRuns.id, cluster.lastSeenRunId)),

    db.select().from(failureDiagnoses).where(eq(failureDiagnoses.clusterId, id)),

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
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
      .where(eq(testRunsCases.failureClusterId, id))
      .groupBy(testCases.id, testCases.title, testCases.filePath)
      .orderBy(desc(sql`count(${testRunsCases.id})`))
      .limit(50),
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
    affectedTestCases: affectedTestCases.map((t) => ({ ...t, runCount: Number(t.runCount) })),
  };
}

/** PATCH /api/failure-clusters/:id/status */
export async function apiPatchClusterStatus(id: number, body: { status?: string; triageNote?: string | null }) {
  const db = await getDemoDb();

  const [cluster] = await db.select({ id: failureClusters.id }).from(failureClusters).where(eq(failureClusters.id, id));

  if (!cluster) return null;

  const status = body?.status;
  if (!status || !VALID_STATUSES.includes(status)) {
    return null;
  }

  const triageNote = body?.triageNote ?? null;

  await db.update(failureClusters).set({ status, triageNote, updatedAt: new Date() }).where(eq(failureClusters.id, id));

  return { success: true, id, status, triageNote };
}

/** PATCH /api/failure-clusters/:id/base-commit */
export async function apiPatchClusterBaseCommit(id: number, body: { commit?: string | null }) {
  const db = await getDemoDb();

  const [cluster] = await db.select({ id: failureClusters.id }).from(failureClusters).where(eq(failureClusters.id, id));

  if (!cluster) return null;

  const commit = typeof body?.commit === 'string' ? body.commit.trim() || null : null;

  await db
    .update(failureClusters)
    .set({ manualBaseCommit: commit, updatedAt: new Date() })
    .where(eq(failureClusters.id, id));

  return { success: true, manualBaseCommit: commit };
}

/**
 * GET /api/failure-clusters/:id/commits
 * No SCM access in demo mode — return an empty list so the CommitPicker
 * renders gracefully (it handles the empty state).
 */
export async function apiGetClusterCommits(_id: number) {
  return { commits: [], repositoryUrl: null, aggregate: null, error: null, hasMore: false };
}

/**
 * GET /api/failure-clusters/:id/branches
 * No SCM access in demo mode — return an empty branches list.
 */
export async function apiGetClusterBranches(_id: number) {
  return { branches: [] };
}

/**
 * GET /api/failure-clusters/:id/commit-diff
 * Not available without SCM access in demo mode.
 */
export async function apiGetClusterCommitDiff(_id: number) {
  return { files: [], totalAdditions: 0, totalDeletions: 0 };
}

/**
 * GET /api/failure-clusters/:id/context
 * AI diagnosis context preview — not available in demo mode (no AI).
 */
export async function apiGetClusterContext(_id: number) {
  return { context: '', coverage: {} };
}

/** POST /api/failure-clusters/:id/extract-cases */
export async function apiExtractClusterCases(id: number, body: { testCaseIds: number[]; triageNote?: string }) {
  const db = await getDemoDb();

  const [cluster] = await db.select({ id: failureClusters.id }).from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) return null;

  const { testCaseIds, triageNote } = body;
  if (!testCaseIds || !Array.isArray(testCaseIds) || testCaseIds.length === 0) {
    return null;
  }

  await db
    .update(testRunsCases)
    .set({ failureClusterId: null })
    .where(and(eq(testRunsCases.failureClusterId, id), inArray(testRunsCases.testCaseId, testCaseIds)));

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(testRunsCases)
    .where(eq(testRunsCases.failureClusterId, id));

  const remainingOccurrences = Number(countRow?.count ?? 0);

  const updateFields: Record<string, unknown> = {
    occurrences: remainingOccurrences,
    updatedAt: new Date(),
  };
  if (triageNote !== undefined) {
    updateFields.triageNote = triageNote;
  }
  await db.update(failureClusters).set(updateFields).where(eq(failureClusters.id, id));

  return { success: true, extractedCount: testCaseIds.length, remainingOccurrences };
}
