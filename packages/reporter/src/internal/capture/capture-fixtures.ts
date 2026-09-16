import { gunzipSync } from 'node:zlib';
import { probeElementAttrs, type ProbeArg, type ProbedAttrs } from '@piwitests/picker-dom';
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Fixtures,
  FrameLocator,
  Locator,
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  Request,
  TestInfo,
  TestType,
} from '@playwright/test';
import {
  generateAlternatives,
  extractAccessibleName,
  approximateAccessibleName,
  captureCallerLocation,
  dedupeSnapshotsByLocation,
  exactAccessibleName,
  resolveAriaRole,
  suggestLocatorsFromAria,
  FORM_FIELD_TAGS,
  LOCATOR_METHODS,
  CHAIN_METHODS,
  ACTION_METHODS,
  LOCATOR_CREATING_CHAINS,
  EXPECT_METHOD,
  EXPECT_CAPTURE_EXPRESSIONS,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
  type LocatorSnapshot,
  type FailedLocatorInfo,
} from './locator-healing.js';
import { ATTACHMENT_NAMES, LOCATOR_SUGGESTION_ANNOTATION, USER_PICK_ANNOTATION } from './attachments.js';
import { environmentalSkipReason, inspectionGateFromTestInfo, shouldInspectOnFailure } from './inspect-on-failure.js';
import { applyPickToSnapshots, deriveFailedLocator, runLocatorPicker, type UserPickResult } from './pick-on-failure.js';
import { isDueForAriaSample } from '../support/aria-sampling.js';

// Re-exported: probeElementAttrs now lives in @piwitests/picker-dom (shared
// with the dashboard's snapshot picker), but the dogfood mirror
// (`application/tests/fixtures.ts`) and this package's own tests import it
// from here.
export { probeElementAttrs };
export type { ProbeArg, ProbedAttrs };

/** A Playwright fixture's `use` callback — hands the fixture value to the test. */
type UseFn<T> = (value: T) => Promise<void>;

// Playwright constrains `TestType`'s args to its internal `KeyValue`
// (`{ [key: string]: any }`) — mirror it so real `test` objects satisfy the
// bound (their args are index-signature-free interfaces) while a non-test
// argument is still rejected by the `TestType` parameter type.
type FixtureArgs = { [key: string]: any };

/** The subset of a Playwright `Dialog` the close-event reader touches. */
interface DialogLike {
  type?: () => string;
  message?: () => string;
  defaultValue?: () => string;
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
  /**
   * Core Web Vitals from buffered PerformanceObserver entries. Chromium-only —
   * Firefox/WebKit don't expose these entry types, so each value is null there.
   * `inp` is null when the test produced no interactions (common in short tests).
   */
  vitals: {
    lcp: number | null;
    cls: number | null;
    inp: number | null;
  } | null;
}

/** Plain-object projection of a performance entry, shipped out of the page. */
export interface RawVitalEntry {
  startTime?: number;
  value?: number;
  hadRecentInput?: boolean;
  interactionId?: number;
  duration?: number;
}

/**
 * Aggregate buffered performance entries into LCP/CLS/INP. Pure and Node-side
 * so it is unit-testable; the in-page evaluate only ships raw entry projections.
 * A null entry list means the entry type is unsupported (non-Chromium) — the
 * metric is null rather than 0 so absence is distinguishable from "no shifts".
 */
export function computeCoreVitals(
  lcpEntries: RawVitalEntry[] | null,
  shiftEntries: RawVitalEntry[] | null,
  eventEntries: RawVitalEntry[] | null,
): { lcp: number | null; cls: number | null; inp: number | null } | null {
  // The last LCP candidate is the final LCP.
  const lastLcp = lcpEntries && lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : null;
  const lcp = lastLcp && typeof lastLcp.startTime === 'number' ? Math.round(lastLcp.startTime) : null;

  // Simple sum over shifts without recent input. The spec's session-window
  // grouping matters for long sessions; a test's page lifetime is short enough
  // that the plain sum tracks it closely.
  let cls: number | null = null;
  if (shiftEntries) {
    const sum = shiftEntries.reduce(
      (acc, e) => acc + (e.hadRecentInput ? 0 : typeof e.value === 'number' ? e.value : 0),
      0,
    );
    cls = Math.round(sum * 10000) / 10000;
  }

  // Worst interaction latency: max duration per interactionId, then the p98
  // interaction when there are many (mirrors the INP definition, simplified).
  let inp: number | null = null;
  if (eventEntries && eventEntries.length > 0) {
    const byInteraction = new Map<number, number>();
    for (const e of eventEntries) {
      if (typeof e.interactionId !== 'number' || e.interactionId <= 0) continue;
      const duration = typeof e.duration === 'number' ? e.duration : 0;
      const prev = byInteraction.get(e.interactionId) ?? 0;
      if (duration > prev) byInteraction.set(e.interactionId, duration);
    }
    const durations = [...byInteraction.values()].sort((a, b) => a - b);
    if (durations.length > 0) {
      const index = durations.length > 50 ? Math.floor(durations.length * 0.98) : durations.length - 1;
      inp = Math.round(durations[Math.min(index, durations.length - 1)]!);
    }
  }

  if (lcp === null && cls === null && inp === null) return null;
  return { lcp, cls, inp };
}

/**
 * Per-test capture buffers. One sink is created per test and stashed in the
 * module-level `currentSink` while that test runs; page/locator instrumentation
 * reads `currentSink` live so events route to whichever test is executing.
 */
