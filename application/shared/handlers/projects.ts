import {
  projects,
  testRuns,
  testRunsCases,
  testCases,
  files,
  tags,
  projectTags,
  failureClusters,
  failureDiagnoses,
} from '../../server/database/schema';
import { desc, eq, sql, and, inArray, gte, lte, isNotNull } from 'drizzle-orm';
import type { BrowserConfig } from '../types';

import type { DrizzleDB } from './db';

type ProjectScope = 'all' | Set<number>;

// ─── listProjects ────────────────────────────────────────────────

export async function listProjects(db: DrizzleDB, scope: ProjectScope = 'all') {
  let allProjects: any[] = await db.select().from(projects).orderBy(desc(projects.updatedAt));

  if (scope !== 'all') {
    if (scope.size === 0) return [];
    allProjects = allProjects.filter((p: any) => scope.has(p.id));
  }

  if (allProjects.length === 0) return [];

  const projectIds: number[] = allProjects.map((p: any) => p.id);

  // 1. Run counts + latest run per project (single GROUP BY query instead of loading all rows)
  const runStats: any[] = await db
    .select({
      projectId: testRuns.projectId,
      count: sql<number>`COUNT(*)`,
      latestRunId: sql<number>`MAX(id)`,
      latestStartTime: sql<Date>`MAX(start_time)`,
    })
    .from(testRuns)
    .where(inArray(testRuns.projectId, projectIds))
    .groupBy(testRuns.projectId);

  const runCountByProjectId = new Map<number, number>();
  const latestRunIds: number[] = [];
  for (const r of runStats) {
    runCountByProjectId.set(r.projectId, r.count);
    if (r.latestRunId) latestRunIds.push(r.latestRunId);
  }

  // 2. Fetch full latest run rows
  const latestRuns: any[] =
    latestRunIds.length > 0 ? await db.select().from(testRuns).where(inArray(testRuns.id, latestRunIds)) : [];
  const latestRunByProjectId = new Map<number, any>();
  for (const r of latestRuns) {
    latestRunByProjectId.set(r.projectId, r);
  }

  // 3. Total test cases per project (batched GROUP BY)
  const caseCounts: any[] = await db
    .select({
      projectId: testCases.projectId,
      count: sql<number>`COUNT(*)`,
    })
    .from(testCases)
    .where(inArray(testCases.projectId, projectIds))
    .groupBy(testCases.projectId);

  const caseCountByProjectId = new Map<number, number>();
  for (const r of caseCounts) {
    caseCountByProjectId.set(r.projectId, r.count);
  }

  // 4. Reports for all latest runs (batched)
  const reportRows: any[] =
    latestRunIds.length > 0
      ? await db
          .select()
          .from(files)
          .where(and(inArray(files.testRunId, latestRunIds), eq(files.type, 'report')))
      : [];
  const reportsByRunId = new Map<
    number,
    { id: number; type: string; label: string; path: string; size: number | null }[]
  >();
  for (const r of reportRows) {
    const list = reportsByRunId.get(r.testRunId!) ?? [];
    list.push({ id: r.id, type: r.subtype || r.type, label: r.label || r.type, path: r.path, size: r.size });
    reportsByRunId.set(r.testRunId!, list);
  }

  // 5. Tags per project (batched)
  const tagRows: any[] = await db
    .select({
      projectId: projectTags.projectId,
      tag: tags,
    })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(inArray(projectTags.projectId, projectIds));

  const tagsByProjectId = new Map<number, any[]>();
  for (const r of tagRows) {
    const list = tagsByProjectId.get(r.projectId) ?? [];
    list.push(r.tag);
    tagsByProjectId.set(r.projectId, list);
  }

  return allProjects.map((project: any) => {
    const latestRun = latestRunByProjectId.get(project.id) ?? null;
    return {
      ...project,
      latestRun: latestRun ? { ...latestRun, reports: reportsByRunId.get(latestRun.id) ?? [] } : null,
      totalRuns: runCountByProjectId.get(project.id) ?? 0,
      totalTestCases: caseCountByProjectId.get(project.id) ?? 0,
      tags: tagsByProjectId.get(project.id) ?? [],
    };
  });
}

// ─── getProject ──────────────────────────────────────────────────

