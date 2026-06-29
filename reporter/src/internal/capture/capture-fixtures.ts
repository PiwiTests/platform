import { gunzipSync } from 'node:zlib';
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Fixtures,
  Locator,
  Page,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs,
  Request,
  TestInfo,
} from '@playwright/test';
import {
  generateAlternatives,
  extractAccessibleName,
  approximateAccessibleName,
  captureCallerLocation,
  resolveAriaRole,
  suggestLocatorsFromAria,
  LOCATOR_METHODS,
  CHAIN_METHODS,
  ACTION_METHODS,
  LOCATOR_CREATING_CHAINS,
  CAPTURED_ATTRIBUTES,
  type LocatorSnapshot,
  type FailedLocatorInfo,
} from './locator-healing.js';
import { ATTACHMENT_NAMES, LOCATOR_SUGGESTION_ANNOTATION } from './attachments.js';

/** A Playwright fixture's `use` callback — hands the fixture value to the test. */
type UseFn<T> = (value: T) => Promise<void>;

/** Shape returned by the in-page element probe (see `wrapLocator`). */
interface CapturedAttrs {
  tagName: string;
  attributes: Record<string, string | null>;
  textContent: string;
  center: { x: number; y: number };
}

/** Shape returned by the in-page web-vitals probe (see `flushSink`). */
interface WebVitals {
  navigation: {
    url: string;
    ttfb: number;
    domInteractive: number;
    domContentLoaded: number;
    loadComplete: number;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
  } | null;
  paint: Record<string, number>;
}

/**
 * Per-test capture buffers. One sink is created per test and stashed in the
 * module-level `currentSink` while that test runs; page/locator instrumentation
 * reads `currentSink` live so events route to whichever test is executing.
 */
interface CaptureSink {
  networkRequests: Array<Record<string, unknown>>;
  consoleEntries: Array<Record<string, unknown>>;
  pendingHandlers: Promise<void>[];
  capturedLocators: LocatorSnapshot[];
  capturePromises: Promise<void>[];
  failedLocators: FailedLocatorInfo[];
  // Most-recently-touched instrumented page — used at teardown for the failure
  // ARIA snapshot and web-vitals read when a test drives several pages.
  lastActivePage: Page | null;
}

function createSink(): CaptureSink {
  return {
    networkRequests: [],
    consoleEntries: [],
    pendingHandlers: [],
    capturedLocators: [],
    capturePromises: [],
    failedLocators: [],
    lastActivePage: null,
  };
}

/**
 * The capture sink for the test currently running in this worker. Playwright
 * runs a worker's tests sequentially, so a single "current" sink is unambiguous.
 * It is null between tests and during `beforeAll`/`afterAll` — activity outside a
 * test (auth setup, teardown) is intentionally not captured.
 */
let currentSink: CaptureSink | null = null;

// Idempotency guards: a page/context/browser can be reached through several
// paths (browser patch, context patch, the `page` fixture, popup events), and
// must be wrapped exactly once.
const INSTRUMENTED_PAGES = new WeakSet<Page>();
const INSTRUMENTED_CONTEXTS = new WeakSet<BrowserContext>();
const PATCHED_BROWSERS = new WeakSet<Browser>();

// O(1) membership for the proxy `get` trap below, which runs on every property
// access of every wrapped locator. The source arrays from locator-healing are
// turned into Sets once here.
const CHAIN_METHOD_SET = new Set(CHAIN_METHODS);
const ACTION_METHOD_SET = new Set(ACTION_METHODS);
const FORM_FIELD_TAGS = new Set(['input', 'select', 'textarea']);
// CAPTURED_ATTRIBUTES is passed verbatim into evaluate() on every action — copy
// it once instead of spreading a fresh array per call.
const CAPTURED_ATTRS_ARG: string[] = [...CAPTURED_ATTRIBUTES];

