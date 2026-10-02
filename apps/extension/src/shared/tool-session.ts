/**
 * One tool at a time, per page.
 *
 * Every momentary tool (pick, the overlays, the various panels) is its own
 * content script injected on demand. Left alone they would overlap: a lint
 * overlay left on while a pick starts means two overlays and two sets of
 * capture-phase listeners fighting over the same clicks. Each tool announces
 * itself here on injection, before it mounts anything, which tears down
 * whichever tool was already running.
 *
 * State lives on the content script's own `globalThis` — the isolated world,
 * shared by every tool injected into the same document, and gone when the
 * page navigates. That is deliberately *not* `chrome.storage`: a record of
 * "what is running in this page" that outlives the page is a record that goes
 * stale, and the popup can read the live value with a one-line probe instead
 * (see `highlightActiveTool` in `popup/main.ts`).
 *
 * The recorder is not part of this. It is a persistent capture mode rather
 * than a momentary tool, and tearing it down because someone opened another
 * panel would silently discard a recording in progress.
 */
import { removeAnchorPicker, removePickerOverlay } from '@piwitests/picker-dom';

/** Matches the popup's button ids, so the popup can highlight the tile directly. */
export type ToolId =
  | 'pick'
  | 'multi-pick'
  | 'lint-overlay'
  | 'assertion-panel'
  | 'agent-context-panel'
  | 'test-function-panel'
  | 'coverage-overlay'
  | 'playwright-view';

interface ActiveTool {
  id: ToolId;
  epoch: number;
  teardown: () => void;
  /** What the tool tied to itself with `bindToTool`, run when it ends. */
  bound: Set<() => void>;
}

interface ToolGlobals {
  __piwiActiveTool?: ActiveTool;
  __piwiToolEpoch?: number;
}

function globals(): ToolGlobals {
  return globalThis as unknown as ToolGlobals;
}

/** Runs each callback, a failing one stopping none of the others. */
function runAll(callbacks: Array<() => void>): void {
  for (const callback of callbacks) {
    try {
      callback();
    } catch {
      // A tool that fails to tear down cleanly must not stop the next one
      // from starting — the worst case is a stale node, not a dead extension.
    }
  }
}

/** Empties what a tool bound to itself, returning it to be run. */
function takeBound(tool: ActiveTool): Array<() => void> {
  const bound = [...(tool.bound ?? [])];
  tool.bound?.clear();
  return bound;
}

/** Ends a tool: what it bound to itself first, then its teardown. */
function stop(tool: ActiveTool): void {
  runAll([...takeBound(tool), tool.teardown]);
}

/**
 * Announces a tool as the active one, stopping any predecessor, and returns
 * an epoch the caller uses to tell whether it is still the current tool after
 * an `await` (see `toolIsCurrent`).
 *
 * Call it before mounting anything: the predecessor's teardown runs inside
 * this call. `teardown` must remove whatever the tool mounted and detach its
 * listeners; it runs when another tool starts, or when the user cancels with
 * Escape.
 */
export function startTool(id: ToolId, teardown: () => void): number {
  const g = globals();
  const previous = g.__piwiActiveTool;
  if (previous) stop(previous);
  const epoch = (g.__piwiToolEpoch ?? 0) + 1;
  g.__piwiToolEpoch = epoch;
  g.__piwiActiveTool = { id, epoch, teardown, bound: new Set() };
  return epoch;
}

/** Whether `id` is the tool running now. A pick-driven tool injected again while it runs leaves the running one be. */
export function isToolActive(id: ToolId): boolean {
  return globals().__piwiActiveTool?.id === id;
}

/** False once another tool has taken over — long-running flows check this after each `await` and bail rather than drawing over their successor. */
export function toolIsCurrent(epoch: number): boolean {
  return globals().__piwiToolEpoch === epoch;
}