interface CaptureSink {
  networkRequests: Array<Record<string, unknown>>;
  consoleEntries: Array<Record<string, unknown>>;
  dialogs: Array<Record<string, unknown>>;
  pendingHandlers: Promise<void>[];
  capturedLocators: LocatorSnapshot[];
  capturePromises: Promise<void>[];
  failedLocators: FailedLocatorInfo[];
  // Call sites already probed this test, by action or by assertion. Only one
  // snapshot per location survives `dedupeSnapshotsByLocation` and the server
  // stores one row per location, so every probe after the first at a given
  // line is work whose result is thrown away — a loop or a page-object method
  // called repeatedly hits the same line many times over. A location is
  // removed again if its probe fails, so a later call still gets to try.
  probedLocations: Set<string>;
  // Most-recently-touched instrumented page — used at teardown for the failure
  // ARIA snapshot and web-vitals read when a test drives several pages.
  lastActivePage: Page | null;
  // The running test's info, so close wrappers can see its status mid-teardown.
  testInfo: TestInfo | null;
  // Page-dependent teardown reads, taken by the close wrappers while the page
  // was still open. The auto capture fixture tears down AFTER the built-in
  // page/context fixtures, so by the time flushSink runs the standard test
  // page is already closed and can no longer be read live.
  stashedWebVitals: WebVitals | null;
  stashedPageState: PageState | null;
  stashedAria: string | null;
  // The failure-time aria tree as JSON (Playwright ≥ 1.63), stringified. Feeds
  // the healing, clue and page-diff paths that read a tree; the YAML above feeds
  // the ARIA card.
  stashedAriaJson: string | null;
  // The failure-time overlay was already offered once this test — several
  // close wrappers can fire for the same teardown.
  pickOffered: boolean;
  // A replacement locator the human confirmed in the failure-time picker.
  userPick: UserPickResult | null;
}

function createSink(): CaptureSink {
  return {
    networkRequests: [],
    consoleEntries: [],
    dialogs: [],
    pendingHandlers: [],
    capturedLocators: [],
    capturePromises: [],
    failedLocators: [],
    probedLocations: new Set(),
    lastActivePage: null,
    testInfo: null,
    stashedWebVitals: null,
    stashedPageState: null,
    stashedAria: null,
    stashedAriaJson: null,
    pickOffered: false,
    userPick: null,
  };
}

/**
 * The capture sink for the test currently running in this worker. Playwright
 * runs a worker's tests sequentially, so a single "current" sink is unambiguous.
 * It is null between tests and during `beforeAll`/`afterAll` — activity outside a
 * test (auth setup, teardown) is intentionally not captured.
 */
let currentSink: CaptureSink | null = null;

/**
 * Element probes whose protocol call is still in flight. Closing a page,
 * context, or browser while a probe is mid-flight makes Playwright's
 * connection dispatcher throw a global "Object with guid handle@… was not
 * bound in the connection" error, which fails whichever test happens to be
 * running. The close wrappers drain this set (bounded) before closing.
 */
const PENDING_PROBES = new Set<Promise<unknown>>();

async function drainPendingProbes(capMs: number): Promise<void> {
  if (PENDING_PROBES.size === 0) return;
  let cap: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(PENDING_PROBES),
    new Promise((resolve) => {
      cap = setTimeout(resolve, capMs);
    }),
  ]);
  clearTimeout(cap);
}

function isPageClosed(page: Page): boolean {
  try {
    return typeof page.isClosed === 'function' ? page.isClosed() : false;
  } catch {
    return false;
  }
}

function pageContext(page: Page): BrowserContext | null {
  try {
    return typeof page.context === 'function' ? page.context() : null;
  } catch {
    return null;
  }
}

/** The evaluate's raw result: navigation/paint plus raw core-vitals entries. */
interface WebVitalsProbeResult {
  navigation: WebVitals['navigation'];
  paint: Record<string, number>;
  lcpEntries: RawVitalEntry[] | null;
  shiftEntries: RawVitalEntry[] | null;
  eventEntries: RawVitalEntry[] | null;
}

/** Read navigation/paint timings and core-vitals entries — null when unavailable or the page is gone. */
async function readWebVitals(page: Page): Promise<WebVitals | null> {
  try {
    // Runs in the browser, so the perf-entry reads stay `any` (no DOM lib);
    // the callback return type pins the result. Aggregation happens Node-side
    // in computeCoreVitals so the in-page code stays a thin projection.
    const probe = await page.evaluate(async (): Promise<WebVitalsProbeResult | null> => {
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

      // Buffered-observer read of an entry type. Returns null when the type is
      // unsupported (non-Chromium); [] when supported but nothing recorded.
      // Buffered entries are dispatched in a queued task, so wait one macrotask
      // before draining with takeRecords().
      const readBuffered = (type: string, extra?: Record<string, unknown>): Promise<any[] | null> =>
        new Promise((resolve) => {
          try {
            const PO = (globalThis as any).PerformanceObserver;
            if (!PO || !(PO.supportedEntryTypes || []).includes(type)) return resolve(null);
            const out: any[] = [];
            const po = new PO((list: any) => out.push(...list.getEntries()));
            po.observe({ type, buffered: true, ...extra });
            setTimeout(() => {
              try {
                out.push(...po.takeRecords());
                po.disconnect();
              } catch {
                // Entries gathered so far still count.
              }
              resolve(out);
            }, 0);
          } catch {
            resolve(null);
          }
        });

      const [lcpRaw, shiftRaw, eventRaw, firstInputRaw] = await Promise.all([
        readBuffered('largest-contentful-paint'),
        readBuffered('layout-shift'),
        // durationThreshold 40 mirrors the web-vitals library — captures every
        // interaction slow enough to matter without flooding the buffer.
        readBuffered('event', { durationThreshold: 40 }),
        readBuffered('first-input'),
      ]);

      const project = (entries: any[] | null): RawVitalEntry[] | null =>
        entries === null
          ? null
          : entries.map((e: any) => ({
              startTime: e.startTime,
              value: e.value,
              hadRecentInput: e.hadRecentInput,
              interactionId: e.interactionId,
              duration: e.duration,
            }));

      const interactionEntries =
        eventRaw === null && firstInputRaw === null ? null : [...(eventRaw ?? []), ...(firstInputRaw ?? [])];

      return {
        navigation,
        paint,
        lcpEntries: project(lcpRaw),
        shiftEntries: project(shiftRaw),
        eventEntries: project(interactionEntries),
      };
    });

    if (!probe) return null;
    const vitals = computeCoreVitals(probe.lcpEntries, probe.shiftEntries, probe.eventEntries);
    if (!probe.navigation && Object.keys(probe.paint).length === 0 && !vitals) return null;
    return { navigation: probe.navigation, paint: probe.paint, vitals };
  } catch {
    return null;
  }
}