// Chain methods that take args and define a new locator scope (not just narrow).
// Origin method/args update to the chain call, e.g. .locator('.item') → locator('.item').
// Positional/filter chains that narrow but don't change locator identity.
// Origin stays from the page-level call, e.g. .first(), .nth(2), .filter(...).
function wrapLocator(page: Page, locator: Locator, originMethod: string, originArgs: unknown[]): Locator {
  return new Proxy(locator, {
    get(target, prop) {
      const original = Reflect.get(target, prop) as unknown;
      if (typeof original !== 'function') return original;
      const fn = original as (...args: unknown[]) => unknown;

      if (CHAIN_METHOD_SET.has(prop as string)) {
        return (...args: unknown[]): Locator => {
          const next = fn.apply(target, args) as Locator;
          if (LOCATOR_CREATING_CHAINS.has(prop as string)) {
            return wrapLocator(page, next, String(prop), args);
          }
          return wrapLocator(page, next, originMethod, originArgs);
        };
      }

      if (!ACTION_METHOD_SET.has(prop as string)) return original;

      return async (...callArgs: unknown[]): Promise<unknown> => {
        // Bind to the sink active when the action starts so the async element
        // capture below writes back to the right test even across a boundary.
        const sink = currentSink;
        // Action outside a tracked test (e.g. during beforeAll) — run untouched.
        if (!sink) return fn.apply(target, callArgs);

        sink.lastActivePage = page;
        const seq = sink.capturedLocators.length;
        // Capture the test call-site now (sync) so the snapshot's location
        // matches the error stack's first user frame — independent of
        // pw:api step ordering, worker interleaving, or concurrent actions.
        const callerLocation = captureCallerLocation();
        // Built once, shared by the placeholder and the resolved snapshot below.
        const used = {
          method: originMethod,
          args: originArgs,
          raw: `${originMethod}(${JSON.stringify(originArgs)})`,
        };

        // Push a placeholder immediately — DOM capture runs async below
        sink.capturedLocators.push({
          location: callerLocation,
          stepIndex: seq,
          used,
          element: null,
          alternatives: [],
        });

        // The placeholder is already pushed. If the action throws, record the
        // failed locator (so teardown can suggest a fresh one for the element's
        // current identity) and re-throw so the test still fails.
        let result: unknown;
        try {
          result = await fn.apply(target, callArgs);
        } catch (error) {
          sink.failedLocators.push({ method: originMethod, args: originArgs });
          throw error;
        }

        // Fire-and-forget: capture element data without blocking the test.
        // evaluate() can hang when page navigates (element detaches), so
        // race it against a 500ms deadline and never throw.
        const resolveAttrs = (async () => {
          try {
            // `el` is browser-context (no DOM lib in this Node package), so it
            // stays `any`; the callback's return type pins `attrs` to CapturedAttrs.
            const attrs = await Promise.race([
              target.evaluate((el: any, keep: string[]): CapturedAttrs => {
                const attrMap: Record<string, string | null> = {};
                for (const key of keep) {
                  const v = el.getAttribute(key) ?? el[key];
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
              }, CAPTURED_ATTRS_ARG),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('locator capture timeout')), 500)),
            ]);

            // The browser-computed accessible name only feeds role-based and
            // form-field alternatives, so only pay for the extra ARIA
            // snapshot when the element actually has a role or is a field.
            const role = resolveAriaRole({ ...attrs, accessibleName: null });
            const isFormField = FORM_FIELD_TAGS.has(attrs.tagName);
            // Bound with a timeout: without it, ariaSnapshot waits up to the
            // test timeout when the page is mid-navigation, which hangs the
            // teardown that drains these capture promises.
            // `ref` is a valid runtime flag but absent from the installed
            // @playwright/test option types, so cast the options to keep passing it.
            const ariaOpts = { ref: true, timeout: 500 } as Parameters<Locator['ariaSnapshot']>[0];
            const aria = role || isFormField ? await target.ariaSnapshot(ariaOpts).catch(() => null) : null;

            const accessibleName =
              extractAccessibleName(aria) || approximateAccessibleName({ ...attrs, accessibleName: null });

            sink.capturedLocators[seq] = {
              location: callerLocation,
              stepIndex: seq,
              used,
              element: { ...attrs, accessibleName },
              alternatives: generateAlternatives({ ...attrs, accessibleName }),
            };
          } catch {
            // element detached or timeout — keep the placeholder
          }
        })();

        sink.capturePromises.push(resolveAttrs);

        return result;
      };
    },
  });
}

