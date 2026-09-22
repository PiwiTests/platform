import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const {
  triageGap,
  listAcceptedUnwritten,
  listScenarioGaps,
  computeScenarioGaps,
  reopenExpiredSnoozes,
  upsertScenarioGaps,
} = await import('../../shared/handlers/scenario-gaps');
const { getFeatureGraph } = await import('../../server/utils/feature-graph');

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'gaps-project' });
});

async function seedGap(overrides: Partial<typeof schema.scenarioGaps.$inferInsert> = {}) {
  await upsertScenarioGaps(
    db,
    1,
    [
      {
        detector: 'success-only',
        kind: 'gap',
        class: 'blind-spot',
        key: 'GET /api/cart',
        title: 'GET /api/cart: no error path under test',
        evidence: ['seen'],
        confidence: 0.5,
        factors: { churn: 0.5, age: 0.5, escapeHistory: 0.1, priority: 0.4 },
        score: 0.01,
      },
    ],
    {},
  );
  const [row] = await db.select({ id: schema.scenarioGaps.id }).from(schema.scenarioGaps).limit(1);
  if (Object.keys(overrides).length > 0) {
    await db.update(schema.scenarioGaps).set(overrides).where(eq(schema.scenarioGaps.id, row!.id));
  }
  return row!.id;
}

describe('triageGap', () => {
  test('accept marks accepted and stamps acceptedAt', async () => {
    const id = await seedGap();
    const result = await triageGap(db, 1, id, { verb: 'accept' });
    expect(result).toEqual({ status: 'accepted' });
    const [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, id));
    expect(row!.status).toBe('accepted');
    expect(row!.acceptedAt).not.toBeNull();
  });

  test('snooze 1-week sets a future wake time', async () => {
    const id = await seedGap();
    await triageGap(db, 1, id, { verb: 'snooze', snooze: '1-week' });
    const [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, id));
    expect(row!.status).toBe('snoozed');
    expect(row!.snoozedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  test('dismiss records the reason', async () => {
    const id = await seedGap();
    await triageGap(db, 1, id, { verb: 'dismiss', reason: 'not-worth-testing' });
    const [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, id));
    expect(row!.status).toBe('dismissed');
    expect(row!.dismissReason).toBe('not-worth-testing');
  });

  test('covered-by writes a manual reaches edge without dismissing', async () => {
    const id = await seedGap();
    await db.insert(schema.testCases).values({ id: 42, projectId: 1, title: 'covers cart', filePath: 'cart.spec.ts' });
    await triageGap(db, 1, id, { verb: 'covered-by', coveringTestCaseId: 42 });
    const [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, id));
    expect(row!.status).toBe('open');
    const edges = await db
      .select()
      .from(schema.graphEdges)
      .where(and(eq(schema.graphEdges.kind, 'reaches'), eq(schema.graphEdges.origin, 'manual')));
    expect(edges).toHaveLength(1);
    expect(edges[0]!.fromKey).toBe('42');
    expect(edges[0]!.toKey).toBe('GET /api/cart');
  });

  test('a covering test from another project is rejected and writes no edge', async () => {
    const id = await seedGap();
    await db.insert(schema.projects).values({ id: 2, name: 'other-project' });
    await db
      .insert(schema.testCases)
      .values({ id: 77, projectId: 2, title: 'someone else', filePath: 'other.spec.ts' });
    const result = await triageGap(db, 1, id, { verb: 'covered-by', coveringTestCaseId: 77 });
    expect(result).toEqual({ error: 'covering-test-not-found' });
    const edges = await db.select().from(schema.graphEdges).where(eq(schema.graphEdges.kind, 'reaches'));
    expect(edges).toHaveLength(0);
    const [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, id));
    expect(row!.status).toBe('open'); // unchanged
  });

  test('a missing gap returns a gap-not-found error', async () => {
    expect(await triageGap(db, 1, 999, { verb: 'accept' })).toEqual({ error: 'gap-not-found' });
  });
});

