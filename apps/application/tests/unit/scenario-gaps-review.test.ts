import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const gaps = await import('../../shared/handlers/scenario-gaps');
const { loadDetectorPrecision } = await import('../../shared/handlers/detector-precision');

// ── F12: readable combined score ─────────────────────────────────────────────

describe('scoreGap — geometric mean (F12)', () => {
  const bare = {
    detector: 'd',
    kind: 'gap' as const,
    class: 'blind-spot' as const,
    key: 'k',
    title: 't',
    evidence: [],
  };

  test('an all-floor gap scores near the floor, not the fourth power of it', () => {
    const floor = gaps.FACTOR_FLOOR;
    const score = gaps.scoreGap(
      { ...bare, confidence: 1 },
      { churn: floor, age: floor, escapeHistory: floor, priority: floor },
    );
    // Geometric mean of four 0.1s is 0.1, readable — never 1e-4.
    expect(score).toBeCloseTo(0.1, 6);
    expect(score).toBeGreaterThan(0.001);
  });

  test('ranking among equal-confidence gaps is unchanged by the transform', () => {
    const strong = gaps.scoreGap({ ...bare, confidence: 0.9 }, { churn: 1, age: 1, escapeHistory: 1, priority: 0.7 });
    const weak = gaps.scoreGap(
      { ...bare, confidence: 0.9 },
      { churn: 0.1, age: 0.1, escapeHistory: 0.1, priority: 0.1 },
    );
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(1);
  });
});

// ── F6: control-nobody-exercises needs control reach ─────────────────────────

describe('detectControlNobodyExercises — needs control reach (F6)', () => {
  test('emits nothing when the project has no control reach at all', () => {
    expect(
      gaps.detectControlNobodyExercises([
        { key: 'button:Export', pageCount: 12, reachCount: 0 },
        { key: 'button:Save', pageCount: 3, reachCount: 0 },
      ]),
    ).toEqual([]);
  });

  test('still flags an unreached control once some control reach exists', () => {
    const out = gaps.detectControlNobodyExercises([
      { key: 'button:Export', pageCount: 12, reachCount: 0 },
      { key: 'button:Save', pageCount: 3, reachCount: 2 },
    ]);
    expect(out.map((g) => g.key)).toEqual(['control:button:Export']);
  });
});

// ── F7: trusted reach ────────────────────────────────────────────────────────

describe('detectSingleCoveringTest — trusted reach only (F7)', () => {
  test('a trusted test plus an untrusted one is still single-covered', () => {
    const out = gaps.detectSingleCoveringTest([
      {
        nodeKind: 'route',
        nodeKey: 'POST /api/orders',
        tests: [
          { testCaseId: 1, title: 'trusted', trusted: true },
          { testCaseId: 2, title: 'flaky', trusted: false },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.testCaseId).toBe(1);
  });

  test('two trusted tests are not single-covered', () => {
    expect(
      gaps.detectSingleCoveringTest([
        {
          nodeKind: 'route',
          nodeKey: 'POST /api/orders',
          tests: [
            { testCaseId: 1, title: 'a', trusted: true },
            { testCaseId: 2, title: 'b', trusted: true },
          ],
        },
      ]),
    ).toEqual([]);
  });
});

// ── F1: dedupe before upsert ─────────────────────────────────────────────────

describe('dedupeScoredGaps (F1)', () => {
  test('keeps the highest-scoring row per (detector, key)', () => {
    const mk = (key: string, score: number) => ({
      detector: 'not-handled',
      kind: 'finding' as const,
      class: 'unhandled' as const,
      key,
      title: 't',
      evidence: [],
      confidence: 1,
      factors: { churn: 0.1, age: 0.1, escapeHistory: 0.1, priority: 0.1 },
      score,
    });
    const out = gaps.dedupeScoredGaps([mk('route:GET /a', 0.2), mk('route:GET /a', 0.9), mk('route:GET /b', 0.3)]);
    expect(out).toHaveLength(2);
    expect(out.find((g) => g.key === 'route:GET /a')!.score).toBe(0.9);
  });
});

// ── DB-backed ────────────────────────────────────────────────────────────────

let db: ReturnType<typeof drizzle<typeof schema>>;
beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'p' });
});

const scoredGap = (over: Partial<gaps.ScoredGap> = {}): gaps.ScoredGap => ({
  detector: 'not-handled',
  kind: 'finding',
  class: 'unhandled',
  key: 'route:GET /api/cart',
  title: 'GET /api/cart: unhandled failure',
  evidence: ['x'],
  confidence: 1,
  factors: { churn: 0.1, age: 0.1, escapeHistory: 0.1, priority: 0.1 },
  score: 0.5,
  ...over,
});

describe('upsertScenarioGaps batch safety + reopen (F1, F2)', () => {
  test('a batch with a duplicate (detector, key) writes one row', async () => {
    await gaps.upsertScenarioGaps(db, 1, [scoredGap({ score: 0.2 }), scoredGap({ score: 0.9 })], {});
    const rows = await db.select().from(schema.scenarioGaps);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(0.9); // highest-scoring row survived the dedupe
  });

  test('a closed gap detected again reopens; a dismissed one keeps its verdict', async () => {
    await gaps.upsertScenarioGaps(db, 1, [scoredGap()], {});
    await db
      .update(schema.scenarioGaps)
      .set({ status: 'closed', closedAt: new Date(), closedByRunId: 7 })
      .where(eq(schema.scenarioGaps.key, 'route:GET /api/cart'));
    // A second, dismissed gap must keep its verdict across a redetect.
    await gaps.upsertScenarioGaps(db, 1, [scoredGap({ key: 'route:GET /api/other' })], {});
    await db
      .update(schema.scenarioGaps)
      .set({ status: 'dismissed', dismissReason: 'wrong' })
      .where(eq(schema.scenarioGaps.key, 'route:GET /api/other'));

    await gaps.upsertScenarioGaps(db, 1, [scoredGap(), scoredGap({ key: 'route:GET /api/other' })], {});

    const [reopened] = await db
      .select()
      .from(schema.scenarioGaps)
      .where(eq(schema.scenarioGaps.key, 'route:GET /api/cart'));
    expect(reopened!.status).toBe('open');
    expect(reopened!.closedAt).toBeNull();
    expect(reopened!.closedByRunId).toBeNull();
    const [dismissed] = await db
      .select()
      .from(schema.scenarioGaps)
      .where(eq(schema.scenarioGaps.key, 'route:GET /api/other'));
    expect(dismissed!.status).toBe('dismissed');
  });
});

