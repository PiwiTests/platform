import { gunzipSync } from 'zlib';
import { test as base } from '@playwright/test';

/**
 * Playwright fixtures that collect network requests, console entries,
 * web vitals, and ARIA snapshots during a test.
 *
 * Attaches collected data as `piwi-dashboard-*` test-info attachments
 * which the Piwi Dashboard reporter parses on `onTestEnd`.
 */
export const dashboardFixtures = {
  page: async ({ page }: any, use: any, testInfo: any) => {
    const networkRequests: Array<Record<string, unknown>> = [];
    const consoleEntries: Array<Record<string, unknown>> = [];
    const pendingHandlers: Promise<void>[] = [];

    page.on('console', (msg: any) => {
      const type = msg.type();
      if (['warning', 'error', 'assert'].includes(type)) {
        consoleEntries.push({
          type,
          text: msg.text(),
          timestamp: Date.now(),
          location: msg.location()
            ? `${msg.location().url}:${msg.location().lineNumber}:${msg.location().columnNumber}`
            : null,
        });
      }
    });

    page.on('requestfinished', (request: any) => {
      const p = (async () => {
        try {
          const url = request.url();
          if (url.startsWith('data:') || url.startsWith('blob:')) return;
          const timing = request.timing();
          const response = await request.response();
          const entry: Record<string, unknown> = {
            method: request.method(),
            url,
            status: response ? response.status() : 0,
            duration: timing.responseEnd > 0 ? Math.round(timing.responseEnd - timing.requestStart) : 0,
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
          /* ignore */
        }
      })();
      pendingHandlers.push(p);
    });

    await use(page);

    // Wait for all in-flight requestfinished handlers before snapshotting
    // networkRequests — the last request (often the one that failed the test)
    // races with fixture teardown and its serverLogs would otherwise be lost.
    await Promise.allSettled(pendingHandlers);

    if (testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
      try {
        const snapshot = await page.locator(':root').ariaSnapshot();
        if (snapshot) {
          await testInfo.attach('piwi-dashboard-aria-snapshot', {
            contentType: 'text/plain',
            body: snapshot,
          });
        }
      } catch {
        /* ignore */
      }
    }

    if (consoleEntries.length > 0) {
      await testInfo.attach('piwi-dashboard-console', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(consoleEntries)),
      });
    }

    if (networkRequests.length > 0) {
      await testInfo.attach('piwi-dashboard-network', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(networkRequests)),
      });
    }

    try {
      const webVitals = await page.evaluate(() => {
        const navEntries = performance.getEntriesByType('navigation' as any);
        const paintEntries = performance.getEntriesByType('paint' as any);
        const nav = navEntries[0] as any;
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
          const key = (entry as any).name.replace(/-([a-z])/g, (_: string, l: string) => l.toUpperCase());
          paint[key] = Math.round((entry as any).startTime);
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
      /* ignore */
    }
  },
};

/** Playwright `test` extended with Piwi Dashboard fixtures (network, web vitals, console, ARIA snapshots) */
export const test = base.extend(dashboardFixtures);
