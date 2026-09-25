import { appSettings, projectAssignments, users } from '../../server/database/schema';
import { eq, and, isNull, or } from 'drizzle-orm';
import { Role } from '../types';
import type { DrizzleDB } from './db';

export interface UserAssignments {
  global: boolean;
  projectIds: number[];
}

export async function getUserAssignments(db: DrizzleDB, userId: number): Promise<UserAssignments> {
  const rows = await db
    .select({ projectId: projectAssignments.projectId })
    .from(projectAssignments)
    .where(eq(projectAssignments.userId, userId));

  const hasGlobal = rows.some((r) => r.projectId === null);
  const projectIds = rows.filter((r): r is { projectId: number } => r.projectId !== null).map((r) => r.projectId);

  return { global: hasGlobal, projectIds };
}

export async function setUserAssignments(
  db: DrizzleDB,
  userId: number,
  data: UserAssignments,
  createdBy?: number,
): Promise<void> {
  // Remove all existing assignments
  await db.delete(projectAssignments).where(eq(projectAssignments.userId, userId));

  if (data.global) {
    // Single global assignment row
    await db.insert(projectAssignments).values({
      userId,
      projectId: null,
      createdBy: createdBy ?? null,
    });
  } else if (data.projectIds.length > 0) {
    // One row per project
    await db.insert(projectAssignments).values(
      data.projectIds.map((projectId) => ({
        userId,
        projectId,
        createdBy: createdBy ?? null,
      })),
    );
  }
}

export interface ProjectMember {
  id: number;
  username: string;
  name: string | null;
  role: string;
  global: boolean;
}

export async function getProjectMembers(db: DrizzleDB, projectId: number): Promise<ProjectMember[]> {
  // Get users with explicit assignment to this project
  const explicitRows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
    })
    .from(projectAssignments)
    .innerJoin(users, eq(projectAssignments.userId, users.id))
    .where(eq(projectAssignments.projectId, projectId));

  // Get users with global assignment (projectId = null)
  const globalRows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
    })
    .from(projectAssignments)
    .innerJoin(users, eq(projectAssignments.userId, users.id))
    .where(isNull(projectAssignments.projectId));

  // Get all admins (implicit access)
  const adminRows = await db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(eq(users.role, Role.ADMINISTRATOR));

  const seenIds = new Set<number>();
  const members: ProjectMember[] = [];

  for (const row of explicitRows) {
    seenIds.add(row.id);
    members.push({ ...row, global: false });
  }

  for (const row of globalRows) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id);
      members.push({ ...row, global: true });
    }
  }

  for (const row of adminRows) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id);
      members.push({ ...row, global: true, role: Role.ADMINISTRATOR });
    }
  }

  return members;
}

export async function setProjectMembers(
  db: DrizzleDB,
  projectId: number,
  userIds: number[],
  createdBy?: number,
): Promise<void> {
  // Remove all explicit (non-global) assignments for this project
  await db.delete(projectAssignments).where(and(eq(projectAssignments.projectId, projectId)));

  // Insert new assignments
  if (userIds.length > 0) {
    await db.insert(projectAssignments).values(
      userIds.map((userId) => ({
        userId,
        projectId,
        createdBy: createdBy ?? null,
      })),
    );
  }
}

/** `app_settings` key claimed by the first `backfillProjectAssignments` run on a database. */
export const PROJECT_ASSIGNMENTS_BACKFILL_KEY = 'project_assignments_backfilled';

/**
 * Give every USER/REPORTER global access when a database first meets project
 * access: runs once per database, and grants only while `project_assignments` is
 * still empty. From then on a user without any assignment has no access, so a
 * user whose last project an administrator revokes stays without access across
 * restarts. The key is claimed atomically, so concurrent startups run it once.
 */
export async function backfillProjectAssignments(db: DrizzleDB): Promise<void> {
  const claimed = await db
    .insert(appSettings)
    .values({ key: PROJECT_ASSIGNMENTS_BACKFILL_KEY, value: true, updatedAt: new Date() })
    .onConflictDoNothing({ target: appSettings.key })
    .returning({ key: appSettings.key });
  if (claimed.length === 0) return;

  try {
    const anyAssignment = await db.select({ id: projectAssignments.id }).from(projectAssignments).limit(1);
    if (anyAssignment.length > 0) return;

    const members = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.role, Role.USER), eq(users.role, Role.REPORTER)));
    if (members.length === 0) return;
    await db.insert(projectAssignments).values(members.map((user) => ({ userId: user.id, projectId: null })));
  } catch (err) {
    // Release the claim so the next startup retries.
    await db.delete(appSettings).where(eq(appSettings.key, PROJECT_ASSIGNMENTS_BACKFILL_KEY));
    throw err;
  }
}
