import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const gaps = await import('../../shared/handlers/scenario-gaps');

// ── Pure detectors ─────────────────────────────────────────────────────────

describe('detectSuccessOnly', () => {
  test('flags a route seen often with only success statuses, saying observed reach', () => {
    const [gap] = gaps.detectSuccessOnly([
      { key: 'GET /api/orders', method: 'GET', pattern: '/api/orders', count: 40, statuses: [200, 200, 304] },
    ]);
    expect(gap!.detector).toBe('success-only');
    expect(gap!.class).toBe('blind-spot');
    expect(gap!.key).toBe('GET /api/orders');
    expect(gap!.evidence[0]).toContain('observed reach');
    expect(gap!.confidence).toBeGreaterThan(0);
  });

  test('does not flag a route that has seen an error status', () => {
    expect(
      gaps.detectSuccessOnly([
        { key: 'GET /api/orders', method: 'GET', pattern: '/api/orders', count: 40, statuses: [200, 500] },
      ]),
    ).toEqual([]);
  });

  test('does not flag a route seen too few times to claim a pattern', () => {
    expect(
      gaps.detectSuccessOnly([{ key: 'GET /api/x', method: 'GET', pattern: '/api/x', count: 2, statuses: [200] }]),
    ).toEqual([]);
  });
});

describe('detectSingleCoveringTest', () => {
  test('flags a node reached by exactly one test', () => {
    const [gap] = gaps.detectSingleCoveringTest([
      { nodeKind: 'route', nodeKey: 'POST /api/orders', tests: [{ testCaseId: 7, title: 'checkout › coupon' }] },
    ]);
    expect(gap!.detector).toBe('single-covering-test');
    expect(gap!.class).toBe('fragile');
    expect(gap!.testCaseId).toBe(7);
    expect(gap!.evidence[0]).toContain('checkout › coupon');
    expect(gap!.evidence[0]).toContain('observed reach');
  });

  test('ignores a node reached by two or more tests', () => {
    expect(
      gaps.detectSingleCoveringTest([
        {
          nodeKind: 'route',
          nodeKey: 'POST /api/orders',
          tests: [
            { testCaseId: 1, title: 'a' },
            { testCaseId: 2, title: 'b' },
          ],
        },
      ]),
    ).toEqual([]);
  });
});

describe('detectSurfaceDrift', () => {
  test('flags a node first seen in the latest run', () => {
    const [gap] = gaps.detectSurfaceDrift(
      [{ nodeKind: 'page', nodeKey: '/billing/plans', firstSeenRunId: 830, reachCount: 1 }],
      830,
    );
    expect(gap!.detector).toBe('surface-drift');
    expect(gap!.evidence[0]).toContain('run #830');
    expect(gap!.evidence[0]).toContain('observed reach');
  });

  test('ignores an older node', () => {
    expect(
      gaps.detectSurfaceDrift([{ nodeKind: 'page', nodeKey: '/x', firstSeenRunId: 800, reachCount: 3 }], 830),
    ).toEqual([]);
  });
});

describe('detectChangedUnreached', () => {
  test('pairs "no test in this run" with the history count and says observed reach', () => {
    const [gap] = gaps.detectChangedUnreached(
      [
        {
          filePath: 'server/api/orders.post.ts',
          additions: 41,
          deletions: 3,
          reachedInRun: false,
          reachedCountHistory: 0,
        },
      ],
      812,
      30,
    );
    expect(gap!.detector).toBe('changed-unreached');
    expect(gap!.evidence[0]).toContain('no test in run #812');
    expect(gap!.evidence[0]).toContain('0 in 30 runs');
    expect(gap!.evidence[0]).toContain('observed reach');
    expect(gap!.confidence).toBeCloseTo(0.9);
    expect(gap!.files).toEqual(['server/api/orders.post.ts']);
  });

  test('ignores a changed file that a test reached in the run', () => {
    expect(
      gaps.detectChangedUnreached(
        [{ filePath: 'a.ts', additions: 1, deletions: 0, reachedInRun: true, reachedCountHistory: 4 }],
        1,
      ),
    ).toEqual([]);
  });
});

// ── Exposure ranking (pure) ────────────────────────────────────────────────

