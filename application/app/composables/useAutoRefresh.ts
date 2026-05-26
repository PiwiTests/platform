import { useIntervalFn } from '@vueuse/core'
import type { ComputedRef, Ref } from 'vue'

const REFRESH_INTERVAL_MS = 5000

/**
 * Polls `refresh` every REFRESH_INTERVAL_MS milliseconds, but only while
 * `hasRunning` is truthy. This keeps pages up-to-date during live test runs
 * without issuing unnecessary requests when everything is idle.
 */
export function useAutoRefresh(
  hasRunning: Ref<boolean> | ComputedRef<boolean>,
  refresh: () => Promise<unknown> | void
) {
  useIntervalFn(async () => {
    if (hasRunning.value) {
      await refresh()
    }
  }, REFRESH_INTERVAL_MS)
}
