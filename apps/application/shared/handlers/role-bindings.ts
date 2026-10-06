/**
 * Role bindings: which user or group holds which project role, on one project
 * or on all projects (present and future). Shared by the server (the access
 * loader behind `requireAuth`, the access-management routes) and the demo.
 * The roles and what they grant are in `#shared/permissions`.
 */
import { and, asc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { groupMembers, groups, roleBindings, users } from '../../server/database/schema';
import type { DrizzleDB } from './db';
import {
  buildAccessSummary,
  InstanceRole,
  isProjectRole,
  type AccessSummary,
  type ProjectRole,
  type RoleBindingGrant,
} from '#shared/permissions';

/** Who a binding is for: a user or a group, never both. */
export type RoleBindingSubject = { userId: number } | { groupId: number };

/** The subject of a listed binding, with what the UI shows for it. */
export type RoleBindingSubjectInfo =
  | { kind: 'user'; id: number; username: string; name: string | null }
  | { kind: 'group'; id: number; name: string };

export interface RoleBindingRow {
  id: number;
  subject: RoleBindingSubjectInfo;
  /** Null for all projects. */
  projectId: number | null;
  role: ProjectRole;
  createdBy: number | null;
  createdAt: Date;
}

export interface RoleBindingFilter {
  /** A project id, or null for the all-projects bindings only. */
  projectId?: number | null;
  userId?: number;
  groupId?: number;
}

function subjectMatch(subject: RoleBindingSubject): SQL {
  return 'userId' in subject ? eq(roleBindings.userId, subject.userId) : eq(roleBindings.groupId, subject.groupId);
}

function scopeMatch(projectId: number | null): SQL {
  return projectId === null ? isNull(roleBindings.projectId) : eq(roleBindings.projectId, projectId);
}

function subjectColumns(subject: RoleBindingSubject): { userId: number | null; groupId: number | null } {
  return 'userId' in subject ? { userId: subject.userId, groupId: null } : { userId: null, groupId: subject.groupId };
}

function assertProjectRole(role: string): asserts role is ProjectRole {
  if (!isProjectRole(role)) throw new Error(`Unknown project role: ${role}`);
}

// ── A user's access ───────────────────────────────────────────────────────────

/** The user's own bindings and the bindings of every group they belong to. */
export async function getUserGrants(db: DrizzleDB, userId: number): Promise<RoleBindingGrant[]> {
  const userGroups = db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId));
  const rows = await db
    .select({ projectId: roleBindings.projectId, role: roleBindings.role })
    .from(roleBindings)
    .where(or(eq(roleBindings.userId, userId), inArray(roleBindings.groupId, userGroups)));
  return rows.filter((row): row is RoleBindingGrant => isProjectRole(row.role));
}

/**
 * Everything needed to authorize a user. An administrator holds every
 * permission, so no binding is read; any other instance role counts as a
 * member, whose rights all come from role bindings.
 */
export async function getUserAccess(db: DrizzleDB, user: { id: number; role: string }): Promise<AccessSummary> {
  if (user.role === InstanceRole.ADMINISTRATOR) {
    return { instanceRole: InstanceRole.ADMINISTRATOR, allProjects: [], projects: {} };
  }
  return buildAccessSummary(InstanceRole.MEMBER, await getUserGrants(db, user.id));
}

// ── Reading and writing bindings ──────────────────────────────────────────────

