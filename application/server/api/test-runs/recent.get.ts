import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { testRuns, projects } from '../../database/schema';
import { desc, eq, or, notInArray } from 'drizzle-orm';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Get recent test runs',
    description:
      'Returns the 30 most recent completed test runs across all projects plus any currently active runs, sorted by start time. Used by the home page dashboard.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const ACTIVE_STATUSES = ['running', 'initialising', 'finalizing'] as const;

const FIELDS = {
  id: testRuns.id,
  projectId: testRuns.projectId,
  projectName: projects.name,
  projectLabel: projects.label,
  status: testRuns.status,
  startTime: testRuns.startTime,
  totalTests: testRuns.totalTests,
  passedTests: testRuns.passedTests,
  failedTests: testRuns.failedTests,
  skippedTests: testRuns.skippedTests,
  flakyTests: testRuns.flakyTests,
  duration: testRuns.duration,
  avgTestDuration: testRuns.avgTestDuration,
  p90TestDuration: testRuns.p90TestDuration,
};

/**
 * GET /api/test-runs/recent
 * Returns active runs (always) + the 30 most recent completed runs for the home page.
 * Active runs are fetched separately so they're never displaced by newer completed runs.
 */
export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();

  const [activeRuns, recentRuns] = await Promise.all([
    db
      .select(FIELDS)
      .from(testRuns)
      .innerJoin(projects, eq(testRuns.projectId, projects.id))
      .where(or(...ACTIVE_STATUSES.map((s) => eq(testRuns.status, s))))
      .orderBy(desc(testRuns.startTime)),
    db
      .select(FIELDS)
      .from(testRuns)
      .innerJoin(projects, eq(testRuns.projectId, projects.id))
      .where(notInArray(testRuns.status, [...ACTIVE_STATUSES]))
      .orderBy(desc(testRuns.startTime))
      .limit(30),
  ]);

  // Merge: active runs first, then recent completed; dedup by id in case a run
  // transitioned between the two queries
  const seen = new Set<number>();
  const result = [];
  for (const run of [...activeRuns, ...recentRuns]) {
    if (!seen.has(run.id)) {
      seen.add(run.id);
      result.push(run);
    }
  }
  return result;
});
