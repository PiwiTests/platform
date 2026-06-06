import type { Page, APIRequestContext } from '@playwright/test'
import { waitForHydration as nuxtWaitForHydration } from '@nuxt/test-utils/e2e'

// Helper to wait for Nuxt page hydration.
// Uses @nuxt/test-utils/e2e which checks
// `window.useNuxtApp?.().isHydrating === false` — the official Nuxt API.
export async function waitForHydration(page: Page) {
  await page.waitForLoadState('load')
  await nuxtWaitForHydration(page, undefined, 'hydration').catch(() => {})
}

/**
 * Retry an API request on transient connection errors (e.g. ECONNRESET).
 * Returns the response on success; throws after all attempts are exhausted.
 */
export async function retryPost(
  request: APIRequestContext,
  url: string,
  options: Parameters<APIRequestContext['post']>[1],
  attempts = 3,
  delayMs = 1000
) {
  const isTransient = (err: unknown) =>
    err instanceof Error && /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(err.message)

  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await request.post(url, options)
    } catch (err) {
      if (!isTransient(err)) throw err
      lastError = err
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }
  throw lastError
}
