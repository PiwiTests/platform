import { describe, test, expect } from 'vitest';
import {
  ADMIN_ACCESS,
  InstanceRole,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  ProjectRole,
  ROLE_PERMISSIONS,
  SIGNED_IN,
  buildAccessSummary,
  can,
  canGrantRole,
  holdsAnywhere,
  passesEarlyCheck,
  passesProjectCheck,
  projectRolesOf,
  projectScopeFor,
  rolesGranting,
  routePermissionList,
} from '#shared/permissions';

const member = (grants: { projectId: number | null; role: ProjectRole }[]) =>
  buildAccessSummary(InstanceRole.MEMBER, grants);

describe('the permission matrix', () => {
  test('each role of the ladder includes the one before it', () => {
    const ladder = [ProjectRole.VIEWER, ProjectRole.CONTRIBUTOR, ProjectRole.MAINTAINER, ProjectRole.PROJECT_ADMIN];
    for (let i = 1; i < ladder.length; i++) {
      for (const permission of ROLE_PERMISSIONS[ladder[i - 1]!]) {
        expect(ROLE_PERMISSIONS[ladder[i]!]).toContain(permission);
      }
    }
  });

  test('a product owner files issues but cannot triage, upload or edit the project', () => {
    const po = member([{ projectId: 1, role: ProjectRole.CONTRIBUTOR }]);
    expect(can(po, 'issue:create', 1)).toBe(true);
    expect(can(po, 'marker:write', 1)).toBe(true);
    expect(can(po, 'triage:write', 1)).toBe(false);
    expect(can(po, 'run:submit', 1)).toBe(false);
    expect(can(po, 'share:create', 1)).toBe(false);
    expect(can(po, 'project:manage', 1)).toBe(false);
  });

  test('an uploader reads and submits, nothing else', () => {
    expect([...ROLE_PERMISSIONS[ProjectRole.UPLOADER]].sort()).toEqual(['project:read', 'run:submit']);
  });

  test('every project permission is granted by at least one role', () => {
    for (const permission of PROJECT_PERMISSIONS) expect(rolesGranting(permission).length).toBeGreaterThan(0);
  });

  test('every role is listed once', () => {
    expect(new Set(PROJECT_ROLES).size).toBe(Object.keys(ROLE_PERMISSIONS).length);
  });
});

describe('a user’s access', () => {
  test('roles on all projects and on one project add up', () => {
    const access = member([
      { projectId: null, role: ProjectRole.VIEWER },
      { projectId: 2, role: ProjectRole.MAINTAINER },
      { projectId: 2, role: ProjectRole.UPLOADER },
      { projectId: 2, role: ProjectRole.MAINTAINER },
    ]);
    expect(projectRolesOf(access, 2).sort()).toEqual(
      [ProjectRole.MAINTAINER, ProjectRole.UPLOADER, ProjectRole.VIEWER].sort(),
    );
    expect(projectRolesOf(access, 3)).toEqual([ProjectRole.VIEWER]);
    expect(can(access, 'triage:write', 2)).toBe(true);
    expect(can(access, 'triage:write', 3)).toBe(false);
    expect(can(access, 'project:read', 3)).toBe(true);
  });

  test('a member never holds an instance permission', () => {
    const access = member([{ projectId: null, role: ProjectRole.PROJECT_ADMIN }]);
    expect(can(access, 'users:manage')).toBe(false);
    expect(holdsAnywhere(access, 'project:delete')).toBe(false);
  });

  test('a project permission needs a project id', () => {
    const access = member([{ projectId: null, role: ProjectRole.MAINTAINER }]);
    expect(can(access, 'triage:write')).toBe(false);
    expect(holdsAnywhere(access, 'triage:write')).toBe(true);
  });

  test('an administrator holds everything', () => {
    expect(can(ADMIN_ACCESS, 'users:manage')).toBe(true);
    expect(can(ADMIN_ACCESS, 'run:delete', 42)).toBe(true);
    expect(projectScopeFor(ADMIN_ACCESS, 'run:delete')).toBe('all');
  });

  test('the project scope of a permission', () => {
    const access = member([
      { projectId: 1, role: ProjectRole.VIEWER },
      { projectId: 2, role: ProjectRole.CONTRIBUTOR },
    ]);
    expect(projectScopeFor(access, 'project:read')).toEqual(new Set([1, 2]));
    expect(projectScopeFor(access, 'issue:create')).toEqual(new Set([2]));
    expect(projectScopeFor(member([{ projectId: null, role: ProjectRole.VIEWER }]), 'project:read')).toBe('all');
    expect(projectScopeFor(member([]), 'project:read')).toEqual(new Set());
  });

  test('only a project admin grants roles', () => {
    expect(canGrantRole([ProjectRole.PROJECT_ADMIN], ProjectRole.PROJECT_ADMIN)).toBe(true);
    expect(canGrantRole([ProjectRole.MAINTAINER], ProjectRole.VIEWER)).toBe(false);
  });
});

describe('route checks', () => {
  const nobody = member([]);
  const reader = member([{ projectId: 1, role: ProjectRole.VIEWER }]);

  test('meta values normalize to a list', () => {
    expect(routePermissionList('issue:create')).toEqual(['issue:create']);
    expect(routePermissionList(['issue:create', 'nonsense'])).toEqual(['issue:create']);
    expect(routePermissionList(undefined)).toEqual([]);
  });

  test('the early check lets any signed-in user through for signed-in and project:read', () => {
    expect(passesEarlyCheck(nobody, [SIGNED_IN])).toBe(true);
    expect(passesEarlyCheck(nobody, ['project:read'])).toBe(true);
    expect(passesEarlyCheck(nobody, ['issue:create'])).toBe(false);
    expect(passesEarlyCheck(reader, ['users:manage'])).toBe(false);
    expect(passesEarlyCheck(reader, ['users:manage', 'project:read'])).toBe(true);
  });

  test('the project check decides per project', () => {
    expect(passesProjectCheck(reader, ['project:read'], 1)).toBe(true);
    expect(passesProjectCheck(reader, ['project:read'], 2)).toBe(false);
    expect(passesProjectCheck(reader, [SIGNED_IN], 1)).toBe(true);
    expect(passesProjectCheck(reader, ['issue:create'], 1)).toBe(false);
  });
});
