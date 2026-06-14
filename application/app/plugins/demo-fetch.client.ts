import { configureDemoDb } from '~/demo/db.client';

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
 * First-load timing: when there is no SW controller yet (first ever visit)
 * we listen for `controllerchange` and then **reload the page**.  The second
 * load finds the SW already in control, so all requests are intercepted from
 * the start and the demo DB initialises cleanly.  A 30-second safety-net
 * resolves the wait if the SW never takes control (blocked by browser policy,
 * install failure, etc.) so the loading screen does not get stuck forever.
 *
 * This approach fixes a race condition that was especially visible in Firefox,
 * where the SW can take longer than the previous 4-second timeout to install
 * and claim the page — causing the rewritten API calls to hit the real host
 * (GitHub Pages) and receive 404s before the DB was ready.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();

  if (!config.public.demoMode) {
    return;
  }

  // Track whether the demo DB has finished initialising.
  // The first intercepted API call will be slow (WASM download + seed SQL).
  // Components can check this ref to show/hide a loading overlay.
  const demoReady = useState('demoReady', () => false);

  // Pass the base URL to the db module so it can locate WASM + seed SQL
  // in the (unlikely) event a request is handled before the SW is active.
  const base = (config.app?.baseURL ?? '/').replace(/\/$/, '');
  configureDemoDb(base);

  // ── Wait for service worker to claim this page ───────────────────────
  // Without this, rewritten /api/ calls hit the real server → 404.
  const swReady =
    !import.meta.client || !('serviceWorker' in navigator) || navigator.serviceWorker.controller
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            () => {
              // SW just claimed this page via clients.claim().  Reload so that
              // the second load starts with the SW already in control — this
              // avoids a race where DB initialisation is racing concurrent
              // in-flight requests.  The promise never resolves here because the
              // reload replaces the page.
              window.location.reload();
            },
            { once: true },
          );
          // Safety net: give up waiting after 30 s if the SW never takes control
          // (blocked by browser settings, install failure, etc.) so the loading
          // screen does not stay up forever.
          setTimeout(resolve, 30_000);
        });

  const originalFetch = globalThis.$fetch as (request: unknown, options?: unknown) => Promise<unknown>;

  function rewritePath(request: unknown): unknown {
    if (typeof request === 'string' && request.startsWith('/api/')) {
      return base + request;
    }
    return request;
  }

  let initCalled = false;

  // Helper: mark the demo as ready on the first resolved API call, regardless
  // of whether it succeeded or threw (so the loading screen doesn't lock).
  function markReady(): void {
    if (!initCalled) {
      initCalled = true;
      demoReady.value = true;
    }
  }

  // @ts-expect-error monkey-patching $fetch for demo mode
  globalThis.$fetch = async (request: unknown, options?: unknown) => {
    await swReady;
    try {
      return await originalFetch(rewritePath(request), options);
    } finally {
      markReady();
    }
  };

  // Copy over $fetch properties so useFetch internals still work.
  Object.assign(globalThis.$fetch, originalFetch);

  // Also patch $fetch.raw so useFetch internals that call the raw variant
  // still have their paths rewritten into the SW's scope.
  const originalRaw = (originalFetch as unknown as Record<string, unknown>).raw as
    | ((request: unknown, options?: unknown) => Promise<unknown>)
    | undefined;
  if (typeof originalRaw === 'function') {
    // @ts-expect-error monkey-patching $fetch.raw for demo mode
    globalThis.$fetch.raw = async (request: unknown, options?: unknown) => {
      await swReady;
      try {
        return await originalRaw(rewritePath(request), options);
      } finally {
        markReady();
      }
    };
    Object.assign(globalThis.$fetch.raw, originalRaw);
  }
});
