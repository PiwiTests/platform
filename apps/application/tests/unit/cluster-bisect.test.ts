import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';
import { apiError } from '../../server/utils/api-error';
import { openTempDb, type TempDb } from './temp-db';
import type { McpContext } from '../../server/utils/mcp/tools';
import type { User } from '../../server/database/schema';
import { InstanceRole, ProjectRole, buildAccessSummary } from '#shared/permissions';
import { recordRouteMeta, type RouteAccessState, type RouteCaller } from './route-access';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load. A team instance has no
// desktop token.
delete process.env.PIWI_DATABASE_URL;
delete process.env.PIWI_DESKTOP_TOKEN;

const state = vi.hoisted(() => ({ db: null, caller: null, routePermission: [] }) as RouteAccessState);
vi.mock('../../server/database', () => ({ getDatabase: async () => state.db }));
// Signed in as `state.caller`, held to the permission the route declares, as
// requireAuth and the project access helpers hold a request to it.
vi.mock('../../server/utils/auth', async () => (await import('./route-access')).authMock(state));
vi.mock('../../server/utils/project-access', async (importOriginal) =>
  (await import('./route-access')).projectAccessMock(state, await importOriginal<object>()),
);

interface FakeEvent {
  body?: unknown;
  params?: Record<string, string>;
}

vi.stubGlobal('defineRouteMeta', (meta: { openAPI?: Record<string, unknown> }) => recordRouteMeta(state, meta));
vi.stubGlobal('eventHandler', (handler: unknown) => handler);
vi.stubGlobal('readBody', async (event: FakeEvent) => event.body);
vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => event.params?.[name]);
vi.stubGlobal('apiError', apiError);

type Handler = (event: FakeEvent) => Promise<{ ok: boolean; bisectedCommit: unknown }>;
const recordBisect = (await import('../../server/api/failure-clusters/[id]/bisect.post')).default as unknown as Handler;
const { MCP_TOOLS } = await import('../../server/utils/mcp/tools');
const { buildExecutionReproduce } = await import('#shared/handlers/reproduce');
const setClusterBisect = MCP_TOOLS.find((t) => t.name === 'set_cluster_bisect')!.handler;

const asUser = (id: number, role: string, name: string) => ({ id, role, name, username: name.toLowerCase() }) as User;
const reporter = asUser(2, 'reporter', 'Robin');
const viewer = asUser(3, 'user', 'Sam');
// The same people on the routes: Robin a Maintainer and Sam a Viewer of project 1.
const onProject = (user: User, projectId: number, role: ProjectRole): RouteCaller => ({
  user,
  access: buildAccessSummary(InstanceRole.MEMBER, [{ projectId, role }]),
});
const robin = onProject(reporter, 1, ProjectRole.MAINTAINER);
const sam = onProject(viewer, 1, ProjectRole.VIEWER);
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

let db: TempDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await openTempDb());
  state.db = db;
  state.caller = robin;
  await db.insert(schema.users).values([
    { id: 2, username: 'robin', password: '', role: InstanceRole.MEMBER, name: 'Robin' },
    { id: 3, username: 'sam', password: '', role: InstanceRole.MEMBER, name: 'Sam' },
  ]);
  await db.insert(schema.projects).values([
    { id: 1, name: 'shop' },
    { id: 2, name: 'other' },
  ]);
  await db.insert(schema.roleBindings).values([
    { userId: 2, projectId: 1, role: ProjectRole.MAINTAINER },
    { userId: 3, projectId: 1, role: ProjectRole.VIEWER },
  ]);
  await db.insert(schema.testRuns).values([
    { id: 1, projectId: 1, status: 'failed', startTime: new Date() },
    { id: 2, projectId: 2, status: 'failed', startTime: new Date() },
  ]);
  const cluster = (id: number, projectId: number) => ({
    id,
    projectId,
    fingerprint: `fp-${id}`,
    signature: `Error ${id}`,
    errorType: 'assertion',
    firstSeenRunId: projectId,
    lastSeenRunId: projectId,
    occurrences: 1,
  });
  await db.insert(schema.failureClusters).values([cluster(1, 1), cluster(2, 2)]);
  await db
    .insert(schema.testCases)
    .values({ id: 1, projectId: 1, filePath: 'tests/cart.spec.ts', title: 'applies the coupon' });
  await db
    .insert(schema.testRunsCases)
    .values({ id: 501, testRunId: 1, testCaseId: 1, status: 'failed', failureClusterId: 1 });
});

