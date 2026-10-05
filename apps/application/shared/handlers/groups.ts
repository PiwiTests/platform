/**
 * Groups: named sets of users. A group receives project roles through role
 * bindings (`./role-bindings`), like a user does, and never carries the
 * instance role. Shared by the server routes and the demo.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { groupMembers, groups, roleBindings, users, type Group } from '../../server/database/schema';
import type { DrizzleDB } from './db';

/** A refusal the routes turn into an API error with `statusCode` (409 for a name already taken). */
export class GroupError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface GroupSummary {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMemberInfo {
  id: number;
  username: string;
  name: string | null;
  addedBy: number | null;
  addedAt: Date;
}

export interface GroupDetails extends GroupSummary {
  members: GroupMemberInfo[];
}

export interface GroupInput {
  name: string;
  description?: string | null;
}

const groupNotFound = () => new GroupError(404, 'Group not found');
const nameTaken = (name: string) => new GroupError(409, `A group named "${name}" already exists`);

function cleanName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new GroupError(400, 'A group needs a name');
  return name;
}

function cleanDescription(raw: string | null | undefined): string | null {
  return raw?.trim() || null;
}

const byName = <T extends { name: string | null; username?: string }>(a: T, b: T) =>
  (a.name ?? a.username ?? '').localeCompare(b.name ?? b.username ?? '', undefined, { sensitivity: 'base' });

function toSummary(row: Group, memberCount: number): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    memberCount,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findGroup(db: DrizzleDB, id: number): Promise<Group | undefined> {
  return (await db.select().from(groups).where(eq(groups.id, id)))[0];
}

async function memberCount(db: DrizzleDB, groupId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  return row?.count ?? 0;
}

async function isNameTaken(db: DrizzleDB, name: string, exceptId?: number): Promise<boolean> {
  const match = exceptId === undefined ? eq(groups.name, name) : and(eq(groups.name, name), ne(groups.id, exceptId));
  return (await db.select({ id: groups.id }).from(groups).where(match).limit(1)).length > 0;
}

/** Every group with its member count, by name. */
export async function listGroups(db: DrizzleDB): Promise<GroupSummary[]> {
  const rows = await db.select().from(groups);
  const counts = await db
    .select({ groupId: groupMembers.groupId, count: sql<number>`count(*)`.mapWith(Number) })
    .from(groupMembers)
    .groupBy(groupMembers.groupId);
  const countByGroup = new Map(counts.map((row) => [row.groupId, row.count]));
  return rows.map((row) => toSummary(row, countByGroup.get(row.id) ?? 0)).sort((a, b) => byName(a, b) || a.id - b.id);
}

/** One group with its members, by the names shown; null when it does not exist. */
export async function getGroup(db: DrizzleDB, id: number): Promise<GroupDetails | null> {
  const row = await findGroup(db, id);
  if (!row) return null;
  const members = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      addedBy: groupMembers.addedBy,
      addedAt: groupMembers.createdAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, id));
  members.sort((a, b) => byName(a, b) || a.id - b.id);
  return { ...toSummary(row, members.length), members };
}

/** Create an empty group. Throws a 409 `GroupError` when the name is taken. */
export async function createGroup(
  db: DrizzleDB,
  input: GroupInput & { createdBy?: number | null },
): Promise<GroupSummary> {
  const name = cleanName(input.name);
  const now = new Date();
  const [row] = await db
    .insert(groups)
    .values({
      name,
      description: cleanDescription(input.description),
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: groups.name })
    .returning();
  if (!row) throw nameTaken(name);
  return toSummary(row, 0);
}

/** Rename a group or change its description. Throws a 404 or 409 `GroupError`. */
export async function updateGroup(db: DrizzleDB, id: number, patch: Partial<GroupInput>): Promise<GroupSummary> {
  if (!(await findGroup(db, id))) throw groupNotFound();
  const set: Partial<typeof groups.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    set.name = cleanName(patch.name);
    if (await isNameTaken(db, set.name, id)) throw nameTaken(set.name);
  }
  if (patch.description !== undefined) set.description = cleanDescription(patch.description);

  let row: Group | undefined;
  try {
    [row] = await db.update(groups).set(set).where(eq(groups.id, id)).returning();
  } catch (error) {
    // A concurrent rename took the name between the check and the update.
    if (set.name !== undefined && (await isNameTaken(db, set.name, id))) throw nameTaken(set.name);
    throw error;
  }
  if (!row) throw groupNotFound();
  return toSummary(row, await memberCount(db, id));
}

