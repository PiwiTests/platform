import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { projects, testRuns, testRunsCases, files, tags, projectTags } from '../../database/schema';
import { eq, desc, inArray, and, isNotNull } from 'drizzle-orm';
import type { BrowserConfig } from '../../../shared/types';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get project details',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID',
    });
  }

  const db = await getDatabase();

  const projectResults = await db.select().from(projects).where(eq(projects.id, id));
  const project = projectResults[0];

  if (!project) {
    throw createError({
      statusCode: 404,
      message: 'Project not found',
    });
  }

  // Select only the columns needed for the run list — omit wide JSON columns
  const runs = await db
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
      flakyTests: testRuns.flakyTests,
      avgTestDuration: testRuns.avgTestDuration,
      p90TestDuration: testRuns.p90TestDuration,
      shardTotal: testRuns.shardTotal,
      shardsFinished: testRuns.shardsFinished,
      environment: testRuns.environment,
      label: testRuns.label,
      instanceId: testRuns.instanceId,
      playwrightVersion: testRuns.playwrightVersion,
      createdAt: testRuns.createdAt,
      updatedAt: testRuns.updatedAt,
    })
    .from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime));

  // Fetch reports for all runs in a single query
  const runIds = runs.map((r) => r.id);
  const reportResults =
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
  const browserRows =
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
  const projectTagRows = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id));

  const { scmToken: _scm, ...projectWithoutSecret } = project;

  return {
    ...projectWithoutSecret,
    hasScmToken: !!project.scmToken,
    tags: projectTagRows.map((r) => r.tag),
    testRuns: runs.map((r) => ({
      ...r,
      reports: reportsByRunId.get(r.id) ?? [],
      browsers: browsersByRunId.get(r.id) ?? [],
    })),
  };
});
