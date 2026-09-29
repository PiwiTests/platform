/**
 * Keep `opened` heal actions in step with their pull request on the SCM. A PR
 * the SCM reports merged or closed moves its action to `merged` / `closed`, so
 * the per-project open-PR cap counts only PRs that are still open and the
 * "Piwi opened a PR" chips stop showing once the PR is settled.
 *
 * Best-effort per row: a project with no SCM token, an unsupported host, a
 * failed lookup or a PR the SCM still reports open leaves the row as it is.
 */
import { and, asc, eq } from 'drizzle-orm';
import { healActions } from '../../database/schema';
import { resolveScmToken, scmProviderForUrl } from '../scm';
import type { HealActionPayload, HealActionResult } from '#shared/auto-heal';
import type { DbClient } from '../../database';

/** Opened actions checked in one pass. */
export const PR_STATE_BATCH = 50;

export interface PrStateRefresh {
  /** Pull requests looked up on the SCM. */
  checked: number;
  merged: number;
  closed: number;
}

/**
 * Ask the SCM about the oldest-updated `opened` actions (all projects, or one)
 * and record the ones whose PR has been merged or closed.
 */
export async function refreshOpenHealActions(
  db: DbClient,
  opts: { projectId?: number; limit?: number } = {},
): Promise<PrStateRefresh> {
  const refresh: PrStateRefresh = { checked: 0, merged: 0, closed: 0 };

  const rows = await db
    .select()
    .from(healActions)
    .where(
      and(
        eq(healActions.status, 'opened'),
        opts.projectId != null ? eq(healActions.projectId, opts.projectId) : undefined,
      ),
    )
    .orderBy(asc(healActions.updatedAt))
    .limit(opts.limit ?? PR_STATE_BATCH);

  const tokens = new Map<number, string | null>();
  for (const row of rows) {
    const prNumber = (row.result as HealActionResult | null)?.prNumber;
    if (!prNumber) continue;
    try {
      if (!tokens.has(row.projectId)) tokens.set(row.projectId, await resolveScmToken(db, row.projectId));
      const token = tokens.get(row.projectId);
      if (!token) continue;
      const provider = scmProviderForUrl((row.payload as HealActionPayload).repositoryUrl, token);
      if (!provider) continue;

      const state = (await provider.fetchPullRequest(prNumber))?.state;
      refresh.checked++;
      if (state !== 'merged' && state !== 'closed') continue;

      await db
        .update(healActions)
        .set({ status: state, updatedAt: new Date() })
        .where(and(eq(healActions.id, row.id), eq(healActions.status, 'opened')));
      refresh[state]++;
    } catch (err) {
      console.error(`[auto-heal] PR state refresh failed for action ${row.id}`, err);
    }
  }

  return refresh;
}