afterEach(async () => {
  await close();
});

async function storedBisect(id: number): Promise<unknown> {
  const [row] = await db
    .select({ bisectResult: schema.failureClusters.bisectResult })
    .from(schema.failureClusters)
    .where(eq(schema.failureClusters.id, id));
  return row?.bisectResult ?? null;
}

describe('POST /api/failure-clusters/:id/bisect', () => {
  test('records the first bad commit on a server with no desktop token', async () => {
    const result = await recordBisect({
      params: { id: '1' },
      body: { sha: SHA.toUpperCase(), subject: ' Drop the cart cache ', author: 'Ada', date: '2026-10-01T10:00:00Z' },
    });
    const expected = {
      sha: SHA,
      subject: 'Drop the cart cache',
      author: 'Ada',
      date: '2026-10-01T10:00:00Z',
      commitUrl: null,
    };
    expect(result).toEqual({ ok: true, bisectedCommit: expected });
    expect(await storedBisect(1)).toEqual(expected);
    // The cluster's failures now name it in their reproduction and fix plan.
    expect((await buildExecutionReproduce(db, 501))?.desktop.bisectedCommit).toEqual(expected);
  });

  test('needs run:control on the cluster’s project', async () => {
    expect(state.routePermission).toEqual(['run:control']);
    state.caller = sam;
    await expect(recordBisect({ params: { id: '1' }, body: { sha: SHA } })).rejects.toMatchObject({
      statusCode: 403,
    });
    // A Maintainer of another project only.
    state.caller = onProject(reporter, 2, ProjectRole.MAINTAINER);
    await expect(recordBisect({ params: { id: '1' }, body: { sha: SHA } })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await storedBisect(1)).toBeNull();
  });

  test("refuses a cluster of a project the caller holds no role on, and a SHA that isn't one", async () => {
    await expect(recordBisect({ params: { id: '2' }, body: { sha: SHA } })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(recordBisect({ params: { id: '1' }, body: { sha: 'HEAD~1' } })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(recordBisect({ params: { id: '99' }, body: { sha: SHA } })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(await storedBisect(2)).toBeNull();
  });
});

describe('set_cluster_bisect', () => {
  const ctx = (caller: RouteCaller): McpContext => ({ ...caller, scope: new Set([1]) });

  test('records the commit through the same handler as the route', async () => {
    const result = await setClusterBisect(
      db,
      { clusterId: 1, sha: SHA.slice(0, 12), subject: 'Drop the cache' },
      ctx(robin),
    );
    expect(result).toEqual({ clusterId: 1, sha: SHA.slice(0, 12), subject: 'Drop the cache' });
    expect(await storedBisect(1)).toEqual({
      sha: SHA.slice(0, 12),
      subject: 'Drop the cache',
      author: null,
      date: null,
      commitUrl: null,
    });
  });

  test('refuses a read-only key, a cluster out of scope and an invalid SHA; answers null for a missing cluster', async () => {
    await expect(setClusterBisect(db, { clusterId: 1, sha: SHA }, ctx(sam))).rejects.toThrow(
      'This action requires the run:control permission on project 1',
    );
    await expect(setClusterBisect(db, { clusterId: 2, sha: SHA }, ctx(robin))).rejects.toThrow(
      'No access to project 2',
    );
    await expect(setClusterBisect(db, { clusterId: 1, sha: 'main' }, ctx(robin))).rejects.toThrow(
      'A valid commit SHA is required',
    );
    expect(await setClusterBisect(db, { clusterId: 99, sha: SHA }, ctx(robin))).toBeNull();
    expect(await storedBisect(1)).toBeNull();
  });
});
