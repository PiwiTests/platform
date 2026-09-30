import {
  NETWORK_PRESETS,
  conditionFor,
  type ConditionsState,
  type RequestCondition,
} from '../shared/request-conditions.js';
import {
  acquireDebugger,
  holdsDebugger,
  onDebuggerEvent,
  onDebuggerLost,
  releaseDebugger,
  sendCommand,
} from './debugger.js';

/**
 * Slow down or fail a request, and throttle the whole page, through the
 * debugging protocol, on the one tab the DevTools panel set them for: the
 * `Fetch` domain pauses every request of the tab (documents, scripts, images,
 * `fetch`, XHR) and delays, fails or answers it; `Network` throttles the page or
 * takes it offline; `Emulation` slows the CPU. The session is held while any of
 * them is on and let go when all are off, which ends every emulation with it.
 */

interface Applied {
  stop: () => void;
  /** The conditions the paused requests are checked against, and the origin they apply on. */
  state: ConditionsState;
  /** The tab's top-level origin, followed across navigations. */
  pageOrigin: string | null;
}

const applied = new Map<number, Applied>();

const EMPTY_BODY = '';

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What a paused request gets: the condition that matches it, while the tab shows the conditions' origin. */
async function answer(tabId: number, entry: Applied, params: Record<string, unknown>): Promise<void> {
  const requestId = String(params.requestId);
  const request = (params.request ?? {}) as { method?: string; url?: string };
  const condition: RequestCondition | null =
    entry.pageOrigin === entry.state.origin
      ? conditionFor(entry.state.conditions, request.method ?? 'GET', request.url ?? '')
      : null;
  try {
    if (condition?.kind === 'delay') {
      await wait(condition.delayMs);
      await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
    } else if (condition?.kind === 'error') {
      await sendCommand(tabId, 'Fetch.fulfillRequest', {
        requestId,
        responseCode: 500,
        responseHeaders: [{ name: 'content-type', value: 'text/plain' }],
        body: EMPTY_BODY,
      });
    } else if (condition?.kind === 'abort') {
      await sendCommand(tabId, 'Fetch.failRequest', { requestId, errorReason: 'Failed' });
    } else {
      await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
    }
  } catch {
    // The request went away (the page navigated), or the session ended: nothing is left to answer.
  }
}

/**
 * Puts the tab's state on through the protocol: attaches when needed, then
 * sets `Fetch`, the network and the CPU to what the state says. Throws when
 * the session cannot be had, and the caller falls back to the page's wrapper.
 */
export async function applyThroughDebugger(state: ConditionsState): Promise<void> {
  const tabId = state.tabId;
  const attached = await acquireDebugger(tabId, 'conditions');
  if (!attached.ok) throw new Error(attached.error || attached.reason);
  let entry = applied.get(tabId);
  if (!entry) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const created: Applied = { stop: () => undefined, state, pageOrigin: originOf(tab?.url) };
    created.stop = onDebuggerEvent(tabId, (method, params) => {
      if (method === 'Fetch.requestPaused') void answer(tabId, created, params);
      if (method === 'Page.frameNavigated') {
        const frame = params.frame as { parentId?: string; url?: string } | undefined;
        if (frame && !frame.parentId) created.pageOrigin = originOf(frame.url);
      }
    });
    applied.set(tabId, created);
    entry = created;
    await sendCommand(tabId, 'Page.enable');
  }
  entry.state = state;
  if (state.conditions.length > 0) {
    await sendCommand(tabId, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  } else {
    await sendCommand(tabId, 'Fetch.disable');
  }
  const network = state.throttle ? NETWORK_PRESETS[state.throttle] : null;
  await sendCommand(tabId, 'Network.enable');
  await sendCommand(
    tabId,
    'Network.emulateNetworkConditions',
    network ?? { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  );
  await sendCommand(tabId, 'Emulation.setCPUThrottlingRate', { rate: state.cpuRate ?? 1 });
}

/**
 * Everything off on the tab: each emulation is ended, since a viewport set in
 * the same tab may keep the session, and the session is let go.
 */
export async function releaseConditionsDebugger(tabId: number): Promise<void> {
  applied.get(tabId)?.stop();
  applied.delete(tabId);
  if (!holdsDebugger(tabId, 'conditions')) return releaseDebugger(tabId, 'conditions');
  await sendCommand(tabId, 'Fetch.disable').catch(() => undefined);
  await sendCommand(tabId, 'Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  }).catch(() => undefined);
  await sendCommand(tabId, 'Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);
  await releaseDebugger(tabId, 'conditions');
}

/**
 * The viewports set on tabs from the DevTools panel, one per tab id, in session
 * storage so the panel can say so and offer to undo it.
 */
export const TAB_VIEWPORT_KEY = 'piwiTabViewport';

export interface TabViewport {
  tabId: number;
  width: number;
  height: number;
}

type TabViewports = Record<string, TabViewport>;

let viewportWrites: Promise<unknown> = Promise.resolve();

/** Changes the stored viewports one write at a time, so two tabs set at once both stay. */
function updateViewports(change: (current: TabViewports) => TabViewports): Promise<void> {
  const run = viewportWrites.then(async () => {
    const stored = (await chrome.storage.session.get(TAB_VIEWPORT_KEY))[TAB_VIEWPORT_KEY] as TabViewports | undefined;
    const next = change({ ...stored });
    if (JSON.stringify(next) === JSON.stringify(stored ?? {})) return;
    if (Object.keys(next).length > 0) await chrome.storage.session.set({ [TAB_VIEWPORT_KEY]: next });
    else await chrome.storage.session.remove(TAB_VIEWPORT_KEY);
  });
  viewportWrites = run.catch(() => undefined);
  return run;
}

/** Sets the tab's viewport, in the tab itself, until it is reset or the tab closes. */
export async function setTabViewport(viewport: TabViewport): Promise<{ ok: true } | { ok: false; error: string }> {
  const attached = await acquireDebugger(viewport.tabId, 'viewport');
  if (!attached.ok) return { ok: false, error: attached.error || attached.reason };
  try {
    await sendCommand(viewport.tabId, 'Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
    await updateViewports((current) => ({ ...current, [viewport.tabId]: viewport }));
    return { ok: true };
  } catch (err) {
    await releaseDebugger(viewport.tabId, 'viewport');
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The tab back to its window's size, and the session let go when nothing else holds it. */
export async function clearTabViewport(tabId: number): Promise<void> {
  if (holdsDebugger(tabId, 'viewport')) {
    await sendCommand(tabId, 'Emulation.clearDeviceMetricsOverride').catch(() => undefined);
  }
  await releaseDebugger(tabId, 'viewport');
  await updateViewports((current) => {
    delete current[tabId];
    return current;
  });
}

// A viewport whose session ended (the bar cancelled, the tab closed) is forgotten.
onDebuggerLost((tabId, purposes) => {
  if (purposes.includes('viewport')) void clearTabViewport(tabId);
});

/** Called when the conditions' session ends without being released: the person cancelled the bar. */
export function onConditionsDebuggerLost(fallback: (tabId: number, reason: 'canceled' | 'lost') => void): void {
  onDebuggerLost((tabId, purposes, reason) => {
    if (!purposes.includes('conditions')) return;
    applied.get(tabId)?.stop();
    applied.delete(tabId);
    fallback(tabId, reason === 'canceled' ? 'canceled' : 'lost');
  });
}
