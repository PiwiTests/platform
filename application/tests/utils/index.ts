import type { Page } from '@playwright/test'

// Helper to wait for page hydration
export async function waitForHydration(page: Page) {
  await page.waitForLoadState('load')
  await page.waitForTimeout(2000)
}
