import { gunzipSync } from 'zlib';
import type { Fixtures } from '@playwright/test';
import {
  generateAlternatives,
  extractAccessibleName,
  approximateAccessibleName,
  captureCallerLocation,
  LOCATOR_METHODS,
  CHAIN_METHODS,
  ACTION_METHODS,
  LOCATOR_CREATING_CHAINS,
  CAPTURED_ATTRIBUTES,
  type LocatorSnapshot,
} from './locator-healing.js';

/**
 * Playwright fixtures that collect network requests, console entries,
 * web vitals, ARIA snapshots, and locator interaction data during a test.
 *
 * Attaches collected data as `piwi-dashboard-*` test-info attachments
 * which the Piwi Dashboard reporter parses on `onTestEnd`.
 */
export const dashboardFixtures: Fixtures = {
  page: async ({ page }: any, use: any, testInfo: any) => {
    const networkRequests: Array<Record<string, unknown>> = [];
    const consoleEntries: Array<Record<string, unknown>> = [];
    const pendingHandlers: Promise<void>[] = [];

    // ── Locator interaction capture ──────────────────────────────────────
    const capturedLocators: LocatorSnapshot[] = [];
    const capturePromises: Promise<void>[] = [];

    // Chain methods that take args and define a new locator scope (not just narrow).
    // Origin method/args update to the chain call, e.g. .locator('.item') → locator('.item').
    // Positional/filter chains that narrow but don't change locator identity.
    // Origin stays from the page-level call, e.g. .first(), .nth(2), .filter(...).

    function wrapLocator(locator: any, originMethod: string, originArgs: unknown[]): any {
      return new Proxy(locator, {
        get(target, prop) {
          const original = target[prop];
          if (typeof original !== 'function') return original;

          if (CHAIN_METHODS.includes(prop as string)) {
            return (...args: unknown[]) => {
              const next = original.apply(target, args);
              if (LOCATOR_CREATING_CHAINS.has(prop as string)) {
                return wrapLocator(next, String(prop), args);
              }
              return wrapLocator(next, originMethod, originArgs);
            };
          }

          if (!ACTION_METHODS.includes(prop as string)) return original;

          return async (...callArgs: unknown[]) => {
            const seq = capturedLocators.length;
            // Capture the test call-site now (sync) so the snapshot's location
            // matches the error stack's first user frame — independent of
            // pw:api step ordering, worker interleaving, or concurrent actions.
            const callerLocation = captureCallerLocation();

            // Push a placeholder immediately — DOM capture runs async below
            capturedLocators.push({
              location: callerLocation,
              stepIndex: seq,
              used: {
                method: originMethod,
                args: originArgs,
                raw: `${originMethod}(${JSON.stringify(originArgs)})`,
              },
              element: null,
              alternatives: [],
            });

            // The placeholder is already pushed; if the action throws, the
            // placeholder (with location, no element) stays and the error
            // propagates naturally — no catch needed.
            const result = await original.apply(target, callArgs);

            // Fire-and-forget: capture element data without blocking the test.
            // evaluate() can hang when page navigates (element detaches), so
            // race it against a 500ms deadline and never throw.
            const resolveAttrs = (async () => {
              try {
                const attrs = (await Promise.race([
                  target.evaluate(
                    (el: any, keep: string[]) => {
                      const attrMap: Record<string, string | null> = {};
                      for (const key of keep) {
                        const v = el.getAttribute(key) ?? (el as any)[key];
                        attrMap[key] = typeof v === 'string' ? v.slice(0, 200) : v ? String(v).slice(0, 200) : null;
                      }
                      const r = el.getBoundingClientRect();
                      return {
                        tagName: el.tagName?.toLowerCase?.() ?? 'unknown',
                        attributes: attrMap,
                        textContent: (el.textContent || '').trim().slice(0, 80),
                        center: {
                          x: Math.round(r.x + r.width / 2),
                          y: Math.round(r.y + r.height / 2),
                        },
                      };
                    },
                    [...CAPTURED_ATTRIBUTES],
                  ),
                  new Promise<null>((_, reject) => setTimeout(() => reject(new Error('locator capture timeout')), 500)),
                ])) as any;

                const aria = (await target.ariaSnapshot({ ref: true }).catch(() => null)) as string | null;

                const accessibleName =
                  extractAccessibleName(aria) ||
                  approximateAccessibleName({
                    tagName: attrs.tagName,
                    attributes: attrs.attributes,
                    textContent: attrs.textContent,
                    accessibleName: null,
                    center: attrs.center,
                  });

                capturedLocators[seq] = {
                  location: callerLocation,
                  stepIndex: seq,
                  used: {
                    method: originMethod,
                    args: originArgs,
                    raw: `${originMethod}(${JSON.stringify(originArgs)})`,
                  },
                  element: { ...attrs, accessibleName },
                  alternatives: generateAlternatives({
                    tagName: attrs.tagName,
                    attributes: attrs.attributes,
                    textContent: attrs.textContent,
                    accessibleName,
                    center: attrs.center,
                  }),
                };
              } catch {
                // element detached or timeout — keep the placeholder
              }
            })();

            capturePromises.push(resolveAttrs);

            return result;
          };
        },
      });
    }

    for (const method of LOCATOR_METHODS) {
      const original = (page as any)[method].bind(page);
      (page as any)[method] = (...args: unknown[]) => wrapLocator(original(...args), method, args);
    }

    // ── Existing event listeners ──────────────────────────────────────────

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
          const resourceType = request.resourceType();

          // Only keep API/document requests; skip static assets (scripts, styles, fonts, images, media)
          if (!['fetch', 'xhr', 'document', 'other'].includes(resourceType)) return;

          const entry: Record<string, unknown> = {
            method: request.method(),
            url,
            status: response ? response.status() : 0,
            duration: timing.responseEnd > 0 ? Math.round(timing.responseEnd - timing.requestStart) : 0,
            startTime: timing.startTime,
            resourceType,
          };

          if (response) {
            const headers = response.headers();
            // Response content type (without charset/boundary params) — relevant
            // per-request metadata for distinguishing API/JSON vs document/HTML calls.
            const contentType = headers['content-type'];
            if (contentType) entry.contentType = contentType.split(';')[0]!.trim();

            const logHeader = headers['x-piwi-logs'];
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

    // ── Attach locator snapshots ──────────────────────────────────────────
    await Promise.allSettled(capturePromises);

    if (capturedLocators.length > 0) {
      await testInfo.attach('piwi-dashboard-locators', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(capturedLocators)),
      });
    }

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

/**
 * Extend a Playwright `test` object with Piwi Dashboard fixtures.
 *
 * Use this instead of importing `@playwright/test` directly from this package
 * to avoid the "Requiring @playwright/test second time" error caused by
 * duplicate module resolution.
 *
 * @example
 * ```ts
 * import { test as base } from '@playwright/test';
 * import { extendDashboardFixtures } from '@piwitests/reporter/fixtures';
 *
 * export const test = extendDashboardFixtures(base);
 * ```
 */
export function extendDashboardFixtures<T>(test: T): T {
  return (test as any).extend(dashboardFixtures);
}
