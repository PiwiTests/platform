import { getDatabase } from '../database';
import { backfillUnindexedProjects } from '../utils/locator-usages';

/**
 * Build the locator index from stored executions, once per project, off the
 * request path. New runs are indexed on ingest.
 */
async function buildLocatorIndexes() {
  try {
    const built = await backfillUnindexedProjects(await getDatabase());
    for (const b of built) {
      if (b.casesProcessed > 0) {
        console.log(`[LocatorIndex] Indexed ${b.usages} locator uses from ${b.casesProcessed} executions of ${b.name}`);
      }
    }
  } catch (error) {
    console.error('[LocatorIndex] Error while building the locator index:', error);
  }
}

export default defineNitroPlugin(() => {
  void buildLocatorIndexes();
});
