import { runEventBus } from './run-events';
import { cancelInstanceRuns as sharedCancelInstanceRuns } from '#shared/handlers/failure-cluster-ops';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

export async function cancelInstanceRuns(
  db: DB,
  projectId: number,
  instanceId: string | null,
  excludeRunId?: number,
  isShardedRun?: boolean,
) {
  const cancelledRuns = await sharedCancelInstanceRuns(db, projectId, instanceId, excludeRunId, isShardedRun);
  for (const run of cancelledRuns) {
    runEventBus.publishGlobal({ type: 'run-cancelled', runId: run.id, projectId: run.projectId, status: 'cancelled' });
  }
}
