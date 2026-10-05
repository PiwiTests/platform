import { describe, test, expect, vi, afterEach } from 'vitest';
import { computed, ref } from 'vue';
import { ADMIN_ACCESS, InstanceRole, ProjectRole, buildAccessSummary, type AccessSummary } from '#shared/permissions';
import type { AuthState } from '../../types/api';

/**
 * Covers the rules deciding what the UI offers: `canSeeAdmin` (admin-only
 * surfaces such as Settings' Analysis section, the Setup page and its link),
 * and `can` / `canAnywhere` (every project action, from the viewer's access).
 *
 * They are tested here at their definition rather than only through consumers,
 * because `use-settings-nav.test.ts` stubs `useAuth` wholesale: without this
 * file, that stub would be asserting a hand-written copy of the rule, and the
 * real implementation could drift from it undetected.
 *
 * The rest of `useAuth` (login, logout, fetchUser, the demo switcher) is
 * exercised by the E2E suite — only setup-time state is stubbed here.
 */
function loadUseAuth(opts: { authEnabled?: boolean; access?: AccessSummary | null }) {
  const access = opts.access ?? null;
  const state = ref<AuthState>({
    authenticated: access !== null,
    user: access === null ? null : { id: 1, username: 'u', role: access.instanceRole, name: 'U', access },
  });

  vi.stubGlobal('computed', computed);
  vi.stubGlobal('useState', (_key: string, init: () => AuthState) => {
    if (!state.value) state.value = init();
    return state;
  });
  vi.stubGlobal('useRuntimeConfig', () => ({
    public: { authEnabled: opts.authEnabled ?? false, demoMode: false },
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Fresh import per case, so the stubs above are in place when the module loads. */
async function useAuthWith(opts: { authEnabled?: boolean; access?: AccessSummary | null }) {
  loadUseAuth(opts);
  const { useAuth } = await import('../../app/composables/useAuth');
  return useAuth();
}

const MEMBER_NO_ROLE = buildAccessSummary(InstanceRole.MEMBER, []);
/** Viewer on all projects, Contributor on project 1, Maintainer on project 2. */
const MEMBER_WITH_BINDINGS = buildAccessSummary(InstanceRole.MEMBER, [
  { projectId: null, role: ProjectRole.VIEWER },
  { projectId: 1, role: ProjectRole.CONTRIBUTOR },
  { projectId: 2, role: ProjectRole.MAINTAINER },
]);

describe('useAuth().canSeeAdmin', () => {
  test('is true for everyone when authentication is disabled', async () => {
    // No users exist at all in this mode, so nobody holds the administrator
    // role. Gating on `isAdmin` alone would hide Storage, Tags, AI and Setup
    // from every visitor on a default self-hosted install — and in the desktop
    // build, which runs single-user with auth off and needs Setup for its own
    // reporter token and MCP configuration.
    expect((await useAuthWith({ authEnabled: false })).canSeeAdmin.value).toBe(true);
  });

  test('is true for an administrator when authentication is enabled', async () => {
    expect((await useAuthWith({ authEnabled: true, access: ADMIN_ACCESS })).canSeeAdmin.value).toBe(true);
  });

  test('is false for a member when authentication is enabled, whatever their project roles', async () => {
    expect((await useAuthWith({ authEnabled: true, access: MEMBER_WITH_BINDINGS })).canSeeAdmin.value).toBe(false);
  });

  test('is false for an unauthenticated visitor when authentication is enabled', async () => {
    expect((await useAuthWith({ authEnabled: true })).canSeeAdmin.value).toBe(false);
  });

  test('differs from isAdmin exactly in the auth-disabled case', async () => {
    const auth = await useAuthWith({ authEnabled: false });

    expect(auth.isAdmin.value).toBe(false);
    expect(auth.canSeeAdmin.value).toBe(true);
  });
});

describe('useAuth().can and canAnywhere', () => {
  test('allow everything when authentication is disabled', async () => {
    // Same reason as canSeeAdmin: no users, and the server answers as a
    // virtual administrator, so hiding actions would hide them from everyone.
    const auth = await useAuthWith({ authEnabled: false });

    expect(auth.access.value).toBeNull();
    expect(auth.can('triage:write', 1)).toBe(true);
    expect(auth.can('settings:manage')).toBe(true);
    expect(auth.canAnywhere('quarantine:write')).toBe(true);
  });

  test('allow everything to an administrator, with or without a project', async () => {
    const auth = await useAuthWith({ authEnabled: true, access: ADMIN_ACCESS });

    expect(auth.can('run:delete', 42)).toBe(true);
    expect(auth.can('users:manage')).toBe(true);
    expect(auth.canAnywhere('project:members')).toBe(true);
  });

  test('give a member the permissions of the roles they hold on that project', async () => {
    const auth = await useAuthWith({ authEnabled: true, access: MEMBER_WITH_BINDINGS });

    // Contributor on project 1: files issues, does not triage.
    expect(auth.can('issue:create', 1)).toBe(true);
    expect(auth.can('triage:write', 1)).toBe(false);
    // Maintainer on project 2.
    expect(auth.can('triage:write', 2)).toBe(true);
    expect(auth.can('project:manage', 2)).toBe(false);
    // Viewer on all projects reads a project with no binding of its own.
    expect(auth.can('project:read', 3)).toBe(true);
    expect(auth.can('issue:create', 3)).toBe(false);
  });

  test('accept a project id given as a string, as a route param holds it', async () => {
    const auth = await useAuthWith({ authEnabled: true, access: MEMBER_WITH_BINDINGS });

    expect(auth.can('triage:write', '2')).toBe(true);
    expect(auth.can('triage:write', '1')).toBe(false);
    expect(auth.can('triage:write', 'not-an-id')).toBe(false);
  });

  test('refuse a member a project permission asked without a project, and every instance permission', async () => {
    const auth = await useAuthWith({ authEnabled: true, access: MEMBER_WITH_BINDINGS });

    expect(auth.can('issue:create')).toBe(false);
    expect(auth.can('issue:create', null)).toBe(false);
    expect(auth.can('settings:manage', 1)).toBe(false);
  });

  test('canAnywhere holds when any project grants the permission', async () => {
    const auth = await useAuthWith({ authEnabled: true, access: MEMBER_WITH_BINDINGS });

    expect(auth.canAnywhere('triage:write')).toBe(true);
    expect(auth.canAnywhere('report:write')).toBe(true);
    expect(auth.canAnywhere('run:delete')).toBe(false);
    expect(auth.canAnywhere('tags:manage')).toBe(false);
  });

  test('refuse everything to a member with no role and to a signed-out visitor', async () => {
    const member = await useAuthWith({ authEnabled: true, access: MEMBER_NO_ROLE });
    expect(member.can('project:read', 1)).toBe(false);
    expect(member.canAnywhere('project:read')).toBe(false);

    vi.unstubAllGlobals();
    vi.resetModules();
    const visitor = await useAuthWith({ authEnabled: true });
    expect(visitor.can('project:read', 1)).toBe(false);
    expect(visitor.canAnywhere('issue:create')).toBe(false);
  });
});
