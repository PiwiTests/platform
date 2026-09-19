import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { triageGap, listScenarioGaps, listAcceptedUnwritten, reopenExpiredSnoozes, upsertScenarioGaps } =
  await import('../../shared/handlers/scenario-gaps');
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
    expect(result?.status).toBe('accepted');
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

  test('a missing gap returns null', async () => {
    expect(await triageGap(db, 1, 999, { verb: 'accept' })).toBeNull();
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
