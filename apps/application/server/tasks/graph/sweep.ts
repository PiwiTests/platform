import { getDatabase } from '../../database';
import { pruneChangesEdges, pruneStaleBranchGraphRows, pruneStaleCanonicalNodes } from '../../utils/graph-ingest';

export default defineTask({
  meta: {
    name: 'graph:sweep',
    description:
      'Keep the feature graph proportional to a project’s surface: prune changes edges older than 90 days, branch-tagged rows older than 30 days, and canonical nodes unseen for 30 runs whose surface-drift gap is closed. Independent of PIWI_RETENTION_DAYS.',
  },
  async run() {
    const db = await getDatabase();
    const result: Record<string, number> = {};

    const changesEdgesPruned = await pruneChangesEdges(db);
    if (changesEdgesPruned > 0) result.changesEdgesPruned = changesEdgesPruned;

    const branchRowsPruned = await pruneStaleBranchGraphRows(db);
    if (branchRowsPruned > 0) result.branchRowsPruned = branchRowsPruned;

    const staleNodesPruned = await pruneStaleCanonicalNodes(db);
    if (staleNodesPruned > 0) result.staleNodesPruned = staleNodesPruned;

    if (Object.keys(result).length > 0) {
      console.info(`[graph:sweep] ${JSON.stringify(result)}`);
    }
    return { result };
  },
});
