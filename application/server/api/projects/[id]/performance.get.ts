import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { projects, testRuns } from '../../../database/schema';
import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Performance trend data',
    description:
      'Returns test run duration, average test duration, and p90 test duration for trend charts with optional date range filtering',
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

  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 50, 200);
  const from = query.from as string | undefined;
  const to = query.to as string | undefined;

  const db = await getDatabase();

  // Verify project exists
  const projectResults = await db.select().from(projects).where(eq(projects.id, id));
  const project = projectResults[0];

  if (!project) {
    throw createError({
      statusCode: 404,
      message: 'Project not found',
    });
  }

  // Build conditions
  const conditions = [eq(testRuns.projectId, id)];
  if (from) {
    const fromDate = new Date(from);
    if (Number.isNaN(fromDate.getTime())) {
      throw createError({
        statusCode: 400,
        message: 'Invalid from date',
      });
    }

    conditions.push(gte(testRuns.startTime, fromDate));
  }
  if (to) {
    // Add a day to include the full "to" date
    const toDate = new Date(to);
    if (Number.isNaN(toDate.getTime())) {
      throw createError({
        statusCode: 400,
        message: 'Invalid to date',
      });
    }

    toDate.setDate(toDate.getDate() + 1);
    conditions.push(lte(testRuns.startTime, toDate));
  }

  // Fetch the most recent N runs (desc), then reverse in-memory so chart plots in chronological order
  const runs = await db
    .select({
      id: testRuns.id,
      startTime: testRuns.startTime,
      duration: testRuns.duration,
      avgTestDuration: testRuns.avgTestDuration,
      p90TestDuration: testRuns.p90TestDuration,
      status: testRuns.status,
      totalTests: testRuns.totalTests,
      metadata: testRuns.metadata,
    })
    .from(testRuns)
    .where(and(...conditions))
    .orderBy(desc(testRuns.startTime))
    .limit(limit);

  // Reverse so oldest → newest for the trend chart
  runs.reverse();

  // Extract SCM info from metadata for each run
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    };
  });

  return trendData;
});
