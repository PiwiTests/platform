import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';
import { pageNodeKey, collectOwnOrigins, isOwnOriginRequest } from '../../shared/graph';

delete process.env.PIWI_DATABASE_URL;
const {
  collectRunGraphReaches,
  collectPageInventories,
  ingestRunGraph,
  pruneChangesEdges,
  pruneStaleBranchGraphRows,
  pruneStaleCanonicalNodes,
  deleteBranchGraphRows,
} = await import('../../server/utils/graph-ingest');

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'graph-project' });
});

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('pageNodeKey', () => {
  test('collapses numeric ids so two order pages are one node', () => {
    expect(pageNodeKey('/orders/123')).toBe('/orders/:id');
    expect(pageNodeKey('/orders/456')).toBe('/orders/:id');
    expect(pageNodeKey('/orders/123')).toBe(pageNodeKey('/orders/456'));
  });

  test('drops the host, query and fragment — a page is its path pattern', () => {
    expect(pageNodeKey('https://staging.example.com/orders/9#tab')).toBe('/orders/:id');
    expect(pageNodeKey('https://prod.example.com/orders/9?ref=x')).toBe('/orders/:id');
  });
});

describe('own-origin route filtering', () => {
  test('collectOwnOrigins reduces base URLs and the allowlist to origins', () => {
    const origins = collectOwnOrigins(['https://app.test/checkout'], ['https://api.app.test']);
    expect([...origins].sort()).toEqual(['https://api.app.test', 'https://app.test']);
  });

  test('isOwnOriginRequest keeps own origins and drops third parties', () => {
    const origins = collectOwnOrigins(['https://app.test'], []);
    expect(isOwnOriginRequest('https://app.test/api/cart', origins)).toBe(true);
    expect(isOwnOriginRequest('https://cdn.vendor.com/lib.js', origins)).toBe(false);
    // With no known origin the caller cannot tell own from third-party, so keeps all.
    expect(isOwnOriginRequest('https://cdn.vendor.com/lib.js', new Set())).toBe(true);
  });

  test('third-party beacons and CDN assets never become route nodes', async () => {
    const origins = collectOwnOrigins(['https://app.test'], []);
    const reaches = collectRunGraphReaches(
      [{ testCaseId: 5, pageState: { url: 'https://app.test/checkout' } }],
      [
        {
          items: [
            { method: 'get', normalizedUrl: '/api/cart', status: 200, url: 'https://app.test/api/cart' },
            { method: 'post', normalizedUrl: '/collect', status: 204, url: 'https://analytics.beacon.io/collect' },
            { method: 'get', normalizedUrl: '/lib.js', status: 200, url: 'https://cdn.vendor.com/lib.js' },
          ],
        },
      ],
      { origins },
    );
    expect(reaches[0]!.routes.map((r) => r.normalizedUrl)).toEqual(['/api/cart']);

    await ingestRunGraph(db, 1, 1, reaches);
    const routeNodes = await db
      .select()
      .from(schema.graphNodes)
      .where(and(eq(schema.graphNodes.projectId, 1), eq(schema.graphNodes.kind, 'route')));
    expect(routeNodes.map((n) => n.key)).toEqual(['GET /api/cart']);
  });
});

describe('branch tagging', () => {
  test('a default-branch run writes canonical rows and a PR run writes branch-tagged rows', async () => {
    const reach = [{ testCaseId: 5, routes: [{ method: 'GET', normalizedUrl: '/api/cart', status: 200 }], pages: [] }];
    await ingestRunGraph(db, 1, 1, reach); // canonical (branch null)
    await ingestRunGraph(
      db,
      1,
      2,
      [{ testCaseId: 6, routes: [{ method: 'GET', normalizedUrl: '/api/new', status: 200 }], pages: [] }],
      { branch: 'pr-7' },
    );

    const canonical = await db
      .select()
      .from(schema.graphNodes)
      .where(and(eq(schema.graphNodes.projectId, 1), isNull(schema.graphNodes.branch)));
    expect(canonical.map((n) => n.key)).toEqual(['GET /api/cart']);

    const tagged = await db
      .select()
      .from(schema.graphNodes)
      .where(and(eq(schema.graphNodes.projectId, 1), eq(schema.graphNodes.branch, 'pr-7')));
    expect(tagged.map((n) => n.key)).toEqual(['GET /api/new']);

    // deleteBranchGraphRows drops only the branch's rows, leaving canonical intact.
    await deleteBranchGraphRows(db, 1, 'pr-7');
    const afterCanonical = await db.select().from(schema.graphNodes).where(eq(schema.graphNodes.projectId, 1));
    expect(afterCanonical.map((n) => n.key)).toEqual(['GET /api/cart']);
  });

  test('the same key on canonical and a branch are two distinct rows', async () => {
    const reach = [{ testCaseId: 5, routes: [{ method: 'GET', normalizedUrl: '/api/cart', status: 200 }], pages: [] }];
    await ingestRunGraph(db, 1, 1, reach);
    await ingestRunGraph(db, 1, 2, reach, { branch: 'pr-7' });
    const rows = await db
      .select()
      .from(schema.graphNodes)
      .where(and(eq(schema.graphNodes.projectId, 1), eq(schema.graphNodes.kind, 'route')));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.branch).sort()).toEqual([null, 'pr-7']);
  });
});

