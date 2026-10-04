import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as schema from '../../server/database/schema.sqlite';
import { apiError } from '../../server/utils/api-error';
import { openTempDb, type TempDb } from './temp-db';
import type { McpContext } from '../../server/utils/mcp/tools';
import type { User } from '../../server/database/schema';
import type { Role } from '#shared/types';

/**
 * Dismissing a quarantine proposal or a proposed release: the REST route the
 * dashboard calls, the quarantine list marking what was dismissed, and the MCP
 * tool over the same handler, each recording the proposal's `rejected` outcome.
 */

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load.
delete process.env.PIWI_DATABASE_URL;

const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as unknown,
  routeRoles: null as Role[] | null,
  flaky: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../server/database', () => ({ getDatabase: async () => state.db }));
// Signed in as `state.user`, held to the roles the route declares, as requireAuth holds a key to them.
vi.mock('../../server/utils/auth', () => ({
  requireAuth: async () => {
    const user = state.user as User;
    if (state.routeRoles && !state.routeRoles.includes(user.role as Role)) {
      throw apiError({ statusCode: 403, message: 'Insufficient permissions' });
    }
    return user;
  },
  isAuthEnabled: () => true,
}));
// The flaky analysis behind the quarantine candidates.
vi.mock('#shared/handlers/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#shared/handlers/projects')>()),
  getProjectFlakyTests: async () => state.flaky,
}));

interface FakeEvent {
  body?: unknown;
  params?: Record<string, string>;
  path?: string;
}

vi.stubGlobal('defineRouteMeta', (meta: { openAPI?: { 'x-required-roles'?: Role[] } }) => {
  state.routeRoles = meta.openAPI?.['x-required-roles'] ?? null;
});
vi.stubGlobal('eventHandler', (handler: unknown) => handler);
vi.stubGlobal('readBody', async (event: FakeEvent) => event.body);
vi.stubGlobal('getRouterParam', (event: FakeEvent, name: string) => event.params?.[name]);
vi.stubGlobal('apiError', apiError);

type Handler<T> = (event: FakeEvent) => Promise<T>;

/** A route's handler, called under the roles its meta declares. */
async function loadRoute<T>(path: string): Promise<{ handler: Handler<T>; roles: Role[] | null }> {
  const handler = (await import(path)).default as Handler<T>;
  const roles = state.routeRoles;
  return {
    roles,
    handler: async (event) => {
      state.routeRoles = roles;
      return handler(event);
    },
  };
}

const { handler: dismissRoute, roles: dismissRoles } = await loadRoute<{
  success: boolean;
  proposal: string;
  dismissed: boolean;
}>('../../server/api/projects/[id]/quarantine/[testCaseId]/dismiss.post');
const { handler: listRoute } = await loadRoute<{
  entries: Array<{ testCaseId: number; releaseProposed: boolean; releaseDismissed: boolean }>;
  candidates: Array<{ testCaseId: number; dismissed: boolean }>;
}>('../../server/api/projects/[id]/quarantine.get');
const { MCP_TOOLS } = await import('../../server/utils/mcp/tools');
const { logMcpToolCall } = await import('../../server/utils/mcp/write-log');
const { listOutcomes } = await import('../../server/utils/outcomes');
const { addQuarantine, RELEASE_AFTER_CONSECUTIVE_PASSES } = await import('#shared/handlers/quarantine');
const dismissTool = MCP_TOOLS.find((t) => t.name === 'dismiss_quarantine_proposal')!.handler;

const asUser = (id: number, role: string, name: string) => ({ id, role, name, username: name.toLowerCase() }) as User;
const reporter = asUser(2, 'reporter', 'Robin');
const viewer = asUser(3, 'user', 'Sam');
// The same people over MCP: Robin with an API key, both assigned to project 1 only.
const reporterKey: McpContext = { user: reporter, scope: new Set([1]), apiKeyId: 9 };
const viewerKey: McpContext = { user: viewer, scope: new Set([1]) };
const WRITE_REFUSED = 'This action requires reporter or administrator access';

let db: TempDb;
let close: () => Promise<void>;
let runSeq = 0;

async function insertRun(projectId = 1): Promise<number> {
  const id = ++runSeq;
  await db.insert(schema.testRuns).values({ id, projectId, status: 'passed', startTime: new Date() });
  return id;
}

const flakyTest = (testCaseId: number) => ({
  testCaseId,
  title: `test ${testCaseId}`,
  filePath: 'tests/cart.spec.ts',
  score: 60,
  wastedCiMinutes: 4,
  rootCause: 'timing',
  owner: null,
});

