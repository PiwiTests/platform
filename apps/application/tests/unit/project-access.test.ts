import { describe, test, expect } from 'vitest';
import { buildAccessSummary, InstanceRole, PROJECT_ROLES, ProjectRole } from '#shared/permissions';
import {
  directProjectMemberEntries,
  grantableProjectRoles,
  indexProjectAccessBindings,
  matchesProjectAccessQuery,
  projectAccessCellKey,
  projectAccessCellState,
  projectAccessRows,
  requestedInstanceRole,
  sortProjectAccessProjects,
  sortProjectAccessUsers,
  sortProjectMembers,
  withRoleBinding,
  withSubjectBindings,
  type ProjectAccessGrid,
  type ProjectAccessUser,
  type ProjectMemberView,
  type RoleBindingView,
} from '#shared/project-access';

function user(overrides: Partial<ProjectAccessUser> = {}): ProjectAccessUser {
  return { id: 1, username: 'sam', name: null, instanceRole: InstanceRole.MEMBER, groupIds: [], ...overrides };
}

const group = (id: number, name: string) => ({ id, name, description: null, memberCount: 0 });
const userSubject = (id: number) => ({ type: 'user' as const, id });
const groupSubject = (id: number) => ({ type: 'group' as const, id });
const binding = (subject: RoleBindingView['subject'], projectId: number | null, role: ProjectRole) => ({
  subject,
  projectId,
  role,
});

/** Quinn: Project admin of 7 on their own, in QA (Maintainer everywhere) and PO (Contributor on 8). */
const grid: Pick<ProjectAccessGrid, 'users' | 'groups' | 'bindings'> = {
  users: [
    user({ id: 1, username: 'avery', instanceRole: InstanceRole.ADMINISTRATOR }),
    user({ id: 2, username: 'quinn', groupIds: [10, 11] }),
    user({ id: 3, username: 'sam' }),
  ],
  groups: [group(10, 'QA'), group(11, 'Product owners')],
  bindings: [
    binding(userSubject(2), 7, ProjectRole.PROJECT_ADMIN),
    binding(groupSubject(10), null, ProjectRole.MAINTAINER),
    binding(groupSubject(11), 8, ProjectRole.CONTRIBUTOR),
    binding(userSubject(3), null, ProjectRole.VIEWER),
    binding(userSubject(3), 7, ProjectRole.CONTRIBUTOR),
  ],
};

describe('projectAccessCellState', () => {
  test("a user's own binding is the cell's role; their groups' roles there are inherited", () => {
    expect(projectAccessCellState(grid, userSubject(2), 7)).toEqual({
      role: ProjectRole.PROJECT_ADMIN,
      inherited: [{ role: ProjectRole.MAINTAINER, source: 'group', groupId: 10, groupName: 'QA' }],
      admin: false,
    });
    expect(projectAccessCellState(grid, userSubject(2), 8)).toEqual({
      role: null,
      inherited: [
        { role: ProjectRole.MAINTAINER, source: 'group', groupId: 10, groupName: 'QA' },
        { role: ProjectRole.CONTRIBUTOR, source: 'group', groupId: 11, groupName: 'Product owners' },
      ],
      admin: false,
    });
  });

  test("the all-projects cell inherits only the groups' all-projects bindings", () => {
    expect(projectAccessCellState(grid, userSubject(2), null)).toEqual({
      role: null,
      inherited: [{ role: ProjectRole.MAINTAINER, source: 'group', groupId: 10, groupName: 'QA' }],
      admin: false,
    });
  });

  test("a subject's own all-projects binding shows on every project cell", () => {
    expect(projectAccessCellState(grid, userSubject(3), 7)).toEqual({
      role: ProjectRole.CONTRIBUTOR,
      inherited: [{ role: ProjectRole.VIEWER, source: 'all-projects' }],
      admin: false,
    });
    expect(projectAccessCellState(grid, groupSubject(10), 8)).toEqual({
      role: null,
      inherited: [{ role: ProjectRole.MAINTAINER, source: 'all-projects' }],
      admin: false,
    });
    expect(projectAccessCellState(grid, groupSubject(10), null).role).toBe(ProjectRole.MAINTAINER);
  });

  test('an administrator is flagged, with no role of their own', () => {
    expect(projectAccessCellState(grid, userSubject(1), 7)).toEqual({ role: null, inherited: [], admin: true });
  });

  test('a prebuilt index reads the same', () => {
    const index = indexProjectAccessBindings(grid.bindings);
    expect(projectAccessCellState(grid, userSubject(2), 8, index)).toEqual(
      projectAccessCellState(grid, userSubject(2), 8),
    );
  });
});