/** Page state captured at test end. Storage values and cookie values are NEVER included. */
export interface PageState {
  url: string;
  hash: string | null;
  /** `history.state` as JSON, capped and token-masked. */
  historyState: string | null;
  /** Key names + value lengths only. */
  localStorage: Array<{ key: string; length: number }>;
  sessionStorage: Array<{ key: string; length: number }>;
  /** Cookie names + flags only (values are never read). */
  cookies: Array<{
    name: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
    expires?: number;
  }>;
}

/** Raw in-page reads shipped out of the evaluate (see `readPageState`). */
export interface RawPageState {
  url: string;
  hash: string | null;
  historyState: string | null;
  localStorage: Array<{ key: string; length: number }>;
  sessionStorage: Array<{ key: string; length: number }>;
}

const PAGE_STATE_MAX_STORAGE_KEYS = 50;
const PAGE_STATE_MAX_COOKIES = 30;
const PAGE_STATE_HISTORY_CAP = 2048;
const TOKEN_MASK_RES = [/\beyJ[\w-]{10,}\.[\w-]{5,}\.[\w-]{5,}\b/g, /\b[0-9a-f]{32,}\b/gi];

/**
 * Assemble the wire page-state from the in-page reads and the context cookies.
 * Pure and Node-side so the sanitization (token masking, caps, value-free
 * cookies) is unit-testable.
 */
export function buildPageState(raw: RawPageState, cookies: Array<Record<string, unknown>> | null): PageState {
  let historyState = raw.historyState;
  if (historyState) {
    for (const re of TOKEN_MASK_RES) historyState = historyState.replace(re, '[masked]');
    if (historyState.length > PAGE_STATE_HISTORY_CAP) {
      historyState = historyState.slice(0, PAGE_STATE_HISTORY_CAP) + '…';
    }
  }
  const capStorage = (entries: Array<{ key: string; length: number }>) =>
    (Array.isArray(entries) ? entries : []).slice(0, PAGE_STATE_MAX_STORAGE_KEYS).map((e) => ({
      key: String(e.key).slice(0, 200),
      length: typeof e.length === 'number' ? e.length : 0,
    }));

  return {
    url: raw.url,
    hash: raw.hash || null,
    historyState: historyState || null,
    localStorage: capStorage(raw.localStorage),
    sessionStorage: capStorage(raw.sessionStorage),
    cookies: (cookies ?? []).slice(0, PAGE_STATE_MAX_COOKIES).map((c) => ({
      name: String(c.name ?? ''),
      domain: String(c.domain ?? ''),
      path: String(c.path ?? ''),
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      ...(c.sameSite !== undefined ? { sameSite: String(c.sameSite) } : {}),
      ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
    })),
  };
}

/** Read the page's state — null when unavailable or the page is gone. */
async function readPageState(page: Page): Promise<PageState | null> {
  try {
    const raw = await page.evaluate((): RawPageState => {
      // Key names + value lengths only — values never leave the page.
      const listStorage = (s: any): Array<{ key: string; length: number }> => {
        const out: Array<{ key: string; length: number }> = [];
        try {
          for (let i = 0; i < s.length; i++) {
            const key = s.key(i);
            if (key != null) out.push({ key, length: (s.getItem(key) ?? '').length });
          }
        } catch {
          // Storage access can throw in sandboxed/opaque-origin pages.
        }
        return out;
      };
      const g = globalThis as any;
      let historyState: string | null = null;
      try {
        historyState = g.history?.state == null ? null : JSON.stringify(g.history.state);
      } catch {
        // Unserializable history state.
      }
      return {
        url: g.location.href,
        hash: g.location.hash || null,
        historyState,
        localStorage: listStorage((globalThis as any).localStorage),
        sessionStorage: listStorage((globalThis as any).sessionStorage),
      };
    });
    if (!raw) return null;

    // Cookie flags are only reachable from the context API, never document.cookie.
    let cookies: Array<Record<string, unknown>> | null = null;
    try {
      cookies = ((await pageContext(page)?.cookies()) as Array<Record<string, unknown>> | undefined) ?? null;
    } catch {
      cookies = null;
    }

    return buildPageState(raw, cookies);
  } catch {
    return null;
  }
}

/**
 * Take the page-dependent teardown reads (web vitals; page state; ARIA
 * snapshot when the test failed) while the last active page is still open.
 * Called by the close wrappers just before a close that would take that page
 * with it — flushSink runs too late for a live read on the standard test page.
 */
async function stashPageState(sink: CaptureSink, closing: { page?: Page; context?: BrowserContext }): Promise<void> {
  const page = sink.lastActivePage;
  if (!page || isPageClosed(page)) return;
  const belongsToClosing =
    closing.page === page || (closing.context !== undefined && pageContext(page) === closing.context);
  if (!belongsToClosing) return;

  const vitals = await readWebVitals(page);
  if (vitals) sink.stashedWebVitals = vitals;

  if (process.env.PIWI_CAPTURE_PAGE_STATE !== 'false') {
    const pageState = await readPageState(page);
    if (pageState) sink.stashedPageState = pageState;
  }

  const status = sink.testInfo?.status;
  const sampleAria = async (): Promise<void> => {
    const root = page.locator(':root');
    const aria = await ariaSnapshotBestEffort(root, 1000);
    if (aria) sink.stashedAria = aria;
    const ariaJson = await ariaSnapshotJSONBestEffort(root, 1000);
    if (ariaJson) sink.stashedAriaJson = ariaJson;
  };
  if (status === 'failed' || status === 'timedOut' || status === 'interrupted') {
    await sampleAria();
  } else if (
    status === 'passed' &&
    process.env.PIWI_SAMPLE_ARIA_ON_PASS !== 'false' &&
    sink.testInfo &&
    isDueForAriaSample(sink.testInfo)
  ) {
    // Sample the green page while it is still open, for the tests the server
    // flagged as due a fresh snapshot this run.
    await sampleAria();
  }
}

