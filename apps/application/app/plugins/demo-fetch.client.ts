import { configureDemoDb } from '~/demo/db.client';
import { DEFAULT_DEMO_USER_ID, DEMO_USER_COOKIE, DEMO_USER_STORAGE_KEY } from '~/demo/demo-users';

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

  // Track whether the demo DB has finished initializing.
  // The first intercepted API call will be slow (WASM download + seed SQL).
  // Components can check this ref to show/hide a loading overlay.
  const demoReady = useState('demoReady', () => false);

  // Pass the base URL to the db module so it can locate WASM + seed SQL
  // in the (unlikely) event a request is handled before the SW is active.
  const base = (config.app?.baseURL ?? '/').replace(/\/$/, '');
  configureDemoDb(base);

  // Publish the selected "act as" demo user to the service worker. In the built
  // SPA the app's data fetching does not attach request headers (Nuxt resolves
  // $fetch before this plugin can wrap it), so the worker cannot read the
  // identity from a header the way the API playground does. Publish it two ways
  // the worker can read instead: a cookie (set synchronously here, before the
  // first request fires, and read per request via the Cookie Store API) and a
  // postMessage (a fallback for workers without the Cookie Store API, e.g.
  // Firefox). The switcher persists the id to localStorage and reloads, so
  // reading it here on every load is enough — there is no in-session switch.
  function publishActingUser(): void {
    const id = localStorage.getItem(DEMO_USER_STORAGE_KEY) || String(DEFAULT_DEMO_USER_ID);
    document.cookie = `${DEMO_USER_COOKIE}=${id}; path=${base || '/'}; SameSite=Lax`;
    navigator.serviceWorker?.controller?.postMessage({ type: 'piwi-demo-user', id: Number(id) || null });
  }
  publishActingUser();
  // A freshly installed worker only starts controlling on `controllerchange`;
  // re-publish then so it learns the identity as soon as it can act on requests.
  navigator.serviceWorker?.addEventListener('controllerchange', publishActingUser);

  // Pre-register the bundled trace viewer's own service worker. Without this,
  // the first "View trace" navigation is controlled by the demo API service
  // worker (scope covers the whole app), which cannot answer the viewer's
  // virtual snapshot URLs — the viewer would hang until a manual reload. With
  // the viewer SW registered up front, its more specific scope takes the page
  // immediately.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register(`${base}/trace-viewer/sw.bundle.js`, { scope: `${base}/trace-viewer/` })
      .catch(() => {});
  }

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

  // Drive the loading overlay from the service worker, not from an intercepted
  // app request. The app's own data fetching does not always flow through the
  // patched globalThis.$fetch below (Nuxt resolves `$fetch` with its own base
  // URL), so waiting for one of those calls to reach `markReady` could leave the
  // overlay up forever. Once the worker controls the page it can serve the
  // in-browser API, so run one query to load the database (WASM + seed) and then
  // clear the overlay. A native `fetch` to the scoped path is used so it goes
  // through the worker without Nuxt's base URL being applied twice.
  void swReady.then(async () => {
    try {
      await fetch(`${base}/api/projects/menu`);
    } catch {
      // A failed probe still means the worker took control; clear the overlay
      // rather than leaving it up on a transient error.
    } finally {
      markReady();
    }
  });

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
