const { test: base } = require('@playwright/test');

/**
 * Playwright fixture that automatically collects network request timing
 * and browser performance metrics for the Playwright Dashboard reporter.
 *
 * Usage in playwright.config.ts:
 * ```ts
 * import { test } from 'piwi-dashboard-reporter/fixtures';
 * export { test };
 * ```
 *
 * Or in a fixture file:
 * ```ts
 * import { test as base } from '@playwright/test';
 * import { dashboardFixtures } from 'piwi-dashboard-reporter/fixtures';
 * export const test = base.extend(dashboardFixtures);
 * ```
 */

/**
 * Fixtures object for merging into existing test configuration.
 * Use this if you already have custom fixtures.
 */
const dashboardFixtures = {
  page: async ({ page }, use, testInfo) => {
    const networkRequests = [];

    // Capture each finished network request with timing
    page.on('requestfinished', async (request) => {
      try {
        const url = request.url();
        // Skip data URIs and blobs — not useful for performance analysis
        if (url.startsWith('data:') || url.startsWith('blob:')) return;

        const timing = request.timing();
        const response = await request.response();

        // duration = time from request start until the last byte of the response
        const duration = timing.responseEnd > 0
          ? Math.round(timing.responseEnd - timing.requestStart)
          : 0;

        networkRequests.push({
          method: request.method(),
          url,
          status: response ? response.status() : 0,
          duration,
          startTime: timing.startTime,
          resourceType: request.resourceType(),
        });
      } catch {
        // Ignore errors (request aborted, etc.)
      }
    });

    await use(page);

    // Attach network requests after the test finishes
    if (networkRequests.length > 0) {
      await testInfo.attach('piwi-dashboard-network', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(networkRequests)),
      });
    }

    // Capture browser-side performance metrics from the last active page
    try {
      const webVitals = await page.evaluate(() => {
        const navEntries = performance.getEntriesByType('navigation');
        const paintEntries = performance.getEntriesByType('paint');

        /** @type {PerformanceNavigationTiming | undefined} */
        const nav = /** @type {any} */ (navEntries[0]);

        const navigation = nav ? {
          url: nav.name,
          ttfb: Math.round(nav.responseStart - nav.fetchStart),
          domInteractive: Math.round(nav.domInteractive - nav.fetchStart),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
          loadComplete: Math.round(nav.loadEventEnd - nav.fetchStart),
          transferSize: nav.transferSize || 0,
          encodedBodySize: nav.encodedBodySize || 0,
          decodedBodySize: nav.decodedBodySize || 0,
        } : null;

        const paint = {};
        for (const entry of paintEntries) {
          // 'first-paint' → firstPaint, 'first-contentful-paint' → firstContentfulPaint
          const key = entry.name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          paint[key] = Math.round(entry.startTime);
        }

        if (!navigation && Object.keys(paint).length === 0) return null;
        return { navigation, paint };
      });

      if (webVitals) {
        await testInfo.attach('piwi-dashboard-web-vitals', {
          contentType: 'application/json',
          body: Buffer.from(JSON.stringify(webVitals)),
        });
      }
    } catch {
      // Page may be closed already or no navigation happened (API-only tests)
    }
  },
};

/**
 * Drop-in replacement for `@playwright/test` that includes dashboard fixtures.
 * Import this instead of `@playwright/test` in your test files.
 */
const test = base.extend(dashboardFixtures);

module.exports = { test, dashboardFixtures };