/**
 * Open Piwi's own failure-time overlay on the still-open page before it closes.
 * This is the single entry point for both `PIWI_PICK_LOCATOR_ON_FAIL` (pick a
 * replacement for the broken locator) and `PIWI_INSPECT_ON_FAIL` (inspect the
 * failing page and pick a locator for any element) — both run our overlay, not
 * Playwright's native inspector, so the experience is fully ours and a
 * confirmed pick flows back into the dashboard.
 *
 * Runs after `stashPageState` so the captured failure evidence reflects the
 * page as the test left it, not as the human poked at it. Gated per
 * `inspect-on-failure.ts` (opt-in, headed, never CI, final attempt only).
 */
async function maybeOpenPicker(sink: CaptureSink, closing?: { page?: Page; context?: BrowserContext }): Promise<void> {
  if (sink.pickOffered) return;
  const page = sink.lastActivePage;
  const testInfo = sink.testInfo;
  if (!page || !testInfo || isPageClosed(page)) return;
  if (closing) {
    const belongsToClosing =
      closing.page === page || (closing.context !== undefined && pageContext(page) === closing.context);
    if (!belongsToClosing) return;
  }
  const pickGate = shouldInspectOnFailure(inspectionGateFromTestInfo(testInfo, process.env.PIWI_PICK_LOCATOR_ON_FAIL));
  const inspectGate = shouldInspectOnFailure(inspectionGateFromTestInfo(testInfo, process.env.PIWI_INSPECT_ON_FAIL));
  if (!pickGate && !inspectGate) return;
  // Gate passed — this is the one shot at the overlay for this test.
  sink.pickOffered = true;
  // A failed locator action was captured with its call site; otherwise (an
  // `expect(...)` assertion) derive the failing locator from the error text.
  // `inspectOnFailure` opens the overlay even with no failing locator (inspect
  // any element); the pick-only flag needs a locator to replace.
  const failed = sink.failedLocators[sink.failedLocators.length - 1] ?? deriveFailedLocator(testInfo);
  if (!failed && !inspectGate) {
    console.log('[piwi] locator picker: no failing locator could be identified in this failure — nothing to replace.');
    return;
  }
  const pick = await runLocatorPicker(page, testInfo, failed, { fn: probeElementAttrs, arg: CAPTURED_ATTRS_ARG });
  if (!pick) return;
  sink.userPick = pick;
  applyPickToSnapshots(sink.capturedLocators, pick);
}

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
const LOCATOR_METHOD_SET = new Set(LOCATOR_METHODS);

/**
 * Everything the in-page probe needs, serialized into the browser on every
 * action. `tagRoles`/`inputRoles` are the shared role maps (single source of
 * truth in `locator-healing.ts`), and `roleSources` is the CSS selector for
 * every element the probe can resolve a role for — all derived from the map so
 * nothing is hand-maintained twice. Exported so the dogfood mirror
 * (`application/tests/fixtures.ts`) reuses the same assembled object.
 */