export async function getProject(db: DrizzleDB, id: number) {
  const projectResults: any[] = await db.select().from(projects).where(eq(projects.id, id));
  const project = projectResults[0];

  if (!project) throw new Error('Project not found');

  // Select only the columns needed for the run list — omit wide JSON columns
  const runs: any[] = await db
    .select({
      id: testRuns.id,
      projectId: testRuns.projectId,
      status: testRuns.status,
      startTime: testRuns.startTime,
      duration: testRuns.duration,
      totalTests: testRuns.totalTests,
      passedTests: testRuns.passedTests,
      failedTests: testRuns.failedTests,
      skippedTests: testRuns.skippedTests,
      didNotRunTests: testRuns.didNotRunTests,
      flakyTests: testRuns.flakyTests,
      avgTestDuration: testRuns.avgTestDuration,
      p90TestDuration: testRuns.p90TestDuration,
      shardTotal: testRuns.shardTotal,
      shardsFinished: testRuns.shardsFinished,
      environment: testRuns.environment,
      label: testRuns.label,
      instanceId: testRuns.instanceId,
      playwrightVersion: testRuns.playwrightVersion,
      isFullRun: testRuns.isFullRun,
      filterDetails: testRuns.filterDetails,
      metadata: testRuns.metadata,
      createdAt: testRuns.createdAt,
      updatedAt: testRuns.updatedAt,
    })
    .from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime));

  // Fetch reports for all runs in a single query
  const runIds: number[] = runs.map((r: any) => r.id);
  const reportResults: any[] =
    runIds.length > 0
      ? await db
          .select()
          .from(files)
          .where(and(inArray(files.testRunId, runIds), eq(files.type, 'report')))
      : [];

  const reportsByRunId = new Map<
    number,
    { id: number; type: string; label: string; path: string; size: number | null }[]
  >();
  for (const r of reportResults) {
    const list = reportsByRunId.get(r.testRunId!) ?? [];
    list.push({ id: r.id, type: r.subtype || r.type, label: r.label || r.type, path: r.path, size: r.size });
    reportsByRunId.set(r.testRunId!, list);
  }

  // Aggregate distinct browsers per run
  const browserRows: any[] =
    runIds.length > 0
      ? await db
          .select({ testRunId: testRunsCases.testRunId, browser: testRunsCases.browser })
          .from(testRunsCases)
          .where(and(inArray(testRunsCases.testRunId, runIds), isNotNull(testRunsCases.browser)))
      : [];

  const browsersByRunId = new Map<number, string[]>();
  for (const row of browserRows) {
    const browser = row.browser as BrowserConfig | null;
    const name = browser?.projectName;
    if (!name) continue;
    const list = browsersByRunId.get(row.testRunId) ?? [];
    if (!list.includes(name)) list.push(name);
    browsersByRunId.set(row.testRunId, list);
  }

  // Get tags for this project
  const projectTagRows: any[] = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id));

  return {
    ...project,
    hasScmToken: !!project.scmToken,
    tags: projectTagRows.map((r: any) => r.tag),
    testRuns: runs.map((r: any) => {
      // Slim the wide metadata JSON down to just the SCM branch/commit shown in the run list
      const scm = (r.metadata as { scm?: { branch?: string | null; commit?: string | null } } | null)?.scm;
      return {
        ...r,
        isFullRun: r.isFullRun === 1,
        metadata:
          scm?.branch || scm?.commit ? { scm: { branch: scm.branch ?? null, commit: scm.commit ?? null } } : null,
        reports: reportsByRunId.get(r.id) ?? [],
        browsers: browsersByRunId.get(r.id) ?? [],
      };
    }),
  };
}

// ─── createProject ───────────────────────────────────────────────

export async function createProject(
  db: DrizzleDB,
  name: string,
  label?: string | null,
  description?: string | null,
  tagIds?: number[],
) {
  const existing: any[] = await db.select().from(projects).where(eq(projects.name, name));
  if (existing.length > 0) throw new Error('A project with this name already exists');

  const result: any[] = await db.insert(projects).values({ name, label, description }).returning();
  const project = result[0]!;

  // Link tags if provided
  if (tagIds && tagIds.length > 0) {
    const existingTags: any[] = await db.select().from(tags).where(inArray(tags.id, tagIds));
    if (existingTags.length !== tagIds.length) {
      throw new Error('One or more tag IDs are invalid');
    }
    await db.insert(projectTags).values(tagIds.map((tagId: number) => ({ projectId: project.id, tagId })));
  }

  return { project };
}

// ─── updateProject ───────────────────────────────────────────────