describe('reopenExpiredSnoozes / listAcceptedUnwritten', () => {
  test('an expired snooze reopens; a future one does not', async () => {
    const past = await seedGap({ status: 'snoozed', snoozedUntil: new Date(Date.now() - 1000) });
    const future = await seedGapSecond({ status: 'snoozed', snoozedUntil: new Date(Date.now() + 100000) });
    const woken = await reopenExpiredSnoozes(db, 1);
    expect(woken).toBe(1);
    const [p] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, past));
    const [f] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, future));
    expect(p!.status).toBe('open');
    expect(f!.status).toBe('snoozed');
  });

  test('accepted-but-unwritten older than a week lists', async () => {
    await seedGap({ status: 'accepted', acceptedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
    const rows = await listAcceptedUnwritten(db, [1]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('accepted');
  });

  test('an accepted gap whose subject gained a trusted edge drops out of the queue', async () => {
    await seedGap({ status: 'accepted', acceptedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
    // A canonical reaches edge to the gap's subject node means the test was written.
    await db.insert(schema.graphEdges).values({
      projectId: 1,
      fromKind: 'test',
      fromKey: '9',
      toKind: 'route',
      toKey: 'GET /api/cart',
      kind: 'reaches',
      branch: null,
      origin: 'manual',
      confidence: 1,
      lastSeenAt: new Date(),
    });
    expect(await listAcceptedUnwritten(db, [1])).toHaveLength(0);
  });

  test('listScenarioGaps reopens an expired snooze before listing', async () => {
    await seedGap({ status: 'snoozed', snoozedUntil: new Date(Date.now() - 1000) });
    const open = await listScenarioGaps(db, 1, {}); // defaults to open only
    expect(open.map((g) => g.key)).toContain('GET /api/cart');
  });
});

describe('computeScenarioGaps snooze + accepted lifecycle', () => {
  test('an "until the node changes" snooze reopens once the node is seen in a later run', async () => {
    // A finding on a route node last seen in run 5.
    await db.insert(schema.graphNodes).values({
      projectId: 1,
      kind: 'route',
      key: 'GET /api/cart',
      origin: 'observed',
      lastSeenRunId: 5,
      lastSeenAt: new Date(),
    });
    await upsertScenarioGaps(
      db,
      1,
      [
        {
          detector: 'not-handled', // not in the close list, so it survives the recompute
          kind: 'finding',
          class: 'unhandled',
          key: 'route:GET /api/cart',
          title: 'GET /api/cart: unhandled failure',
          evidence: ['x'],
          confidence: 1,
          factors: null as never,
          score: 0.5,
        },
      ],
      {},
    );
    const [gap] = await db
      .select({ id: schema.scenarioGaps.id })
      .from(schema.scenarioGaps)
      .where(eq(schema.scenarioGaps.detector, 'not-handled'));
    await triageGap(db, 1, gap!.id, { verb: 'snooze', snooze: 'until-node-changes' });
    let [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, gap!.id));
    expect(row!.status).toBe('snoozed');
    expect(row!.snoozedAtRunId).toBe(5);

    // The node is exercised again in a later run.
    await db
      .update(schema.graphNodes)
      .set({ lastSeenRunId: 6 })
      .where(and(eq(schema.graphNodes.kind, 'route'), eq(schema.graphNodes.key, 'GET /api/cart')));
    await computeScenarioGaps(db, 1);
    [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.id, gap!.id));
    expect(row!.status).toBe('open');
    expect(row!.snoozedAtRunId).toBeNull();
  });

  test('an accepted gap no longer detected closes so the inbox drains', async () => {
    await seedGap({ status: 'accepted', acceptedAt: new Date(Date.now() - 1000) });
    // No route stats seed the success-only detector, so the gap is not re-detected.
    await computeScenarioGaps(db, 1);
    const [row] = await db.select().from(schema.scenarioGaps).where(eq(schema.scenarioGaps.detector, 'success-only'));
    expect(row!.status).toBe('closed');
  });
});

// A second distinct gap (different detector/key) for the snooze test.
async function seedGapSecond(overrides: Partial<typeof schema.scenarioGaps.$inferInsert>) {
  await upsertScenarioGaps(
    db,
    1,
    [
      {
        detector: 'single-covering-test',
        kind: 'gap',
        class: 'fragile',
        key: 'route:POST /api/orders',
        title: 'Only one test reaches route POST /api/orders',
        evidence: ['x'],
        confidence: 0.5,
        factors: { churn: 0.1, age: 0.1, escapeHistory: 0.1, priority: 0.1 },
        score: 0.001,
      },
    ],
    {},
  );
  const [row] = await db
    .select({ id: schema.scenarioGaps.id })
    .from(schema.scenarioGaps)
    .where(eq(schema.scenarioGaps.detector, 'single-covering-test'));
  await db.update(schema.scenarioGaps).set(overrides).where(eq(schema.scenarioGaps.id, row!.id));
  return row!.id;
}

describe('getFeatureGraph', () => {
  beforeEach(async () => {
    const base = {
      projectId: 1,
      branch: null as string | null,
      confidence: 1,
      origin: 'observed' as const,
      lastSeenAt: new Date(),
    };
    await db.insert(schema.graphNodes).values([
      { projectId: 1, kind: 'route', key: 'POST /api/orders', origin: 'observed', lastSeenAt: new Date() },
      { projectId: 1, kind: 'handler', key: 'src/api/orders.post.ts', origin: 'observed', lastSeenAt: new Date() },
      { projectId: 1, kind: 'dependency', key: 'payments-svc', origin: 'observed', lastSeenAt: new Date() },
    ]);
    await db.insert(schema.graphEdges).values([
      { ...base, fromKind: 'test', fromKey: '1', toKind: 'route', toKey: 'POST /api/orders', kind: 'reaches' },
      {
        ...base,
        fromKind: 'route',
        fromKey: 'POST /api/orders',
        toKind: 'handler',
        toKey: 'src/api/orders.post.ts',
        kind: 'handled-by',
        confidence: null,
      },
      {
        ...base,
        fromKind: 'handler',
        fromKey: 'src/api/orders.post.ts',
        toKind: 'dependency',
        toKey: 'payments-svc',
        kind: 'calls',
        confidence: null,
      },
    ]);
    await db
      .insert(schema.testCases)
      .values({ id: 1, projectId: 1, title: 'checkout happy path', filePath: 'a.spec.ts' });
  });

  test('walks outward to the requested depth and attaches tests', async () => {
    const graph = await getFeatureGraph(db, 1, { kind: 'route', key: 'POST /api/orders' }, 2);
    const keys = graph.nodes.map((n) => `${n.kind}:${n.key}`);
    expect(keys).toContain('route:POST /api/orders');
    expect(keys).toContain('handler:src/api/orders.post.ts');
    expect(keys).toContain('dependency:payments-svc');
    const route = graph.nodes.find((n) => n.kind === 'route');
    expect(route!.tests.map((t) => t.title)).toContain('checkout happy path');
  });

  test('depth 1 stops at the immediate neighbors', async () => {
    const graph = await getFeatureGraph(db, 1, { kind: 'route', key: 'POST /api/orders' }, 1);
    const keys = graph.nodes.map((n) => `${n.kind}:${n.key}`);
    expect(keys).toContain('handler:src/api/orders.post.ts');
    expect(keys).not.toContain('dependency:payments-svc');
  });

  test('depth is capped at six', async () => {
    const graph = await getFeatureGraph(db, 1, { kind: 'route', key: 'POST /api/orders' }, 99);
    expect(graph.depth).toBe(6);
  });
});
