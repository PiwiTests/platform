import { describe, test, expect } from 'vitest';
import { Role } from '#shared/types';
import {
  groupProjectAccessUsers,
  matchesProjectAccessQuery,
  projectAccessCellKey,
  projectAccessCellState,
  sortProjectAccessProjects,
  sortProjectAccessUsers,
  toProjectAccessUser,
  withProjectAccess,
  type ProjectAccessUser,
} from '#shared/project-access';

function user(overrides: Partial<ProjectAccessUser> = {}): ProjectAccessUser {
  return { id: 1, username: 'sam', name: null, role: Role.USER, global: false, projectIds: [], ...overrides };
}

describe('toProjectAccessUser', () => {
  test('splits the all-projects grant from the per-project ones', () => {
    const row = toProjectAccessUser({ id: 3, username: 'sam', name: 'Sam', role: 'user' }, [5, null, 2, 5]);
    expect(row).toEqual({ id: 3, username: 'sam', name: 'Sam', role: Role.USER, global: true, projectIds: [2, 5] });
  });

  test('a user without assignments has no access', () => {
    expect(toProjectAccessUser({ id: 3, username: 'sam', name: null, role: 'reporter' }, [])).toMatchObject({
      global: false,
      projectIds: [],
    });
  });

  test('an administrator always reads as global, whatever rows remain', () => {
    const row = toProjectAccessUser({ id: 1, username: 'avery', name: null, role: 'administrator' }, [4]);
    expect(row).toMatchObject({ global: true, projectIds: [] });
  });
});

describe('projectAccessCellState', () => {
  test('an administrator is locked open everywhere', () => {
    const admin = user({ role: Role.ADMINISTRATOR, global: true });
    expect(projectAccessCellState(admin, null)).toBe('admin');
    expect(projectAccessCellState(admin, 7)).toBe('admin');
  });

  test('the all-projects cell reflects the global grant', () => {
    expect(projectAccessCellState(user({ global: true }), null)).toBe('granted');
    expect(projectAccessCellState(user(), null)).toBe('none');
  });

  test('a global grant covers every project cell, granted or not', () => {
    const global = user({ global: true, projectIds: [7] });
    expect(projectAccessCellState(global, 7)).toBe('inherited');
    expect(projectAccessCellState(global, 8)).toBe('inherited');
  });

  test('without a global grant a project cell is granted or not', () => {
    const scoped = user({ projectIds: [7] });
    expect(projectAccessCellState(scoped, 7)).toBe('granted');
    expect(projectAccessCellState(scoped, 8)).toBe('none');
  });
});

describe('withProjectAccess', () => {
  test('grants and revokes one project, keeping ids sorted and unique', () => {
    const granted = withProjectAccess(user({ projectIds: [9] }), 3, true);
    expect(granted.projectIds).toEqual([3, 9]);
    expect(withProjectAccess(granted, 3, true).projectIds).toEqual([3, 9]);
    expect(withProjectAccess(granted, 9, false).projectIds).toEqual([3]);
  });

  test('toggles the global grant without touching the per-project ones', () => {
    const scoped = user({ projectIds: [3] });
    const global = withProjectAccess(scoped, null, true);
    expect(global).toMatchObject({ global: true, projectIds: [3] });
    expect(withProjectAccess(global, null, false)).toMatchObject({ global: false, projectIds: [3] });
  });

  test('returns a new row', () => {
    const row = user();
    expect(withProjectAccess(row, 1, true)).not.toBe(row);
    expect(row.projectIds).toEqual([]);
  });
});

describe('sorting and grouping', () => {
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

  test('groups come out administrators, reporters, users, keeping order within a group', () => {
    const rows = [
      user({ id: 1, role: Role.USER }),
      user({ id: 2, role: Role.ADMINISTRATOR }),
      user({ id: 3, role: Role.USER }),
      user({ id: 4, role: Role.REPORTER }),
    ];
    const groups = groupProjectAccessUsers(rows);
    expect(groups.map((g) => g.role)).toEqual([Role.ADMINISTRATOR, Role.REPORTER, Role.USER]);
    expect(groups[2]!.users.map((row) => row.id)).toEqual([1, 3]);
  });

  test('empty roles are left out', () => {
    expect(groupProjectAccessUsers([user({ role: Role.REPORTER })]).map((g) => g.role)).toEqual([Role.REPORTER]);
    expect(groupProjectAccessUsers([])).toEqual([]);
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

test('projectAccessCellKey tells the all-projects cell from a project cell', () => {
  expect(projectAccessCellKey(4, null)).toBe('4:all');
  expect(projectAccessCellKey(4, 12)).toBe('4:12');
});
