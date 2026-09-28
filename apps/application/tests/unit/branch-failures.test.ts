import { beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load.
delete process.env.PIWI_DATABASE_URL;
const { getBranchFailures } = await import('../../server/utils/branch-failures');

let db: ReturnType<typeof drizzle<typeof schema>>;

const ERROR = [
  "Error: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Pay now' })",
  '',
  '    at CheckoutPage.pay (/ci/work/tests/pages/checkout.page.ts:12:19)',
  '    at /ci/work/tests/checkout.spec.ts:8:3',
].join('\n');

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values([{ id: 1, name: 'shop' }]);
  await db.insert(schema.testCases).values([
    { id: 1, projectId: 1, filePath: 'tests/checkout.spec.ts', title: 'pays' },
    { id: 2, projectId: 1, filePath: 'tests/cart.spec.ts', title: 'adds' },
  ]);
  await db.insert(schema.testRuns).values([
    { id: 1, projectId: 1, status: 'failed', branch: 'main', startTime: new Date(1000_000), totalTests: 2 },
    { id: 2, projectId: 1, status: 'failed', branch: 'feature/pay', startTime: new Date(2000_000), totalTests: 2 },
    { id: 3, projectId: 1, status: 'passed', branch: 'main', startTime: new Date(3000_000), totalTests: 2 },
  ]);
  await db.insert(schema.testRunsCases).values([
    { id: 10, testRunId: 2, testCaseId: 1, status: 'failed', error: ERROR, line: 7 },
    { id: 11, testRunId: 2, testCaseId: 2, status: 'passed', line: 3 },
    { id: 12, testRunId: 1, testCaseId: 2, status: 'timedOut', error: 'Test timeout of 30000ms exceeded.', line: 3 },
  ]);
  await db.insert(schema.files).values([
    { testRunsCaseId: 10, type: 'trace', path: 'traces/10-a.zip' },
    { testRunsCaseId: 10, type: 'screenshot', path: 'shots/10-early.png' },
    { testRunsCaseId: 10, type: 'screenshot', path: 'shots/10-failure.png' },
  ]);
});

describe('getBranchFailures', () => {
  test("lists the branch's newest run and its failures at their failing call", async () => {
    const result = await getBranchFailures(db as never, 1, 'feature/pay');
    expect(result.run).toMatchObject({ id: 2, status: 'failed', branch: 'feature/pay', totalTests: 2 });
    expect(result.failures).toEqual([
      {
        executionId: 10,
        testCaseId: 1,
        clusterId: null,
        title: 'pays',
        file: 'tests/checkout.spec.ts',
        line: 7,
        status: 'failed',
        headline: expect.stringContaining('Pay now'),
        location: '/ci/work/tests/pages/checkout.page.ts:12:19',
        traces: ['traces/10-a.zip'],
        screenshot: 'shots/10-failure.png',
      },
    ]);
  });

  test('reads the newest run on the branch, which may have no failure', async () => {
    const result = await getBranchFailures(db as never, 1, 'main');
    expect(result.run?.id).toBe(3);
    expect(result.failures).toEqual([]);
  });

  test('without a branch, reads the newest run of any branch', async () => {
    expect((await getBranchFailures(db as never, 1, null)).run?.id).toBe(3);
  });

  test('a branch without a run has no run', async () => {
    expect(await getBranchFailures(db as never, 1, 'nope')).toEqual({ run: null, failures: [] });
  });
});
