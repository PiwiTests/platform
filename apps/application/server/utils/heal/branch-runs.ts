/**
 * Runs on a heal branch. The branch name carries the run the heal came from
 * and its edit-set signature (`healBranchName`), so a run reported from it
 * finds its heal action by the dedupe key, without a lookup table.
 *
 * Each eligible run there is recorded on the action's result as `branchRun`.
 * The first one in which every healed test ran and passed is also recorded as
 * `verifiedOnBranch`, and, while the PR is open and auto-heal is on, posts one
 * comment on the PR saying so. The PR itself is left as it is: a draft stays a
 * draft.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { healActions, testRuns, testRunsCases } from '../../database/schema';
import { createScmProvider } from '../scm';
import { resolveRunBranch } from '../run-branch';
import { getAutoHealSettings, resolveHealSiteUrl } from './settings';
import { isEligibleRun } from '#shared/run-eligibility';
import {
  healDedupeKey,
  parseHealBranch,
  type HealActionPayload,
  type HealActionResult,
  type HealBranchRun,
} from '#shared/auto-heal';
import { buildHealBranchVerifiedComment, HEAL_BRANCH_VERIFIED_MARKER } from '#shared/heal-pr';
import type { RunMetadata } from '../run-json-types';
import type { DbClient } from '../../database';

export type HealBranchRunResult =
  | { recorded: true; actionId: number; passed: boolean; commented: boolean }
  | { recorded: false; reason: string };

/** Whether every healed test ran and passed, from the statuses the run recorded per test case. */
export function healedTestsPassed(healedCaseIds: number[], statuses: Map<number, string[]>): boolean {
  if (healedCaseIds.length === 0) return false;
  return healedCaseIds.every((id) => statuses.get(id)?.includes('passed') === true);
}

/** Record a finished run on a heal branch on its heal action. Best-effort; never throws on SCM errors. */
export async function recordHealBranchRun(db: DbClient, runId: number): Promise<HealBranchRunResult> {
  const skip = (reason: string): HealBranchRunResult => ({ recorded: false, reason });

  const [run] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
  if (!run) return skip('run not found');
  const settings = await getAutoHealSettings(db);
  const parsed = parseHealBranch(run.branch ?? resolveRunBranch(run.metadata), settings.branchPrefix);
  if (!parsed) return skip('not a heal branch');
  if (!isEligibleRun(run, 'fix-verification')) return skip('run is not eligible');

  const [action] = await db
    .select()
    .from(healActions)
    .where(
      and(
        eq(healActions.projectId, run.projectId),
        eq(healActions.dedupeKey, healDedupeKey(run.projectId, parsed.signature)),
      ),
    );
  const result = action?.result as HealActionResult | null | undefined;
  if (!action || !result?.prNumber) return skip('no heal PR for this branch');

  const payload = action.payload as HealActionPayload;
  const executionIds = [...new Set(payload.edits.map((edit) => edit.executionId).filter(Number.isInteger))];
  const healed = executionIds.length
    ? await db
        .select({ testCaseId: testRunsCases.testCaseId })
        .from(testRunsCases)
        .where(inArray(testRunsCases.id, executionIds))
    : [];
  const healedCaseIds = [...new Set(healed.map((row) => row.testCaseId))];
  if (healedCaseIds.length === 0) return skip('the healed tests are no longer stored');

  const cases = await db
    .select({ testCaseId: testRunsCases.testCaseId, status: testRunsCases.status })
    .from(testRunsCases)
    .where(and(eq(testRunsCases.testRunId, runId), inArray(testRunsCases.testCaseId, healedCaseIds)));
  const statuses = new Map<number, string[]>();
  for (const row of cases) statuses.set(row.testCaseId, [...(statuses.get(row.testCaseId) ?? []), row.status]);
  const passed = healedTestsPassed(healedCaseIds, statuses);

  const branchRun: HealBranchRun = {
    runId,
    commit: (run.metadata as RunMetadata | null)?.scm?.commit?.trim() || null,
    passed,
    at: new Date().toISOString(),
  };
  const firstPass = passed && !result.verifiedOnBranch;
  const next: HealActionResult = { ...result, branchRun, ...(firstPass ? { verifiedOnBranch: branchRun } : {}) };
  await db.update(healActions).set({ result: next }).where(eq(healActions.id, action.id));

  let commented = false;
  if (firstPass && action.status === 'opened' && settings.enabled) {
    try {
      const provider = await createScmProvider(payload.repositoryUrl, db, run.projectId);
      commented =
        (await provider?.upsertPullRequestComment(
          result.prNumber,
          HEAL_BRANCH_VERIFIED_MARKER,
          buildHealBranchVerifiedComment({
            runId,
            commit: branchRun.commit,
            testCount: healedCaseIds.length,
            siteUrl: resolveHealSiteUrl(),
            draft: payload.draft,
          }),
        )) ?? false;
    } catch (err) {
      console.error(`[auto-heal] heal-branch comment failed for action ${action.id}`, err);
    }
  }
  return { recorded: true, actionId: action.id, passed, commented };
}