describe('exposure ranking', () => {
  test('every factor stays at or above the floor', () => {
    const factors = gaps.exposureFactorsFor(
      { detector: 'd', kind: 'gap', class: 'blind-spot', key: 'k', title: 't', evidence: [], confidence: 1 },
      {},
    );
    expect(factors.churn).toBe(gaps.FACTOR_FLOOR);
    expect(factors.age).toBe(gaps.FACTOR_FLOOR);
    expect(factors.escapeHistory).toBe(gaps.FACTOR_FLOOR);
    expect(factors.priority).toBe(gaps.FACTOR_FLOOR);
  });

  test('priority maps to its factor', () => {
    expect(gaps.priorityFactor('critical')).toBe(1);
    expect(gaps.priorityFactor('low')).toBe(0.2);
    expect(gaps.priorityFactor(null)).toBe(gaps.FACTOR_FLOOR);
  });

  test('a changed file with churn, age and escape outranks a bare route gap', () => {
    const files = new Map([['src/orders.ts', { churn: 12, ageDays: 400, escaped: true }]]);
    const changed = gaps.rankGap(
      {
        detector: 'changed-unreached',
        kind: 'gap',
        class: 'blind-spot',
        key: 'src/orders.ts',
        title: 't',
        evidence: [],
        confidence: 0.9,
        files: ['src/orders.ts'],
        priority: 'high',
      },
      { files },
    );
    const route = gaps.rankGap(
      {
        detector: 'success-only',
        kind: 'gap',
        class: 'blind-spot',
        key: 'GET /x',
        title: 't',
        evidence: [],
        confidence: 0.9,
      },
      {},
    );
    expect(changed.score).toBeGreaterThan(route.score);
    expect(changed.factors.escapeHistory).toBe(1);
  });
});

// ── DB-backed orchestration ────────────────────────────────────────────────

let db: ReturnType<typeof drizzle<typeof schema>>;
let clock = 0;

async function seedRun(id: number): Promise<void> {
  await db.insert(schema.testRuns).values({ id, projectId: 1, status: 'passed', startTime: new Date(++clock) });
}

async function seedReach(testCaseId: number, toKind: string, toKey: string, runId: number): Promise<void> {
  await db.insert(schema.graphEdges).values({
    projectId: 1,
    fromKind: 'test',
    fromKey: String(testCaseId),
    toKind,
    toKey,
    kind: 'reaches',
    confidence: 1,
    lastSeenAt: new Date(++clock),
  });
  await db
    .insert(schema.graphNodes)
    .values({
      projectId: 1,
      kind: toKind,
      key: toKey,
      firstSeenRunId: runId,
      lastSeenRunId: runId,
      lastSeenAt: new Date(++clock),
    })
    .onConflictDoNothing();
}

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'gap-project' });
  await db
    .insert(schema.testCases)
    .values({ id: 1, projectId: 1, filePath: 'tests/checkout.spec.ts', title: 'checkout › coupon' });
  clock = 0;
});

describe('computeScenarioGaps', () => {
  test('detects a single-covering-test gap and persists it as open', async () => {
    await seedRun(1);
    await seedReach(1, 'page', '/checkout', 1);

    const result = await gaps.computeScenarioGaps(db, 1);
    expect(result.upserted).toBeGreaterThan(0);

    const rows = await gaps.listScenarioGaps(db, 1, {});
    const single = rows.find((r) => r.detector === 'single-covering-test');
    expect(single).toBeTruthy();
    expect(single!.status).toBe('open');
    expect(single!.factors).not.toBeNull();
  });

  test('recomputation preserves triage — a dismissed gap stays dismissed', async () => {
    await seedRun(1);
    await seedReach(1, 'page', '/checkout', 1);
    await gaps.computeScenarioGaps(db, 1);

    await db
      .update(schema.scenarioGaps)
      .set({ status: 'dismissed' })
      .where(eq(schema.scenarioGaps.detector, 'single-covering-test'));
    await gaps.computeScenarioGaps(db, 1);

    const [row] = await db
      .select()
      .from(schema.scenarioGaps)
      .where(eq(schema.scenarioGaps.detector, 'single-covering-test'));
    expect(row!.status).toBe('dismissed');
  });

  test('closes a gap whose condition no longer holds', async () => {
    await seedRun(1);
    await seedReach(1, 'page', '/checkout', 1);
    await gaps.computeScenarioGaps(db, 1);

    // A second test now reaches the page, so it is no longer single-covered.
    await db.insert(schema.testCases).values({ id: 2, projectId: 1, filePath: 'tests/other.spec.ts', title: 'other' });
    await seedReach(2, 'page', '/checkout', 1);
    await gaps.computeScenarioGaps(db, 1);

    const open = await gaps.listScenarioGaps(db, 1, { status: 'open' });
    expect(open.find((r) => r.detector === 'single-covering-test')).toBeFalsy();
    const closed = await gaps.listScenarioGaps(db, 1, { status: 'closed' });
    expect(closed.find((r) => r.detector === 'single-covering-test')).toBeTruthy();
  });
});