export async function updateProject(
  db: DrizzleDB,
  id: number,
  data: {
    label?: string | null;
    description?: string | null;
    diagnosisInstructions?: string | null;
    scmToken?: string | null;
    tagIds?: number[];
  },
) {
  const projectResults: any[] = await db.select().from(projects).where(eq(projects.id, id));
  if (!projectResults[0]) throw new Error('Project not found');

  const { label, description, diagnosisInstructions, scmToken, tagIds: dataTagIds } = data;

  // Update project
  await db
    .update(projects)
    .set({
      label,
      description,
      diagnosisInstructions: diagnosisInstructions ?? undefined,
      scmToken: scmToken !== undefined ? scmToken : undefined,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id));

  // Update project tags if provided
  if (dataTagIds !== undefined) {
    // Remove all existing tags for this project
    await db.delete(projectTags).where(eq(projectTags.projectId, id));

    if (dataTagIds.length > 0) {
      // Validate that all tag IDs exist
      const existingTags: any[] = await db.select().from(tags).where(inArray(tags.id, dataTagIds));
      if (existingTags.length !== dataTagIds.length) {
        throw new Error('One or more tag IDs are invalid');
      }

      // Insert new tag associations
      await db.insert(projectTags).values(dataTagIds.map((tagId: number) => ({ projectId: id, tagId })));
    }
  }

  // Get updated project with tags
  const updatedProject: any[] = await db.select().from(projects).where(eq(projects.id, id));
  const projectTagRows: any[] = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id));

  return {
    ...updatedProject[0],
    tags: projectTagRows.map((r: any) => r.tag),
  };
}

// ─── deleteProjectData ───────────────────────────────────────────
// Cascading delete — no storage operations (server-only concern)

export async function deleteProjectData(db: DrizzleDB, projectId: number) {
  // Get all run IDs to cascade-delete dependent rows that lack DB-level cascade
  const runRows: any[] = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.projectId, projectId));
  const runIds: number[] = runRows.map((r: any) => r.id);

  if (runIds.length > 0) {
    const caseRows: any[] = await db
      .select({ id: testRunsCases.id })
      .from(testRunsCases)
      .where(inArray(testRunsCases.testRunId, runIds));
    const caseIds: number[] = caseRows.map((c: any) => c.id);

    if (caseIds.length > 0) {
      await db.delete(files).where(inArray(files.testRunsCaseId, caseIds));
    }

    await db.delete(files).where(inArray(files.testRunId, runIds));
    await db.delete(testRunsCases).where(inArray(testRunsCases.testRunId, runIds));
    await db.delete(testRuns).where(eq(testRuns.projectId, projectId));
  }

  await db.delete(testCases).where(eq(testCases.projectId, projectId));

  // Deleting the project row cascades to: projectTags, failureClusters,
  // failureDiagnoses, traceBlobs, traceResources
  await db.delete(projects).where(eq(projects.id, projectId));
}

// ─── getProjectMenu ──────────────────────────────────────────────

export async function getProjectMenu(db: DrizzleDB, scope: ProjectScope = 'all'): Promise<{ id: number; name: string; label: string | null }[]> {
  if (scope !== 'all' && scope.size === 0) return [];
  const query = db
    .select({ id: projects.id, name: projects.name, label: projects.label })
    .from(projects)
    .orderBy(desc(projects.updatedAt));
  const rows = await query;
  if (scope === 'all') return rows;
  return rows.filter((p) => scope.has(p.id));
}

// ─── getProjectPerformance ───────────────────────────────────────

