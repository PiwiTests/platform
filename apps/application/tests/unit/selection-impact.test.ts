import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { resolveImpact } = await import('../../server/utils/selection-impact');

let db: ReturnType<typeof drizzle<typeof schema>>;
let caseSeq = 0;
let runSeq = 0;
let clock = 0;

async function seedCase(title: string, filePath: string): Promise<number> {
  const id = ++caseSeq;
  await db.insert(schema.testCases).values({ id, projectId: 1, filePath, title });
  return id;
}

/** One execution recording the in-project source frames the test ran through. */
async function seedExec(testCaseId: number, frames: string[], line = 1): Promise<void> {
  const runId = ++runSeq;
  await db.insert(schema.testRuns).values({ id: runId, projectId: 1, status: 'passed', startTime: new Date(++clock) });
  await db.insert(schema.testRunsCases).values({
    testRunId: runId,
    testCaseId,
    status: 'passed',
    line,
    testSourceFrames: frames.map((file) => ({ file, line, snippet: '' })),
    createdAt: new Date(++clock),
  });
}

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'impact-project' });
  caseSeq = 0;
  runSeq = 0;
  clock = 0;
});

describe('resolveImpact', () => {
  test('maps a changed test file directly to its tests', async () => {
    const login = await seedCase('logs in', 'tests/login.spec.ts');
    await seedExec(login, ['tests/login.spec.ts']);
    await seedCase('checks out', 'tests/checkout.spec.ts');

    const r = await resolveImpact(db, 1, ['tests/login.spec.ts']);
    expect(r.impact.widened).toBe(false);
    expect(r.tests.map((t) => t.testCaseId)).toEqual([login]);
    expect(r.impact.mappedFiles).toBe(1);
  });

  test('maps a changed support file to tests that ran through it (reach)', async () => {
    const checkout = await seedCase('pays', 'tests/checkout.spec.ts');
    await seedExec(checkout, ['tests/checkout.spec.ts', 'pages/CartPage.ts']);
    const other = await seedCase('logs in', 'tests/login.spec.ts');
    await seedExec(other, ['tests/login.spec.ts', 'pages/LoginPage.ts']);

    const r = await resolveImpact(db, 1, ['pages/CartPage.ts']);
    expect(r.impact.widened).toBe(false);
    expect(r.tests.map((t) => t.testCaseId)).toEqual([checkout]);
  });

  test('widens to the full suite when a changed source file maps to no test', async () => {
    const a = await seedCase('a', 'tests/a.spec.ts');
    await seedExec(a, ['tests/a.spec.ts']);
    const b = await seedCase('b', 'tests/b.spec.ts');
    await seedExec(b, ['tests/b.spec.ts']);

    const r = await resolveImpact(db, 1, ['src/services/pricing.ts']);
    expect(r.impact.widened).toBe(true);
    expect(r.impact.unmappedSourceFiles).toEqual(['src/services/pricing.ts']);
    // The whole suite runs.
    expect(r.tests.map((t) => t.testCaseId).sort()).toEqual([a, b]);
    expect(r.warnings.some((w) => w.code === 'impact-widened')).toBe(true);
  });

  test('a docs-only change impacts nothing and does not widen', async () => {
    const a = await seedCase('a', 'tests/a.spec.ts');
    await seedExec(a, ['tests/a.spec.ts']);

    const r = await resolveImpact(db, 1, ['README.md', 'docs/guide.md']);
    expect(r.impact.widened).toBe(false);
    expect(r.tests).toHaveLength(0);
  });

  test('matches on a path suffix so prefix differences do not miss', async () => {
    const login = await seedCase('logs in', 'tests/login.spec.ts');
    await seedExec(login, ['tests/login.spec.ts']);

    // A changed path reported with a repo prefix still matches the project-relative one.
    const r = await resolveImpact(db, 1, ['apps/web/tests/login.spec.ts']);
    expect(r.tests.map((t) => t.testCaseId)).toEqual([login]);
  });
});
