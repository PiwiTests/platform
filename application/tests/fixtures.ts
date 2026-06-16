/**
 * Shared test fixtures for the Piwi Dashboard test suite.
 *
 * Extends the base Playwright `test` with dashboard fixtures that mirror the
 * behavior of `@phenx/piwi-dashboard-reporter/fixtures` — automatically
 * capturing network request timing and browser performance (Web Vitals) for
 * every page interaction so they appear in the dashboard.
 *
 * Usage in test files:
 * ```ts
 * import { test, expect } from './fixtures'
 * ```
 */
import { gunzipSync } from 'node:zlib';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

type NetworkRequest = {
  method: string;
  url: string;
  status: number;
  duration: number;
  startTime: number;
  resourceType: string;
  serverLogs?: unknown;
};

async function collectNetworkAndVitals(page: Page, testInfo: TestInfo) {
  const networkRequests: NetworkRequest[] = [];
  const pendingHandlers: Promise<void>[] = [];

  page.on('requestfinished', (request) => {
    const p = (async () => {
      try {
        const url = request.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return;

        const timing = request.timing();
        const response = await request.response();
        const duration = timing.responseEnd > 0 ? Math.round(timing.responseEnd - timing.requestStart) : 0;

        const entry: NetworkRequest = {
          method: request.method(),
          url,
          status: response ? response.status() : 0,
          duration,
          startTime: timing.startTime,
          resourceType: request.resourceType(),
        };

        if (response) {
          const logHeader = response.headers()['x-piwi-logs'];
          if (logHeader) {
            try {
              entry.serverLogs = JSON.parse(gunzipSync(Buffer.from(logHeader, 'base64')).toString('utf-8'));
            } catch {
              /* ignore malformed header */
            }
          }
        }

        networkRequests.push(entry);
      } catch {
        // ignore aborted requests
      }
    })();
    pendingHandlers.push(p);
  });

  return async () => {
    // Wait for all in-flight requestfinished handlers to complete before
    // snapshotting networkRequests — without this, the last request (often
    // the one that caused the test to fail) races with fixture teardown and
    // its entry (including serverLogs) can be missing from the attachment.
    await Promise.allSettled(pendingHandlers);

    if (networkRequests.length > 0) {
      await testInfo.attach('piwi-dashboard-network', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(networkRequests)),
      });
    }

    try {
      const webVitals = await page.evaluate(() => {
        const navEntries = performance.getEntriesByType('navigation');
        const paintEntries = performance.getEntriesByType('paint');
        const nav = navEntries[0] as PerformanceNavigationTiming | undefined;

        const navigation = nav
          ? {
              url: nav.name,
              ttfb: Math.round(nav.responseStart - nav.fetchStart),
              domInteractive: Math.round(nav.domInteractive - nav.fetchStart),
              domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.fetchStart),
              loadComplete: Math.round(nav.loadEventEnd - nav.fetchStart),
              transferSize: nav.transferSize || 0,
              encodedBodySize: nav.encodedBodySize || 0,
              decodedBodySize: nav.decodedBodySize || 0,
            }
          : null;

        const paint: Record<string, number> = {};
        for (const entry of paintEntries) {
          const key = entry.name.replace(/-([a-z])/g, (_: string, letter: string) => letter.toUpperCase());
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
      // page may already be closed or no navigation happened
    }
  };
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use, testInfo) => {
    const flush = await collectNetworkAndVitals(page, testInfo);
    await use(page);
    try {
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await page.screenshot({ fullPage: true, timeout: 5000 });
        await testInfo.attach('failure-screenshot', {
          contentType: 'image/png',
          body: screenshot,
        });
      }
    } catch {
      // page may already be closed or screenshot failed — skip
    }

    try {
      if (testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
        const snapshot = await page.locator(':root').ariaSnapshot();
        if (snapshot) {
          await testInfo.attach('piwi-dashboard-aria-snapshot', {
            contentType: 'text/plain',
            body: snapshot,
          });
        }
      }
    } catch {
      // aria snapshot may fail if page is already closed
    }

    await flush();
  },
});

export { expect };
