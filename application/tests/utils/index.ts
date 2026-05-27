import type { Page, APIRequestContext } from '@playwright/test'

// Helper to wait for page hydration
export async function waitForHydration(page: Page) {
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)
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
