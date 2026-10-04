import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiwiSteps } from '@piwitests/core/steps';

/**
 * The background worker's debugging sessions against a fake `chrome.debugger`
 * that keeps the attached tabs and every command sent: what each feature
 * holds, sends and leaves behind when it lets go.
 */

type Listener = (source: { tabId?: number }, method: string, params?: unknown) => void;

interface FakeBrowser {
  attached: Set<number>;
  commands: Array<{ tabId: number; method: string; params: Record<string, unknown> }>;
  session: Map<string, unknown>;
  /** Holds every attach until called. */
  holdAttach: () => () => void;
  /** Makes the nth command with `method` fail (1-based). */
  failCommand: (method: string, nth: number) => void;
  emit: (tabId: number, method: string, params: Record<string, unknown>) => void;
}

function installChrome(): FakeBrowser {
  const attached = new Set<number>();
  const commands: FakeBrowser['commands'] = [];
  const session = new Map<string, unknown>();
  const eventListeners: Listener[] = [];
  let gate: Promise<void> | null = null;
  const failures = new Map<string, number>();
  const seen = new Map<string, number>();
  const fake = {
    debugger: {
      attach: async ({ tabId }: { tabId: number }) => {
        if (gate) await gate;
        if (attached.has(tabId)) throw new Error('Another debugger is already attached');
        attached.add(tabId);
      },
      detach: async ({ tabId }: { tabId: number }) => {
        attached.delete(tabId);
      },
      sendCommand: async ({ tabId }: { tabId: number }, method: string, params: Record<string, unknown> = {}) => {
        if (!attached.has(tabId)) throw new Error('Debugger is not attached to the tab');
        const count = (seen.get(method) ?? 0) + 1;
        seen.set(method, count);
        if (failures.get(method) === count) throw new Error(`${method} failed`);
        commands.push({ tabId, method, params });
        return {};
      },
      onEvent: { addListener: (listener: Listener) => eventListeners.push(listener) },
      onDetach: { addListener: () => undefined },
    },
    storage: {
      session: {
        get: async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) session.set(key, structuredClone(value));
        },
        remove: async (key: string) => {
          session.delete(key);
        },
      },
    },
    tabs: {
      get: async (tabId: number) => ({ id: tabId, url: 'https://shop.test/cart' }),
      sendMessage: async () => undefined,
    },
    runtime: { getPlatformInfo: async () => ({ os: 'linux' }) },
  };
  (globalThis as { chrome?: unknown }).chrome = fake;
  return {
    attached,
    commands,
    session,
    holdAttach: () => {
      let open!: () => void;
      gate = new Promise<void>((resolve) => (open = resolve));
      return () => {
        gate = null;
        open();
      };
    },
    failCommand: (method, nth) => failures.set(method, nth),
    emit: (tabId, method, params) => {
      for (const listener of eventListeners) listener({ tabId }, method, params);
    },
  };
}

let browser: FakeBrowser;

beforeEach(() => {
  vi.resetModules();
  browser = installChrome();
});

const TAB = { id: 7, url: 'https://shop.test/cart' } as chrome.tabs.Tab;

async function runningReplay(): Promise<string> {
  const { newReplayState, setReplayState } = await import('../../src/shared/replay-storage.js');
  const state = newReplayState({ version: 1, steps: [] } as unknown as PiwiSteps, 'https://shop.test', false);
  await setReplayState(state);
  return state.id;
}

describe('acquireDebugger and releaseDebugger', () => {
  it('lets go of a session released while it was still attaching', async () => {
    const { acquireDebugger, holdsDebugger, releaseDebugger } = await import('../../src/background/debugger.js');
    const open = browser.holdAttach();
    const acquiring = acquireDebugger(7, 'conditions');
    await releaseDebugger(7, 'conditions');
    open();
    const result = await acquiring;
    expect(result.ok).toBe(false);
    expect(holdsDebugger(7, 'conditions')).toBe(false);
    expect(browser.attached.has(7)).toBe(false);
  });

  it('keeps the session for a purpose still wanted when another releases during the attach', async () => {
    const { acquireDebugger, holdsDebugger, releaseDebugger } = await import('../../src/background/debugger.js');
    const open = browser.holdAttach();
    const first = acquireDebugger(7, 'conditions');
    const second = acquireDebugger(7, 'viewport');
    await releaseDebugger(7, 'conditions');
    open();
    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(true);
    expect(holdsDebugger(7, 'viewport')).toBe(true);
    expect(browser.attached.has(7)).toBe(true);
  });
});

