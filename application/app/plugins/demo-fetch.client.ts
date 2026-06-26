import { configureDemoDb } from '~/demo/db.client';
import { DEFAULT_DEMO_USER_ID, DEMO_USER_STORAGE_KEY } from '~/demo/demo-users';

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
 * we block every `$fetch` call behind `swReady` and wait for `controllerchange`.
 * Once the SW installs, activates, and calls `clients.claim()`, that event fires
 * and we unblock all pending requests — the SW is now the controller and its
 * fetch listener is active, so every rewritten API call is intercepted correctly.
 *
 * We intentionally do NOT reload the page on `controllerchange`.  A reload was
 * tried previously but caused a Firefox-specific failure: after the programmatic
 * reload, `navigator.serviceWorker.controller` was still null when the plugin
 * ran again, so the page got stuck waiting for a second `controllerchange` that
 * never arrived and only escaped after the 30-second safety-net timeout.
 * Because every `$fetch` call already awaits `swReady`, no request can escape
 * to the real server before the SW is active — no reload is required.
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
          // Once the SW installs, activates, and calls clients.claim(), the
          // controllerchange event fires.  At that point the SW's fetch listener
          // is live and every rewritten /api/ call will be intercepted, so we
          // can safely unblock all pending $fetch calls.
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
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

  // Tag every demo API call with the currently selected "act as" identity so
  // the service worker can apply that user's project affectations (scope).
  function withDemoUser(options: unknown): unknown {
    const id = localStorage.getItem(DEMO_USER_STORAGE_KEY) || String(DEFAULT_DEMO_USER_ID);
    const o = (options ?? {}) as { headers?: unknown };
    if (o.headers instanceof Headers) {
      o.headers.set('x-demo-user-id', id);
    } else {
      o.headers = { ...((o.headers as Record<string, string>) || {}), 'x-demo-user-id': id };
    }
    return o;
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
      return await originalFetch(rewritePath(request), withDemoUser(options));
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
        return await originalRaw(rewritePath(request), withDemoUser(options));
      } finally {
        markReady();
      }
    };
    Object.assign(globalThis.$fetch.raw, originalRaw);
  }
});
