import type { H3Event } from 'h3';
import { getDatabase } from '../database';
import { projectAssignments, testRuns, testCases, testRunsCases, failureClusters, failureDiagnoses } from '../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, isAuthEnabled } from './auth';
import { Role } from '../../shared/types';
import type { User } from '../database/schema';

export type ProjectScope = 'all' | Set<number>;

export async function getProjectScope(db: Awaited<ReturnType<typeof getDatabase>>, user: User | null): Promise<ProjectScope> {
  if (!user || !isAuthEnabled()) {
    return 'all';
  }

  if (user.role as Role === Role.ADMINISTRATOR) {
    return 'all';
  }

  const rows = await db
    .select({ projectId: projectAssignments.projectId })
    .from(projectAssignments)
    .where(eq(projectAssignments.userId, user.id));

  if (rows.length === 0) {
    return new Set<number>();
  }

  const hasGlobal = rows.some((r) => r.projectId === null);
  if (hasGlobal) {
    return 'all';
  }

  return new Set(rows.map((r) => r.projectId!).filter((id): id is number => id != null));
}

export function scopeAllows(scope: ProjectScope, projectId: number): boolean {
  return scope === 'all' || scope.has(projectId);
}

export async function canAccessProject(
  db: Awaited<ReturnType<typeof getDatabase>>,
  user: User | null,
  projectId: number,
): Promise<boolean> {
  const scope = await getProjectScope(db, user);
  return scopeAllows(scope, projectId);
}

export async function requireProjectAccess(
  event: H3Event,
  projectId: number,
  roles?: Role[],
): Promise<User> {
  const user = await requireAuth(event, roles);
  const db = await getDatabase();
  const canAccess = await canAccessProject(db, user, projectId);
  if (!canAccess) {
    throw createError({
      statusCode: 403,
      message: 'No access to this project',
    });
  }
  return user;
}

// Helpers to resolve projectId from entity IDs
export async function resolveRunProjectId(db: Awaited<ReturnType<typeof getDatabase>>, runId: number): Promise<number | null> {
  const rows = await db.select({ projectId: testRuns.projectId }).from(testRuns).where(eq(testRuns.id, runId));
  return rows[0]?.projectId ?? null;
}

export async function resolveCaseProjectId(db: Awaited<ReturnType<typeof getDatabase>>, caseId: number): Promise<number | null> {
  const rows = await db.select({ projectId: testCases.projectId }).from(testCases).where(eq(testCases.id, caseId));
  return rows[0]?.projectId ?? null;
}

export async function resolveClusterProjectId(db: Awaited<ReturnType<typeof getDatabase>>, clusterId: number): Promise<number | null> {
  const rows = await db.select({ projectId: failureClusters.projectId }).from(failureClusters).where(eq(failureClusters.id, clusterId));
  return rows[0]?.projectId ?? null;
}

export async function resolveTestRunCaseProjectId(db: Awaited<ReturnType<typeof getDatabase>>, runCaseId: number): Promise<number | null> {
  const rows = await db
    .select({ projectId: testRuns.projectId })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.id, runCaseId))
    .limit(1);
  return rows[0]?.projectId ?? null;
}

export async function resolveDiagnosisProjectId(db: Awaited<ReturnType<typeof getDatabase>>, diagnosisId: number): Promise<number | null> {
  const rows = await db
    .select({ projectId: failureClusters.projectId })
    .from(failureDiagnoses)
    .innerJoin(failureClusters, eq(failureDiagnoses.clusterId, failureClusters.id))
    .where(eq(failureDiagnoses.id, diagnosisId))
    .limit(1);
  return rows[0]?.projectId ?? null;
}
