import { approveMergeSuggestion, getMergeSuggestionPair } from '#shared/handlers/cluster-merge-suggestions';
import { enqueueMergePolicies } from './integrations/policies';
import type { HandbackActor } from '#shared/handback-outcomes';
import type { DbClient } from '../database';

/**
 * Approve a pending merge suggestion: queue the tracker merge comments, then
 * merge the two clusters. The merge-comment policy reads both tickets before the
 * merge deletes the victim (its link is inherited by the survivor during the
 * merge). Returns null when the suggestion is not pending.
 */
export async function approveSuggestedMerge(
  db: DbClient,
  id: number,
  actor: HandbackActor,
): Promise<{ survivorId: number } | null> {
  const pair = await getMergeSuggestionPair(db, id);
  if (pair) {
    await enqueueMergePolicies(db, pair).catch((e) => console.error('[integrations] merge policy failed', e));
  }
  return approveMergeSuggestion(db, id, actor);
}