export const CAPTURED_ATTRS_ARG: ProbeArg = {
  keep: [...CAPTURED_ATTRIBUTES],
  tagRoles: TAG_TO_ROLE,
  inputRoles: INPUT_TYPE_TO_ROLE,
  // '[role]' plus every tag the maps can resolve (input/select are handled by
  // special-cased logic in the probe, so add them explicitly).
  roleSources: [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(','),
  // The reporter always wants ancestor-anchored alternatives (the picker's
  // anchors step and generateAnchoredAlternatives both need them). `labelText`
  // is what names a form field, and the probe reads it from `el.labels` in the
  // same pass — so asking for it here is free and settles the accessible name
  // of a labeled field without a second round trip (`exactAccessibleName`).
  includeStructural: true,
  includeLabelText: true,
};

/**
 * Where the seeded probe lives on the page (see `PROBE_INIT_SCRIPT`).
 * Deliberately unlikely to collide with anything a page defines — and if a page
 * does clobber it, `probeElement` falls back rather than trusting it.
 */
const PROBE_GLOBAL = '__piwiProbeElement';

/**
 * The probe, seeded into the page once per context rather than shipped with
 * every capture. Playwright re-serializes an `evaluate` callback's source and
 * arguments on each call, and `probeElementAttrs` plus `CAPTURED_ATTRS_ARG` is
 * by far the largest thing this path sends; installing it as an init script
 * turns each capture into a small stub call instead. `addInitScript` re-runs on
 * every navigation and in every frame, so it is present whenever a capture
 * needs it.
 *
 * `probeElementAttrs` is already required to be self-contained (Playwright
 * serializes it through `Function.prototype.toString()` today), so embedding
 * its source here relies on nothing new.
 */
const PROBE_INIT_SCRIPT = `(() => {
  const probe = ${probeElementAttrs.toString()};
  const arg = ${JSON.stringify(CAPTURED_ATTRS_ARG)};
  globalThis[${JSON.stringify(PROBE_GLOBAL)}] = (el) => probe(el, arg);
})();`;

/**
 * Documents with no seeded probe — a page whose context was instrumented after
 * it had already navigated, or one where the init script never landed. Cleared
 * on navigation, because the init script runs for the next document even when
 * it missed this one. Without the mark, every capture on such a page would
 * spend a full locator resolution discovering the same thing again.
 */
const PROBE_UNSEEDED_PAGES = new WeakSet<Page>();

/**
 * Read the element through the seeded probe, falling back to shipping the
 * probe's source when the page has none. The stub returns null rather than
 * throwing when the global is absent, so "not seeded" is distinguishable from
 * a genuine probe failure (a detached element, a closing page), which
 * propagates as it would have anyway.
 */
function probeElement(page: Page | null, target: Locator): Promise<ProbedAttrs> {
  const shipSource = () => target.evaluate(probeElementAttrs, CAPTURED_ATTRS_ARG);
  if (!page || PROBE_UNSEEDED_PAGES.has(page)) return shipSource();

  return target
    .evaluate((el, name) => {
      const seeded = (globalThis as Record<string, any>)[name];
      return typeof seeded === 'function' ? (seeded(el) as ProbedAttrs) : null;
    }, PROBE_GLOBAL)
    .then((attrs) => {
      if (attrs) return attrs;
      PROBE_UNSEEDED_PAGES.add(page);
      return shipSource();
    });
}

/**
 * ARIA snapshot that tolerates every Playwright version the reporter supports,
 * returning null instead of throwing so a capture can never fail the test. The
 * options validator runs client-side in the user's installed Playwright, so an
 * unsupported key surfaces as a rejected promise (not a synchronous throw):
 *   - ≥ 1.59: `mode: 'ai'` yields the ref-annotated AI snapshot (the ideal);
 *     `ref` is unknown and silently stripped.
 *   - 1.52: `mode: 'ai'` fails validation (only 'raw'/'regex' are accepted) and
 *     rejects; the `{ ref: true }` fallback then yields a ref-annotated snapshot.
 *   - 1.53–1.58: neither `ref` nor `mode` exists — unknown keys are stripped
 *     server-side, so the first call already returns a plain flat snapshot.
 *   - < 1.49: `locator.ariaSnapshot` does not exist — returns null up front.
 */
export async function ariaSnapshotBestEffort(target: Locator, timeout?: number): Promise<string | null> {
  // Playwright < 1.49 predates locator.ariaSnapshot entirely.
  if (typeof target.ariaSnapshot !== 'function') return null;
  try {
    return await target.ariaSnapshot({
      ...(timeout != null ? { timeout } : {}),
      mode: 'ai',
    } as Parameters<Locator['ariaSnapshot']>[0]);
  } catch {
    // 1.52 rejects `mode: 'ai'`; retry with the `ref` flag that release accepts.
    try {
      return await target.ariaSnapshot({
        ...(timeout != null ? { timeout } : {}),
        ref: true,
      } as Parameters<Locator['ariaSnapshot']>[0]);
    } catch {
      return null;
    }
  }
}

/**
 * The aria tree as JSON (Playwright ≥ 1.63's `ariaSnapshotJSON()`), stringified,
 * or null on any older Playwright or on failure. Feature-detected the same way
 * as `ariaSnapshotBestEffort`, so an older Playwright without the method simply
 * yields null and the capture proceeds with the YAML alone.
 */
export async function ariaSnapshotJSONBestEffort(target: Locator, timeout?: number): Promise<string | null> {
  const fn = (target as unknown as { ariaSnapshotJSON?: (opts?: unknown) => Promise<unknown> }).ariaSnapshotJSON;
  if (typeof fn !== 'function') return null;
  try {
    const tree = await fn.call(target, timeout != null ? { timeout } : {});
    return tree == null ? null : JSON.stringify(tree);
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget element capture for a locator that just proved it resolves —
 * a successful action or a passing presence assertion. Probes the element,
 * generates ranked alternatives, and replaces the placeholder at `seq`. The
 * snapshot wait is bounded by a 500ms deadline (evaluate can hang when the
 * page navigates), but the probe's underlying protocol call is tracked in
 * PENDING_PROBES so the close wrappers can drain it — and in capturePromises
 * so flushSink outwaits it — even when the deadline abandons it. An evaluate
 * still in flight when its page closes crashes the connection dispatcher with
 * a global "not bound" error.
 */
function startElementCapture(
  sink: CaptureSink,
  page: Page,
  target: Locator,
  seq: number,
  callerLocation: string | null,
  used: LocatorSnapshot['used'],
): void {
  const probe = probeElement(page, target);
  const settledProbe = probe.then(
    () => undefined,
    () => undefined,
  );
  PENDING_PROBES.add(settledProbe);
  settledProbe.then(() => PENDING_PROBES.delete(settledProbe));
  sink.capturePromises.push(settledProbe);

  const resolveAttrs = (async () => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const attrs = await Promise.race([
        probe,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('locator capture timeout')), 500);
        }),
      ]);

      // The browser-computed accessible name only feeds role-based and
      // form-field alternatives, so only pay for the extra ARIA
      // snapshot when the element actually has a role or is a field —
      // and, within that, only when the probed attributes have not
      // already settled the name. The snapshot is a second protocol
      // round trip on the same locator, which costs more than the whole
      // probe body; skipping it where it cannot change the answer is
      // the single cheapest saving on this path.
      const role = resolveAriaRole({ ...attrs, accessibleName: null });
      const isFormField = FORM_FIELD_TAGS.has(attrs.tagName);
      const exactName = exactAccessibleName(attrs, role);
      // Bound with a timeout: without it, ariaSnapshot waits up to the
      // test timeout when the page is mid-navigation, which hangs the
      // teardown that drains these capture promises.
      // ariaSnapshotBestEffort adapts the options to the installed
      // Playwright version and never throws (see its doc comment).
      const aria = exactName === null && (role || isFormField) ? await ariaSnapshotBestEffort(target, 500) : null;

      const accessibleName =
        exactName ?? (extractAccessibleName(aria) || approximateAccessibleName({ ...attrs, accessibleName: null }));

      sink.capturedLocators[seq] = {
        location: callerLocation,
        used,
        // hasLabel/selectorCounts inform alternative generation only —
        // keep the stored element to the wire shape. rolePosition and
        // ancestors ARE wire fields: the server's renamed-element match
        // uses them at heal time.
        element: {
          tagName: attrs.tagName,
          attributes: attrs.attributes,
          textContent: attrs.textContent,
          accessibleName,
          center: attrs.center,
          ...(attrs.rolePosition ? { rolePosition: attrs.rolePosition } : {}),
          ...(attrs.ancestors && attrs.ancestors.length > 0 ? { ancestors: attrs.ancestors } : {}),
        },
        alternatives: generateAlternatives({ ...attrs, accessibleName }),
      };
    } catch {
      // Element detached or timeout — keep the placeholder, and release the
      // call site so a later action or assertion on the same line can retry.
      if (callerLocation) sink.probedLocations.delete(callerLocation);
    } finally {
      clearTimeout(deadline);
    }
  })();

  sink.capturePromises.push(resolveAttrs);
}

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

      if (prop === EXPECT_METHOD) {
        return async (...callArgs: unknown[]): Promise<unknown> => {
          const sink = currentSink;
          const expression = typeof callArgs[0] === 'string' ? callArgs[0] : '';
          const isNot = Boolean((callArgs[1] as { isNot?: boolean } | undefined)?.isNot);
          // Only positive presence-proving assertions participate — negations,
          // absence/count/page-level assertions, and any unknown future
          // expression pass through untouched.
          if (!sink || isNot || !EXPECT_CAPTURE_EXPRESSIONS.has(expression)) {
            return fn.apply(target, callArgs);
          }

          sink.lastActivePage = page;
          // Sync, before the await — the caller's frames are gone after it.
          const callerLocation = captureCallerLocation();
          const used = {
            method: originMethod,
            args: originArgs,
            raw: `${originMethod}(${JSON.stringify(originArgs)})`,
          };

          // One probe per call site (see `probedLocations`). The placeholder
          // pushed on the first visit already marks the location as exercised
          // this run.
          const alreadyProbed = callerLocation !== null && sink.probedLocations.has(callerLocation);
          let seq = -1;
          if (!alreadyProbed) {
            seq = sink.capturedLocators.length;
            sink.capturedLocators.push({ location: callerLocation, used, element: null, alternatives: [] });
          }

          const result = await fn.apply(target, callArgs);

          // `_expect` reports the outcome instead of throwing (the matcher
          // layer above does the throw), so read it off the result. A missing
          // `matches` — a future result-shape change — degrades to no capture,
          // never to a broken assertion.
          const matches = (result as { matches?: boolean } | null | undefined)?.matches;
          if (matches === true && !alreadyProbed) {
            if (callerLocation) sink.probedLocations.add(callerLocation);
            startElementCapture(sink, page, target, seq, callerLocation, used);
          } else if (matches === false) {
            // A presence assertion that missed is a failed-locator signal —
            // feeds the failure-time picker and the fresh-locator suggestion,
            // same as a failed action.
            sink.failedLocators.push({ method: originMethod, args: originArgs, location: callerLocation });
          }

          return result;
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

        // One probe per call site (see `probedLocations`). Push a placeholder
        // immediately on the first visit — DOM capture runs async below.
        const alreadyProbed = callerLocation !== null && sink.probedLocations.has(callerLocation);
        let seq = -1;
        if (!alreadyProbed) {
          seq = sink.capturedLocators.length;
          sink.capturedLocators.push({
            location: callerLocation,
            used,
            element: null,
            alternatives: [],
          });
        }

        // The location is already on record. If the action throws, note the
        // failed locator (so teardown can suggest a fresh one for the element's
        // current identity) and re-throw so the test still fails.
        let result: unknown;
        try {
          result = await fn.apply(target, callArgs);
        } catch (error) {
          sink.failedLocators.push({ method: originMethod, args: originArgs, location: callerLocation });
          throw error;
        }

        // Fire-and-forget: capture element data without blocking the test.
        if (!alreadyProbed) {
          if (callerLocation) sink.probedLocations.add(callerLocation);
          startElementCapture(sink, page, target, seq, callerLocation, used);
        }

        return result;
      };
    },
  });
}

