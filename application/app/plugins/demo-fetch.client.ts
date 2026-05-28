import { handleDemoRequest } from '~/demo/api/router'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  if (!config.public.demoMode) {
    return
  }

  const originalFetch = globalThis.$fetch as (request: unknown, options?: unknown) => Promise<unknown>

  // @ts-expect-error monkey-patching $fetch for demo mode
  globalThis.$fetch = async (request: string, options?: Record<string, unknown>) => {
    if (typeof request !== 'string' || !request.startsWith('/api/')) {
      return originalFetch(request, options)
    }

    const [pathPart, queryPart] = request.split('?') as [string, string | undefined]
    const method = ((options?.method as string | undefined) ?? 'GET').toUpperCase()
    const body = options?.body

    const result = await handleDemoRequest(pathPart, method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', body, queryPart)

    if (result !== undefined) {
      return result
    }

    // No demo route matched – fall through to the real network (should not
    // happen in normal demo usage but allows graceful fallback).
    return originalFetch(request, options)
  }

  // Copy over $fetch properties so useFetch internals still work
  Object.assign(globalThis.$fetch, originalFetch)
})
