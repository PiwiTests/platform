import { testRuns } from '../database/schema';
import { eq, ne, and, or, isNull } from 'drizzle-orm';
import { runEventBus } from './run-events';
import type { getDatabase } from '../database';

type DB = Awaited<ReturnType<typeof getDatabase>>;

export async function cancelInstanceRuns(
  db: DB,
  projectId: number,
  instanceId: string | null,
  excludeRunId?: number,
  isShardedRun?: boolean,
) {
  if (!instanceId) return;

  const conditions = [
    eq(testRuns.projectId, projectId),
    eq(testRuns.instanceId, instanceId),
    or(eq(testRuns.status, 'running'), eq(testRuns.status, 'initialising'), eq(testRuns.status, 'finalizing')),
  ];

  if (excludeRunId !== undefined) {
    conditions.push(ne(testRuns.id, excludeRunId));
  }

  // For sharded runs, only cancel non-sharded runs (shardTotal is null).
  // Sibling shards share the same instanceId and must NOT be cancelled.
  if (isShardedRun) {
    conditions.push(isNull(testRuns.shardTotal));
  }

  const cancelledRuns = await db
    .update(testRuns)
    .set({
      status: 'cancelled',
      streamToken: null,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning({ id: testRuns.id, projectId: testRuns.projectId });

  for (const run of cancelledRuns) {
    runEventBus.publishGlobal({ type: 'run-cancelled', runId: run.id, projectId: run.projectId, status: 'cancelled' });
  }
}
