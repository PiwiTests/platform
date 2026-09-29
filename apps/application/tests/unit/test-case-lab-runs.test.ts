import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load.
delete process.env.PIWI_DATABASE_URL;
const { getTestCase, getTestCaseStabilityTrend } = await import('../../shared/handlers/test-cases');
const { getProjectTestCases } = await import('../../shared/handlers/projects');

let db: ReturnType<typeof drizzle<typeof schema>>;
const MINUTE = 60_000;
const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * MINUTE);

/**
 * One test case with three real executions (two passed, one failed) and, more
 * recently, a probe run that failed plus a flake-lab arm of two executions: a
 * failure and a retry-pass. Every stat reads the three real executions only.
 */
beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'shop' });
  const run = (id: number, minutesAgo: number, metadata: object | null) => ({
    id,
    projectId: 1,
    status: 'passed',
    startTime: at(minutesAgo),
    metadata,
  });
  await db
    .insert(schema.testRuns)
    .values([
      run(1, 50, null),
      run(2, 40, null),
      run(3, 30, { ci: true }),
      run(4, 20, { piwiProbe: true }),
      run(5, 10, { piwiFlakeLab: { experimentId: 'exp-1', armId: 'slow-cart' } }),
    ]);
  await db.insert(schema.testCases).values({ id: 1, projectId: 1, filePath: 'cart.spec.ts', title: 'adds to cart' });
  const execution = (
    id: number,
    testRunId: number,
    minutesAgo: number,
    status: string,
    duration: number,
    retries = 0,
  ) => ({
    id,
    testRunId,
    testCaseId: 1,
    status,
    duration,
    retries,
    createdAt: at(minutesAgo),
  });
  await db
    .insert(schema.testRunsCases)
    .values([
      execution(1, 1, 50, 'passed', 1000),
      execution(2, 2, 40, 'failed', 2000),
      execution(3, 3, 30, 'passed', 3000),
      execution(4, 4, 20, 'failed', 30_000),
      execution(5, 5, 10, 'failed', 30_000),
      execution(6, 5, 9, 'passed', 30_000, 1),
    ]);
});

describe('test case stats leave lab runs out', () => {
  test('the header counts real executions only', async () => {
    const testCase = await getTestCase(db as never, 1);
    expect(testCase).toMatchObject({
      totalRuns: 3,
      passedRuns: 2,
      failedRuns: 1,
      flakyRuns: 0,
      recentFlakyRuns: 0,
      avgDuration: 2000,
      passRate: 67,
      lastExecutionId: 3,
    });
    expect(testCase!.lastRunAt).toBe(at(30).getTime());
    expect(testCase!.recentExecutions.map((e: { id: number }) => e.id)).toEqual([3, 2, 1]);
  });

  test('the test-cases list aggregates real executions only', async () => {
    const { items } = await getProjectTestCases(db as never, 1, { maxAgeDays: 1 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      totalRuns: 3,
      passedRuns: 2,
      failedRuns: 1,
      flakyRuns: 0,
      recentFlakyRuns: 0,
      avgDuration: 2000,
      lastStatus: 'passed',
      status: 'passed',
    });
    expect(items[0].lastRun).toBe(at(30).getTime());
  });

  test('the stability trend buckets real executions only', async () => {
    const trend = await getTestCaseStabilityTrend(db as never, 1, { days: 2, granularity: 'day', now: NOW });
    expect(trend.buckets.reduce((sum, b) => sum + b.totalRuns, 0)).toBe(3);
  });
});