describe('withRoleBinding', () => {
  test("sets, replaces and removes one cell, leaving the subject's other bindings", () => {
    const set = withRoleBinding(grid.bindings, { subject: userSubject(2), projectId: 8, role: ProjectRole.VIEWER });
    expect(set).toContainEqual(binding(userSubject(2), 8, ProjectRole.VIEWER));
    expect(set).toContainEqual(binding(userSubject(2), 7, ProjectRole.PROJECT_ADMIN));

    const replaced = withRoleBinding(set, { subject: userSubject(2), projectId: 8, role: ProjectRole.UPLOADER });
    expect(replaced.filter((b) => b.subject.id === 2 && b.subject.type === 'user')).toHaveLength(2);
    expect(replaced).toContainEqual(binding(userSubject(2), 8, ProjectRole.UPLOADER));

    const removed = withRoleBinding(replaced, { subject: userSubject(2), projectId: 8, role: null });
    expect(removed.some((b) => b.subject.type === 'user' && b.subject.id === 2 && b.projectId === 8)).toBe(false);
  });

  test('tells a user from a group with the same id, and all projects from a project', () => {
    const next = withRoleBinding(grid.bindings, { subject: userSubject(10), projectId: null, role: null });
    expect(next).toEqual(grid.bindings);
    const allProjects = withRoleBinding(grid.bindings, { subject: userSubject(3), projectId: null, role: null });
    expect(allProjects).toContainEqual(binding(userSubject(3), 7, ProjectRole.CONTRIBUTOR));
    expect(allProjects).toHaveLength(grid.bindings.length - 1);
  });

  test('withSubjectBindings swaps in a subject’s bindings as the server returned them', () => {
    const next = withSubjectBindings(grid.bindings, userSubject(3), [binding(userSubject(3), 9, ProjectRole.VIEWER)]);
    expect(next.filter((b) => b.subject.type === 'user' && b.subject.id === 3)).toEqual([
      binding(userSubject(3), 9, ProjectRole.VIEWER),
    ]);
    expect(next).toHaveLength(grid.bindings.length - 1);
  });
});

describe('sorting and rows', () => {
  test('users sort by the name shown, case-insensitively, then by id', () => {
    const rows = [
      user({ id: 1, username: 'zed' }),
      user({ id: 2, username: 'x', name: 'amy' }),
      user({ id: 3, username: 'Bob' }),
      user({ id: 4, username: 'bob' }),
    ];
    expect(sortProjectAccessUsers(rows).map((row) => row.id)).toEqual([2, 3, 4, 1]);
  });

  test('projects sort by label, falling back to the name', () => {
    const projects = [
      { id: 1, name: 'zeta', label: null },
      { id: 2, name: 'b-key', label: 'Alpha' },
      { id: 3, name: 'beta', label: null },
    ];
    expect(sortProjectAccessProjects(projects).map((p) => p.id)).toEqual([2, 3, 1]);
  });

  test('the rows are the groups by name, then the users by the name shown', () => {
    expect(projectAccessRows(grid).map((row) => [row.subject.type, row.name])).toEqual([
      ['group', 'Product owners'],
      ['group', 'QA'],
      ['user', 'avery'],
      ['user', 'quinn'],
      ['user', 'sam'],
    ]);
  });
});