/**
 * Wrap a frame locator so the locators built through it capture like page-level
 * ones. Only the locator-building methods are intercepted; the resulting locator
 * is proxied by `wrapLocator` with the builder call as its origin, so a healing
 * snapshot records `getByRole(…)` rather than the frame path. Frame locators
 * carry no action methods of their own, so nothing else is wrapped.
 */
function wrapFrameLocator(page: Page, frameLocator: FrameLocator): FrameLocator {
  return new Proxy(frameLocator, {
    get(target, prop) {
      const original = Reflect.get(target, prop) as unknown;
      if (typeof original !== 'function') return original;
      const fn = original as (...args: unknown[]) => unknown;
      if (!LOCATOR_METHOD_SET.has(prop as string)) return original;
      return (...args: unknown[]): Locator => {
        if (currentSink) currentSink.lastActivePage = page;
        return wrapLocator(page, fn.apply(target, args) as Locator, String(prop), args);
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

  // A page reached through the `page` fixture safety net may live in a context
  // the browser patch never saw — instrument it so its close is wrapped too.
  const ctx = pageContext(page);
  if (ctx) instrumentContext(ctx);

  // Drain in-flight probes before a user-initiated close (the guard tolerates
  // page-like test fakes without a close method), and preserve the
  // page-dependent teardown reads while the page can still serve them.
  if (typeof page.close === 'function') {
    const originalClose = page.close.bind(page);
    page.close = async (...args: Parameters<Page['close']>): Promise<void> => {
      await drainPendingProbes(1000);
      const sink = currentSink;
      if (sink) {
        await stashPageState(sink, { page });
        await maybeOpenPicker(sink, { page });
      }
      return originalClose(...args);
    };
  }

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

    // The no-selector `frameLocator()` searches the whole frame subtree and is a
    // single wrappable entry point. The selector form (`frameLocator('#f')`)
    // stays unwrapped: it predates the no-selector form and is left as Playwright
    // returns it.
    const originalFrameLocator = typeof page.frameLocator === 'function' ? page.frameLocator.bind(page) : null;
    if (originalFrameLocator) {
      (page as unknown as Record<string, (...args: unknown[]) => FrameLocator>).frameLocator = (
        ...args: unknown[]
      ): FrameLocator => {
        const frame = (originalFrameLocator as (...a: unknown[]) => FrameLocator)(...args);
        return args.length === 0 ? wrapFrameLocator(page, frame) : frame;
      };
    }

    // A document that had no seeded probe says nothing about the next one —
    // the init script runs for every navigation, so give each new document a
    // fresh chance at the fast path.
    if (typeof page.on === 'function') {
      page.on('framenavigated', () => PROBE_UNSEEDED_PAGES.delete(page));
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

  // Dialogs are observed through the close event only. A `dialog` listener would
  // suppress Playwright's automatic dismissal and can hang a test that relied on
  // it; the close event (Playwright ≥ 1.63) never does, so a page on an older
  // Playwright — where the event never fires — simply records no dialogs. The
  // registration is guarded because an unknown event name can throw there.
  if (typeof page.on === 'function') {
    try {
      (page.on as (event: string, handler: (dialog: DialogLike) => void) => void)('dialogclosed', (dialog) => {
        const sink = currentSink;
        if (!sink) return;
        try {
          sink.dialogs.push({
            type: typeof dialog.type === 'function' ? dialog.type() : null,
            message: typeof dialog.message === 'function' ? dialog.message() : null,
            defaultValue: typeof dialog.defaultValue === 'function' ? dialog.defaultValue() || null : null,
            closedAt: Date.now(),
          });
        } catch {
          /* a dialog shape the reader does not expect — skip it */
        }
      });
    } catch {
      /* Playwright predates the dialogclosed event */
    }
  }

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

          // Server-side spans emitted by a Piwi instrumentation plugin, in the
          // same gzip+base64 form as the logs header. Skipped when trace capture
          // is disabled; absent header (no instrumentation) is a no-op.
          const traceHeader = headers['x-piwi-trace'];
          if (traceHeader && process.env.PIWI_CAPTURE_SERVER_TRACES !== 'false') {
            try {
              entry.serverTraces = JSON.parse(gunzipSync(Buffer.from(traceHeader, 'base64')).toString('utf-8'));
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

  // Seed the probe for every document this context loads, so a capture ships a
  // stub call instead of the probe's source. Best-effort: `probeElement` falls
  // back to shipping the source for any document this does not reach.
  if (process.env.PIWI_CAPTURE_LOCATORS !== 'false' && typeof context.addInitScript === 'function') {
    void Promise.resolve(context.addInitScript({ content: PROBE_INIT_SCRIPT })).catch(() => {
      /* the fallback covers it */
    });
  }

  const originalNewPage = context.newPage.bind(context);
  context.newPage = async (...args: Parameters<BrowserContext['newPage']>): Promise<Page> => {
    const page = await originalNewPage(...args);
    instrumentPage(page);
    return page;
  };

  // The built-in context fixture closes here at test teardown — BEFORE the
  // auto capture fixture flushes. Drain in-flight probes (an evaluate crossing
  // the close crashes the connection with a global "not bound" error) and take
  // the page-dependent reads (web vitals, failure ARIA snapshot) while the
  // test's page is still open.
  if (typeof context.close === 'function') {
    const originalClose = context.close.bind(context);
    context.close = async (...args: Parameters<BrowserContext['close']>): Promise<void> => {
      await drainPendingProbes(1000);
      const sink = currentSink;
      if (sink) {
        await stashPageState(sink, { context });
        await maybeOpenPicker(sink, { context });
      }
      return originalClose(...args);
    };
  }

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

  // Worker shutdown closes the browser; a probe still in flight would crash
  // the connection dispatcher.
  if (typeof browser.close === 'function') {
    const originalClose = browser.close.bind(browser);
    browser.close = async (...args: Parameters<Browser['close']>): Promise<void> => {
      await drainPendingProbes(1000);
      return originalClose(...args);
    };
  }
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
  let drainDeadline: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(sink.capturePromises),
    new Promise((resolve) => {
      drainDeadline = setTimeout(resolve, 2000);
    }),
  ]);
  clearTimeout(drainDeadline);

  const page = sink.lastActivePage;
  const pageReadable = page !== null && !isPageClosed(page);

  // A page the test left open (e.g. a raw browser.newPage) never passes
  // through the close wrappers — offer the picker here instead, before the
  // snapshots are attached (a confirmed pick is folded into them).
  if (pageReadable) await maybeOpenPicker(sink);

  if (sink.capturedLocators.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.locators, {
      contentType: 'application/json',
      // Repeated call sites (loops) keep only their latest capture — the
      // server stores one row per location anyway, so shipping every
      // iteration is pure payload bloat.
      body: Buffer.from(JSON.stringify(dedupeSnapshotsByLocation(sink.capturedLocators))),
    });
  }

  if (testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
    try {
      // Prefer a live read; fall back to the snapshot the close wrappers
      // stashed — the standard test page is already closed when this auto
      // fixture tears down.
      const snapshot = (pageReadable ? await ariaSnapshotBestEffort(page.locator(':root')) : null) ?? sink.stashedAria;
      if (snapshot) {
        await testInfo.attach(ATTACHMENT_NAMES.ariaSnapshot, {
          contentType: 'text/plain',
          body: snapshot,
        });

        const snapshotJson =
          (pageReadable ? await ariaSnapshotJSONBestEffort(page.locator(':root')) : null) ?? sink.stashedAriaJson;
        if (snapshotJson) {
          await testInfo.attach(ATTACHMENT_NAMES.ariaSnapshotJson, {
            contentType: 'application/json',
            body: snapshotJson,
          });
        }

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

  // Sample the ARIA snapshot at the end of a passing test, but only for the
  // tests the server flagged as due a fresh green sample this run. The same
  // attachment carries it as a failure snapshot, so ingest and the diff read it
  // the same way. Rate-limited server-side; a null sample set never samples.
  if (
    testInfo.status === 'passed' &&
    process.env.PIWI_SAMPLE_ARIA_ON_PASS !== 'false' &&
    isDueForAriaSample(testInfo)
  ) {
    try {
      const snapshot = (pageReadable ? await ariaSnapshotBestEffort(page.locator(':root')) : null) ?? sink.stashedAria;
      if (snapshot) {
        await testInfo.attach(ATTACHMENT_NAMES.ariaSnapshot, {
          contentType: 'text/plain',
          body: snapshot,
        });
        const snapshotJson =
          (pageReadable ? await ariaSnapshotJSONBestEffort(page.locator(':root')) : null) ?? sink.stashedAriaJson;
        if (snapshotJson) {
          await testInfo.attach(ATTACHMENT_NAMES.ariaSnapshotJson, {
            contentType: 'application/json',
            body: snapshotJson,
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // A confirmed picker choice — attach it and surface it in the report. The
  // snapshot write-back already happened at pick time (applyPickToSnapshots).
  if (sink.userPick) {
    const pick = sink.userPick;
    testInfo.annotations.push({
      type: USER_PICK_ANNOTATION,
      description: pick.failing
        ? `Replacement locator picked on the failing page for ${pick.failing.rendered}` +
          `${pick.failing.location ? ` at ${pick.failing.location}` : ''}: ${pick.picked.locator}`
        : `Locator picked while inspecting the failing page: ${pick.picked.locator}`,
    });
    try {
      await testInfo.attach(ATTACHMENT_NAMES.userPick, {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(pick)),
      });
    } catch {
      /* ignore */
    }
  } else if (!sink.pickOffered) {
    // The overlay never ran on this failure. If a failure-time tool was
    // *enabled* but the gate refused for an environmental reason (headless /
    // CI), say so — a silent no-op after opting in is baffling. The picker's
    // gate wins the message when both flags are enabled.
    const reason =
      environmentalSkipReason(inspectionGateFromTestInfo(testInfo, process.env.PIWI_PICK_LOCATOR_ON_FAIL)) ??
      environmentalSkipReason(inspectionGateFromTestInfo(testInfo));
    if (reason) console.log(`[piwi] failure-time locator tools enabled but skipped: ${reason}`);
  }

  if (sink.consoleEntries.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.console, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sink.consoleEntries)),
    });
  }

  if (sink.dialogs.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.dialogs, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sink.dialogs)),
    });
  }

  if (sink.networkRequests.length > 0) {
    await testInfo.attach(ATTACHMENT_NAMES.network, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(sink.networkRequests)),
    });
  }

  // Live read when the page still exists (e.g. a browser.newPage the test left
  // open); otherwise the vitals the close wrappers stashed before the page went.
  const webVitals = (pageReadable ? await readWebVitals(page) : null) ?? sink.stashedWebVitals;
  if (webVitals) {
    await testInfo.attach(ATTACHMENT_NAMES.webVitals, {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify(webVitals)),
    });
  }

  // Page state at test end (pass AND fail — the pass side is the diff baseline).
  if (process.env.PIWI_CAPTURE_PAGE_STATE !== 'false') {
    const pageState = (pageReadable ? await readPageState(page) : null) ?? sink.stashedPageState;
    if (pageState) {
      await testInfo.attach(ATTACHMENT_NAMES.pageState, {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify(pageState)),
      });
    }
  }
}