/**
 * Instrument a single page: wrap its locator-building methods for healing
 * capture and attach console/network listeners. Idempotent — safe to call on a
 * page already reached through another path (browser patch, `page` fixture).
 */
function instrumentPage(page: Page): void {
  if (!page || INSTRUMENTED_PAGES.has(page)) return;
  INSTRUMENTED_PAGES.add(page);

  // Opt-out: skipped when PIWI_CAPTURE_LOCATORS=false (set automatically when
  // the reporter's collectPerformanceMetrics / captureLocators is disabled),
  // so the per-action DOM read + ARIA snapshot cost is never paid when unused.
  const captureLocators = process.env.PIWI_CAPTURE_LOCATORS !== 'false';

  if (captureLocators) {
    // Locator factories are accessed by dynamic name, so a string-indexed view
    // of the page is the cleanest local escape hatch from the static surface.
    const factories = page as unknown as Record<string, (...args: unknown[]) => Locator>;
    for (const method of LOCATOR_METHODS) {
      const original = factories[method]!.bind(page);
      factories[method] = (...args: unknown[]): Locator => {
        // Touching a page's locator factory marks it the active page even for
        // assertion-only tests that never call an action method.
        if (currentSink) currentSink.lastActivePage = page;
        return wrapLocator(page, original(...args), method, args);
      };
    }
  }

  page.on('console', (msg: ConsoleMessage) => {
    const sink = currentSink;
    if (!sink) return;
    const type = msg.type();
    if (['warning', 'error', 'assert'].includes(type)) {
      const location = msg.location();
      sink.consoleEntries.push({
        type,
        text: msg.text(),
        timestamp: Date.now(),
        location: location ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : null,
      });
    }
  });

  page.on('requestfinished', (request: Request) => {
    const sink = currentSink;
    if (!sink) return;
    sink.lastActivePage = page;
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

        sink.networkRequests.push(entry);
      } catch {
        /* ignore */
      }
    })();
    sink.pendingHandlers.push(p);
  });
}

/**
 * Instrument a browser context so every page it opens — via `newPage()` or as a
 * popup/`window.open` — is captured. Idempotent.
 */
function instrumentContext(context: BrowserContext): void {
  if (!context || INSTRUMENTED_CONTEXTS.has(context)) return;
  INSTRUMENTED_CONTEXTS.add(context);

  const originalNewPage = context.newPage.bind(context);
  context.newPage = async (...args: Parameters<BrowserContext['newPage']>): Promise<Page> => {
    const page = await originalNewPage(...args);
    instrumentPage(page);
    return page;
  };

  // Popups and pages the context opens on its own (idempotent with the above).
  context.on('page', (page: Page) => instrumentPage(page));
}

/**
 * Patch a browser so any page or context created directly from it is
 * instrumented. This is what makes capture work for suites that build their own
 * pages from the worker-scoped `browser` (e.g. `browser.newPage()` /
 * `browser.newContext().newPage()`) instead of using the `page` fixture.
 * Idempotent.
 */
function patchBrowser(browser: Browser): void {
  if (!browser || PATCHED_BROWSERS.has(browser)) return;
  PATCHED_BROWSERS.add(browser);

  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...args: Parameters<Browser['newPage']>): Promise<Page> => {
    const page = await originalNewPage(...args);
    instrumentPage(page);
    return page;
  };

  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args: Parameters<Browser['newContext']>): Promise<BrowserContext> => {
    const context = await originalNewContext(...args);
    instrumentContext(context);
    return context;
  };
}

/**
 * Drain in-flight capture work and attach the collected `piwi-*` data
 * to the test. Mirrors the per-test teardown the `page` fixture used to do, but
 * sourced from the sink so it works regardless of how the test's pages were made.
 */
