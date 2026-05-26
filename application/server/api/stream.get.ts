import { runEventBus } from '../utils/run-events'

export default eventHandler(async (event) => {
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const unsubscribe = runEventBus.subscribeGlobal((globalEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(globalEvent)}\n\n`))
        } catch {
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
