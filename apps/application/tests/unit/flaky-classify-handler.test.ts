import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the handler modules load.
delete process.env.PIWI_DATABASE_URL;
const { classifyAndPersistFlakyRootCause } = await import('../../shared/handlers/flaky-classify');

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  await db.insert(schema.projects).values({ id: 1, name: 'checkout' });
  await db.insert(schema.testCases).values({ id: 1, projectId: 1, filePath: 'checkout.spec.ts', title: 'pays' });
});

async function addRun(status: 'passed' | 'failed'): Promise<number> {
  const [run] = await db
    .insert(schema.testRuns)
    .values({ projectId: 1, status, startTime: new Date(), duration: 60_000, totalTests: 1 })
    .returning({ id: schema.testRuns.id });
  return run!.id;
}

async function addAttempt(
  testRunId: number,
  retries: number,
  status: string,
  project: string,
  error: string | null = null,
  createdAt?: Date,
): Promise<void> {
  await db.insert(schema.testRunsCases).values({
    ...(createdAt ? { createdAt } : {}),
    testRunId,
    testCaseId: 1,
    status,
    retries,
    duration: 1_000,
    error,
    browserName: project,
    browser: { projectName: project, browserName: project },
  });
}

describe('classifyAndPersistFlakyRootCause', () => {
  test('reads the failed attempts of green runs that passed on retry', async () => {
    for (let i = 0; i < 3; i++) {
      const runId = await addRun('passed');
      await addAttempt(runId, 0, 'failed', 'chromium', 'Error: connect ECONNREFUSED 127.0.0.1:3000');
      await addAttempt(runId, 1, 'passed', 'chromium');
    }
    const result = await classifyAndPersistFlakyRootCause(db as any, 1, 1);
    expect(result.rootCause).toBe('network');
  });

  test('counts the passes of other browsers toward environment', async () => {
    for (let i = 0; i < 3; i++) {
      const runId = await addRun('passed');
      await addAttempt(runId, 0, 'failed', 'webkit', 'Error: something odd happened');
      await addAttempt(runId, 1, 'passed', 'webkit');
      await addAttempt(runId, 0, 'passed', 'chromium');
    }
    const result = await classifyAndPersistFlakyRootCause(db as any, 1, 1);
    expect(result.rootCause).toBe('environment');
  });

  test('keeps the failures of a rare flake behind many more recent passes', async () => {
    const start = Date.UTC(2026, 8, 1);
    for (let i = 0; i < 3; i++) {
      const runId = await addRun('passed');
      await addAttempt(
        runId,
        0,
        'failed',
        'chromium',
        'Error: connect ECONNREFUSED 127.0.0.1:3000',
        new Date(start + i),
      );
    }
    for (let i = 0; i < 150; i++) {
      await addAttempt(await addRun('passed'), 0, 'passed', 'chromium', null, new Date(start + 1_000 + i * 1_000));
    }
    const result = await classifyAndPersistFlakyRootCause(db as any, 1, 1);
    expect(result.rootCause).toBe('network');
  });

  test('stays other with no failed attempt', async () => {
    const runId = await addRun('passed');
    await addAttempt(runId, 0, 'passed', 'chromium');
    const result = await classifyAndPersistFlakyRootCause(db as any, 1, 1);
    expect(result.rootCause).toBe('other');
  });
});
