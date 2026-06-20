import { requireAuth } from '../utils/auth';
import { getDatabase } from '../database';
import { projects, testRuns, testCases, files, tags, projectTags } from '../database/schema';
import { eq, desc, sql, inArray, and } from 'drizzle-orm';
import { Role } from '../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List all projects with stats',
    description: 'Returns all projects with their latest run, total runs count, total test cases, and tags',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();

  const allProjects = await db.select().from(projects).orderBy(desc(projects.updatedAt));

  if (allProjects.length === 0) return [];

  const projectIds = allProjects.map((p) => p.id);

  // 1. Run counts + latest run per project (single GROUP BY query instead of loading all rows)
  const runStats = await db
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
  const latestRuns =
    latestRunIds.length > 0 ? await db.select().from(testRuns).where(inArray(testRuns.id, latestRunIds)) : [];
  const latestRunByProjectId = new Map<number, typeof testRuns.$inferSelect>();
  for (const r of latestRuns) {
    latestRunByProjectId.set(r.projectId, r);
  }

  // 3. Total test cases per project (batched GROUP BY)
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

  // 4. Reports for all latest runs (batched)
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

  // 5. Tags per project (batched)
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
