import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as schema from '../../server/database/schema.sqlite';
import { apiError } from '../../server/utils/api-error';
import { openTempDb, type TempDb } from './temp-db';
import type { User } from '../../server/database/schema';
import { buildAccessSummary, InstanceRole, ProjectRole, type RoutePermission } from '#shared/permissions';
import { recordRouteMeta, type RouteAccessState, type RouteCaller } from './route-access';

/**
 * The access-management routes called as different people, held to the
 * permission their meta declares the way requireAuth and the project access
 * helpers hold a request to it.
 */

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load.
delete process.env.PIWI_DATABASE_URL;

const state = vi.hoisted(
  () => ({ db: null, caller: null, routePermission: [], revoked: [] }) as RouteAccessState & { revoked: number[] },
);
vi.mock('../../server/database', () => ({ getDatabase: async () => state.db }));
vi.mock('../../server/utils/auth', async () => ({
  ...(await import('./route-access')).authMock(state),
  hashPassword: async (password: string) => `hashed:${password}`,
  revokeUserSessions: async (userId: number) => {
    state.revoked.push(userId);
    return 1;
  },
}));
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

type Handler = (event: FakeEvent) => Promise<any>;

/** A route's handler, called under the permission its meta declares. */
async function loadRoute(path: string): Promise<Handler> {
  const handler = (await import(path)).default as Handler;
  const permission: RoutePermission[] = state.routePermission;
  return async (event) => {
    state.routePermission = permission;
    return handler(event);
  };
}

const listUsers = await loadRoute('../../server/api/users/index.get');
const createUser = await loadRoute('../../server/api/users/index.post');
const patchUser = await loadRoute('../../server/api/users/[id].patch');
const listGroups = await loadRoute('../../server/api/groups/index.get');
const getMembers = await loadRoute('../../server/api/projects/[id]/members.get');
const putMembers = await loadRoute('../../server/api/projects/[id]/members.put');

const asUser = (id: number, role: string) => ({ id, role, username: `user${id}`, name: null }) as unknown as User;
const caller = (id: number, role: InstanceRole, ...grants: { projectId: number | null; role: ProjectRole }[]) =>
  ({ user: asUser(id, role), access: buildAccessSummary(role, grants) }) satisfies RouteCaller;

const avery = caller(1, InstanceRole.ADMINISTRATOR);
// Quinn: Project admin of web (10), Maintainer elsewhere.
const quinn = caller(
  2,
  InstanceRole.MEMBER,
  { projectId: 10, role: ProjectRole.PROJECT_ADMIN },
  { projectId: null, role: ProjectRole.MAINTAINER },
);
const sam = caller(3, InstanceRole.MEMBER, { projectId: 10, role: ProjectRole.VIEWER });

let db: TempDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await openTempDb());
  state.db = db;
  state.revoked = [];
  await db.insert(schema.users).values([
    { id: 1, username: 'avery', password: '', role: 'administrator', name: 'Avery', email: 'avery@example.com' },
    { id: 2, username: 'quinn', password: '', role: 'member', name: 'Quinn' },
    { id: 3, username: 'sam', password: '', role: 'member', name: 'Sam' },
  ]);
  await db.insert(schema.projects).values([
    { id: 10, name: 'web' },
    { id: 11, name: 'api' },
  ]);
  await db.insert(schema.groups).values({ id: 100, name: 'QA' });
  await db.insert(schema.roleBindings).values([{ userId: 2, projectId: 10, role: 'project_admin' }]);
});

afterEach(() => close());

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    return (error as { statusCode: number }).statusCode;
  }
}

describe('GET /api/users', () => {
  test('an administrator gets every field, a Project admin only ids and names, anyone else nothing', async () => {
    state.caller = avery;
    const full = await listUsers({});
    expect(full.items.find((u: { id: number }) => u.id === 1)).toMatchObject({
      email: 'avery@example.com',
      instanceRole: InstanceRole.ADMINISTRATOR,
      groupIds: [],
    });

    state.caller = quinn;
    const summaries = await listUsers({});
    expect(summaries.items).toEqual([
      { id: 1, username: 'avery', name: 'Avery' },
      { id: 2, username: 'quinn', name: 'Quinn' },
      { id: 3, username: 'sam', name: 'Sam' },
    ]);

    state.caller = sam;
    expect(await status(listUsers({}))).toBe(403);
  });
});

test('GET /api/groups lets a Project admin read the groups, not a Viewer', async () => {
  state.caller = quinn;
  expect((await listGroups({})).groups).toEqual([{ id: 100, name: 'QA', description: null, memberCount: 0 }]);
  state.caller = sam;
  expect(await status(listGroups({}))).toBe(403);
});

describe('project members', () => {
  const entries = [
    { subject: { type: 'user', id: 2 }, role: 'project_admin' },
    { subject: { type: 'group', id: 100 }, role: 'maintainer' },
  ];

  test("a Project admin reads and replaces their project's direct bindings", async () => {
    state.caller = quinn;
    const before = await getMembers({ params: { id: '10' } });
    expect(before.canManage).toBe(true);

    const after = await putMembers({ params: { id: '10' }, body: { entries } });
    expect(after.success).toBe(true);
    expect(after.members.filter((m: { source: string }) => m.source === 'direct')).toHaveLength(2);
  });

  test('nobody edits the members of a project they do not administer', async () => {
    // Quinn holds Maintainer on api only; Sam is a Viewer of web.
    state.caller = quinn;
    expect(await status(putMembers({ params: { id: '11' }, body: { entries: [] } }))).toBe(403);
    expect(await status(getMembers({ params: { id: '11' } }))).toBe(403);
    state.caller = sam;
    expect(await status(putMembers({ params: { id: '10' }, body: { entries: [] } }))).toBe(403);
  });

  test('a malformed body is a 400', async () => {
    state.caller = avery;
    expect(await status(putMembers({ params: { id: '10' }, body: { userIds: [2] } }))).toBe(400);
  });
});

describe('users writes', () => {
  test('POST stores a legacy role as member', async () => {
    state.caller = avery;
    const { user } = await createUser({ body: { username: 'robin', password: 'password123', role: 'reporter' } });
    expect(user).toMatchObject({ username: 'robin', role: 'member', instanceRole: InstanceRole.MEMBER });
    expect(await status(createUser({ body: { username: 'robin', role: 'member' } }))).toBe(409);
    state.caller = quinn;
    expect(await status(createUser({ body: { username: 'kim', role: 'member' } }))).toBe(403);
  });

  test('PATCH revokes sessions on an instance role change only, and keeps the last administrator', async () => {
    state.caller = avery;
    expect(await status(patchUser({ params: { id: '1' }, body: { role: 'member' } }))).toBe(400);

    await patchUser({ params: { id: '3' }, body: { role: 'member', name: 'Samuel' } });
    expect(state.revoked).toEqual([]);
    await patchUser({ params: { id: '3' }, body: { role: 'administrator' } });
    expect(state.revoked).toEqual([3]);
  });

  test('PATCH lets anyone change their own name, not someone else or their own role', async () => {
    state.caller = sam;
    expect((await patchUser({ params: { id: '3' }, body: { name: 'Sammy' } })).user.name).toBe('Sammy');
    expect(await status(patchUser({ params: { id: '2' }, body: { name: 'Q' } }))).toBe(403);
    expect(await status(patchUser({ params: { id: '3' }, body: { role: 'administrator' } }))).toBe(403);
  });
});
