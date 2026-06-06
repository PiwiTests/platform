import { runEventBus } from '../utils/run-events'
import { createSSEEndpoint } from '../utils/sse'

export default eventHandler(async (event) => {
  return createSSEEndpoint(event, (controller, encoder) => {
    return runEventBus.subscribeGlobal((globalEvent) => {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(globalEvent)}\n\n`))
      } catch {
        // Stream closed — unsubscribe is handled by SSE helper
      }
    })
  })
})
