import { getDatabase } from '../database';
import { projects, testRuns, testCases, files, tags, projectTags } from '../database/schema';
import { eq, desc, sql, inArray, and } from 'drizzle-orm';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List all projects with stats',
    description: 'Returns all projects with their latest run, total runs count, total test cases, and tags',
  },
});

export default eventHandler(async () => {
  const db = await getDatabase();

  const allProjects = await db.select().from(projects).orderBy(desc(projects.updatedAt));

  if (allProjects.length === 0) return [];

  const projectIds = allProjects.map((p) => p.id);

  // 1. Fetch ALL runs for all projects (sorted so first per project is latest)
  const allRuns = await db
    .select()
    .from(testRuns)
    .where(inArray(testRuns.projectId, projectIds))
    .orderBy(desc(testRuns.startTime));

  // Derive latest run + total runs count per project from the single result
  const latestRunByProjectId = new Map<number, typeof testRuns.$inferSelect>();
  const runCountByProjectId = new Map<number, number>();
  for (const r of allRuns) {
    runCountByProjectId.set(r.projectId, (runCountByProjectId.get(r.projectId) ?? 0) + 1);
    if (!latestRunByProjectId.has(r.projectId)) {
      latestRunByProjectId.set(r.projectId, r);
    }
  }

  // 2. Total test cases per project (batched GROUP BY)
  const caseCounts = await db
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

  // 3. Reports for all latest runs (batched)
  const latestRunIds = [...latestRunByProjectId.values()].map((r) => r.id);
  const reportRows =
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

  // 4. Tags per project (batched)
  const tagRows = await db
    .select({
      projectId: projectTags.projectId,
      tag: tags,
    })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(inArray(projectTags.projectId, projectIds));

  const tagsByProjectId = new Map<number, (typeof tags.$inferSelect)[]>();
  for (const r of tagRows) {
    const list = tagsByProjectId.get(r.projectId) ?? [];
    list.push(r.tag);
    tagsByProjectId.set(r.projectId, list);
  }

  return allProjects.map((project) => {
    const latestRun = latestRunByProjectId.get(project.id) ?? null;
    const { scmToken: _scm, ...projectWithoutSecret } = project;
    return {
      ...projectWithoutSecret,
      latestRun: latestRun ? { ...latestRun, reports: reportsByRunId.get(latestRun.id) ?? [] } : null,
      totalRuns: runCountByProjectId.get(project.id) ?? 0,
      totalTestCases: caseCountByProjectId.get(project.id) ?? 0,
      tags: tagsByProjectId.get(project.id) ?? [],
    };
  });
});
