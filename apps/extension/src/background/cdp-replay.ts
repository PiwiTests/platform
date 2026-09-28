import {
  chooseDriver,
  clickEvents,
  dragPathEvents,
  keyEvents,
  moveEvents,
  readInputOps,
  releaseEvent,
  type CdpCommand,
  type FallbackReason,
  type InputOp,
  type Point,
  type ReplayDriver,
} from '../shared/cdp-input.js';
import { getReplayState } from '../shared/replay-storage.js';
import {
  acquireDebugger,
  debuggerAvailable,
  holdsDebugger,
  onDebuggerEvent,
  onDebuggerLost,
  releaseDebugger,
  sendCommand,
  tabsHolding,
} from './debugger.js';

/**
 * The replay's trusted input: the replay script finds each element and says
 * where it is; the worker attaches to that tab and sends the input through the
 * debugging protocol, as Playwright does. A replay attaches on its first action
 * and detaches when it ends.
 */

let isMac: Promise<boolean> | null = null;

/** The replay each tab's session was attached for. */
const replayOfTab = new Map<number, string>();
/** Replays whose session ended without them (the person cancelled the bar): they go on with the page's events. */
const lostReplays = new Map<string, FallbackReason>();

onDebuggerLost((tabId, purposes, reason) => {
  if (!purposes.includes('replay')) return;
  const replayId = replayOfTab.get(tabId);
  replayOfTab.delete(tabId);
  if (replayId) lostReplays.set(replayId, reason);
  // The replay script hears it now rather than at its next step, and says so in its panel.
  void chrome.tabs.sendMessage(tabId, { type: 'piwi-replay-driver-lost', replayId, reason }).catch(() => undefined);
});

function macPlatform(): Promise<boolean> {
  isMac ??= chrome.runtime
    .getPlatformInfo()
    .then((info) => info.os === 'mac')
    .catch(() => false);
  return isMac;
}

/** Whether the tab asking is on the running replay's origin. */
async function replayRunsIn(tab: chrome.tabs.Tab | undefined, replayId: unknown): Promise<boolean> {
  const state = await getReplayState();
  if (!state || state.id !== replayId || (state.status !== 'running' && state.status !== 'paused')) return false;
  try {
    return !!tab?.url && new URL(tab.url).origin === state.origin;
  } catch {
    return false;
  }
}

/**
 * The driver for the replay running in the sender's tab: trusted input when the
 * tab's session attaches, the page's own events otherwise, with why.
 */
export async function handleReplayDriver(
  message: { replayId?: unknown; previous?: unknown },
  tab: chrome.tabs.Tab | undefined,
): Promise<{ driver: ReplayDriver; reason: FallbackReason | null; error?: string }> {
  const previous = message.previous as { driver: ReplayDriver; reason: FallbackReason | null } | null;
  if (tab?.id == null || !(await replayRunsIn(tab, message.replayId))) {
    return { driver: 'synthetic', reason: 'refused' };
  }
  if (previous?.driver === 'synthetic') return chooseDriver({ available: true, attached: false, previous });
  const lost = lostReplays.get(String(message.replayId));
  if (lost) return { driver: 'synthetic', reason: lost };
  if (!debuggerAvailable()) return chooseDriver({ available: false, attached: false, previous });
  const attached = await acquireDebugger(tab.id, 'replay');
  if (!attached.ok) {
    return {
      ...chooseDriver({ available: true, attached: false, previous, attachError: attached.reason }),
      error: attached.error,
    };
  }
  replayOfTab.set(tab.id, String(message.replayId));
  // A click that opens a file chooser must not open the browser's dialog: the file step asks for the file.
  await sendCommand(tab.id, 'Page.enable').catch(() => undefined);
  await sendCommand(tab.id, 'Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => undefined);
  return chooseDriver({ available: true, attached: true, previous });
}

async function sendAll(tabId: number, commands: CdpCommand[]): Promise<void> {
  for (const command of commands) await sendCommand(tabId, command.method, command.params);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A drag from one point to another. An HTML drag and drop is intercepted as
 * it starts and dropped through `Input.dispatchDragEvent`, since no drag loop
 * of the system runs for synthesized input; a drag done with pointer events
 * (sortable lists, sliders) is the moves themselves.
 */
async function drag(tabId: number, from: Point, to: Point): Promise<void> {
  let intercepted: Record<string, unknown> | null = null;
  const stop = onDebuggerEvent(tabId, (method, params) => {
    if (method === 'Input.dragIntercepted') intercepted = params.data as Record<string, unknown>;
  });
  try {
    await sendCommand(tabId, 'Input.setInterceptDrags', { enabled: true });
    await sendAll(tabId, dragPathEvents(from, to));
    await wait(50);
    const data = intercepted as Record<string, unknown> | null;
    if (data) {
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await sendCommand(tabId, 'Input.dispatchDragEvent', { type, x: to.x, y: to.y, data, modifiers: 0 });
      }
    }
    await sendAll(tabId, [releaseEvent(to)]);
  } finally {
    stop();
    await sendCommand(tabId, 'Input.setInterceptDrags', { enabled: false }).catch(() => undefined);
  }
}

async function perform(tabId: number, op: InputOp, mac: boolean): Promise<void> {
  switch (op.op) {
    case 'move':
      return sendAll(tabId, moveEvents(op));
    case 'click':
      return sendAll(tabId, clickEvents(op, op.count));
    case 'press':
      return sendAll(tabId, keyEvents(op.combo, mac));
    case 'insertText':
      await sendCommand(tabId, 'Input.insertText', { text: op.text });
      return;
    case 'drag':
      return drag(tabId, op.from, op.to);
  }
}

/**
 * Performs what the replay script asks in its tab. `started` says whether any
 * input reached the page before a failure, so the script knows whether it may
 * play the step again with the page's own events.
 */
export async function handleReplayInput(
  message: { replayId?: unknown; ops?: unknown },
  tab: chrome.tabs.Tab | undefined,
): Promise<{ ok: true } | { ok: false; lost: boolean; started: boolean; error: string; reason?: FallbackReason }> {
  const ops = readInputOps(message.ops);
  if (tab?.id == null || !ops) return { ok: false, lost: false, started: false, error: 'bad request' };
  if (!holdsDebugger(tab.id, 'replay') || !(await replayRunsIn(tab, message.replayId))) {
    const reason = lostReplays.get(String(message.replayId)) ?? 'lost';
    return { ok: false, lost: true, started: false, error: 'not attached', reason };
  }
  const mac = await macPlatform();
  let started = false;
  try {
    for (const op of ops) {
      await perform(tab.id, op, mac);
      started = true;
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const lost = !holdsDebugger(tab.id, 'replay');
    return { ok: false, lost, started, error, reason: lostReplays.get(String(message.replayId)) ?? 'lost' };
  }
}

/** The replay ended: every tab it attached to is let go. */
export async function releaseReplayDebugger(): Promise<void> {
  await Promise.all(
    tabsHolding('replay').map((tabId) => {
      replayOfTab.delete(tabId);
      return releaseDebugger(tabId, 'replay');
    }),
  );
}
