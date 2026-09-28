import { actionPoint, boxInTopViewport, type FallbackReason, type InputOp, type Point } from '../shared/cdp-input.js';
import { t } from '../shared/i18n.js';
import { DomModel } from './engine-aria.js';
import { parentOf } from './hover-reveal.js';
import { OWN_HOST_IDS } from './record-ui.js';
import type { FakeCursor } from './replay-cursor.js';

/**
 * The replay's actions as trusted input: this script finds the element and
 * the point to act on, and the background worker sends the mouse and keyboard
 * input through the debugging protocol (`piwi-replay-input`). The page gets
 * what a person's mouse and keyboard give it: a real `:hover`, focus moving as
 * the browser moves it, Enter submitting a form, a drag the browser runs.
 *
 * Filling a field follows Playwright: focus, select what it holds, insert the
 * text; date, time and color fields, which only take a whole value, get it set
 * with an `input` and a `change` event, and a `<select>` gets its option
 * chosen the same way, as Playwright's `selectOption` does.
 */

/** The worker could not send the input: the debugging session is gone or refused the command. */
export class TrustedInputLost extends Error {
  constructor(
    message: string,
    /** Whether some of the input reached the page before it failed. */
    readonly started: boolean,
    readonly reason: FallbackReason = 'lost',
  ) {
    super(message);
  }
}

/** An action that cannot be done with the pointer where it would land, with why. */
export class NotActionable extends Error {}

let replayId = '';

/** The replay whose input the worker sends; it checks the id against the running replay. */
export function setTrustedReplay(id: string): void {
  replayId = id;
}

async function send(ops: InputOp[]): Promise<void> {
  let answer: { ok: boolean; lost?: boolean; started?: boolean; error?: string; reason?: FallbackReason } | undefined;
  try {
    answer = await chrome.runtime.sendMessage({ type: 'piwi-replay-input', replayId, ops });
  } catch (e) {
    throw new TrustedInputLost(e instanceof Error ? e.message : String(e), false);
  }
  if (answer?.ok) return;
  throw new TrustedInputLost(answer?.error ?? t('common_workerNoAnswer'), answer?.started ?? false, answer?.reason);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The origin of each frame's content around `element`, innermost first, in its parent's viewport. */
function frameOrigins(element: Element): Point[] {
  const origins: Point[] = [];
  let win: Window | null = element.ownerDocument.defaultView;
  while (win && win !== window.top) {
    let frame: Element | null = null;
    try {
      frame = win.frameElement;
    } catch {
      frame = null;
    }
    if (!frame) break;
    const r = frame.getBoundingClientRect();
    origins.push({ x: r.left + frame.clientLeft, y: r.top + frame.clientTop });
    win = frame.ownerDocument.defaultView;
  }
  return origins;
}

/** Whether `hit`, what the browser finds at the point, is the element, inside it, or a label that acts for it. */
function reaches(element: Element, hit: Element | null): boolean {
  for (let n: Element | null = hit; n; n = parentOf(n)) {
    if (n === element) return true;
    if (n.tagName === 'LABEL' && (n as HTMLLabelElement).control === element) return true;
  }
  return false;
}

/** What the page shows at a point of the element's own frame, the extension's own surfaces aside. */
function hitAt(element: Element, x: number, y: number): Element | null {
  const doc = element.ownerDocument;
  let hit = doc.elementFromPoint(x, y);
  // Down through open shadow roots, as a pointer event reaches its target.
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

function describe(element: Element): string {
  const model = new DomModel();
  const name = model.accessibleName(element, false);
  const tag = element.tagName.toLowerCase();
  return name ? `${tag} "${name.slice(0, 60)}"` : tag;
}

/** How long a covered element is waited for before the step gives up, as Playwright retries its hit check. */
const COVERED_WAIT_MS = 3_000;

/**
 * The point to act on the element, in the top viewport, once nothing covers
 * it: the element, something inside it, or its label must be what the
 * browser finds there. `requireHit` false takes the point as it is, for an
 * action that does not go through the pointer (a fill, a key press).
 */
export async function pointFor(element: Element, requireHit = true): Promise<Point> {
  const deadline = Date.now() + COVERED_WAIT_MS;
  for (;;) {
    const r = element.getBoundingClientRect();
    const win = element.ownerDocument.defaultView ?? window;
    const local = actionPoint(r, { width: win.innerWidth, height: win.innerHeight });
    if (!local) {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    } else {
      const hit = requireHit ? await withOwnSurfacesAside(() => hitAt(element, local.x, local.y)) : element;
      if (reaches(element, hit)) {
        const top = boxInTopViewport({ left: local.x, top: local.y, width: 0, height: 0 }, frameOrigins(element));
        return { x: top.left, y: top.top };
      }
      if (Date.now() >= deadline) {
        throw new NotActionable(
          hit
            ? t('replay_reasonCovered', { element: describe(element), other: describe(hit) })
            : t('replay_reasonOffscreen', { element: describe(element) }),
        );
      }
    }
    if (Date.now() >= deadline) throw new NotActionable(t('replay_reasonOffscreen', { element: describe(element) }));
    await wait(100);
  }
}

/** The request conditions' banner, drawn by another script, over the page like the extension's panels. */
const CONDITIONS_BANNER_ID = 'piwi-conditions-banner';

/**
 * Runs `fn` with the extension's own surfaces (the replay's panel, a
 * recorder's frame, the conditions' banner) letting the pointer through, so
 * input aimed at an element under one of them reaches the element, as the fake
 * cursor always does.
 */
async function withOwnSurfacesAside<T>(fn: () => T | Promise<T>): Promise<T> {
  const hosts = [...OWN_HOST_IDS, CONDITIONS_BANNER_ID]
    .map((id) => document.getElementById(id))
    .filter((host): host is HTMLElement => !!host);
  const before = hosts.map((host) => host.style.pointerEvents);
  for (const host of hosts) host.style.pointerEvents = 'none';
  try {
    return await fn();
  } finally {
    hosts.forEach((host, i) => {
      host.style.pointerEvents = before[i]!;
    });
  }
}

function sendAside(ops: InputOp[]): Promise<void> {
  return withOwnSurfacesAside(() => send(ops));
}

/** The fake cursor glides to the point in the top viewport, where the real pointer then goes. */
async function glide(element: Element, cursor: FakeCursor, caption: string, requireHit = true): Promise<Point> {
  const point = await pointFor(element, requireHit);
  const r = element.getBoundingClientRect();
  const origin = frameOrigins(element).reduce((sum, o) => ({ x: sum.x + o.x, y: sum.y + o.y }), { x: 0, y: 0 });
  cursor.outline({ left: r.left + origin.x, top: r.top + origin.y, width: r.width, height: r.height });
  await cursor.moveTo(point.x, point.y, caption);
  // The page may have moved while the cursor glided.
  return pointFor(element, requireHit);
}

export async function trustedHover(
  element: Element,
  cursor: FakeCursor,
  caption: string,
  requireHit = true,
): Promise<void> {
  const point = await glide(element, cursor, caption, requireHit);
  cursor.outline(null);
  await sendAside([{ op: 'move', ...point }]);
}

export async function trustedClick(
  element: Element,
  cursor: FakeCursor,
  caption: string,
  count: 1 | 2 = 1,
): Promise<void> {
  const point = await glide(element, cursor, caption);
  await cursor.press();
  cursor.outline(null);
  await sendAside([{ op: 'click', ...point, count }]);
}

export async function trustedCheck(
  element: Element,
  checked: boolean,
  cursor: FakeCursor,
  caption: string,
): Promise<boolean> {
  const input = element as HTMLInputElement;
  const current = () =>
    typeof input.checked === 'boolean' ? input.checked : element.getAttribute('aria-checked') === 'true';
  if (current() === checked) {
    await glide(element, cursor, caption);
    cursor.outline(null);
    return true;
  }
  await trustedClick(element, cursor, caption);
  await wait(50);
  return current() === checked;
}

/** Fields whose value is only valid whole: Playwright sets them in one go, and so does the replay. */
const WHOLE_VALUE_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range']);

function selectContents(element: HTMLElement): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.select();
    return;
  }
  const selection = element.ownerDocument.getSelection();
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** The editable element a fill types into: the element, or the editable host it is inside. */
function editableOf(element: Element): HTMLElement | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element;
  if (element instanceof HTMLElement && element.isContentEditable) {
    let host: HTMLElement = element;
    while (host.parentElement?.isContentEditable) host = host.parentElement;
    return host;
  }
  return null;
}