const outcomes = async () =>
  (await listOutcomes(db as never, { kind: 'quarantine-proposal' })).map((o) => ({
    subjectId: o.subjectId,
    key: o.suggestionKey.split(':')[0],
    outcome: o.outcome,
    channel: o.channel,
    userId: o.actorUserId,
    apiKeyId: o.actorApiKeyId,
    details: o.details,
  }));

beforeEach(async () => {
  ({ db, close } = await openTempDb());
  state.db = db;
  state.user = reporter;
  runSeq = 0;
  await db.insert(schema.users).values([
    { id: 2, username: 'robin', password: '', role: 'reporter', name: 'Robin' },
    { id: 3, username: 'sam', password: '', role: 'user', name: 'Sam' },
  ]);
  await db.insert(schema.apiKeys).values({ id: 9, userId: 2, name: 'agent', keyHash: 'h9', keyPrefix: 'abcd1234' });
  await db.insert(schema.projects).values([
    { id: 1, name: 'shop' },
    { id: 2, name: 'other' },
  ]);
  await db.insert(schema.projectAssignments).values([
    { userId: 2, projectId: 1 },
    { userId: 3, projectId: 1 },
  ]);
  await db.insert(schema.testCases).values([
    { id: 1, projectId: 1, filePath: 'tests/cart.spec.ts', title: 'adds an item' },
    { id: 2, projectId: 1, filePath: 'tests/cart.spec.ts', title: 'removes an item' },
    { id: 3, projectId: 1, filePath: 'tests/cart.spec.ts', title: 'applies a coupon' },
    { id: 4, projectId: 2, filePath: 'tests/admin.spec.ts', title: 'signs in' },
  ]);
  // Test 1 is a quarantine candidate; test 2 is quarantined and has earned its release; test 3 is quarantined with no streak.
  state.flaky = [flakyTest(1)];
  await insertRun();
  await addQuarantine(db as never, 1, 2);
  await addQuarantine(db as never, 1, 3);
  for (let i = 0; i < RELEASE_AFTER_CONSECUTIVE_PASSES; i++) {
    const runId = await insertRun();
    await db.insert(schema.testRunsCases).values([
      { testRunId: runId, testCaseId: 2, status: 'passed' },
      { testRunId: runId, testCaseId: 3, status: 'failed' },
    ]);
  }
});

afterEach(async () => {
  await close();
});

