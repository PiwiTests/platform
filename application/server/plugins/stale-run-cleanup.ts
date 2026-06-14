import { getDatabase } from '../database'
import { testRuns } from '../database/schema'
import { eq, and, lt, or, isNull } from 'drizzle-orm'
import { runEventBus } from '../utils/run-events'

const STALE_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour without activity → mark interrupted
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // check every 5 minutes

async function cleanupStaleRuns() {
  try {
    const staleThreshold = new Date(Date.now() - STALE_TIMEOUT_MS)
    const db = await getDatabase()

    const staleRuns = await db.update(testRuns)
      .set({
        status: 'interrupted',
        streamToken: null,
        updatedAt: new Date()
      })
      .where(
        and(
          or(
            eq(testRuns.status, 'running'),
            eq(testRuns.status, 'initialising'),
            eq(testRuns.status, 'finalizing')
          ),
          or(
            lt(testRuns.updatedAt, staleThreshold),
            and(isNull(testRuns.updatedAt), lt(testRuns.createdAt, staleThreshold))
          )
        )
      )
      .returning({ id: testRuns.id })

    if (staleRuns.length > 0) {
      console.log(`[StaleRunCleanup] Marked ${staleRuns.length} stale run(s) as interrupted: ${staleRuns.map(r => r.id).join(', ')}`)
      // Signal SSE subscribers so their connections close, then free event bus memory
      for (const run of staleRuns) {
        runEventBus.publish(run.id, {
          type: 'run-finished',
          data: { status: 'interrupted', duration: null, totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 }
        })
        runEventBus.cleanup(run.id)
      }
    }
  } catch (error) {
    console.error('[StaleRunCleanup] Error during stale run cleanup:', error)
  }
}

export default defineNitroPlugin((nitroApp) => {
  // Run once at startup to recover any runs left hanging from a previous crash
  cleanupStaleRuns()

  const interval = setInterval(cleanupStaleRuns, CHECK_INTERVAL_MS)

  nitroApp.hooks.hook('close', () => {
    clearInterval(interval)
  })
})