/**
 * Ties `dispose` to the tool started as `epoch`: it runs once, when that tool
 * ends (it finishes, another tool starts, or Escape cancels it) or when the
 * returned function is called, whichever comes first. Runs at once when that
 * tool is not running.
 *
 * A panel binds its close this way, and a wait its settling, so that tearing
 * the tool down resolves the promise its flow is waiting on: the flow then
 * unwinds instead of waiting for the life of the page.
 */
export function bindToTool(epoch: number, dispose: () => void): () => void {
  const active = globals().__piwiActiveTool;
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    active?.bound?.delete(once);
    dispose();
  };
  if (active?.epoch === epoch && active.bound) active.bound.add(once);
  else once();
  return once;
}

/** Clears the active-tool record if this tool still owns it, and runs what it bound to itself. Idempotent, and a no-op once something else has started. */
export function endTool(epoch: number): void {
  const g = globals();
  const active = g.__piwiActiveTool;
  if (active?.epoch !== epoch) return;
  g.__piwiActiveTool = undefined;
  runAll(takeBound(active));
}

/** Tears down the running tool, if any — what Escape triggers. */
function stopActiveTool(): void {
  const g = globals();
  const active = g.__piwiActiveTool;
  if (!active) return;
  g.__piwiActiveTool = undefined;
  // Bumping the epoch stops any loop still awaiting inside the tool.
  g.__piwiToolEpoch = (g.__piwiToolEpoch ?? 0) + 1;
  stop(active);
}

/**
 * Polls for a global the picker overlay sets, mirroring the reporter's
 * `page.waitForFunction` from inside the browser itself. Resolves `undefined`
 * as soon as the tool started as `epoch` ends.
 */
export function waitForGlobal<T>(key: string, epoch: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settle = bindToTool(epoch, () => {
      settled = true;
      clearTimeout(timer);
      resolve(undefined);
    });
    const check = () => {
      if (settled) return;
      const value = (globalThis as Record<string, unknown>)[key];
      if (value !== undefined) {
        resolve(value as T);
        settle();
      } else {
        timer = setTimeout(check, 120);
      }
    };
    check();
  });
}

/**
 * The teardown of a pick-driven tool: removes the picking overlay and the
 * anchors step, listeners included. The tool's own panels close through
 * `bindToTool`; no other surface on the page is touched.
 *
 * It also answers `__piwiPickState`/`__piwiAnchorState` with "skipped" when
 * nothing has yet, so a flow waiting on them, such as the bug recorder's Mark
 * what's wrong, unwinds through the cancel path it already has.
 */
export function teardownToolSurfaces(): void {
  const g = globalThis as unknown as { __piwiPickState?: string; __piwiAnchorState?: string };
  g.__piwiPickState ??= 'skipped';
  g.__piwiAnchorState ??= 'skipped';
  removePickerOverlay();
  removeAnchorPicker();
}

/**
 * Escape cancels whatever is running, from anywhere on the page.
 *
 * Individual tools already handle Escape while their own UI has focus, but
 * that leaves the cases where it doesn't — an overlay such as the lint
 * overlay has no focusable chrome, and loses focus as soon as you click the page.
 * Registered once per document, on the capture phase so a page that swallows
 * keydown can't block it, and only acting when a tool is actually running so
 * the page's own Escape handling is untouched the rest of the time. The Escape
 * that cancels a tool is the tool's: the page does not act on it too.
 *
 * The anchors step of a pick is the exception: Escape there is its Skip, and
 * the pick goes on to its results.
 */
export function installEscapeToCancel(): void {
  const g = globals() as ToolGlobals & { __piwiEscapeInstalled?: boolean };
  if (g.__piwiEscapeInstalled) return;
  g.__piwiEscapeInstalled = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !globals().__piwiActiveTool) return;
      if (typeof (globalThis as { __piwiAnchorCleanup?: unknown }).__piwiAnchorCleanup === 'function') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stopActiveTool();
    },
    true,
  );
}