export async function getProjectPerformance(
  db: DrizzleDB,
  projectId: number,
  limit: number,
  from?: string,
  to?: string,
  fullRunsOnly: boolean = true,
) {
  // Verify project exists
  const projectResults: any[] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!projectResults[0]) throw new Error('Project not found');

  // Build conditions
  const conditions = [eq(testRuns.projectId, projectId)];
  if (fullRunsOnly) {
    conditions.push(eq(testRuns.isFullRun, 1));
  }
  if (from) {
    const fromDate = new Date(from);
    if (Number.isNaN(fromDate.getTime())) throw new Error('Invalid from date');
    conditions.push(gte(testRuns.startTime, fromDate));
  }
  if (to) {
    const toDate = new Date(to);
    if (Number.isNaN(toDate.getTime())) throw new Error('Invalid to date');
    toDate.setDate(toDate.getDate() + 1);
    conditions.push(lte(testRuns.startTime, toDate));
  }

  const runs: any[] = await db
    .select({
      id: testRuns.id,
      startTime: testRuns.startTime,
      duration: testRuns.duration,
      avgTestDuration: testRuns.avgTestDuration,
      p90TestDuration: testRuns.p90TestDuration,
      status: testRuns.status,
      totalTests: testRuns.totalTests,
      metadata: testRuns.metadata,
      isFullRun: testRuns.isFullRun,
    })
    .from(testRuns)
    .where(and(...conditions))
    .orderBy(desc(testRuns.startTime))
    .limit(Math.min(limit, 200));

  // Reverse so oldest → newest for the trend chart
  runs.reverse();

  // Extract SCM info from metadata for each run
  const trendData = runs.map((run: any) => {
    const metadata = run.metadata as Record<string, unknown> | null;
    const scm = metadata?.scm as Record<string, unknown> | undefined;

    return {
      id: run.id,
      startTime: run.startTime,
      duration: run.duration,
      avgTestDuration: run.avgTestDuration,
      p90TestDuration: run.p90TestDuration,
      status: run.status,
      totalTests: run.totalTests,
      commit: (scm?.commit as string | null) || null,
      branch: (scm?.branch as string | null) || null,
      isFullRun: run.isFullRun === 1,
    };
  });

  return trendData;
}

// ─── getProjectTestCases ─────────────────────────────────────────