describe('loadDetectorPrecision — durable, per-gap verdicts (F9)', () => {
  test('an accepted gap that later closes still counts for its detector', async () => {
    await db.insert(schema.scenarioGaps).values({
      projectId: 1,
      detector: 'success-only',
      class: 'blind-spot',
      key: 'GET /a',
      title: 't',
      status: 'closed', // closed after being accepted
      acceptedAt: new Date(),
    });
    const [row] = (await loadDetectorPrecision(db, 1)).filter((r) => r.detector === 'success-only');
    expect(row!.for).toBe(1);
  });

  test('a covered-by credits only the gap it was given on, not every detector on the subject', async () => {
    // Two detectors flag the same subject; only one is marked covered-by.
    await db.insert(schema.scenarioGaps).values([
      {
        projectId: 1,
        detector: 'success-only',
        class: 'blind-spot',
        key: 'GET /api/cart',
        title: 't',
        status: 'open',
        coveredAt: new Date(),
      },
      {
        projectId: 1,
        detector: 'single-covering-test',
        class: 'fragile',
        key: 'route:GET /api/cart',
        title: 't',
        status: 'open',
      },
    ]);
    const result = await loadDetectorPrecision(db, 1);
    expect(result.find((r) => r.detector === 'success-only')!.for).toBe(1);
    // The other detector on the same subject earns no verdict from that covered-by.
    expect(result.find((r) => r.detector === 'single-covering-test')).toBeUndefined();
  });
});

describe('triageGap records the actor (F4)', () => {
  test('the triaging user id is stored on the gap', async () => {
    await db.insert(schema.users).values({ id: 5, username: 'reporter5', password: '', role: 'reporter', name: 'A' });
    await gaps.upsertScenarioGaps(
      db,
      1,
      [scoredGap({ detector: 'success-only', kind: 'gap', class: 'blind-spot', key: 'GET /a' })],
      {},
    );
    const [gap] = await db.select({ id: schema.scenarioGaps.id }).from(schema.scenarioGaps);
    await gaps.triageGap(db, 1, gap!.id, { verb: 'dismiss', reason: 'wrong', triagedByUserId: 5 });
    const [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, gap!.id));
    expect(row!.triagedBy).toBe(5);
  });
});

describe('computeScenarioGaps — trusted reach discounts flaky/quarantined (F7)', () => {
  test('a node reached by one trusted and one quarantined test is still single-covered', async () => {
    await db.insert(schema.testRuns).values({ id: 1, projectId: 1, status: 'passed', startTime: new Date() });
    await db.insert(schema.testCases).values([
      { id: 1, projectId: 1, filePath: 'a.spec.ts', title: 'trusted' },
      { id: 2, projectId: 1, filePath: 'b.spec.ts', title: 'quarantined' },
    ]);
    await db.insert(schema.quarantinedTests).values({ projectId: 1, testCaseId: 2 });
    for (const id of [1, 2]) {
      await db.insert(schema.graphEdges).values({
        projectId: 1,
        fromKind: 'test',
        fromKey: String(id),
        toKind: 'route',
        toKey: 'GET /api/cart',
        kind: 'reaches',
        confidence: 1,
        lastSeenAt: new Date(),
      });
    }
    await db.insert(schema.graphNodes).values({
      projectId: 1,
      kind: 'route',
      key: 'GET /api/cart',
      firstSeenRunId: 1,
      lastSeenRunId: 1,
      lastSeenAt: new Date(),
    });

    await gaps.computeScenarioGaps(db, 1);
    const list = await gaps.listScenarioGaps(db, 1, { detector: 'single-covering-test' });
    // Only the trusted test counts, so the route reads as single-covered.
    const gap = list.find((r) => r.subject.key === 'GET /api/cart');
    expect(gap).toBeTruthy();
    expect(gap!.testCaseId).toBe(1);
  });
});

describe('draftScenario does not leak another project’s test (F3)', () => {
  test('a gap testCaseId from another project is not loaded as the nearest test', async () => {
    // Project 2 owns a secret-titled test; project 1's gap points at its id.
    await db.insert(schema.projects).values({ id: 2, name: 'other' });
    await db
      .insert(schema.testCases)
      .values({ id: 99, projectId: 2, title: 'SECRET project-B test', filePath: 'secret/b.spec.ts' });
    await db.insert(schema.scenarioGaps).values({
      projectId: 1,
      detector: 'success-only',
      class: 'blind-spot',
      key: 'GET /api/cart',
      title: 'gap',
      status: 'open',
      testCaseId: 99, // a cross-project id
    });
    const [gap] = await db.select({ id: schema.scenarioGaps.id }).from(schema.scenarioGaps);
    const draft = await gaps.draftScenario(db, 1, gap!.id);
    expect(draft).not.toBeNull();
    expect(draft!.text).not.toContain('SECRET');
    expect(draft!.text).not.toContain('secret/b.spec.ts');
    expect(draft!.nearestTest).toBeNull();
  });
});
