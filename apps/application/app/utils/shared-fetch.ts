import type { NuxtApp } from '#app';

/**
 * `getCachedData` for data several components of one page read under the same
 * key (capability states, the project list): during the server render and
 * hydration they share the first answer instead of each fetching it again,
 * and a later client-side navigation fetches it afresh. Pair it with
 * `dedupe: 'defer'`, so a component asking while the first fetch is still
 * running waits for it rather than cancelling it.
 */
export function reuseWithinRender<T>(key: string, nuxtApp: NuxtApp): T | undefined {
  return import.meta.server || nuxtApp.isHydrating ? (nuxtApp.payload.data[key] as T | undefined) : undefined;
}