export async function getProjectTestCases(db: DrizzleDB, projectId: number) {
  const testCasesWithStats: any[] = await db
    .select({
      id: testCases.id,
      filePath: testCases.filePath,
      title: testCases.title,
      totalRuns: sql<number>`COUNT(${testRunsCases.id})`,
      passedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'passed' THEN 1 ELSE 0 END)`,
      failedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'failed' THEN 1 ELSE 0 END)`,
      skippedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'skipped' THEN 1 ELSE 0 END)`,
      timedOutRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'timedOut' THEN 1 ELSE 0 END)`,
      flakyRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'passed' AND ${testRunsCases.retries} > 0 THEN 1 ELSE 0 END)`,
      recentFlakyRuns: sql<number>`(
      SELECT COUNT(*) FROM (
        SELECT ${testRunsCases.status} AS s, ${testRunsCases.retries} AS r
        FROM ${testRunsCases}
        WHERE ${testRunsCases.testCaseId} = ${testCases.id}
        ORDER BY ${testRunsCases.createdAt} DESC
        LIMIT 10
      ) WHERE s = 'passed' AND r > 0
    )`,
      avgDuration: sql<number>`AVG(${testRunsCases.duration})`,
      lastRun: sql<number>`MAX(${testRunsCases.createdAt})`,
      lastStatus: sql<string>`(
      SELECT ${testRunsCases.status}
      FROM ${testRunsCases}
      WHERE ${testRunsCases.testCaseId} = ${testCases.id}
      ORDER BY ${testRunsCases.createdAt} DESC
      LIMIT 1
    )`,
    })
    .from(testCases)
    .leftJoin(testRunsCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(eq(testCases.projectId, projectId))
    .groupBy(testCases.id, testCases.filePath, testCases.title)
    .orderBy(desc(sql`MAX(${testRunsCases.createdAt})`));

  return testCasesWithStats;
}

// ─── getProjectSlowTests ─────────────────────────────────────────

export async function getProjectSlowTests(db: DrizzleDB, projectId: number, runsCount: number) {
  // Verify project exists
  const projectResults: any[] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!projectResults[0]) throw new Error('Project not found');

  const effectiveLimit = Math.min(runsCount, 100);

  // Get recent test run IDs for this project
  const recentRuns: any[] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.startTime))
    .limit(effectiveLimit);

  const runIds: number[] = recentRuns.map((r: any) => r.id);
  if (runIds.length === 0) return [];

  // Get all test case results from these runs, joining startTime so we can sort chronologically
  const results: any[] = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      duration: testRunsCases.duration,
      testRunId: testRunsCases.testRunId,
      startTime: testRuns.startTime,
      title: testCases.title,
      filePath: testCases.filePath,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(inArray(testRunsCases.testRunId, runIds), eq(testCases.projectId, projectId)));

  // Group by test case and compute aggregates
  const testCaseMap = new Map<
    number,
    {
      id: number;
      title: string;
      filePath: string;
      entries: Array<{ startTime: Date; duration: number }>;
    }
  >();

  for (const row of results) {
    if (row.duration === null || row.duration === undefined) continue;

    if (!testCaseMap.has(row.testCaseId)) {
      testCaseMap.set(row.testCaseId, {
        id: row.testCaseId,
        title: row.title,
        filePath: row.filePath,
        entries: [],
      });
    }

    const entry = testCaseMap.get(row.testCaseId)!;
    entry.entries.push({ startTime: row.startTime, duration: row.duration });
  }

  // Compute stats and sort by average duration desc (slowest first)
  const slowTests = Array.from(testCaseMap.values())
    .map(
      (entry: {
        id: number;
        title: string;
        filePath: string;
        entries: Array<{ startTime: Date; duration: number }>;
      }) => {
        // Sort entries chronologically so latestDuration and trend are correct
        const chronological = [...entry.entries].sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        );
        const durations = chronological.map((e) => e.duration);

        const sorted = [...durations].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const avgDuration = Math.round(sum / sorted.length);
        const maxDuration = sorted[sorted.length - 1] || 0;
        const minDuration = sorted[0] || 0;
        const latestDuration = durations[durations.length - 1] || 0;

        // Compute trend: compare first half average vs second half average
        let trend: 'faster' | 'slower' | 'stable' = 'stable';
        if (durations.length >= 4) {
          const mid = Math.floor(durations.length / 2);
          const firstHalf = durations.slice(0, mid);
          const secondHalf = durations.slice(mid);
          const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
          const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

          const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;
          if (changePercent > 10) trend = 'slower';
          else if (changePercent < -10) trend = 'faster';
        }

        return {
          id: entry.id,
          title: entry.title,
          filePath: entry.filePath,
          avgDuration,
          maxDuration,
          minDuration,
          runCount: durations.length,
          trend,
          latestDuration,
        };
      },
    )
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 20);

  return slowTests;
}

// ─── getProjectFailureClusters ───────────────────────────────────

export async function getProjectFailureClusters(db: DrizzleDB, projectId: number, statusFilter?: string) {
  const projectResults: any[] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));

  if (!projectResults[0]) throw new Error('Project not found');

  const whereClauses = [eq(failureClusters.projectId, projectId)];
  if (statusFilter && ['open', 'resolved', 'ignored'].includes(statusFilter)) {
    whereClauses.push(eq(failureClusters.status, statusFilter));
  }

  const clusters: any[] = await db
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
  const clusterIds: number[] = clusters.map((c: any) => c.id);
  const counts: any[] = await db
    .select({
      clusterId: testRunsCases.failureClusterId,
      affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})`,
    })
    .from(testRunsCases)
    .where(inArray(testRunsCases.failureClusterId, clusterIds))
    .groupBy(testRunsCases.failureClusterId);
  const affectedById = new Map(counts.map((c: any) => [c.clusterId, Number(c.affectedTests)]));

  // Resolve lastSeen run status and start time
  const lastSeenRunIds: number[] = [...new Set(clusters.map((c: any) => c.lastSeenRunId))] as number[];
  const lastSeenRuns: any[] = await db
    .select({
      id: testRuns.id,
      status: testRuns.status,
      startTime: testRuns.startTime,
    })
    .from(testRuns)
    .where(inArray(testRuns.id, lastSeenRunIds));

  const runDataById = new Map(lastSeenRuns.map((r: any) => [r.id, { status: r.status, startTime: r.startTime }]));

  // Attach compact diagnosis subset
  const diagnosisRows: any[] =
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
  const diagnosisById = new Map(diagnosisRows.map((d: any) => [d.clusterId, d]));

  return clusters.map((c: any) => {
    const runData = runDataById.get(c.lastSeenRunId) as { status: string; startTime: Date } | undefined;
    return {
      ...c,
      affectedTests: affectedById.get(c.id) ?? 0,
      lastSeenRunStatus: runData?.status ?? null,
      lastSeenAt: runData?.startTime ?? null,
      diagnosis: diagnosisById.get(c.id) ?? null,
    };
  });
}

// ─── getProjectFlakyTests ────────────────────────────────────────

const TERMINAL_STATUSES = ['passed', 'failed', 'timedout', 'interrupted'];

