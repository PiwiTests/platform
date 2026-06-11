import { onUnmounted } from 'vue'
import { subscribeDemoEvents } from '~/demo/run-events'

/**
 * Shared SSE connection and subscriber list.
 * All components share a single EventSource connection to /api/stream,
 * preventing redundant connections on every page/component mount.
 * Refreshes are debounced to coalesce rapid successive events, and
 * non-terminal run events are filtered out to avoid unnecessary re-fetches.
 *
 * In demo mode the API handlers run in the service worker, so the SSE
 * connection is replaced with a BroadcastChannel subscription carrying the
 * same global lifecycle events (see app/demo/run-events.ts).
 *
 * Must be called inside a component's `setup` (or `<script setup>`) context
 * so that `onUnmounted` can deregister the callback.
 */
let sharedEventSource: EventSource | null = null
let demoUnsubscribe: (() => void) | null = null
const subscribers = new Set<() => void>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const REFRESH_EVENTS = new Set(['run-initialising', 'run-started', 'run-finalizing', 'run-finished', 'run-submitted', 'run-cancelled'])

function notifySubscribers(eventType: string) {
  if (!REFRESH_EVENTS.has(eventType)) return

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    for (const fn of subscribers) fn()
  }, 300)
}

function ensureConnection() {
  if (!import.meta.client) return

  if (useRuntimeConfig().public.demoMode) {
    if (demoUnsubscribe) return
    demoUnsubscribe = subscribeDemoEvents((message) => {
      if (message.scope === 'global') notifySubscribers(message.event.type)
    })
    return
  }

  if (sharedEventSource) return

  sharedEventSource = new EventSource('/api/stream')

  sharedEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      notifySubscribers(data.type)
    } catch {
      // Ignore non-JSON messages (e.g. heartbeat comments)
    }
  }

  sharedEventSource.onerror = () => {
    // EventSource will automatically attempt to reconnect on error
  }
}

function closeConnection() {
  if (subscribers.size > 0) return

  if (sharedEventSource) {
    sharedEventSource.close()
    sharedEventSource = null
  }
  if (demoUnsubscribe) {
    demoUnsubscribe()
    demoUnsubscribe = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

export function useRunStream(refresh: () => Promise<unknown>) {
  if (!import.meta.client) return

  ensureConnection()

  subscribers.add(refresh)

  onUnmounted(() => {
    subscribers.delete(refresh)
    closeConnection()
  })
}