describe('graph pruning', () => {
  test('pruneChangesEdges drops changes edges older than ninety days, keeps recent and other kinds', async () => {
    await db.insert(schema.graphEdges).values([
      {
        projectId: 1,
        fromKind: 'commit',
        fromKey: 'old',
        toKind: 'file',
        toKey: 'a.ts',
        kind: 'changes',
        lastSeenAt: daysAgo(100),
      },
      {
        projectId: 1,
        fromKind: 'commit',
        fromKey: 'new',
        toKind: 'file',
        toKey: 'b.ts',
        kind: 'changes',
        lastSeenAt: daysAgo(10),
      },
      {
        projectId: 1,
        fromKind: 'test',
        fromKey: '1',
        toKind: 'route',
        toKey: 'GET /x',
        kind: 'reaches',
        lastSeenAt: daysAgo(400),
      },
    ]);
    const removed = await pruneChangesEdges(db);
    expect(removed).toBe(1);
    const left = await db.select().from(schema.graphEdges).where(eq(schema.graphEdges.projectId, 1));
    expect(left.map((e) => e.fromKey).sort()).toEqual(['1', 'new']);
  });

  test('pruneStaleBranchGraphRows drops branch-tagged rows unseen for thirty days, keeps canonical', async () => {
    await db.insert(schema.graphNodes).values([
      { projectId: 1, kind: 'route', key: 'GET /canon', lastSeenAt: daysAgo(400) },
      { projectId: 1, kind: 'route', key: 'GET /stale', branch: 'pr-1', lastSeenAt: daysAgo(40) },
      { projectId: 1, kind: 'route', key: 'GET /fresh', branch: 'pr-2', lastSeenAt: daysAgo(5) },
    ]);
    const removed = await pruneStaleBranchGraphRows(db);
    expect(removed).toBe(1);
    const left = await db.select().from(schema.graphNodes).where(eq(schema.graphNodes.projectId, 1));
    expect(left.map((n) => n.key).sort()).toEqual(['GET /canon', 'GET /fresh']);
  });

  test('pruneStaleCanonicalNodes soft-deletes a stale node and its edges, keeping an open-gap node', async () => {
    // Thirty-one runs, so the thirty-run window floor is run #2.
    for (let i = 1; i <= 31; i++) {
      await db.insert(schema.testRuns).values({ id: i, projectId: 1, status: 'passed', startTime: new Date(i) });
    }
    await db.insert(schema.graphNodes).values([
      { projectId: 1, kind: 'route', key: 'GET /gone', firstSeenRunId: 1, lastSeenRunId: 1, lastSeenAt: daysAgo(1) },
      { projectId: 1, kind: 'route', key: 'GET /kept', firstSeenRunId: 1, lastSeenRunId: 1, lastSeenAt: daysAgo(1) },
      {
        projectId: 1,
        kind: 'route',
        key: 'GET /recent',
        firstSeenRunId: 31,
        lastSeenRunId: 31,
        lastSeenAt: daysAgo(1),
      },
    ]);
    // A reaches edge into the stale node is deleted with it.
    await db.insert(schema.graphEdges).values({
      projectId: 1,
      fromKind: 'test',
      fromKey: '9',
      toKind: 'route',
      toKey: 'GET /gone',
      kind: 'reaches',
      lastSeenAt: daysAgo(1),
    });
    // An open surface-drift gap protects its node from removal.
    await db.insert(schema.scenarioGaps).values({
      projectId: 1,
      detector: 'surface-drift',
      class: 'blind-spot',
      key: 'route:GET /kept',
      title: 'new route',
      status: 'open',
    });

    const removed = await pruneStaleCanonicalNodes(db);
    expect(removed).toBe(1);

    // The row is kept (soft delete) but stamped pruned_at; the others stay active.
    const active = await db
      .select()
      .from(schema.graphNodes)
      .where(and(eq(schema.graphNodes.projectId, 1), isNull(schema.graphNodes.prunedAt)));
    expect(active.map((n) => n.key).sort()).toEqual(['GET /kept', 'GET /recent']);
    const gone = await db.select().from(schema.graphNodes).where(eq(schema.graphNodes.key, 'GET /gone'));
    expect(gone[0]!.prunedAt).not.toBeNull();
    // Its reaches edge is gone.
    const edges = await db.select().from(schema.graphEdges).where(eq(schema.graphEdges.projectId, 1));
    expect(edges).toHaveLength(0);
  });

  test('a pruned node reappearing keeps its first-seen run and clears pruned_at', async () => {
    await db.insert(schema.graphNodes).values({
      projectId: 1,
      kind: 'route',
      key: 'GET /back',
      firstSeenRunId: 3,
      lastSeenRunId: 3,
      lastSeenAt: daysAgo(60),
      prunedAt: daysAgo(1),
    });

    await ingestRunGraph(db, 1, 40, [
      { testCaseId: 5, routes: [{ method: 'GET', normalizedUrl: '/back', status: 200 }], pages: [] },
    ]);

    const [node] = await db
      .select()
      .from(schema.graphNodes)
      .where(and(eq(schema.graphNodes.projectId, 1), eq(schema.graphNodes.key, 'GET /back')));
    expect(node!.firstSeenRunId).toBe(3);
    expect(node!.lastSeenRunId).toBe(40);
    expect(node!.prunedAt).toBeNull();
  });
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

describe('collectPageInventories', () => {
  const origins = new Set(['https://app.example.com']);

  test('attributes each request to the page current when it started (two-page test)', () => {
    // A test that signs in on /login then lands on /orders. Each page carries its
    // settle time; the login POST fired while /login was current, the orders
    // fetch after /orders settled.
    const pages = collectPageInventories(
      [
        {
          pageInventory: [
            { url: 'https://app.example.com/login', controls: [], links: [], capturedAt: 1000 },
            { url: 'https://app.example.com/orders', controls: [], links: [], capturedAt: 2000 },
          ],
          networkItems: [
            {
              method: 'POST',
              normalizedUrl: '/api/login',
              url: 'https://app.example.com/api/login',
              resourceType: 'fetch',
              startTime: 1500,
            },
            {
              method: 'GET',
              normalizedUrl: '/api/orders',
              url: 'https://app.example.com/api/orders',
              resourceType: 'fetch',
              startTime: 2500,
            },
          ],
        },
      ],
      origins,
    );
    const login = pages.find((p) => p.pageKey === '/login');
    const orders = pages.find((p) => p.pageKey === '/orders');
    // The login POST attaches to /login, not to the end-of-test /orders page.
    expect(login?.loadsRouteKeys).toEqual(['POST /api/login']);
    expect(orders?.loadsRouteKeys).toEqual(['GET /api/orders']);
  });

  test('writes no loads edge when a request cannot be placed', () => {
    const pages = collectPageInventories(
      [
        {
          pageInventory: [{ url: 'https://app.example.com/orders', controls: [], links: [], capturedAt: 2000 }],
          networkItems: [
            // Before the first settle — cannot be attributed.
            {
              method: 'GET',
              normalizedUrl: '/api/early',
              url: 'https://app.example.com/api/early',
              resourceType: 'document',
              startTime: 500,
            },
            // No start time — cannot be attributed.
            {
              method: 'GET',
              normalizedUrl: '/api/untimed',
              url: 'https://app.example.com/api/untimed',
              resourceType: 'fetch',
              startTime: null,
            },
          ],
        },
      ],
      origins,
    );
    expect(pages.find((p) => p.pageKey === '/orders')?.loadsRouteKeys).toEqual([]);
  });
});