/** Bindings matching every given filter, with their subject, in creation order. */
export async function listRoleBindings(db: DrizzleDB, filter: RoleBindingFilter = {}): Promise<RoleBindingRow[]> {
  const conditions: SQL[] = [];
  if (filter.projectId !== undefined) conditions.push(scopeMatch(filter.projectId));
  if (filter.userId !== undefined) conditions.push(eq(roleBindings.userId, filter.userId));
  if (filter.groupId !== undefined) conditions.push(eq(roleBindings.groupId, filter.groupId));
  const rows = await db
    .select({
      id: roleBindings.id,
      userId: roleBindings.userId,
      groupId: roleBindings.groupId,
      projectId: roleBindings.projectId,
      role: roleBindings.role,
      createdBy: roleBindings.createdBy,
      createdAt: roleBindings.createdAt,
      username: users.username,
      userName: users.name,
      groupName: groups.name,
    })
    .from(roleBindings)
    .leftJoin(users, eq(roleBindings.userId, users.id))
    .leftJoin(groups, eq(roleBindings.groupId, groups.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(roleBindings.id));

  const result: RoleBindingRow[] = [];
  for (const row of rows) {
    if (!isProjectRole(row.role)) continue;
    let subject: RoleBindingSubjectInfo;
    if (row.userId !== null && row.username !== null) {
      subject = { kind: 'user', id: row.userId, username: row.username, name: row.userName };
    } else if (row.groupId !== null && row.groupName !== null) {
      subject = { kind: 'group', id: row.groupId, name: row.groupName };
    } else {
      continue;
    }
    result.push({
      id: row.id,
      subject,
      projectId: row.projectId,
      role: row.role,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    });
  }
  return result;
}

/**
 * Give a subject a role on one project, or on all projects when `projectId` is
 * null, replacing the role it held there; a null role removes the binding.
 * Idempotent. Two concurrent calls for the same subject and scope leave one
 * binding, holding the role of the call that wrote last.
 */
export async function setRoleBinding(
  db: DrizzleDB,
  input: {
    subject: RoleBindingSubject;
    projectId: number | null;
    role: ProjectRole | null;
    createdBy?: number | null;
  },
): Promise<void> {
  const { subject, projectId, role } = input;
  const match = and(subjectMatch(subject), scopeMatch(projectId));
  if (role === null) {
    await db.delete(roleBindings).where(match);
    return;
  }
  assertProjectRole(role);

  const updated = await db.update(roleBindings).set({ role }).where(match).returning({ id: roleBindings.id });
  if (updated.length > 0) return;
  const inserted = await db
    .insert(roleBindings)
    .values({ ...subjectColumns(subject), projectId, role, createdBy: input.createdBy ?? null })
    .onConflictDoNothing()
    .returning({ id: roleBindings.id });
  if (inserted.length > 0) return;
  // The unique (subject, scope) index refused the row: a concurrent call bound it first.
  await db.update(roleBindings).set({ role }).where(match);
}

/**
 * Replace every binding on one project (not the all-projects ones) with
 * `entries`, in one transaction. A subject listed twice keeps its last role.
 */
export async function replaceProjectBindings(
  db: DrizzleDB,
  projectId: number,
  entries: { subject: RoleBindingSubject; role: ProjectRole }[],
  createdBy?: number | null,
): Promise<void> {
  const bySubject = new Map<string, { subject: RoleBindingSubject; role: ProjectRole }>();
  for (const entry of entries) {
    assertProjectRole(entry.role);
    const key = 'userId' in entry.subject ? `user:${entry.subject.userId}` : `group:${entry.subject.groupId}`;
    bySubject.set(key, entry);
  }
  await db.transaction(async (tx) => {
    await tx.delete(roleBindings).where(eq(roleBindings.projectId, projectId));
    if (bySubject.size === 0) return;
    await tx.insert(roleBindings).values(
      [...bySubject.values()].map(({ subject, role }) => ({
        ...subjectColumns(subject),
        projectId,
        role,
        createdBy: createdBy ?? null,
      })),
    );
  });
}

/**
 * Replace every binding of one subject (on all projects and on each project)
 * with `grants`, in one transaction. A scope listed twice keeps its last role.
 */
export async function replaceSubjectBindings(
  db: DrizzleDB,
  subject: RoleBindingSubject,
  grants: readonly RoleBindingGrant[],
  createdBy?: number | null,
): Promise<void> {
  const byScope = new Map<number | null, ProjectRole>();
  for (const grant of grants) {
    assertProjectRole(grant.role);
    byScope.set(grant.projectId, grant.role);
  }
  await db.transaction(async (tx) => {
    await tx.delete(roleBindings).where(subjectMatch(subject));
    if (byScope.size === 0) return;
    await tx.insert(roleBindings).values(
      [...byScope].map(([projectId, role]) => ({
        ...subjectColumns(subject),
        projectId,
        role,
        createdBy: createdBy ?? null,
      })),
    );
  });
}

// ── A project's members ───────────────────────────────────────────────────────

/** Where a role held on a project comes from. */
export type ProjectRoleSource =
  /** A binding on this project. */
  | { via: 'project' }
  /** A binding on all projects. */
  | { via: 'all-projects' }
  /** A binding of a group the user belongs to, on this project or on all projects. */
  | { via: 'group'; groupId: number; groupName: string; allProjects: boolean };

export interface ProjectRoleGrant {
  role: ProjectRole;
  source: ProjectRoleSource;
}

export interface ProjectUserMember {
  id: number;
  username: string;
  name: string | null;
  /** An administrator holds every permission on every project, with or without a binding. */
  administrator: boolean;
  /** Every binding giving the user a role here, own and through groups. Empty for an administrator without one. */
  grants: ProjectRoleGrant[];
}

export interface ProjectGroupMember {
  id: number;
  name: string;
  /** The group's own bindings here (`via` is `project` or `all-projects`). */
  grants: ProjectRoleGrant[];
  memberIds: number[];
}

export interface ProjectMembers {
  users: ProjectUserMember[];
  groups: ProjectGroupMember[];
}

const byDisplayName = (a: { name: string | null; username?: string }, b: { name: string | null; username?: string }) =>
  (a.name ?? a.username ?? '').localeCompare(b.name ?? b.username ?? '', undefined, { sensitivity: 'base' });

/**
 * Everyone holding a role on a project, and every group with a binding on it:
 * bindings on the project and on all projects, own and through groups, and the
 * administrators, who need none.
 */
export async function getProjectMembers(db: DrizzleDB, projectId: number): Promise<ProjectMembers> {
  const bindings = await db
    .select({
      userId: roleBindings.userId,
      groupId: roleBindings.groupId,
      projectId: roleBindings.projectId,
      role: roleBindings.role,
    })
    .from(roleBindings)
    .where(or(eq(roleBindings.projectId, projectId), isNull(roleBindings.projectId)))
    .orderBy(asc(roleBindings.id));

  const groupIds = [...new Set(bindings.map((b) => b.groupId).filter((id): id is number => id !== null))];
  const groupRows =
    groupIds.length > 0
      ? await db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupIds))
      : [];
  const memberRows =
    groupIds.length > 0
      ? await db
          .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
          .from(groupMembers)
          .where(inArray(groupMembers.groupId, groupIds))
          .orderBy(asc(groupMembers.userId))
      : [];

  const groupsById = new Map<number, ProjectGroupMember>(
    groupRows.map((g) => [g.id, { id: g.id, name: g.name, grants: [], memberIds: [] }]),
  );
  for (const row of memberRows) groupsById.get(row.groupId)?.memberIds.push(row.userId);

  const userGrants = new Map<number, ProjectRoleGrant[]>();
  const addUserGrant = (userId: number, grant: ProjectRoleGrant) => {
    const grants = userGrants.get(userId);
    if (grants) grants.push(grant);
    else userGrants.set(userId, [grant]);
  };
  for (const binding of bindings) {
    if (!isProjectRole(binding.role)) continue;
    const allProjects = binding.projectId === null;
    if (binding.userId !== null) {
      addUserGrant(binding.userId, { role: binding.role, source: { via: allProjects ? 'all-projects' : 'project' } });
      continue;
    }
    const group = binding.groupId !== null ? groupsById.get(binding.groupId) : undefined;
    if (!group) continue;
    group.grants.push({ role: binding.role, source: { via: allProjects ? 'all-projects' : 'project' } });
    for (const userId of group.memberIds) {
      addUserGrant(userId, {
        role: binding.role,
        source: { via: 'group', groupId: group.id, groupName: group.name, allProjects },
      });
    }
  }

  const userRows = await db
    .select({ id: users.id, username: users.username, name: users.name, role: users.role })
    .from(users)
    .where(
      userGrants.size > 0
        ? or(eq(users.role, InstanceRole.ADMINISTRATOR), inArray(users.id, [...userGrants.keys()]))
        : eq(users.role, InstanceRole.ADMINISTRATOR),
    );

  return {
    users: userRows
      .map((user) => ({
        id: user.id,
        username: user.username,
        name: user.name,
        administrator: user.role === InstanceRole.ADMINISTRATOR,
        grants: userGrants.get(user.id) ?? [],
      }))
      .sort((a, b) => byDisplayName(a, b) || a.id - b.id),
    groups: [...groupsById.values()]
      .filter((group) => group.grants.length > 0)
      .sort((a, b) => byDisplayName(a, b) || a.id - b.id),
  };
}