describe('matchesProjectAccessQuery', () => {
  test('matches any field, case-insensitively, trimming the query', () => {
    expect(matchesProjectAccessQuery('  SAM ', [null, 'sam-checkout'])).toBe(true);
    expect(matchesProjectAccessQuery('check', ['Sam', 'sam-checkout'])).toBe(true);
    expect(matchesProjectAccessQuery('priya', ['Sam', 'sam-checkout'])).toBe(false);
  });

  test('an empty query matches everything', () => {
    expect(matchesProjectAccessQuery('', [])).toBe(true);
    expect(matchesProjectAccessQuery('   ', [null])).toBe(true);
  });
});

test('projectAccessCellKey tells users from groups and the all-projects cell from a project cell', () => {
  expect(projectAccessCellKey(userSubject(4), null)).toBe('user:4:all');
  expect(projectAccessCellKey(userSubject(4), 12)).toBe('user:4:12');
  expect(projectAccessCellKey(groupSubject(4), 12)).toBe('group:4:12');
});

describe('project members', () => {
  const member = (overrides: Partial<ProjectMemberView>): ProjectMemberView => ({
    subject: userSubject(1),
    username: 'sam',
    name: 'Sam',
    role: ProjectRole.VIEWER,
    source: 'direct',
    ...overrides,
  });

  test('groups first, then users, by name; a subject’s own binding before its inherited roles', () => {
    const rows = [
      member({ subject: userSubject(2), name: 'Bob', source: 'group', groupName: 'QA' }),
      member({ subject: userSubject(2), name: 'Bob', source: 'direct' }),
      member({ subject: userSubject(1), name: 'avery', source: 'administrator' }),
      member({ subject: groupSubject(5), username: null, name: 'QA', source: 'all-projects' }),
      member({ subject: userSubject(2), name: 'Bob', source: 'all-projects' }),
    ];
    expect(sortProjectMembers(rows).map((r) => `${r.name}/${r.source}`)).toEqual([
      'QA/all-projects',
      'avery/administrator',
      'Bob/direct',
      'Bob/all-projects',
      'Bob/group',
    ]);
  });

  test('directProjectMemberEntries keeps the bindings on the project only', () => {
    const rows = [
      member({ subject: userSubject(2), role: ProjectRole.MAINTAINER, source: 'direct' }),
      member({ subject: userSubject(2), role: ProjectRole.VIEWER, source: 'all-projects' }),
      member({ subject: groupSubject(5), role: ProjectRole.CONTRIBUTOR, source: 'direct' }),
      member({ subject: userSubject(3), source: 'group' }),
    ];
    expect(directProjectMemberEntries(rows)).toEqual([
      { subject: userSubject(2), role: ProjectRole.MAINTAINER },
      { subject: groupSubject(5), role: ProjectRole.CONTRIBUTOR },
    ]);
  });
});

describe('grantableProjectRoles', () => {
  test('an administrator grants every role, a Project admin those canGrantRole allows, anyone else none', () => {
    expect(grantableProjectRoles(buildAccessSummary(InstanceRole.ADMINISTRATOR, []), 7)).toEqual([...PROJECT_ROLES]);
    const lead = buildAccessSummary(InstanceRole.MEMBER, [
      { projectId: 7, role: ProjectRole.PROJECT_ADMIN },
      { projectId: null, role: ProjectRole.MAINTAINER },
    ]);
    expect(grantableProjectRoles(lead, 7)).toEqual([...PROJECT_ROLES]);
    expect(grantableProjectRoles(lead, 8)).toEqual([]);
  });

  test('a Project admin role held through all projects counts on every project', () => {
    const access = buildAccessSummary(InstanceRole.MEMBER, [{ projectId: null, role: ProjectRole.PROJECT_ADMIN }]);
    expect(grantableProjectRoles(access, 42)).toEqual([...PROJECT_ROLES]);
  });
});

test('requestedInstanceRole stores the roles of earlier versions as member', () => {
  expect(requestedInstanceRole('reporter')).toBe(InstanceRole.MEMBER);
  expect(requestedInstanceRole('user')).toBe(InstanceRole.MEMBER);
  expect(requestedInstanceRole(InstanceRole.ADMINISTRATOR)).toBe(InstanceRole.ADMINISTRATOR);
  expect(requestedInstanceRole(InstanceRole.MEMBER)).toBe(InstanceRole.MEMBER);
});
