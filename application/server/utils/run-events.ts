import { EventEmitter } from 'node:events'

/**
 * In-memory pub/sub for live test run streaming.
 * Events are keyed by run ID and forwarded to SSE subscribers.
 */

export interface RunEvent {
  type: 'test-completed' | 'run-progress' | 'run-finished'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
  seq: number
  timestamp: number
}

class RunEventBus {
  private emitter = new EventEmitter()
  private sequences = new Map<number, number>()

  constructor() {
    // Allow many concurrent listeners (one per SSE connection)
    this.emitter.setMaxListeners(1000)
  }

  /**
   * Publish an event for a specific run.
   */
  publish(runId: number, event: Omit<RunEvent, 'seq' | 'timestamp'>): RunEvent {
    const seq = (this.sequences.get(runId) || 0) + 1
    this.sequences.set(runId, seq)

    const fullEvent: RunEvent = {
      ...event,
      seq,
      timestamp: Date.now()
    }

    this.emitter.emit(`run:${runId}`, fullEvent)
    return fullEvent
  }

  /**
   * Subscribe to events for a specific run.
   * Returns an unsubscribe function.
   */
  subscribe(runId: number, listener: (event: RunEvent) => void): () => void {
    const channel = `run:${runId}`
    this.emitter.on(channel, listener)
    return () => {
      this.emitter.off(channel, listener)
    }
  }

  /**
   * Clean up sequences for a finished run.
   */
  cleanup(runId: number): void {
    this.sequences.delete(runId)
  }
}

// Singleton instance
export const runEventBus = new RunEventBus()
