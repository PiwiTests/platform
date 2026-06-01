import { testRuns } from '../database/schema'
import { eq, ne, and, or } from 'drizzle-orm'
import { runEventBus } from './run-events'
import type { getDatabase } from '../database'

type DB = Awaited<ReturnType<typeof getDatabase>>

export async function cancelInstanceRuns(
  db: DB,
  projectId: number,
  instanceId: string | null,
  excludeRunId?: number
) {
  if (!instanceId) return

  const conditions = [
    eq(testRuns.projectId, projectId),
    eq(testRuns.instanceId, instanceId),
    or(
      eq(testRuns.status, 'running'),
      eq(testRuns.status, 'initialising')
    )
  ]

  if (excludeRunId !== undefined) {
    conditions.push(ne(testRuns.id, excludeRunId))
  }

  const cancelledRuns = await db.update(testRuns)
    .set({
      status: 'cancelled',
      streamToken: null,
      updatedAt: new Date()
    })
    .where(and(...conditions))
    .returning({ id: testRuns.id, projectId: testRuns.projectId })

  for (const run of cancelledRuns) {
    runEventBus.publishGlobal({ type: 'run-cancelled', runId: run.id, projectId: run.projectId, status: 'cancelled' })
  }
}
