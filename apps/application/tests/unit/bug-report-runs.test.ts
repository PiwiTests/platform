import { beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load.
delete process.env.PIWI_DATABASE_URL;
const { applyBugReportLifecycle } = await import('#shared/handlers/bug-reports');
const { loadLooksFixedTests } = await import('../../server/utils/notifications/run-notifications');

let db: ReturnType<typeof drizzle<typeof schema>>;

const EMPTY = { steps: { v: 1, steps: [] }, evidence: {}, context: {} };
const fixedIn = (browserName: string) => ({ status: 'failed', expectedStatus: 'failed', browserName });
const stillFailsIn = (browserName: string) => ({ status: 'passed', expectedStatus: 'failed', browserName });

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values([
    { id: 1, name: 'shop' },
    { id: 2, name: 'other' },
  ]);
  await db.insert(schema.testCases).values([
    { id: 1, projectId: 1, filePath: 'tests/bugs/coupon.spec.ts', title: 'coupon' },
    { id: 2, projectId: 1, filePath: 'tests/bugs/total.spec.ts', title: 'total' },
  ]);
  await db.insert(schema.testRuns).values([
    { id: 1, projectId: 1, status: 'passed', branch: 'main', startTime: new Date(1000_000), totalTests: 2 },
    { id: 2, projectId: 1, status: 'passed', branch: 'main', startTime: new Date(2000_000), totalTests: 2 },
    { id: 3, projectId: 2, status: 'passed', branch: 'main', startTime: new Date(3000_000), totalTests: 0 },
  ]);
  await db.insert(schema.bugReports).values([
    { id: 1, projectId: 1, title: 'Coupon', status: 'test-committed', ...EMPTY },
    { id: 2, projectId: 1, title: 'Total', status: 'test-committed', ...EMPTY },
  ]);
});

describe('a test that runs in several browser projects', () => {
  test('looks fixed only when every project that ran it agrees', async () => {
    // Test 1 passed on chromium and still fails as expected on webkit; test 2 passed on both.
    await db.insert(schema.testRunsCases).values([
      { testRunId: 2, testCaseId: 1, testMeta: { bug: '1' }, ...stillFailsIn('webkit') },
      { testRunId: 2, testCaseId: 1, testMeta: { bug: '1' }, ...fixedIn('chromium') },
      { testRunId: 2, testCaseId: 2, testMeta: { bug: '2' }, ...stillFailsIn('webkit') },
      { testRunId: 2, testCaseId: 2, testMeta: { bug: '2' }, ...fixedIn('chromium') },
      { testRunId: 2, testCaseId: 2, testMeta: { bug: '2' }, retries: 1, ...fixedIn('webkit') },
    ]);

    expect((await loadLooksFixedTests(db as never, 2)).map((t) => t.testCaseId)).toEqual([2]);

    const transitions = await applyBugReportLifecycle(db as never, 2);
    expect(transitions.map((t) => [t.id, t.to])).toEqual([[2, 'looks-fixed']]);
    const statuses = await db
      .select({ id: schema.bugReports.id, status: schema.bugReports.status })
      .from(schema.bugReports)
      .orderBy(schema.bugReports.id);
    expect(statuses).toEqual([
      { id: 1, status: 'test-committed' },
      { id: 2, status: 'looks-fixed' },
    ]);
  });
});
