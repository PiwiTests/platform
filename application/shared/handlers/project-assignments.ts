import { projectAssignments, users } from '../../server/database/schema';
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
  const projectIds = rows
    .filter((r): r is { projectId: number } => r.projectId !== null)
    .map((r) => r.projectId);

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
  await db
    .delete(projectAssignments)
    .where(and(eq(projectAssignments.projectId, projectId)));

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

// Backfill: give all existing USER/REPORTER users global access (idempotent)
export async function backfillProjectAssignments(db: DrizzleDB): Promise<void> {
  const allUsers = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(or(eq(users.role, Role.USER), eq(users.role, Role.REPORTER)));

  for (const user of allUsers) {
    const existing = await db
      .select({ id: projectAssignments.id })
      .from(projectAssignments)
      .where(eq(projectAssignments.userId, user.id))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(projectAssignments).values({
        userId: user.id,
        projectId: null,
      });
    }
  }
}
