import { describe, test, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema at import time when
// PIWI_DATABASE_URL is set, so clear it before importing the handler.
delete process.env.PIWI_DATABASE_URL;
const { getFlakeProfile } = await import('../../shared/handlers/flake-profile');

let db: ReturnType<typeof drizzle<typeof schema>>;

const NOW = new Date('2026-09-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const FLAKY = 1;
const NEIGHBOR = 2;
const PREVIOUS = 3;
const FAR = 4;

/**
 * Twelve runs of the flaky test (case 1), one attempt each. In runs 1–4 it
 * fails: `GET /api/cart` takes 2 s, the neighbor (case 2) overlaps it on
 * another shard, and case 3 ran just before it on its worker. In runs 5–12
 * it passes with a fast cart, case 3 runs before it on another worker, and
 * the neighbor runs after it. A probe run, a run on a feature branch and a
 * run older than the window fail too, and must be left out.
 */
beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  const migrationsFolder = fileURLToPath(new URL('../../server/database/migrations', import.meta.url));
  await migrate(db, { migrationsFolder });

  await db.insert(schema.projects).values([{ id: 1, name: 'Shop', defaultBranch: 'main' }]);
  await db.insert(schema.testCases).values([
    { id: FLAKY, projectId: 1, title: 'pays with a saved card', filePath: 'checkout.spec.ts' },
    { id: NEIGHBOR, projectId: 1, title: 'resets catalog', filePath: 'admin.spec.ts' },
    { id: PREVIOUS, projectId: 1, title: 'seeds the cart', filePath: 'cart.spec.ts' },
    { id: FAR, projectId: 1, title: 'unrelated', filePath: 'other.spec.ts' },
  ]);

  const runs: Array<typeof schema.testRuns.$inferInsert> = [];
  const executions: Array<typeof schema.testRunsCases.$inferInsert & { id: number }> = [];
  const requests: Array<typeof schema.networkRequests.$inferInsert> = [];
  let executionId = 1;
  const exec = (row: Omit<typeof schema.testRunsCases.$inferInsert, 'id'>) => {
    const id = executionId++;
    executions.push({ id, browserName: 'chromium', ...row });
    return id;
  };

  const addRun = (id: number, opts: { fails: boolean; ageDays: number; branch?: string; probe?: boolean }) => {
    const start = NOW.getTime() - opts.ageDays * DAY;
    runs.push({
      id,
      projectId: 1,
      status: opts.fails ? 'failed' : 'passed',
      startTime: new Date(start),
      duration: 600_000,
      branch: opts.branch ?? 'main',
      environment: 'staging',
      metadata: opts.probe ? { piwiProbe: true } : null,
    });
    const created = new Date(start);
    if (opts.fails) {
      exec({
        testRunId: id,
        testCaseId: PREVIOUS,
        status: 'passed',
        startedAt: start,
        duration: 4_000,
        workerIndex: 0,
        shardIndex: 1,
        createdAt: created,
      });
      const flaky = exec({
        testRunId: id,
        testCaseId: FLAKY,
        status: 'failed',
        startedAt: start + 5_000,
        duration: 6_000,
        workerIndex: 0,
        shardIndex: 1,
        createdAt: created,
      });
      const neighbor = exec({
        testRunId: id,
        testCaseId: NEIGHBOR,
        status: 'passed',
        startedAt: start + 7_000,
        duration: 3_000,
        workerIndex: 0,
        shardIndex: 2,
        createdAt: created,
      });
      requests.push(
        {
          testRunsCaseId: flaky,
          testRunId: id,
          method: 'GET',
          url: 'https://shop.test/api/cart',
          status: 200,
          duration: 2_000,
        },
        {
          testRunsCaseId: flaky,
          testRunId: id,
          method: 'POST',
          url: 'https://shop.test/api/products',
          status: 201,
          duration: 90,
        },
        {
          testRunsCaseId: neighbor,
          testRunId: id,
          method: 'PUT',
          url: 'https://shop.test/api/products/12',
          status: 200,
          duration: 80,
        },
        {
          testRunsCaseId: neighbor,
          testRunId: id,
          method: 'POST',
          url: 'https://shop.test/api/products',
          status: 200,
          duration: 80,
        },
      );
    } else {
      exec({
        testRunId: id,
        testCaseId: PREVIOUS,
        status: 'passed',
        startedAt: start,
        duration: 4_000,
        workerIndex: 1,
        shardIndex: 1,
        createdAt: created,
      });
      exec({
        testRunId: id,
        testCaseId: FAR,
        status: 'passed',
        startedAt: start,
        duration: 4_000,
        workerIndex: 0,
        shardIndex: 1,
        createdAt: created,
      });
      const flaky = exec({
        testRunId: id,
        testCaseId: FLAKY,
        status: 'passed',
        startedAt: start + 5_000,
        duration: 5_000,
        workerIndex: 0,
        shardIndex: 1,
        createdAt: created,
      });
      exec({
        testRunId: id,
        testCaseId: NEIGHBOR,
        status: 'passed',
        startedAt: start + 20_000,
        duration: 3_000,
        workerIndex: 0,
        shardIndex: 2,
        createdAt: created,
      });
      requests.push({
        testRunsCaseId: flaky,
        testRunId: id,
        method: 'GET',
        url: 'https://shop.test/api/cart',
        status: 200,
        duration: 150,
      });
    }
  };

  for (let i = 1; i <= 4; i++) addRun(i, { fails: true, ageDays: i });
  for (let i = 5; i <= 12; i++) addRun(i, { fails: false, ageDays: i });
  addRun(13, { fails: true, ageDays: 1, probe: true });
  addRun(14, { fails: true, ageDays: 1, branch: 'feature/x' });
  addRun(15, { fails: true, ageDays: 40 });

  await db.insert(schema.testRuns).values(runs);
  await db.insert(schema.testRunsCases).values(executions);
  await db.insert(schema.networkRequests).values(requests);
});

