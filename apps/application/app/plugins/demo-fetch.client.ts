import { DEFAULT_DEMO_USER_ID, DEMO_USER_COOKIE, DEMO_USER_STORAGE_KEY } from '~/demo/demo-users';

/**
 * Demo-mode fetch plugin.
 *
 * In demo mode the app is served from a sub-path (e.g. /piwi-dashboard/demo/),
 * and `$fetch` prefixes every `/api/…` call with it (the app's `baseURL`), so
 * the request falls inside the service worker's scope and `demo-sw.ts`
 * answers it.
 *
 * First-load timing: when there is no SW controller yet (first ever visit),
 * every request to `[demoBase]/api/` waits behind `swReady` for
 * `controllerchange`. The wait sits on `window.fetch`, which `$fetch` and
 * `useFetch` (ofetch) call for every request: until the SW installs, activates
 * and calls `clients.claim()`, the static host would answer an API request with
 * the app's HTML shell.
 *
 * The page is not reloaded on `controllerchange`: in Firefox, after a
 * programmatic reload `navigator.serviceWorker.controller` can still be null
 * when the plugin runs again, and the page would wait for a second
 * `controllerchange` that never arrives. Because every API request already
 * awaits `swReady`, none can escape to the static host before the SW is
 * active.
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
  // Imported lazily: the module pulls the server schema, server utils and
  // Drizzle, which a non-demo client (and its dev server) should never load.
  // Any later window-side caller reaches the module through the same dynamic
  // import, so this `then` still runs before theirs.
  const base = (config.app?.baseURL ?? '/').replace(/\/$/, '');
  void import('~/demo/db.client').then(({ configureDemoDb }) => configureDemoDb(base));

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
  // the first "Open trace" navigation is controlled by the demo API service
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
  // Before it does, an /api/ request reaches the static host, which answers with the app's HTML shell.
  const swReady =
    !import.meta.client || !('serviceWorker' in navigator) || navigator.serviceWorker.controller
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          // Once the SW installs, activates, and calls clients.claim(), the
          // controllerchange event fires. At that point the SW's fetch listener
          // is live and every /api/ request will be intercepted, so the pending
          // requests can go.
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          // Safety net: give up waiting after 30 s if the SW never takes control
          // (blocked by browser settings, install failure, etc.) so the loading
          // screen does not stay up forever.
          setTimeout(resolve, 30_000);
        });

  // Every request to the in-browser API waits until the worker controls the
  // page. ofetch, behind `$fetch` and `useFetch`, calls `window.fetch` for each
  // request, so the wait applies to all of them.
  const apiPrefix = `${base}/api/`;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url, window.location.href).pathname.startsWith(apiPrefix)) await swReady;
    return nativeFetch(input, init);
  };

  // Drive the loading overlay from the service worker: once it controls the
  // page it can serve the in-browser API, so run one query to load the database
  // (WASM + seed) and then clear the overlay, whether the query succeeded or
  // threw (a failed probe still means the worker took control).
  void swReady.then(async () => {
    try {
      await nativeFetch(`${apiPrefix}projects/menu`);
    } catch {
      // The overlay clears below either way.
    } finally {
      demoReady.value = true;
    }
  });
});
