import { getDatabase } from '../../../database'
import { testRuns, testCases, testRunsCases } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { runEventBus } from '../../../utils/run-events'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run ID'
    })
  }

  const db = await getDatabase()

  // Verify the run exists
  const testRunResults = await db.select().from(testRuns).where(eq(testRuns.id, id))
  const testRun = testRunResults[0]

  if (!testRun) {
    throw createError({
      statusCode: 404,
      message: 'Test run not found'
    })
  }

  // Set SSE headers for nginx compatibility
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  })

  // Create a readable stream for SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send initial state as catch-up event
      const initialData = {
        type: 'init',
        data: {
          id: testRun.id,
          status: testRun.status,
          totalTests: testRun.totalTests,
          passedTests: testRun.passedTests,
          failedTests: testRun.failedTests,
          skippedTests: testRun.skippedTests
        },
        seq: 0,
        timestamp: Date.now()
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`))

      // If the run is already finished, send that and close
      if (testRun.status !== 'running') {
        const finishedData = {
          type: 'run-finished',
          data: {
            status: testRun.status,
            duration: testRun.duration,
            totalTests: testRun.totalTests,
            passedTests: testRun.passedTests,
            failedTests: testRun.failedTests,
            skippedTests: testRun.skippedTests
          },
          seq: 1,
          timestamp: Date.now()
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishedData)}\n\n`))
        controller.close()
        return
      }

      // Also send existing test cases for catch-up
      ;(async () => {
        try {
          const existingCases = await db.select({
            title: testCases.title,
            status: testRunsCases.status,
            duration: testRunsCases.duration,
            filePath: testCases.filePath,
            line: testRunsCases.line,
            column: testRunsCases.column,
            error: testRunsCases.error
          })
            .from(testRunsCases)
            .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
            .where(eq(testRunsCases.testRunId, id))

          for (const tc of existingCases) {
            const location = tc.line && tc.column ? `${tc.filePath}:${tc.line}:${tc.column}` : tc.filePath
            const caseEvent = {
              type: 'test-completed',
              data: {
                title: tc.title,
                status: tc.status,
                duration: tc.duration,
                location,
                error: tc.error || null
              },
              seq: 0, // Catch-up events have seq 0
              timestamp: Date.now()
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(caseEvent)}\n\n`))
          }
        } catch {
          // Ignore errors during catch-up
        }
      })()

      // Subscribe to live events
      const unsubscribe = runEventBus.subscribe(id, (runEvent) => {
        try {
          controller.enqueue(encoder.encode(`id: ${runEvent.seq}\ndata: ${JSON.stringify(runEvent)}\n\n`))

          // Close stream when run finishes
          if (runEvent.type === 'run-finished') {
            setTimeout(() => {
              try {
                controller.close()
              } catch {
                // Already closed
              }
            }, 100)
          }
        } catch {
          // Stream was closed by client
          unsubscribe()
        }
      })

      // Heartbeat to keep connection alive through proxies
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`))
        } catch {
          clearInterval(heartbeatInterval)
          unsubscribe()
        }
      }, 15000)

      // Handle client disconnect
      event.node.req.on('close', () => {
        clearInterval(heartbeatInterval)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
})
