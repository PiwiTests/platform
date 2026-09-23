import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';
import type { GlobalRunEvent } from '../../server/utils/run-events';

// The schema barrel picks the PostgreSQL schema at import time when
// PIWI_DATABASE_URL is set, so clear it before importing the helper.
delete process.env.PIWI_DATABASE_URL;
const { interruptStaleRuns, STALE_TIMEOUT_MS } = await import('../../server/utils/stale-runs');
const { runEventBus } = await import('../../server/utils/run-events');

let db: ReturnType<typeof drizzle<typeof schema>>;
const now = Date.now();
const stale = new Date(now - STALE_TIMEOUT_MS - 60_000);
const fresh = new Date(now - 10_000);

// Runs 1–3 are in flight and quiet past the timeout; run 4 is in flight but
// active; run 5 is quiet but already finished.
beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  const migrationsFolder = fileURLToPath(new URL('../../server/database/migrations', import.meta.url));
  await migrate(db, { migrationsFolder });

  await db.insert(schema.projects).values([
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
  ]);
  const run = (id: number, projectId: number, status: string, updatedAt: Date) => ({
    id,
    projectId,
    status,
    startTime: stale,
    createdAt: stale,
    updatedAt,
    streamToken: `token-${id}`,
    totalTests: 10,
  });
  await db
    .insert(schema.testRuns)
    .values([
      run(1, 1, 'running', stale),
      run(2, 2, 'initializing', stale),
      run(3, 1, 'finalizing', stale),
      run(4, 1, 'running', fresh),
      run(5, 1, 'passed', stale),
    ]);
  await db.insert(schema.testCases).values([{ id: 1, projectId: 1, title: 'test 1', filePath: 'a.spec.ts' }]);
  await db
    .insert(schema.testRunsCases)
    .values([{ testRunId: 1, testCaseId: 1, status: 'passed', retries: 0, browserName: 'chromium' }]);
});

describe('interruptStaleRuns', () => {
  test('marks quiet in-flight runs interrupted and announces each on the global stream', async () => {
    const global: GlobalRunEvent[] = [];
    const unsubscribe = runEventBus.subscribeGlobal((event) => global.push(event));
    const finished: unknown[] = [];
    const unsubscribeRun = runEventBus.subscribe(1, (event) => finished.push(event.data));

    const reaped = await interruptStaleRuns(db, now);
    unsubscribe();
    unsubscribeRun();

    expect([...reaped].sort()).toEqual([1, 2, 3]);
    expect([...global].sort((a, b) => a.runId - b.runId)).toEqual([
      { type: 'run-finished', runId: 1, projectId: 1, status: 'interrupted' },
      { type: 'run-finished', runId: 2, projectId: 2, status: 'interrupted' },
      { type: 'run-finished', runId: 3, projectId: 1, status: 'interrupted' },
    ]);
    // The run's own stream gets the reconciled counts.
    expect(finished).toEqual([expect.objectContaining({ status: 'interrupted', totalTests: 10, passedTests: 1 })]);

    const rows = await db.select().from(schema.testRuns);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of [1, 2, 3]) {
      expect(byId.get(id)?.status).toBe('interrupted');
      expect(byId.get(id)?.streamToken).toBeNull();
    }
    expect(byId.get(4)?.status).toBe('running');
    expect(byId.get(5)?.status).toBe('passed');
  });

  test('leaves nothing to announce once every stale run is reaped', async () => {
    const global: GlobalRunEvent[] = [];
    const unsubscribe = runEventBus.subscribeGlobal((event) => global.push(event));
    const reaped = await interruptStaleRuns(db, now);
    unsubscribe();

    expect(reaped).toEqual([]);
    expect(global).toEqual([]);
    const [active] = await db.select().from(schema.testRuns).where(eq(schema.testRuns.id, 4));
    expect(active?.status).toBe('running');
  });
});