describe('POST /api/projects/:id/quarantine/:testCaseId/dismiss', () => {
  test('dismisses a proposed release with a reason, as the signed-in person over the dashboard', async () => {
    const result = await dismissRoute({
      params: { id: '1', testCaseId: '2' },
      body: { proposal: 'release', reason: '  Still fails on staging  ' },
    });
    expect(result).toEqual({ success: true, proposal: 'release', dismissed: true });
    expect(await outcomes()).toEqual([
      {
        subjectId: 2,
        key: 'release',
        outcome: 'rejected',
        channel: 'ui',
        userId: 2,
        apiKeyId: null,
        details: { reason: 'Still fails on staging' },
      },
    ]);
    // Nothing else changes: the test is still quarantined.
    const listed = await listRoute({ params: { id: '1' }, path: '/api/projects/1/quarantine' });
    expect(listed.entries.find((e) => e.testCaseId === 2)).toMatchObject({
      releaseProposed: true,
      releaseDismissed: true,
    });
  });

  test('dismisses a quarantine candidate, once, and the list marks it until a newer run arrives', async () => {
    const dismiss = () => dismissRoute({ params: { id: '1', testCaseId: '1' }, body: { proposal: 'quarantine' } });
    await dismiss();
    await dismiss();
    expect(await outcomes()).toEqual([
      {
        subjectId: 1,
        key: 'quarantine',
        outcome: 'rejected',
        channel: 'ui',
        userId: 2,
        apiKeyId: null,
        details: null,
      },
    ]);
    const list = () => listRoute({ params: { id: '1' }, path: '/api/projects/1/quarantine' });
    expect((await list()).candidates).toMatchObject([{ testCaseId: 1, dismissed: true }]);
    await insertRun();
    expect((await list()).candidates).toMatchObject([{ testCaseId: 1, dismissed: false }]);
  });

  test('is limited to reporters and administrators', async () => {
    expect(dismissRoles).toEqual(['administrator', 'reporter']);
    state.user = viewer;
    await expect(
      dismissRoute({ params: { id: '1', testCaseId: '2' }, body: { proposal: 'release' } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await outcomes()).toEqual([]);
  });

  test('refuses an unknown proposal, a test with no such proposal, and a test of another project', async () => {
    await expect(
      dismissRoute({ params: { id: '1', testCaseId: '2' }, body: { proposal: 'forget' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    // Test 3 has no passing streak, so no release is proposed; test 2 is already quarantined.
    await expect(
      dismissRoute({ params: { id: '1', testCaseId: '3' }, body: { proposal: 'release' } }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'No release proposal for this test' });
    await expect(
      dismissRoute({ params: { id: '1', testCaseId: '2' }, body: { proposal: 'quarantine' } }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'No quarantine proposal for this test' });
    await expect(
      dismissRoute({ params: { id: '1', testCaseId: '4' }, body: { proposal: 'quarantine' } }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Test case not found in this project' });
    // Project 2 is not assigned to Robin.
    await expect(
      dismissRoute({ params: { id: '2', testCaseId: '4' }, body: { proposal: 'quarantine' } }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await outcomes()).toEqual([]);
  });
});

describe('dismiss_quarantine_proposal', () => {
  test('dismisses a candidate as the agent and its key, and logs the call against the test', async () => {
    const args = { projectId: 1, testCaseId: 1, proposal: 'quarantine', reason: 'The fix is in review' };
    const result = await dismissTool(db as never, args, reporterKey);
    expect(result).toEqual({
      projectId: 1,
      testCaseId: 1,
      proposal: 'quarantine',
      dismissed: true,
      reason: 'The fix is in review',
    });
    expect(await outcomes()).toEqual([
      {
        subjectId: 1,
        key: 'quarantine',
        outcome: 'rejected',
        channel: 'mcp',
        userId: 2,
        apiKeyId: 9,
        details: { reason: 'The fix is in review' },
      },
    ]);

    expect(await logMcpToolCall(db as never, reporterKey, 'dismiss_quarantine_proposal', args, 'ok')).toBe(1);
    const [logged] = await db.select().from(schema.mcpToolCalls);
    expect(logged).toMatchObject({
      tool: 'dismiss_quarantine_proposal',
      subjectType: 'test-case',
      subjectId: 1,
      projectId: 1,
      apiKeyId: 9,
      userId: 2,
      result: 'ok',
    });
  });

  test('dismisses a proposed release', async () => {
    const result = await dismissTool(db as never, { projectId: 1, testCaseId: 2, proposal: 'release' }, reporterKey);
    expect(result).toEqual({ projectId: 1, testCaseId: 2, proposal: 'release', dismissed: true });
    expect((await outcomes()).map((o) => [o.subjectId, o.key, o.channel])).toEqual([[2, 'release', 'mcp']]);
  });

  test('refuses a read-only key', async () => {
    await expect(
      dismissTool(db as never, { projectId: 1, testCaseId: 1, proposal: 'quarantine' }, viewerKey),
    ).rejects.toThrow(WRITE_REFUSED);
    expect(await outcomes()).toEqual([]);
  });

  test('refuses a bad argument before recording anything', async () => {
    await expect(
      dismissTool(db as never, { projectId: 1, testCaseId: 1, proposal: 'forget' }, reporterKey),
    ).rejects.toThrow('proposal must be quarantine or release');
    await expect(
      dismissTool(db as never, { projectId: 1, testCaseId: 'one', proposal: 'quarantine' }, reporterKey),
    ).rejects.toThrow('Invalid testCaseId: must be a number');
    await expect(
      dismissTool(db as never, { projectId: 1, testCaseId: 1, proposal: 'quarantine', reason: 42 }, reporterKey),
    ).rejects.toThrow('reason must be a string');
    expect(await outcomes()).toEqual([]);
  });

  test('refuses a project out of scope and a test with no such proposal; a test of another project is not found', async () => {
    await expect(
      dismissTool(db as never, { projectId: 2, testCaseId: 4, proposal: 'quarantine' }, reporterKey),
    ).rejects.toThrow('No access to project 2');
    await expect(
      dismissTool(db as never, { projectId: 1, testCaseId: 3, proposal: 'release' }, reporterKey),
    ).rejects.toThrow('Test 3 has no release proposal to dismiss');
    expect(
      await dismissTool(db as never, { projectId: 1, testCaseId: 4, proposal: 'quarantine' }, reporterKey),
    ).toBeNull();
    expect(await outcomes()).toEqual([]);
  });
});
