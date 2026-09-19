import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { computeChangeCoverage, extractTicketIds } = await import('../../shared/handlers/change-coverage');

let db: ReturnType<typeof drizzle<typeof schema>>;
let caseSeq = 0;
let runSeq = 0;
let clock = 0;

async function seedCase(title: string, filePath: string): Promise<number> {
  const id = ++caseSeq;
  await db.insert(schema.testCases).values({ id, projectId: 1, filePath, title });
  return id;
}

/** A run in which a set of test cases executed. Returns the run id. */
async function seedRun(testCaseIds: number[]): Promise<number> {
  const runId = ++runSeq;
  await db.insert(schema.testRuns).values({ id: runId, projectId: 1, status: 'passed', startTime: new Date(++clock) });
  for (const testCaseId of testCaseIds) {
    await db
      .insert(schema.testRunsCases)
      .values({ testRunId: runId, testCaseId, status: 'passed', createdAt: new Date(++clock) });
  }
  return runId;
}

/** A locator call site for a test case, pointing at a source file. */
async function seedLocator(testCaseId: number, location: string): Promise<void> {
  await db.insert(schema.locatorSnapshots).values({
    testCaseId,
    location,
    usedMethod: 'getByRole',
    usedArgs: '[]',
    usedArgsFp: 'fp',
    elementAttrs: '{}',
    alternatives: '[]',
    lastSeenAt: new Date(++clock),
  });
}

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'change-coverage-project' });
  caseSeq = 0;
  runSeq = 0;
  clock = 0;
});

describe('extractTicketIds', () => {
  test('pulls Jira/Linear-style ids from free text, deduped', () => {
    expect(extractTicketIds('fix: PROJ-418 stale version', 'chore(ABC-9): retry', null, 'PROJ-418 again')).toEqual([
      'PROJ-418',
      'ABC-9',
    ]);
  });

  test('is empty when nothing matches', () => {
    expect(extractTicketIds('no tickets here', undefined)).toEqual([]);
  });
});

describe('computeChangeCoverage', () => {
  test('marks a file reached in the run when a reaching test ran there', async () => {
    const orders = await seedCase('places an order', 'tests/orders.spec.ts');
    await seedLocator(orders, 'src/api/orders.post.ts:12:4');
    const runId = await seedRun([orders]);

    const cc = await computeChangeCoverage(db, 1, {
      changedFiles: [{ filePath: 'src/api/orders.post.ts', additions: 41, deletions: 3 }],
      runId,
      tickets: ['PROJ-418'],
    });

    const file = cc.files[0]!;
    expect(file.reachedInRun).toBe(true);
    expect(file.reachedCountHistory).toBe(1);
    expect(file.reachingTestCount).toBe(1);
    expect(file.ticket).toBe('PROJ-418');
    expect(cc.reachedFiles).toBe(1);
    expect(cc.uncoveredFiles).toBe(0);
  });

  test('marks a changed file with no reaching test as uncovered', async () => {
    const orders = await seedCase('places an order', 'tests/orders.spec.ts');
    await seedLocator(orders, 'src/api/orders.post.ts:12:4');
    const runId = await seedRun([orders]);

    const cc = await computeChangeCoverage(db, 1, {
      changedFiles: [
        { filePath: 'src/api/orders.post.ts', additions: 41, deletions: 3 },
        { filePath: 'src/utils/rounding.ts', additions: 5, deletions: 1 },
      ],
      runId,
      tickets: ['PROJ-418'],
    });

    const rounding = cc.files.find((f) => f.filePath === 'src/utils/rounding.ts')!;
    expect(rounding.reachedInRun).toBe(false);
    expect(rounding.reachedCountHistory).toBe(0);
    expect(cc.reachedFiles).toBe(1);
    expect(cc.uncoveredFiles).toBe(1);
  });

  test('a changed spec file reaches the tests defined in it', async () => {
    const login = await seedCase('logs in', 'tests/login.spec.ts');
    const runId = await seedRun([login]);

    const cc = await computeChangeCoverage(db, 1, {
      changedFiles: [{ filePath: 'tests/login.spec.ts', additions: 2, deletions: 0 }],
      runId,
    });

    expect(cc.files[0]!.reachedInRun).toBe(true);
    expect(cc.files[0]!.ticket).toBeNull();
  });

  test('groups files by their primary ticket', async () => {
    const orders = await seedCase('places an order', 'tests/orders.spec.ts');
    await seedRun([orders]);

    const cc = await computeChangeCoverage(db, 1, {
      changedFiles: [
        { filePath: 'src/a.ts', additions: 1, deletions: 0 },
        { filePath: 'src/b.ts', additions: 1, deletions: 0 },
      ],
      tickets: ['PROJ-1'],
    });

    expect(cc.tickets).toHaveLength(1);
    expect(cc.tickets[0]!.ticket).toBe('PROJ-1');
    expect(cc.tickets[0]!.files).toHaveLength(2);
  });
});