export async function trustedFill(
  element: Element,
  value: string,
  cursor: FakeCursor,
  caption: string,
): Promise<boolean> {
  await glide(element, cursor, caption, false);
  await cursor.press();
  cursor.outline(null);
  const editable = editableOf(element);
  if (!editable) return false;
  editable.focus({ preventScroll: true });
  if (editable instanceof HTMLInputElement && WHOLE_VALUE_TYPES.has(editable.type)) {
    editable.value = value;
    editable.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    editable.dispatchEvent(new Event('change', { bubbles: true }));
    return editable.value === value;
  }
  selectContents(editable);
  await send(value ? [{ op: 'insertText', text: value }] : [{ op: 'press', combo: 'Delete' }]);
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    await wait(0);
    return editable.value === value;
  }
  return true;
}

export async function trustedPress(
  element: Element | null,
  key: string,
  cursor: FakeCursor,
  caption: string,
): Promise<void> {
  if (element) {
    await glide(element, cursor, caption, false);
    cursor.outline(null);
    if (element instanceof HTMLElement && element.ownerDocument.activeElement !== element) {
      element.focus({ preventScroll: true });
    }
  }
  await send([{ op: 'press', combo: key }]);
}

/** A `<select>`: the pointer goes over it, and the option is chosen as Playwright's `selectOption` chooses it. */
export async function trustedSelect(
  element: Element,
  value: string,
  cursor: FakeCursor,
  caption: string,
): Promise<boolean> {
  await trustedHover(element, cursor, caption, false);
  if (!(element instanceof HTMLSelectElement)) return false;
  const option =
    [...element.options].find((o) => o.value === value) ?? [...element.options].find((o) => o.label === value);
  if (!option) return false;
  element.focus({ preventScroll: true });
  element.value = option.value;
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export async function trustedDrag(
  element: Element,
  target: Element,
  cursor: FakeCursor,
  caption: string,
): Promise<void> {
  const from = await glide(element, cursor, caption);
  await cursor.press();
  const to = await pointFor(target).catch(() => null);
  if (!to) throw new NotActionable(t('replay_reasonOffscreen', { element: describe(target) }));
  const r = target.getBoundingClientRect();
  cursor.outline(r);
  await cursor.moveTo(to.x, to.y, caption);
  cursor.outline(null);
  await sendAside([{ op: 'drag', from, to }]);
}
