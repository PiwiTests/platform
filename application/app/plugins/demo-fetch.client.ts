import { $fetch as ofetch } from 'ofetch'

const DEMO_API_MAP: Record<string, string> = {
  '/api/projects': '/demo/api/projects.json',
  '/api/projects/1': '/demo/api/projects/1.json',
  '/api/projects/1/test-cases': '/demo/api/projects/1/test-cases.json',
  '/api/projects/1/performance': '/demo/api/projects/1/performance.json',
  '/api/projects/1/slow-tests': '/demo/api/projects/1/slow-tests.json',
  '/api/projects/1/quality': '/demo/api/projects/1/quality.json',
  '/api/projects/1/flaky-tests': '/demo/api/projects/1/flaky-tests.json',
  '/api/projects/2': '/demo/api/projects/2.json',
  '/api/projects/2/test-cases': '/demo/api/projects/2/test-cases.json',
  '/api/projects/2/performance': '/demo/api/projects/2/performance.json',
  '/api/projects/2/slow-tests': '/demo/api/projects/2/slow-tests.json',
  '/api/projects/2/quality': '/demo/api/projects/2/quality.json',
  '/api/projects/2/flaky-tests': '/demo/api/projects/2/flaky-tests.json',
  '/api/projects/3': '/demo/api/projects/3.json',
  '/api/projects/3/test-cases': '/demo/api/projects/3/test-cases.json',
  '/api/projects/3/performance': '/demo/api/projects/3/performance.json',
  '/api/projects/3/slow-tests': '/demo/api/projects/3/slow-tests.json',
  '/api/projects/3/quality': '/demo/api/projects/3/quality.json',
  '/api/projects/3/flaky-tests': '/demo/api/projects/3/flaky-tests.json',
  '/api/tags': '/demo/api/tags.json',
  '/api/admin/stats': '/demo/api/admin/stats.json',
  '/api/test-runs/1': '/demo/api/test-runs/1.json',
  '/api/test-runs/1/network-requests': '/demo/api/test-runs/1/network-requests.json',
  '/api/test-runs/2': '/demo/api/test-runs/2.json',
  '/api/test-runs/2/network-requests': '/demo/api/test-runs/2/network-requests.json',
  '/api/test-runs/3': '/demo/api/test-runs/3.json',
  '/api/test-runs/3/network-requests': '/demo/api/test-runs/3/network-requests.json',
  '/api/test-cases/1': '/demo/api/test-cases/1.json',
  '/api/test-cases/2': '/demo/api/test-cases/2.json',
  '/api/auth/session': '/demo/api/auth/session.json'
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  if (!config.public.demoMode) {
    return
  }

  const baseURL = config.app.baseURL || '/'

  const originalFetch = globalThis.$fetch

  // @ts-expect-error monkey-patching $fetch for demo mode
  globalThis.$fetch = async (request: string, options?: Record<string, unknown>) => {
    const path = typeof request === 'string' ? request.split('?')[0] : undefined

    if (path && path.startsWith('/api/')) {
      const fixtureRelPath = DEMO_API_MAP[path]
      if (fixtureRelPath) {
        const fixtureURL = baseURL.replace(/\/$/, '') + fixtureRelPath
        return ofetch(fixtureURL, { parseResponse: JSON.parse })
      }
    }

    return originalFetch(request, options)
  }

  // Copy over $fetch properties so useFetch internals still work
  Object.assign(globalThis.$fetch, originalFetch)
})