export async function getProjectFlakyTests(db: DrizzleDB, projectId: number, runsLimit: number) {
  const projectResults: any[] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  const project = projectResults[0];
  if (!project) throw new Error('Project not found');

  const effectiveLimit = Math.min(200, Math.max(1, runsLimit));

  // Step 1: Last N terminal runs
  const recentRuns: any[] = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.startTime))
    .limit(effectiveLimit);

  if (recentRuns.length === 0) return [];

  const runIds: number[] = recentRuns.map((r: any) => r.id);

  // Re-fetch with status filter
  const runsWithStatus: any[] = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime, status: testRuns.status })
    .from(testRuns)
    .where(inArray(testRuns.id, runIds));
  const filteredRuns: any[] = runsWithStatus.filter((r: any) => TERMINAL_STATUSES.includes(r.status));

  if (filteredRuns.length === 0) return [];
  const filteredRunIds: number[] = filteredRuns.map((r: any) => r.id);
  const runStartTimeById = new Map(filteredRuns.map((r: any) => [r.id, r.startTime]));

  // Step 2: All test_runs_cases for those runs
  const allRows: any[] = await db
    .select({
      id: testRunsCases.id,
      testRunId: testRunsCases.testRunId,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
      duration: testRunsCases.duration,
      browser: testRunsCases.browser,
    })
    .from(testRunsCases)
    .where(inArray(testRunsCases.testRunId, filteredRunIds));

  // Step 3: Per (testCaseId, runId, browserKey): group rows
  type BrowserGroup = { rows: any[]; finalStatus: string; retryPass: boolean };
  const runDataMap = new Map<number, Map<number, Map<string, BrowserGroup>>>();

  for (const row of allRows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = row.browser as any;
    const browserKey: string = b?.projectName ?? b?.browserName ?? '';

    let byRun = runDataMap.get(row.testCaseId);
    if (!byRun) {
      byRun = new Map();
      runDataMap.set(row.testCaseId, byRun);
    }
    let byBrowser = byRun.get(row.testRunId);
    if (!byBrowser) {
      byBrowser = new Map();
      byRun.set(row.testRunId, byBrowser);
    }
    let group = byBrowser.get(browserKey);
    if (!group) {
      group = { rows: [], finalStatus: '', retryPass: false };
      byBrowser.set(browserKey, group);
    }
    group.rows.push(row);
  }

  // Compute per-browser group finalStatus and retryPass
  for (const [, byRun] of runDataMap) {
    for (const [, byBrowser] of byRun) {
      for (const [, group] of byBrowser) {
        const sorted = group.rows.slice().sort((a: any, b: any) => (a.retries ?? 0) - (b.retries ?? 0));
        const maxRetryRow = sorted[sorted.length - 1];
        group.finalStatus = maxRetryRow?.status ?? 'unknown';
        const hasFailed = group.rows.some((r: any) => r.status === 'failed' || r.status === 'timedOut');
        const hasPassed = group.rows.some((r: any) => r.status === 'passed');
        group.retryPass = hasFailed && hasPassed;
      }
    }
  }

  // Step 4: Per testCaseId: aggregate across runs
  type CaseAgg = {
    totalRuns: number;
    failedRuns: number;
    retryPassRuns: number;
    alternations: number;
    lastFlakeRunId: number | null;
    lastFlakeAt: Date | null;
    latestRunsCaseId: number;
    failedDurations: number[];
  };

  const caseAggMap = new Map<number, CaseAgg>();

  // Process runs oldest → newest
  const sortedRuns = [...filteredRuns].sort((a: any, b: any) => a.startTime.getTime() - b.startTime.getTime());

  for (const testCaseId of runDataMap.keys()) {
    const byRun = runDataMap.get(testCaseId)!;
    let prevFinalFailed: boolean | null = null;
    let alternations = 0;
    let totalRuns = 0;
    let failedRuns = 0;
    let retryPassRuns = 0;
    let lastFlakeRunId: number | null = null;
    let lastFlakeAt: Date | null = null;
    let latestRunsCaseId = 0;
    const failedDurations: number[] = [];

    for (const run of sortedRuns) {
      const byBrowser = byRun.get(run.id);
      if (!byBrowser) continue;

      totalRuns++;
      let runFinalFailed = false;
      let runRetryPass = false;

      for (const [, group] of byBrowser) {
        if (group.finalStatus === 'failed' || group.finalStatus === 'timedOut') runFinalFailed = true;
        if (group.retryPass) runRetryPass = true;

        for (const row of group.rows) {
          if (row.id > latestRunsCaseId) latestRunsCaseId = row.id;
          if ((row.status === 'failed' || row.status === 'timedOut') && row.duration != null) {
            failedDurations.push(row.duration);
          }
        }
      }

      if (runFinalFailed) failedRuns++;
      if (runRetryPass) {
        retryPassRuns++;
        lastFlakeRunId = run.id;
        lastFlakeAt = runStartTimeById.get(run.id) ?? null;
      }

      if (prevFinalFailed !== null && prevFinalFailed !== runFinalFailed) {
        alternations++;
        if (!runRetryPass) {
          lastFlakeRunId = run.id;
          lastFlakeAt = runStartTimeById.get(run.id) ?? null;
        }
      }
      prevFinalFailed = runFinalFailed;
    }

    caseAggMap.set(testCaseId, {
      totalRuns,
      failedRuns,
      retryPassRuns,
      alternations,
      lastFlakeRunId,
      lastFlakeAt,
      latestRunsCaseId,
      failedDurations,
    });
  }

  // Step 5: Filter candidates and compute scores
  const candidates: Array<{
    testCaseId: number;
    latestRunsCaseId: number;
    totalRuns: number;
    failedRuns: number;
    retryPassRuns: number;
    alternations: number;
    failureRate: number;
    score: number;
    lastFlakeAt: Date | null;
    avgFailedDurationMs: number;
    wastedCiMinutes: number;
    impact: number;
  }> = [];

  for (const [testCaseId, agg] of caseAggMap) {
    if (agg.totalRuns < 3) continue;
    if (agg.retryPassRuns < 1 && agg.alternations < 2) continue;

    const retryRate = agg.retryPassRuns / agg.totalRuns;
    const altRate = agg.alternations / Math.max(1, agg.totalRuns - 1);
    const score = Math.min(100, Math.max(1, Math.round(100 * (0.6 * retryRate + 0.4 * altRate))));
    const failureRate = agg.failedRuns / agg.totalRuns;

    const avgFailedDurationMs =
      agg.failedDurations.length > 0
        ? Math.round(agg.failedDurations.reduce((a, b) => a + b, 0) / agg.failedDurations.length)
        : 0;
    const wastedCiMinutes = (avgFailedDurationMs / 60000) * agg.retryPassRuns;
    const wastedCiMinutesVal = Math.round(wastedCiMinutes * 100) / 100;
    const impact = Math.round(wastedCiMinutesVal * 0.7 + agg.retryPassRuns * 30 * 0.3);

    candidates.push({
      testCaseId,
      latestRunsCaseId: agg.latestRunsCaseId,
      totalRuns: agg.totalRuns,
      failedRuns: agg.failedRuns,
      retryPassRuns: agg.retryPassRuns,
      alternations: agg.alternations,
      failureRate,
      score,
      lastFlakeAt: agg.lastFlakeAt,
      avgFailedDurationMs,
      wastedCiMinutes: wastedCiMinutesVal,
      impact,
    });
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.impact - a.impact || b.score - a.score || b.retryPassRuns - a.retryPassRuns);
  const top = candidates.slice(0, 50);

  // Step 6: Join titles/filePaths + rootCause
  const testCaseIds: number[] = top.map((c) => c.testCaseId);
  const testCaseRows: any[] = await db
    .select({
      id: testCases.id,
      title: testCases.title,
      filePath: testCases.filePath,
      flakyRootCause: testCases.flakyRootCause,
    })
    .from(testCases)
    .where(inArray(testCases.id, testCaseIds));
  const testCaseById = new Map(testCaseRows.map((t: any) => [t.id, t]));

  return top.map((c) => {
    const tc = testCaseById.get(c.testCaseId);
    return {
      testCaseId: c.testCaseId,
      latestRunsCaseId: c.latestRunsCaseId,
      title: tc?.title ?? '',
      filePath: tc?.filePath ?? '',
      totalRuns: c.totalRuns,
      failedRuns: c.failedRuns,
      retryPassRuns: c.retryPassRuns,
      alternations: c.alternations,
      failureRate: Math.round(c.failureRate * 100) / 100,
      score: c.score,
      lastFlakeAt: c.lastFlakeAt,
      rootCause: tc?.flakyRootCause ?? null,
      impact: c.impact,
      wastedCiMinutes: c.wastedCiMinutes,
      avgFailedDurationMs: c.avgFailedDurationMs,
    };
  });
}
