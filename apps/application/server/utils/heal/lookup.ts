/**
 * Read-side lookups that connect a heal action back to the execution or cluster
 * it covers, for surfacing "Piwi opened a PR" chips. The action's payload is
 * opaque JSON, so matching happens in memory over the project's recent actions
 * (a bounded set) rather than in SQL.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { healActions } from '../../database/schema';
import type { HealActionPayload, HealActionResult, HealActionStatus } from '#shared/auto-heal';
import type { DbClient } from '../../database';

/** Compact heal-action summary for the UI. */
export interface HealActionChip {
  id: number;
  status: HealActionStatus;
  prNumber: number | null;
  prUrl: string | null;
  branch: string;
}

/** Actions worth surfacing — an open PR, or one still on its way. */
const LIVE_STATUSES: HealActionStatus[] = ['opened', 'pending'];

async function liveActionsForProject(db: DbClient, projectId: number) {
  return db
    .select()
    .from(healActions)
    .where(and(eq(healActions.projectId, projectId), inArray(healActions.status, LIVE_STATUSES)))
    .orderBy(desc(healActions.id))
    .limit(50);
}

function toChip(row: { id: number; status: string; payload: unknown; result: unknown }): HealActionChip {
  const payload = row.payload as HealActionPayload;
  const result = row.result as HealActionResult | null;
  return {
    id: row.id,
    status: row.status as HealActionStatus,
    prNumber: result?.prNumber ?? null,
    prUrl: result?.prUrl ?? null,
    branch: payload.branch,
  };
}

/**
 * The live heal action covering a call site (file + line), if any. Matched by
 * call site — not execution id — because a heal opened from the default-branch
 * run must still be recognized on a later run's execution of the same broken
 * locator.
 */
export async function findHealActionForCallSite(
  db: DbClient,
  projectId: number,
  filePath: string,
  line: number,
): Promise<HealActionChip | null> {
  for (const row of await liveActionsForProject(db, projectId)) {
    const payload = row.payload as HealActionPayload;
    if (payload.edits.some((e) => e.filePath === filePath && e.line === line)) return toChip(row);
  }
  return null;
}

/**
 * Map each failure cluster to the live heal action covering it. Built once so
 * the PR-feedback comment can cross-link a failure to the PR already healing it
 * without a per-row query. Keyed by cluster because that is stable across runs,
 * where execution ids are not.
 */
export async function mapHealActionsByCluster(db: DbClient, projectId: number): Promise<Map<number, HealActionChip>> {
  const byCluster = new Map<number, HealActionChip>();
  // Oldest first so the newest action wins each cluster key on overwrite.
  const rows = (await liveActionsForProject(db, projectId)).reverse();
  for (const row of rows) {
    const payload = row.payload as HealActionPayload;
    const chip = toChip(row);
    for (const e of payload.edits) if (e.clusterId != null) byCluster.set(e.clusterId, chip);
  }
  return byCluster;
}