/** Delete a group, its memberships and its role bindings. Throws a 404 `GroupError`. */
export async function deleteGroup(db: DrizzleDB, id: number): Promise<void> {
  // Deleted explicitly rather than through the foreign keys' cascade, which the demo's database does not enforce.
  await db.transaction(async (tx) => {
    await tx.delete(roleBindings).where(eq(roleBindings.groupId, id));
    await tx.delete(groupMembers).where(eq(groupMembers.groupId, id));
    const deleted = await tx.delete(groups).where(eq(groups.id, id)).returning({ id: groups.id });
    if (deleted.length === 0) throw groupNotFound();
  });
}

/**
 * Make `userIds` the group's members: missing ones are added, the others
 * removed, and those staying keep when and by whom they were added. Throws a
 * 404 `GroupError` for a missing group and a 400 one for an unknown user.
 */
export async function setGroupMembers(
  db: DrizzleDB,
  groupId: number,
  userIds: number[],
  addedBy?: number | null,
): Promise<void> {
  if (!(await findGroup(db, groupId))) throw groupNotFound();
  const wanted = [...new Set(userIds)];
  if (wanted.length > 0) {
    const known = await db.select({ id: users.id }).from(users).where(inArray(users.id, wanted));
    const knownIds = new Set(known.map((row) => row.id));
    const unknown = wanted.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) throw new GroupError(400, `Unknown user id: ${unknown.join(', ')}`);
  }

  await db.transaction(async (tx) => {
    const current = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    const currentIds = new Set(current.map((row) => row.userId));
    const wantedIds = new Set(wanted);
    const removed = [...currentIds].filter((id) => !wantedIds.has(id));
    const added = wanted.filter((id) => !currentIds.has(id));
    if (removed.length > 0) {
      await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.userId, removed)));
    }
    if (added.length > 0) {
      await tx
        .insert(groupMembers)
        .values(added.map((userId) => ({ groupId, userId, addedBy: addedBy ?? null })))
        .onConflictDoNothing();
    }
    if (removed.length > 0 || added.length > 0) {
      await tx.update(groups).set({ updatedAt: new Date() }).where(eq(groups.id, groupId));
    }
  });
}

/** Throw a 400 `GroupError` naming the ids of `groupIds` that are not groups. */
export async function assertGroupsExist(db: DrizzleDB, groupIds: readonly number[]): Promise<void> {
  const wanted = [...new Set(groupIds)];
  if (wanted.length === 0) return;
  const known = await db.select({ id: groups.id }).from(groups).where(inArray(groups.id, wanted));
  const knownIds = new Set(known.map((row) => row.id));
  const unknown = wanted.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) throw new GroupError(400, `Group(s) not found: ${unknown.join(', ')}`);
}

/**
 * Make `groupIds` the groups a user belongs to: the user joins the missing
 * ones and leaves the others, and the memberships staying keep when and by
 * whom they were added. Throws a 400 `GroupError` for an unknown group.
 */
export async function setUserGroups(
  db: DrizzleDB,
  userId: number,
  groupIds: readonly number[],
  addedBy?: number | null,
): Promise<void> {
  await assertGroupsExist(db, groupIds);
  const wanted = new Set(groupIds);
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));
    const currentIds = new Set(current.map((row) => row.groupId));
    const left = [...currentIds].filter((id) => !wanted.has(id));
    const joined = [...wanted].filter((id) => !currentIds.has(id));
    if (left.length > 0) {
      await tx.delete(groupMembers).where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, left)));
    }
    if (joined.length > 0) {
      await tx
        .insert(groupMembers)
        .values(joined.map((groupId) => ({ groupId, userId, addedBy: addedBy ?? null })))
        .onConflictDoNothing();
    }
    const changed = [...left, ...joined];
    if (changed.length > 0) {
      await tx.update(groups).set({ updatedAt: new Date() }).where(inArray(groups.id, changed));
    }
  });
}

/** The groups each user belongs to, ascending, keyed by user id. */
export async function getGroupIdsByUser(db: DrizzleDB): Promise<Map<number, number[]>> {
  const rows = await db
    .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
    .from(groupMembers)
    .orderBy(groupMembers.groupId);
  const byUser = new Map<number, number[]>();
  for (const row of rows) {
    const ids = byUser.get(row.userId);
    if (ids) ids.push(row.groupId);
    else byUser.set(row.userId, [row.groupId]);
  }
  return byUser;
}

/** The groups a user belongs to, by name. */
export async function getUserGroups(db: DrizzleDB, userId: number): Promise<{ id: number; name: string }[]> {
  const rows = await db
    .select({ id: groups.id, name: groups.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, userId));
  return rows.sort((a, b) => byName(a, b) || a.id - b.id);
}
