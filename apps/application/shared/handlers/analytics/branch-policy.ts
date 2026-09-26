/**
 * The branch policy of an analytics scope, as SQL over any table carrying a
 * project id and a branch column: the rollups (`''` is the unknown branch) and
 * `test_runs` (`NULL` is the unknown branch).
 */

import { and, eq, inArray, isNull, or, type SQL, type SQLWrapper } from 'drizzle-orm';

export type BranchPolicy =
  /** Every branch. */
  | { kind: 'any' }
  /** Exactly these branches, chosen by hand. */
  | { kind: 'list'; branches: string[] }
  /** Each project's default branch, plus runs whose branch is unknown. */
  | { kind: 'default'; groups: Array<{ branch: string; projectIds: number[] }> };

/** Group projects by their default branch, so the SQL has one clause per branch name. */
export function defaultBranchPolicy(defaults: Map<number, string>): BranchPolicy {
  const byBranch = new Map<string, number[]>();
  for (const [projectId, branch] of defaults) {
    const list = byBranch.get(branch) ?? [];
    list.push(projectId);
    byBranch.set(branch, list);
  }
  return {
    kind: 'default',
    groups: [...byBranch].map(([branch, projectIds]) => ({ branch, projectIds })),
  };
}

/** The condition a branch policy puts on a row, or null for no condition. */
export function branchPolicyCondition(
  policy: BranchPolicy,
  columns: { branch: SQLWrapper; projectId: SQLWrapper },
  unknown: 'empty' | 'null',
): SQL | null {
  if (policy.kind === 'any') return null;
  if (policy.kind === 'list') return inArray(columns.branch as any, policy.branches);
  const unknownBranch =
    unknown === 'empty'
      ? eq(columns.branch as any, '')
      : or(isNull(columns.branch as any), eq(columns.branch as any, ''))!;
  const perDefault = policy.groups.map((g) =>
    and(eq(columns.branch as any, g.branch), inArray(columns.projectId as any, g.projectIds))!,
  );
  return or(unknownBranch, ...perDefault)!;
}
