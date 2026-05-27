import { EventEmitter } from 'node:events'

/**
 * In-memory pub/sub for live test run streaming.
 * Events are keyed by run ID and forwarded to SSE subscribers.
 *
 * **Single-instance limitation**: This event bus lives in Node.js process memory.
 * When the server is scaled to multiple instances, SSE clients connected to one
 * instance will not receive events published on another instance. For multi-instance
 * deployments you must either use sticky sessions (ensuring each run's reporter and
 * its SSE subscribers always hit the same instance) or replace this bus with a
 * shared pub/sub backend such as Redis.
 */

export interface RunEvent {
  type: 'test-completed' | 'run-progress' | 'run-finished'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
  seq: number
  timestamp: number
}

export interface GlobalRunEvent {
  type: 'run-started' | 'run-initialising' | 'run-finished' | 'run-submitted'
  runId: number
  projectId: number
  status?: string
}

class RunEventBus {
  private emitter = new EventEmitter()
  private globalEmitter = new EventEmitter()
  private sequences = new Map<number, number>()

  constructor() {
    // Allow many concurrent listeners (one per SSE connection)
    this.emitter.setMaxListeners(1000)
    this.globalEmitter.setMaxListeners(1000)
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

  /**
   * Broadcast a global run lifecycle event to all dashboard subscribers.
   */
  publishGlobal(event: GlobalRunEvent): void {
    this.globalEmitter.emit('global', event)
  }

  /**
   * Subscribe to global run lifecycle events.
   * Returns an unsubscribe function.
   */
  subscribeGlobal(listener: (event: GlobalRunEvent) => void): () => void {
    this.globalEmitter.on('global', listener)
    return () => {
      this.globalEmitter.off('global', listener)
    }
  }
}

// Singleton instance
export const runEventBus = new RunEventBus()
