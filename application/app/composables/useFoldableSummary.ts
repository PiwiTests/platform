const STORAGE_PREFIX = 'piwi:summary-fold:'

export function useFoldableSummary(key: string) {
  const storageKey = `${STORAGE_PREFIX}${key}`
  const folded = ref<boolean>(true)

  if (import.meta.client) {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored !== null) {
        folded.value = stored === 'true'
      }
    } catch {
      // localStorage not available
    }
  }

  function toggle() {
    folded.value = !folded.value
    if (import.meta.client) {
      try {
        localStorage.setItem(storageKey, String(folded.value))
      } catch {
        // ignore
      }
    }
  }

  return { folded, toggle }
}