describe('the replay’s session', () => {
  it('stops intercepting the file chooser when it lets go of a tab another feature still holds', async () => {
    const replayId = await runningReplay();
    const { acquireDebugger } = await import('../../src/background/debugger.js');
    const { handleReplayDriver, releaseReplayDebugger } = await import('../../src/background/cdp-replay.js');
    expect((await handleReplayDriver({ replayId, previous: null }, TAB)).driver).toBe('cdp');
    await acquireDebugger(7, 'conditions');
    await releaseReplayDebugger();
    expect(browser.attached.has(7)).toBe(true);
    const intercepts = browser.commands.filter((c) => c.method === 'Page.setInterceptFileChooserDialog');
    expect(intercepts.map((c) => c.params.enabled)).toEqual([true, false]);
  });

  it('says the input started when a click fails after the button went down', async () => {
    const replayId = await runningReplay();
    const { handleReplayDriver, handleReplayInput } = await import('../../src/background/cdp-replay.js');
    await handleReplayDriver({ replayId, previous: null }, TAB);
    // The move, the press, then the release fails.
    browser.failCommand('Input.dispatchMouseEvent', 3);
    const answer = await handleReplayInput({ replayId, ops: [{ op: 'click', x: 10, y: 10, count: 1 }] }, TAB);
    expect(answer).toMatchObject({ ok: false, started: true });
  });

  it('says nothing started when the first command of an action fails', async () => {
    const replayId = await runningReplay();
    const { handleReplayDriver, handleReplayInput } = await import('../../src/background/cdp-replay.js');
    await handleReplayDriver({ replayId, previous: null }, TAB);
    browser.failCommand('Input.dispatchMouseEvent', 1);
    const answer = await handleReplayInput({ replayId, ops: [{ op: 'click', x: 10, y: 10, count: 1 }] }, TAB);
    expect(answer).toMatchObject({ ok: false, started: false });
  });
});

