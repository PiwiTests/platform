/**
 * One tool at a time, per page.
 *
 * Every momentary tool (pick, hover-inspect, the various panels) is its own
 * content script injected on demand, and nothing stopped them overlapping:
 * you could leave hover-inspect running, start a pick, and end up with two
 * overlays and two sets of capture-phase listeners fighting over the same
 * clicks. Each tool now announces itself here on injection, which tears down
 * whichever tool was already running.
 *
 * State lives on the content script's own `globalThis` — the isolated world,
 * shared by every tool injected into the same document, and gone when the
 * page navigates. That is deliberately *not* `chrome.storage`: a record of
 * "what is running in this page" that outlives the page is a record that goes
 * stale, and the popup can read the live value with a one-line probe instead
 * (see `activeToolId` in `popup/main.ts`).
 *
 * The recorder is not part of this. It is a persistent capture mode rather
 * than a momentary tool, and tearing it down because someone opened another
 * panel would silently discard a recording in progress.
 */
import { removePickerOverlay } from '@piwitests/picker-dom';

/** Matches the popup's button ids, so the popup can highlight the tile directly. */
export type ToolId =
  | 'pick'
  | 'hover-inspect'
  | 'locator-console'
  | 'multi-pick'
  | 'lint-overlay'
  | 'assertion-panel'
  | 'session-panel'
  | 'agent-context-panel'
  | 'test-function-panel'
  | 'coverage-overlay';

interface ActiveTool {
  id: ToolId;
  epoch: number;
  teardown: () => void;
}

interface ToolGlobals {
  __piwiActiveTool?: ActiveTool;
  __piwiToolEpoch?: number;
}

function globals(): ToolGlobals {
  return globalThis as unknown as ToolGlobals;
}

/**
 * Announces a tool as the active one, stopping any predecessor, and returns
 * an epoch the caller uses to tell whether it is still the current tool after
 * an `await` (see `toolIsCurrent`).
 *
 * `teardown` must remove whatever the tool mounted and detach its listeners;
 * it runs when another tool starts, or when the user cancels with Escape.
 */
export function startTool(id: ToolId, teardown: () => void): number {
  const g = globals();
  try {
    g.__piwiActiveTool?.teardown();
  } catch {
    // A tool that fails to tear down cleanly must not stop the next one from
    // starting — the worst case is a stale node, not a dead extension.
  }
  const epoch = (g.__piwiToolEpoch ?? 0) + 1;
  g.__piwiToolEpoch = epoch;
  g.__piwiActiveTool = { id, epoch, teardown };
  return epoch;
}

/** False once another tool has taken over — long-running flows check this after each `await` and bail rather than drawing over their successor. */
export function toolIsCurrent(epoch: number): boolean {
  return globals().__piwiToolEpoch === epoch;
}

/** Clears the active-tool record if this tool still owns it. Idempotent, and a no-op once something else has started. */
export function endTool(epoch: number): void {
  const g = globals();
  if (g.__piwiActiveTool?.epoch === epoch) g.__piwiActiveTool = undefined;
}

/** Tears down the running tool, if any — what Escape triggers. */
export function stopActiveTool(): void {
  const g = globals();
  const active = g.__piwiActiveTool;
  if (!active) return;
  g.__piwiActiveTool = undefined;
  // Bumping the epoch stops any loop still awaiting inside the tool.
  g.__piwiToolEpoch = (g.__piwiToolEpoch ?? 0) + 1;
  active.teardown();
}

/** The running tool's id, for the popup's highlight. */
export function activeToolId(): ToolId | null {
  return globals().__piwiActiveTool?.id ?? null;
}

/** Hosts belonging to the recorder, which is a capture mode rather than a momentary tool and must survive another tool starting. */
const RECORDER_HOST_IDS = new Set(['piwi-record-hud-host', 'piwi-record-frame-host', 'piwi-record-review-host']);

/**
 * The default teardown: removes every tool surface on the page and unblocks
 * any flow still waiting on a pick.
 *
 * The unblocking matters more than it looks. The pick-driven tools poll for
 * `__piwiPickState`/`__piwiAnchorState` and only reset their own re-entry
 * guard in a `finally`. Ripping their UI out without answering leaves them
 * polling a global that will never be set, so the guard stays on and that
 * tool is dead for the life of the page. Answering "skipped" instead lets
 * each flow unwind through the cancel path it already has.
 */
export function teardownToolSurfaces(): void {
  const g = globalThis as unknown as { __piwiPickState?: string; __piwiAnchorState?: string };
  g.__piwiPickState ??= 'skipped';
  g.__piwiAnchorState ??= 'skipped';
  removePickerOverlay();
  for (const host of document.querySelectorAll('[id^="piwi-"]')) {
    if (!RECORDER_HOST_IDS.has(host.id)) host.remove();
  }
}

/**
 * Escape cancels whatever is running, from anywhere on the page.
 *
 * Individual tools already handle Escape while their own UI has focus, but
 * that leaves the cases where it doesn't — hover-inspect has no focusable
 * chrome at all, and an overlay loses focus as soon as you click the page.
 * Registered once per document, on the capture phase so a page that swallows
 * keydown can't block it, and only acting when a tool is actually running so
 * the page's own Escape handling is untouched the rest of the time.
 */
export function installEscapeToCancel(): void {
  const g = globals() as ToolGlobals & { __piwiEscapeInstalled?: boolean };
  if (g.__piwiEscapeInstalled) return;
  g.__piwiEscapeInstalled = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !globals().__piwiActiveTool) return;
      stopActiveTool();
    },
    true,
  );
}