describe('getFlakeProfile', () => {
  test('reads the window the flaky leaderboard reads', async () => {
    const profile = (await getFlakeProfile(db as never, FLAKY, { now: NOW }))!;
    // Runs 1–12 only: the probe run, the feature branch and the 40-day-old run are left out.
    expect(profile.failures).toBe(4);
    expect(profile.passes).toBe(8);
  });

  test('finds the slow route, the neighbor alongside and the test before, from SQL', async () => {
    const profile = (await getFlakeProfile(db as never, FLAKY, { now: NOW }))!;
    const byKind = Object.fromEntries(profile.suspects.map((s) => [s.kind, s]));

    expect(byKind['slow-route']).toMatchObject({
      route: 'GET /api/cart',
      thresholdMs: 2_000,
      counts: { failuresWith: 4, failures: 4, passesWith: 0, passes: 8 },
    });
    expect(byKind.alongside).toMatchObject({
      testCaseId: NEIGHBOR,
      title: 'resets catalog',
      approximate: true,
      sharedRoutes: ['/api/products'],
      counts: { failuresWith: 4, failures: 4, passesWith: 0, passes: 8 },
    });
    expect(byKind.before).toMatchObject({
      testCaseId: PREVIOUS,
      title: 'seeds the cart',
      counts: { failuresWith: 4, failures: 4, passesWith: 0, passes: 8 },
    });
  });

  test('the summary view leaves out the shared routes', async () => {
    const profile = (await getFlakeProfile(db as never, FLAKY, { now: NOW, summary: true }))!;
    const alongside = profile.suspects.find((s) => s.kind === 'alongside')!;
    expect(alongside.title).toBe('resets catalog');
    expect(alongside.sharedRoutes).toEqual([]);
  });

  test('an unknown test case has no profile', async () => {
    expect(await getFlakeProfile(db as never, 999, { now: NOW })).toBeNull();
  });
});
