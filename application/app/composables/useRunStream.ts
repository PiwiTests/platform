import { onUnmounted } from 'vue'

/**
 * Shared SSE connection and subscriber list.
 * All components share a single EventSource connection to /api/stream,
 * preventing redundant connections on every page/component mount.
 * Refreshes are debounced to coalesce rapid successive events, and
 * non-terminal run events are filtered out to avoid unnecessary re-fetches.
 *
 * Must be called inside a component's `setup` (or `<script setup>`) context
 * so that `onUnmounted` can deregister the callback.
 */
let sharedEventSource: EventSource | null = null
const subscribers = new Set<() => void>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const TERMINAL_EVENTS = new Set(['run-finished', 'run-submitted', 'run-cancelled'])

function ensureConnection() {
  if (sharedEventSource) return
  if (!import.meta.client) return
  if (useRuntimeConfig().public.demoMode) return

  sharedEventSource = new EventSource('/api/stream')

  sharedEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (!TERMINAL_EVENTS.has(data.type)) return

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        for (const fn of subscribers) fn()
      }, 300)
    } catch {
      // Ignore non-JSON messages (e.g. heartbeat comments)
    }
  }

  sharedEventSource.onerror = () => {
    // EventSource will automatically attempt to reconnect on error
  }
}

function closeConnection() {
  if (sharedEventSource && subscribers.size === 0) {
    sharedEventSource.close()
    sharedEventSource = null
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
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
