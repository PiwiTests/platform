import type { H3Event } from 'h3';
import { apiError } from './api-error';
import { getDatabase } from '../database';
import type { DbClient } from '../database';
import {
  projectAssignments,
  testRuns,
  testCases,
  testRunsCases,
  failureClusters,
  failureDiagnoses,
  markers,
  testFunctions,
  entityLinks,
} from '../database/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, isAuthEnabled } from './auth';
import { Role } from '#shared/types';
import type { User } from '../database/schema';

export type DrizzleDB = DbClient;

export type ProjectScope = 'all' | Set<number>;

export async function getProjectScope(db: DrizzleDB, user: User | null): Promise<ProjectScope> {
  if (!user || !isAuthEnabled()) {
    return 'all';
  }

  if ((user.role as Role) === Role.ADMINISTRATOR) {
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

export async function canAccessProject(db: DrizzleDB, user: User | null, projectId: number): Promise<boolean> {
  const scope = await getProjectScope(db, user);
  return scopeAllows(scope, projectId);
}

export async function requireProjectAccess(event: H3Event, projectId: number, roles?: Role[]): Promise<User> {
  const user = await requireAuth(event, roles);
  const db = await getDatabase();
  const canAccess = await canAccessProject(db, user, projectId);
  if (!canAccess) {
    throw apiError({
      statusCode: 403,
      message: 'No access to this project',
    });
  }
  return user;
}

/** Parse and validate a numeric route param, throwing 400 if missing/invalid. */
export function requireRouteId(event: H3Event, paramName = 'id', label = 'ID'): number {
  const id = parseInt(getRouterParam(event, paramName) || '0');
  if (!id) throw apiError({ statusCode: 400, message: `Invalid ${label}` });
  return id;
}

/**
 * Resolve a child entity's project via `resolve`, 404 if the entity doesn't
 * exist, then require the caller has access to that project. Returns the
 * db/projectId/user so callers don't need a second getDatabase() call.
 */
export async function requireResolvedProjectAccess(
  event: H3Event,
  id: number,
  resolve: (db: DrizzleDB, id: number) => Promise<number | null>,
  notFoundLabel: string,
  roles?: Role[],
): Promise<{ db: DrizzleDB; projectId: number; user: User }> {
  const db = await getDatabase();
  const projectId = await resolve(db, id);
  if (!projectId) throw apiError({ statusCode: 404, message: `${notFoundLabel} not found` });
  const user = await requireProjectAccess(event, projectId, roles);
  return { db, projectId, user };
}

// Helpers to resolve projectId from entity IDs
export async function resolveRunProjectId(db: DrizzleDB, runId: number): Promise<number | null> {
  const rows = await db.select({ projectId: testRuns.projectId }).from(testRuns).where(eq(testRuns.id, runId));
  return rows[0]?.projectId ?? null;
}

export async function resolveCaseProjectId(db: DrizzleDB, caseId: number): Promise<number | null> {
  const rows = await db.select({ projectId: testCases.projectId }).from(testCases).where(eq(testCases.id, caseId));
  return rows[0]?.projectId ?? null;
}

export async function resolveClusterProjectId(db: DrizzleDB, clusterId: number): Promise<number | null> {
  const rows = await db
    .select({ projectId: failureClusters.projectId })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  return rows[0]?.projectId ?? null;
}

export async function resolveTestRunCaseProjectId(db: DrizzleDB, runCaseId: number): Promise<number | null> {
  const rows = await db
    .select({ projectId: testRuns.projectId })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(testRunsCases.id, runCaseId))
    .limit(1);
  return rows[0]?.projectId ?? null;
}

export async function resolveMarkerProjectId(db: DrizzleDB, markerId: number): Promise<number | null> {
  const rows = await db.select({ projectId: markers.projectId }).from(markers).where(eq(markers.id, markerId));
  return rows[0]?.projectId ?? null;
}

export async function resolveTestFunctionProjectId(db: DrizzleDB, testFunctionId: number): Promise<number | null> {
  const rows = await db
    .select({ projectId: testFunctions.projectId })
    .from(testFunctions)
    .where(eq(testFunctions.id, testFunctionId));
  return rows[0]?.projectId ?? null;
}

/** Resolve the project owning the entity an entity-link targets (list/create). */
export async function resolveLinkEntityProjectId(
  db: DrizzleDB,
  entityType: string,
  entityId: number,
): Promise<number | null> {
  if (entityType === 'test_run') return resolveRunProjectId(db, entityId);
  if (entityType === 'test_runs_case') return resolveTestRunCaseProjectId(db, entityId);
  if (entityType === 'test_case') return resolveCaseProjectId(db, entityId);
  if (entityType === 'failure_cluster') return resolveClusterProjectId(db, entityId);
  return null;
}

/** Resolve the project owning an existing entity link, via its target entity. */
export async function resolveLinkProjectId(db: DrizzleDB, linkId: number): Promise<number | null> {
  const rows = await db.select().from(entityLinks).where(eq(entityLinks.id, linkId)).limit(1);
  const link = rows[0];
  if (!link) return null;
  if (link.testRunId != null) return resolveRunProjectId(db, link.testRunId);
  if (link.testRunsCaseId != null) return resolveTestRunCaseProjectId(db, link.testRunsCaseId);
  if (link.testCaseId != null) return resolveCaseProjectId(db, link.testCaseId);
  if (link.failureClusterId != null) return resolveClusterProjectId(db, link.failureClusterId);
  return null;
}

export async function resolveDiagnosisProjectId(db: DrizzleDB, diagnosisId: number): Promise<number | null> {
  // Cluster-scoped diagnoses resolve via their cluster; execution-scoped rows carry no
  // cluster (null) and resolve via the execution's run instead.
  const rows = await db
    .select({ clusterProjectId: failureClusters.projectId, execProjectId: testRuns.projectId })
    .from(failureDiagnoses)
    .leftJoin(failureClusters, eq(failureDiagnoses.clusterId, failureClusters.id))
    .leftJoin(testRunsCases, eq(failureDiagnoses.testRunsCaseId, testRunsCases.id))
    .leftJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(eq(failureDiagnoses.id, diagnosisId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return row.clusterProjectId ?? row.execProjectId ?? null;
}
