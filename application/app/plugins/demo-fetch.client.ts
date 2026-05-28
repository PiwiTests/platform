import { configureDemoDb } from '~/demo/db.client'

/**
 * Demo-mode fetch plugin.
 *
 * In demo mode the app is served from a sub-path (e.g. /playwright-dashboard/demo/).
 * API calls made by Nuxt components use bare paths like `/api/projects`, but
 * the service worker's scope is limited to that sub-path.
 *
 * This plugin rewrites every `/api/…` call to `[demoBase]/api/…` so the
 * request URL falls inside the service worker's scope and gets intercepted
 * by `demo-sw.ts`.
 *
 * All actual API handling (sql.js, Drizzle, route logic) lives in the SW;
 * no backend code is duplicated here.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  if (!config.public.demoMode) {
    return
  }

  // Pass the base URL to the db module so it can locate WASM + seed SQL
  // in the (unlikely) event a request is handled before the SW is active.
  const base = (config.app?.baseURL ?? '/').replace(/\/$/, '')
  configureDemoDb(base)

  const originalFetch = globalThis.$fetch as (request: unknown, options?: unknown) => Promise<unknown>

  function rewritePath(request: unknown): unknown {
    if (typeof request === 'string' && request.startsWith('/api/')) {
      return base + request
    }
    return request
  }

  // @ts-expect-error monkey-patching $fetch for demo mode
  globalThis.$fetch = (request: unknown, options?: unknown) => {
    return originalFetch(rewritePath(request), options)
  }

  // Copy over $fetch properties so useFetch internals still work.
  Object.assign(globalThis.$fetch, originalFetch)

  // Also patch $fetch.raw so useFetch internals that call the raw variant
  // still have their paths rewritten into the SW's scope.
  const originalRaw = (originalFetch as Record<string, unknown>).raw as ((request: unknown, options?: unknown) => Promise<unknown>) | undefined
  if (typeof originalRaw === 'function') {
    // @ts-expect-error monkey-patching $fetch.raw for demo mode
    globalThis.$fetch.raw = (request: unknown, options?: unknown) => {
      return originalRaw(rewritePath(request), options)
    }
    Object.assign(globalThis.$fetch.raw, originalRaw)
  }
})