async function flushSink(sink: CaptureSink, testInfo: TestInfo): Promise<void> {
  // Wait for all in-flight requestfinished handlers before snapshotting
  // networkRequests — the last request (often the one that failed the test)
  // races with teardown and its serverLogs would otherwise be lost.
  await Promise.allSettled(sink.pendingHandlers);

  // ── Attach locator snapshots ──────────────────────────────────────────
  // Cap the drain so a stuck capture (e.g. a navigation in flight) can never
  // hang teardown past the test timeout; per-action evaluate/ariaSnapshot are
  // already bounded, this is a backstop.
  await Promise.race([Promise.allSettled(sink.capturePromises), new Promise((resolve) => setTimeout(resolve, 2000))]);

  if (sink.capturedLocators.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.locators, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sink.capturedLocators)),
    });
  }

  const page = sink.lastActivePage;

  if (page && testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
    try {
      const snapshot = await page.locator(':root').ariaSnapshot();
      if (snapshot) {
        await testInfo.attach(ATTACHMENT_NAMES.ariaSnapshot, {
          contentType: 'text/plain',
          body: snapshot,
        });

        // Suggest a fresh locator for the failed action from the current page.
        // When the element was renamed/moved, the pre-captured alternatives
        // describe the old element, so this points at where it went now — as a
        // Playwright annotation (shown in the report + trace) and an attachment
        // (shown in the trace viewer). It does NOT change the locator.
        const failed = sink.failedLocators[sink.failedLocators.length - 1];
        const suggestion = failed ? suggestLocatorsFromAria(failed, snapshot) : null;
        if (suggestion) {
          testInfo.annotations.push({
            type: LOCATOR_SUGGESTION_ANNOTATION,
            description: `${suggestion.failing} matched nothing on the failing page — the element may have been renamed or moved. Suggested: ${suggestion.suggestions.join('  |  ')}`,
          });
          await testInfo.attach(ATTACHMENT_NAMES.locatorSuggestion, {
            contentType: 'application/json',
            body: Buffer.from(JSON.stringify(suggestion)),
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (sink.consoleEntries.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.console, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sink.consoleEntries)),
    });
  }

  if (sink.networkRequests.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.network, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sink.networkRequests)),
    });
  }

  if (page) {
    try {
      // Runs in the browser, so the perf-entry reads stay `any` (no DOM lib);
      // the callback return type pins `webVitals` to WebVitals.
      const webVitals = await page.evaluate((): WebVitals | null => {
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
        await testInfo.attach(ATTACHMENT_NAMES.webVitals, {
          contentType: 'application/json',
          body: Buffer.from(JSON.stringify(webVitals)),
        });
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Playwright fixtures that collect network requests, console entries,
 * web vitals, ARIA snapshots, and locator interaction data during a test.
 *
 * Capture is wired at the `browser` level, so it works whether a test uses the
 * standard `page` fixture or builds its own pages from `browser` /
 * `browser.newContext()`. Collected data is attached as `piwi-*`
 * test-info attachments which the Piwi Dashboard reporter parses on `onTestEnd`.
 */
export const dashboardFixtures: Fixtures = {
  // Worker-scoped: patch the shared browser so every page/context created from
  // it — including by user fixtures that take `browser` directly — is captured.
  browser: [
    async ({ browser }: PlaywrightWorkerArgs, use: UseFn<Browser>) => {
      patchBrowser(browser);
      await use(browser);
    },
    { scope: 'worker' },
  ],

  // Safety net for the standard `page` fixture, in case its page is created
  // through an internal path the browser patch doesn't see. Idempotent, so it
  // never double-wraps a page the browser patch already instrumented.
  page: async ({ page }: PlaywrightTestArgs, use: UseFn<Page>) => {
    instrumentPage(page);
    await use(page);
  },

  // Auto, test-scoped: open a capture sink for the running test and flush it
  // (attach the collected data) at teardown. Runs for every test without being
  // requested, so suites that never destructure `page` are still captured.
  piwiDashboardCapture: [
    async ({}, use: UseFn<void>, testInfo: TestInfo) => {
      const sink = createSink();
      currentSink = sink;
      try {
        await use();
      } finally {
        currentSink = null;
        await flushSink(sink, testInfo);
      }
    },
    { auto: true },
  ],
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
 * import { extendDashboardFixtures } from '@piwitests/reporter';
 *
 * export const test = extendDashboardFixtures(base);
 * ```
 */
export function extendDashboardFixtures<T>(test: T): T {
  return (test as any).extend(dashboardFixtures);
}
