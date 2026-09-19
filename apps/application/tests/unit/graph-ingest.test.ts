import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { collectRunGraphReaches, ingestRunGraph } = await import('../../server/utils/graph-ingest');

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'graph-project' });
});

describe('collectRunGraphReaches', () => {
  test('folds a test case that ran twice into one reach with a union of routes', () => {
    const reaches = collectRunGraphReaches(
      [
        { testCaseId: 5, pageState: { url: 'https://app.test/checkout?x=1' } },
        { testCaseId: 5, pageState: null },
      ],
      [
        { items: [{ method: 'get', normalizedUrl: '/api/cart', status: 200 }] },
        { items: [{ method: 'post', normalizedUrl: '/api/orders', status: 201 }] },
      ],
    );
    expect(reaches).toHaveLength(1);
    expect(reaches[0]!.testCaseId).toBe(5);
    expect(reaches[0]!.routes).toHaveLength(2);
    expect(reaches[0]!.pages).toEqual(['https://app.test/checkout?x=1']);
  });
});

describe('ingestRunGraph', () => {
  test('upserts route and page nodes and reaches edges, and bumps last-seen on re-ingest', async () => {
    const reach = [
      {
        testCaseId: 5,
        routes: [{ method: 'POST', normalizedUrl: '/api/orders', status: 201 }],
        pages: ['https://app.test/checkout'],
      },
    ];
    await ingestRunGraph(db, 1, 1, reach);

    const nodes = await db.select().from(schema.graphNodes).where(eq(schema.graphNodes.projectId, 1));
    expect(nodes.map((n) => `${n.kind}:${n.key}`).sort()).toEqual(['page:/checkout', 'route:POST /api/orders']);
    expect(nodes.every((n) => n.firstSeenRunId === 1)).toBe(true);

    const edges = await db
      .select()
      .from(schema.graphEdges)
      .where(and(eq(schema.graphEdges.projectId, 1), eq(schema.graphEdges.kind, 'reaches')));
    expect(edges).toHaveLength(2);

    // Re-ingest under a later run keeps first-seen but advances last-seen.
    await ingestRunGraph(db, 1, 2, reach);
    const after = await db.select().from(schema.graphNodes).where(eq(schema.graphNodes.projectId, 1));
    expect(after).toHaveLength(2);
    expect(after.every((n) => n.firstSeenRunId === 1 && n.lastSeenRunId === 2)).toBe(true);
  });
});
