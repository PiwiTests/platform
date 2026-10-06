/**
 * A project run scope (`#shared/project-run-scope`) as SQL over `test_runs`,
 * for every handler behind a project tab that reads run history.
 */
import { and, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { testRuns } from '../../server/database/schema';
import { projectDefaultBranch } from '../../server/utils/scm/stored-default-branch';
import type { ProjectRunScope } from '../project-run-scope';
import { notLabRun } from './probes';
import type { DrizzleDB } from './db';

/**
 * The `test_runs` conditions of a scope over one project's runs. The default
 * branch is the project's stored one (`resolveStoredDefaultBranch`), and a run
 * with no branch counts on it.
 */
export async function projectRunScopeConditions(
  db: DrizzleDB,
  projectId: number,
  scope: ProjectRunScope,
): Promise<SQL[]> {
  const conditions: SQL[] = [];
  if (scope.fullRunsOnly) conditions.push(eq(testRuns.isFullRun, 1));
  if (scope.environments.length > 0) conditions.push(inArray(testRuns.environment, scope.environments));
  if (scope.branches.length > 0) {
    conditions.push(inArray(testRuns.branch, scope.branches));
  } else if (!scope.allBranches) {
    const defaultBranch = await projectDefaultBranch(db, projectId);
    conditions.push(or(eq(testRuns.branch, defaultBranch), isNull(testRuns.branch), eq(testRuns.branch, ''))!);
  }
  return conditions;
}

/**
 * The predicate on an execution's run id keeping the executions of the
 * project's runs that are not lab runs and meet `conditions` (from
 * `projectRunScopeConditions`): `notLabExecutionInProject` with a scope.
 */
export function scopedExecutionInProject(projectId: number, testRunId: SQLWrapper, conditions: SQL[]): SQL {
  const where = and(eq(testRuns.projectId, projectId), notLabRun(testRuns.origin), ...conditions)!;
  return sql`${testRunId} IN (SELECT ${testRuns.id} FROM ${testRuns} WHERE ${where})`;
}
