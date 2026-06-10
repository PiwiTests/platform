import { configureDemoDb } from '~/demo/db.client'

/**
 * Demo-mode fetch plugin.
 *
 * In demo mode the app is served from a sub-path (e.g. /piwi-dashboard/demo/).
 * API calls made by Nuxt components use bare paths like `/api/projects`, but
 * the service worker's scope is limited to that sub-path.
 *
 * This plugin rewrites every `/api/…` call to `[demoBase]/api/…` so the
 * request URL falls inside the service worker's scope and gets intercepted
 * by `demo-sw.ts`.
 *
 * Important timing concern: on the very first page load the service worker
 * hasn't claimed the page yet, so rewritten API calls would hit the real
 * server and return 404.  We wait for `controllerchange` before allowing
 * any fetch through, keeping the loading screen visible until then.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  if (!config.public.demoMode) {
    return
  }

  // Track whether the demo DB has finished initialising.
  // The first intercepted API call will be slow (WASM download + seed SQL).
  // Components can check this ref to show/hide a loading overlay.
  const demoReady = useState('demoReady', () => false)

  // Pass the base URL to the db module so it can locate WASM + seed SQL
  // in the (unlikely) event a request is handled before the SW is active.
  const base = (config.app?.baseURL ?? '/').replace(/\/$/, '')
  configureDemoDb(base)

  // ── Wait for service worker to claim this page ───────────────────────
  // Without this, rewritten /api/ calls hit the real server → 404.
  const swReady = (
    !import.meta.client
    || !('serviceWorker' in navigator)
    || navigator.serviceWorker.controller
  )
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 4000)
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true }
        )
      })

  const originalFetch = globalThis.$fetch as (request: unknown, options?: unknown) => Promise<unknown>

  function rewritePath(request: unknown): unknown {
    if (typeof request === 'string' && request.startsWith('/api/')) {
      return base + request
    }
    return request
  }

  let initCalled = false

  // Helper: mark the demo as ready on the first resolved API call, regardless
  // of whether it succeeded or threw (so the loading screen doesn't lock).
  function markReady(): void {
    if (!initCalled) {
      initCalled = true
      demoReady.value = true
    }
  }

  // @ts-expect-error monkey-patching $fetch for demo mode
  globalThis.$fetch = async (request: unknown, options?: unknown) => {
    await swReady
    try {
      return await originalFetch(rewritePath(request), options)
    } finally {
      markReady()
    }
  }

  // Copy over $fetch properties so useFetch internals still work.
  Object.assign(globalThis.$fetch, originalFetch)

  // Also patch $fetch.raw so useFetch internals that call the raw variant
  // still have their paths rewritten into the SW's scope.
  const originalRaw = (originalFetch as unknown as Record<string, unknown>).raw as ((request: unknown, options?: unknown) => Promise<unknown>) | undefined
  if (typeof originalRaw === 'function') {
    // @ts-expect-error monkey-patching $fetch.raw for demo mode
    globalThis.$fetch.raw = async (request: unknown, options?: unknown) => {
      await swReady
      try {
        return await originalRaw(rewritePath(request), options)
      } finally {
        markReady()
      }
    }
    Object.assign(globalThis.$fetch.raw, originalRaw)
  }
})