describe('the bug recording’s evidence', () => {
  const consoleError = { type: 'error', executionContextId: 1, args: [{ type: 'string', value: 'Cart failed' }] };
  /** The page's own world, where its scripts run. */
  const pageContext = { context: { id: 1, origin: 'https://shop.test', auxData: { isDefault: true } } };

  it('stores what is pending when the recording stops', async () => {
    const { CDP_EVIDENCE_KEY } = await import('../../src/shared/bug-storage.js');
    const { startBugDebugger, stopBugDebugger } = await import('../../src/background/cdp-evidence.js');
    expect(await startBugDebugger(7, 'https://shop.test/*')).toBe(true);
    browser.emit(7, 'Runtime.executionContextCreated', pageContext);
    browser.emit(7, 'Runtime.consoleAPICalled', consoleError);
    await stopBugDebugger();
    const stored = browser.session.get(CDP_EVIDENCE_KEY) as { console: Array<{ message: string }> };
    expect(stored.console.map((e) => e.message)).toEqual(['Cart failed']);
  });

  it('keeps the console of the page’s own world and the requests of its documents, on the recorded origin only', async () => {
    const { CDP_EVIDENCE_KEY } = await import('../../src/shared/bug-storage.js');
    const { startBugDebugger, stopBugDebugger } = await import('../../src/background/cdp-evidence.js');
    await startBugDebugger(7, 'https://shop.test/*');
    browser.emit(7, 'Runtime.executionContextCreated', pageContext);
    browser.emit(7, 'Runtime.executionContextCreated', {
      context: { id: 2, origin: 'https://shop.test', auxData: { isDefault: false } },
    });
    browser.emit(7, 'Runtime.consoleAPICalled', { ...consoleError, executionContextId: 2 });
    const failed = (id: string, url: string, documentURL: string, status: number) => {
      browser.emit(7, 'Network.requestWillBeSent', { requestId: id, documentURL, request: { method: 'GET', url } });
      browser.emit(7, 'Network.responseReceived', { requestId: id, response: { status } });
    };
    failed('1', 'https://login.test/session', 'https://shop.test/cart', 401);
    // The tab goes through another site, then comes back.
    browser.emit(7, 'Page.frameNavigated', { frame: { url: 'https://login.test/sign-in' } });
    browser.emit(7, 'Runtime.executionContextCreated', {
      context: { id: 3, origin: 'https://login.test', auxData: { isDefault: true } },
    });
    browser.emit(7, 'Runtime.consoleAPICalled', { ...consoleError, executionContextId: 3 });
    browser.emit(7, 'Log.entryAdded', { entry: { level: 'error', source: 'javascript', text: 'Sign-in failed' } });
    failed('2', 'https://login.test/api/me', 'https://login.test/sign-in', 401);
    failed('3', 'https://shop.test/cart', 'https://shop.test/cart', 500);
    browser.emit(7, 'Page.frameNavigated', { frame: { url: 'https://shop.test/cart' } });
    browser.emit(7, 'Runtime.executionContextCreated', { context: { ...pageContext.context, id: 4 } });
    browser.emit(7, 'Runtime.consoleAPICalled', { ...consoleError, executionContextId: 4 });
    await stopBugDebugger();
    const stored = browser.session.get(CDP_EVIDENCE_KEY) as {
      console: Array<{ message: string }>;
      requests: Array<{ url: string; status: number }>;
    };
    expect(stored.console.map((e) => e.message)).toEqual(['Cart failed']);
    expect(stored.requests.map((r) => `${r.url} ${r.status}`)).toEqual(['https://login.test/session 401', '/cart 500']);
  });

  it('starts a new recording with nothing from the one before', async () => {
    const { CDP_EVIDENCE_KEY } = await import('../../src/shared/bug-storage.js');
    const { startBugDebugger, stopBugDebugger } = await import('../../src/background/cdp-evidence.js');
    await startBugDebugger(7, 'https://shop.test/*');
    browser.emit(7, 'Runtime.executionContextCreated', pageContext);
    browser.emit(7, 'Runtime.consoleAPICalled', consoleError);
    await stopBugDebugger();
    await startBugDebugger(7, 'https://shop.test/*');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stored = browser.session.get(CDP_EVIDENCE_KEY) as { console: unknown[] };
    expect(stored.console).toEqual([]);
  });
});

describe('the viewport set in a tab', () => {
  it('keeps each tab’s viewport, and forgets only the one reset', async () => {
    const { TAB_VIEWPORT_KEY, clearTabViewport, setTabViewport } =
      await import('../../src/background/cdp-conditions.js');
    expect(await setTabViewport({ tabId: 7, width: 390, height: 664 })).toEqual({ ok: true });
    expect(await setTabViewport({ tabId: 8, width: 1280, height: 720 })).toEqual({ ok: true });
    expect(browser.session.get(TAB_VIEWPORT_KEY)).toEqual({
      7: { tabId: 7, width: 390, height: 664 },
      8: { tabId: 8, width: 1280, height: 720 },
    });
    await clearTabViewport(7);
    expect(browser.session.get(TAB_VIEWPORT_KEY)).toEqual({ 8: { tabId: 8, width: 1280, height: 720 } });
    expect(browser.attached.has(7)).toBe(false);
    expect(browser.attached.has(8)).toBe(true);
  });

  it('gives a replay that sized the tab its own size back when the panel’s viewport is reset', async () => {
    const replayId = await runningReplay();
    const { handleReplayDriver, handleReplayViewport } = await import('../../src/background/cdp-replay.js');
    const { clearTabViewport, setTabViewport } = await import('../../src/background/cdp-conditions.js');
    await handleReplayDriver({ replayId, previous: null }, TAB);
    expect(await handleReplayViewport({ replayId, width: 800, height: 600 }, TAB)).toEqual({ ok: true });
    await setTabViewport({ tabId: 7, width: 390, height: 664 });
    await clearTabViewport(7);
    const emulation = browser.commands.filter((c) => c.method.startsWith('Emulation.'));
    expect(emulation[emulation.length - 1]).toMatchObject({
      method: 'Emulation.setDeviceMetricsOverride',
      params: { width: 800, height: 600 },
    });
    expect(browser.attached.has(7)).toBe(true);
  });
});
