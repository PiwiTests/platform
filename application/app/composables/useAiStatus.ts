import type { AiStatus } from '~~/types/api'

let fetchPromise: Promise<AiStatus> | null = null

export function useAiStatus() {
  const status = useState<AiStatus | null>('ai-status', () => null)

  async function load() {
    if (status.value !== null) return
    if (!fetchPromise) {
      fetchPromise = $fetch<AiStatus>('/api/ai/status').catch(() => ({ configured: false }))
    }
    status.value = await fetchPromise
  }

  if (import.meta.client) {
    load()
  }

  return { aiStatus: status }
}
