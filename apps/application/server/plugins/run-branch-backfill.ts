import { getDatabase } from '../database';
import { backfillRunBranches } from '../utils/run-branch-backfill';

/**
 * Give stored runs the branch their metadata reported, off the request path.
 * New runs get it on ingest.
 */
async function backfillBranches() {
  try {
    const filled = await backfillRunBranches(await getDatabase());
    if (filled > 0) console.log(`[RunBranch] Set the branch of ${filled} stored runs from their metadata`);
  } catch (error) {
    console.error('[RunBranch] Error while setting the branch of stored runs:', error);
  }
}

export default defineNitroPlugin(() => {
  void backfillBranches();
});