/**
 * The fixtures `piwiFixtures` / `extendPiwiFixtures` contribute. The single
 * added fixture is `piwiCapture`: an auto, test-scoped teardown hook that
 * attaches the collected `piwi-*` data. Its name is **reserved** — a user
 * fixture of the same name replaces the capture teardown and silently disables
 * all capture. Exported so `piwiFixtures` and the extended `test` carry it in
 * their types (and a collision surfaces to the type checker).
 */
export interface PiwiFixtures {
  piwiCapture: void;
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
export const piwiFixtures: Fixtures<
  PiwiFixtures,
  {},
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = {
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
  piwiCapture: [
    async ({}, use: UseFn<void>, testInfo: TestInfo) => {
      const sink = createSink();
      sink.testInfo = testInfo;
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
 * Extend a Playwright `test` object with the Piwi capture fixtures. The
 * returned `test` carries the existing fixtures plus {@link PiwiFixtures}.
 *
 * Use this instead of importing `@playwright/test` directly from this package
 * to avoid the "Requiring @playwright/test second time" error caused by
 * duplicate module resolution.
 *
 * @example
 * ```ts
 * import { test as base } from '@playwright/test';
 * import { extendPiwiFixtures } from '@piwitests/reporter';
 *
 * export const test = extendPiwiFixtures(base);
 * ```
 */
export function extendPiwiFixtures<TestArgs extends FixtureArgs, WorkerArgs extends FixtureArgs>(
  test: TestType<TestArgs, WorkerArgs>,
): TestType<TestArgs & PiwiFixtures, WorkerArgs> {
  return (
    test as unknown as { extend: (f: typeof piwiFixtures) => TestType<TestArgs & PiwiFixtures, WorkerArgs> }
  ).extend(piwiFixtures);
}
