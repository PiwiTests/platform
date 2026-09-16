import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema at import time when
// PIWI_DATABASE_URL is set, so clear it before importing the handlers.
delete process.env.PIWI_DATABASE_URL;
const { getProjectLatestRun, getTestRun } = await import('../../shared/handlers/test-runs');

const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60 * 1000);

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  const migrationsFolder = fileURLToPath(new URL('../../server/database/migrations', import.meta.url));
  await migrate(db, { migrationsFolder });

  await db.insert(schema.projects).values([{ id: 1, name: 'Alpha' }]);

  // Insert runs the way the demo seed does: newest-first with an incrementing
  // id, so the NEWEST run (by start_time) has the SMALLEST id and the OLDEST run
  // has the LARGEST id. Ordering by MAX(id) would therefore pick the OLDEST run.
  await db.insert(schema.testRuns).values([
    { id: 5, projectId: 1, status: 'failed', startTime: at(1), isFullRun: 1 }, // newest
    { id: 8, projectId: 1, status: 'passed', startTime: at(300), isFullRun: 1 },
    { id: 12, projectId: 1, status: 'passed', startTime: at(900), isFullRun: 1 }, // oldest
  ]);
});

describe('latest-run selection is chronological, not MAX(id)', () => {
  test('getProjectLatestRun returns the newest run by start_time', async () => {
    const latest = await getProjectLatestRun(db, 1);
    expect(latest).toEqual({ id: 5, status: 'failed' });
  });

  test('getTestRun exposes the chronologically newest run as project.latestRunId', async () => {
    // Open the OLDEST run (largest id): its "Newer run" pill must still point at
    // the newest run (id 5), never at itself or at MAX(id).
    const run: any = await getTestRun(db, 12);
    expect(run?.project?.latestRunId).toBe(5);
    expect(run?.project?.latestRunStatus).toBe('failed');
  });
});
