import { onUnmounted } from 'vue'

/**
 * Subscribes to the global run-lifecycle SSE stream and calls `refresh`
 * whenever a run starts, finishes, or is submitted.  This replaces the
 * previous polling approach (`useAutoRefresh`) with a push-based model so
 * the page only re-fetches when something actually changes.
 *
 * Must be called inside a component's `setup` (or `<script setup>`) context
 * so that `onUnmounted` can clean up the connection.
 */
export function useRunStream(refresh: () => Promise<unknown> | void) {
  if (!import.meta.client) return

  const eventSource = new EventSource('/api/stream')

  eventSource.onmessage = () => {
    refresh()
  }

  onUnmounted(() => {
    eventSource.close()
  })
}
