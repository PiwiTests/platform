/**
 * The permission grid's data model: every user against every project, with the
 * project access each one holds. Pure — shared by the server handler that builds
 * the grid, the demo mirror, and the Settings → Permissions page.
 *
 * Access is stored as `project_assignments` rows (see `server/utils/project-access.ts`
 * for how it is enforced): a row with a project id grants that one project, a row
 * with a null project id grants every project, current and future. The two kinds
 * are independent, so taking the all-projects grant away leaves the user with
 * exactly the projects granted one by one. Administrators open every project
 * without any row.
 */
import { Role } from '#shared/types';

/** One user's row on the permission grid. */
export interface ProjectAccessUser {
  id: number;
  username: string;
  name: string | null;
  role: Role;
  /** Holds the all-projects grant. Always true for an administrator. */
  global: boolean;
  /** Projects granted one by one, ascending. Always empty for an administrator. */
  projectIds: number[];
}

/** One column of the permission grid. */
export interface ProjectAccessProject {
  id: number;
  name: string;
  label: string | null;
}

export interface ProjectAccessGrid {
  users: ProjectAccessUser[];
  projects: ProjectAccessProject[];
}

/**
 * How one cell reads:
 * - `admin` — an administrator, who opens every project; not editable.
 * - `inherited` — covered by the user's all-projects grant; not editable on its own.
 * - `granted` / `none` — a grant the cell toggles.
 */
export type ProjectAccessCellState = 'admin' | 'inherited' | 'granted' | 'none';

/** Roles in the order the grid groups them, most access first. */
export const PROJECT_ACCESS_ROLE_ORDER: readonly Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

/** The name the grid shows for a user. */
export function projectAccessUserName(user: Pick<ProjectAccessUser, 'name' | 'username'>): string {
  return user.name || user.username;
}

/** The name the grid shows for a project. */
export function projectAccessProjectName(project: Pick<ProjectAccessProject, 'name' | 'label'>): string {
  return project.label || project.name;
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** Users sorted by the name the grid shows. */
export function sortProjectAccessUsers<T extends ProjectAccessUser>(users: T[]): T[] {
  return [...users].sort((a, b) => byText(projectAccessUserName(a), projectAccessUserName(b)) || a.id - b.id);
}

/** Projects sorted by the name the grid shows. */
export function sortProjectAccessProjects<T extends ProjectAccessProject>(projects: T[]): T[] {
  return [...projects].sort((a, b) => byText(projectAccessProjectName(a), projectAccessProjectName(b)) || a.id - b.id);
}

/**
 * Build a user's row from the project ids of their assignment rows (`null` for
 * the all-projects grant).
 */
export function toProjectAccessUser(
  user: { id: number; username: string; name: string | null; role: string },
  grants: (number | null)[],
): ProjectAccessUser {
  const base = { id: user.id, username: user.username, name: user.name, role: user.role as Role };
  if (base.role === Role.ADMINISTRATOR) return { ...base, global: true, projectIds: [] };
  const projectIds = [...new Set(grants.filter((id): id is number => id !== null))].sort((a, b) => a - b);
  return { ...base, global: grants.includes(null), projectIds };
}

/** A stable key for one cell; `projectId` null is the all-projects cell. */
export function projectAccessCellKey(userId: number, projectId: number | null): string {
  return `${userId}:${projectId ?? 'all'}`;
}

/** The state of the cell for `projectId`, or of the all-projects cell when it is null. */
export function projectAccessCellState(user: ProjectAccessUser, projectId: number | null): ProjectAccessCellState {
  if (user.role === Role.ADMINISTRATOR) return 'admin';
  if (projectId === null) return user.global ? 'granted' : 'none';
  if (user.global) return 'inherited';
  return user.projectIds.includes(projectId) ? 'granted' : 'none';
}

/** The row after granting or revoking one cell — the same change the server applies. */
export function withProjectAccess(
  user: ProjectAccessUser,
  projectId: number | null,
  granted: boolean,
): ProjectAccessUser {
  if (projectId === null) return { ...user, global: granted };
  const ids = new Set(user.projectIds);
  if (granted) ids.add(projectId);
  else ids.delete(projectId);
  return { ...user, projectIds: [...ids].sort((a, b) => a - b) };
}

/** Users grouped by role in `PROJECT_ACCESS_ROLE_ORDER`, keeping their order within a group. Empty groups are dropped. */
export function groupProjectAccessUsers<T extends ProjectAccessUser>(users: T[]): { role: Role; users: T[] }[] {
  const rank = (role: Role) => {
    const index = PROJECT_ACCESS_ROLE_ORDER.indexOf(role);
    return index === -1 ? PROJECT_ACCESS_ROLE_ORDER.length : index;
  };
  const groups = new Map<Role, T[]>();
  for (const user of users) {
    const group = groups.get(user.role);
    if (group) group.push(user);
    else groups.set(user.role, [user]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([role, members]) => ({ role, users: members }));
}

/** Case-insensitive match of `query` against any of `fields`; an empty query matches everything. */
export function matchesProjectAccessQuery(query: string, fields: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}
