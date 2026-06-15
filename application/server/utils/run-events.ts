import { EventEmitter } from 'node:events';

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
  type: 'test-begin' | 'test-completed' | 'run-progress' | 'run-finalizing' | 'run-finished' | 'case-files';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
  seq: number;
  timestamp: number;
}

export interface GlobalRunEvent {
  type: 'run-started' | 'run-initialising' | 'run-finalizing' | 'run-finished' | 'run-submitted' | 'run-cancelled';
  runId: number;
  projectId: number;
  status?: string;
}

export interface RunState {
  streamToken: string;
  projectId: number;
}

class RunEventBus {
  private emitter = new EventEmitter();
  private globalEmitter = new EventEmitter();
  private sequences = new Map<number, number>();
  /** Stores pending final status for runs in `finalizing` state, keyed by run ID */
  private finalStatuses = new Map<number, string>();
  /**
   * In-memory cache of active run state (token + projectId) so the events
   * endpoint can skip a DB round-trip on every incoming batch.
   * Populated by start/begin endpoints; cleared when the run finishes.
   */
  private runStates = new Map<number, RunState>();

  constructor() {
    // Allow many concurrent listeners (one per SSE connection)
    this.emitter.setMaxListeners(1000);
    this.globalEmitter.setMaxListeners(1000);
  }

  /**
   * Publish an event for a specific run.
   */
  publish(runId: number, event: Omit<RunEvent, 'seq' | 'timestamp'>): RunEvent {
    const seq = (this.sequences.get(runId) || 0) + 1;
    this.sequences.set(runId, seq);

    const fullEvent: RunEvent = {
      ...event,
      seq,
      timestamp: Date.now(),
    };

    this.emitter.emit(`run:${runId}`, fullEvent);
    return fullEvent;
  }

  /**
   * Subscribe to events for a specific run.
   * Returns an unsubscribe function.
   */
  subscribe(runId: number, listener: (event: RunEvent) => void): () => void {
    const channel = `run:${runId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Store a final status for a run entering the `finalizing` state.
   * The upload endpoint will consume this to transition to the actual final status.
   */
  setFinalStatus(runId: number, status: string): void {
    this.finalStatuses.set(runId, status);
  }

  /**
   * Read and remove the stored final status for a run.
   * Returns undefined if no status was stored (e.g., the run wasn't finalizing).
   */
  consumeFinalStatus(runId: number): string | undefined {
    const status = this.finalStatuses.get(runId);
    this.finalStatuses.delete(runId);
    return status;
  }

  /** Cache the stream token and projectId for an active run. */
  cacheRunState(runId: number, state: RunState): void {
    this.runStates.set(runId, state);
  }

  /** Return cached run state, or undefined on a cache miss. */
  getRunState(runId: number): RunState | undefined {
    return this.runStates.get(runId);
  }

  /** Remove the cached run state when the stream token is invalidated. */
  clearRunState(runId: number): void {
    this.runStates.delete(runId);
  }

  /**
   * Clean up all in-memory state for a finished run.
   */
  cleanup(runId: number): void {
    this.sequences.delete(runId);
    this.finalStatuses.delete(runId);
    this.runStates.delete(runId);
  }

  /**
   * Broadcast a global run lifecycle event to all dashboard subscribers.
   */
  publishGlobal(event: GlobalRunEvent): void {
    this.globalEmitter.emit('global', event);
  }

  /**
   * Subscribe to global run lifecycle events.
   * Returns an unsubscribe function.
   */
  subscribeGlobal(listener: (event: GlobalRunEvent) => void): () => void {
    this.globalEmitter.on('global', listener);
    return () => {
      this.globalEmitter.off('global', listener);
    };
  }
}

// Singleton instance
export const runEventBus = new RunEventBus();
