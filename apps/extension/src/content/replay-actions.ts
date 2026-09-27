import { stepLocator } from '@piwitests/core/codegen';
import { parseLocatorChain } from '@piwitests/core/locator-chain';
import type { RecordedStep } from '@piwitests/core/recording';
import { t, tn } from '../shared/i18n.js';
import { DomModel } from './engine-aria.js';
import { createLocatorEngine } from './locator-engine.js';
import { endHoverEmulation, hoverElement } from './hover-emulation.js';
import { parentOf } from './hover-reveal.js';
import { isOwnHost } from './record-ui.js';
import type { FakeCursor } from './replay-cursor.js';
import type { Observation } from './replay-core.js';

/**
 * How the replay finds each step's element and acts on it in the page.
 *
 * The element is found with the locator the generated spec would use
 * (`stepLocator`), resolved by the in-page engine, and waited for as
 * Playwright waits: exactly one match, visible, enabled, and still in place
 * across two frames. The actions are the page's own events, since an
 * extension cannot send trusted input without the `debugger` permission.
 */

/** How long a step waits for its element, and an assertion for its result. */
export const ACTION_TIMEOUT_MS = 10_000;
export const ASSERT_TIMEOUT_MS = 5_000;
const POLL_MS = 100;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * How long the page must stay still before the replay acts: no change to its
 * DOM and no new request. An app rendered on the server ignores input until it
 * has hydrated, and hydrating writes its own state back over whatever was
 * typed before; a person never acts that fast after a page appears.
 */
const QUIET_MS = 400;
const LOAD_QUIET_MAX_MS = 10_000;
const STEP_QUIET_MS = 250;
const STEP_QUIET_MAX_MS = 3_000;

function isOwnNode(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return !!element && isOwnHost(element);
}

/** Resolves once the page has gone `quietMs` without a DOM change or a new request, or after `maxMs`. */
async function waitForQuiet(quietMs: number, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  let last = Date.now();
  const mutations = new MutationObserver((records) => {
    if (records.some((r) => !isOwnNode(r.target))) last = Date.now();
  });
  mutations.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  let requests: PerformanceObserver | null = null;
  try {
    requests = new PerformanceObserver(() => {
      last = Date.now();
    });
    requests.observe({ type: 'resource' });
  } catch {
    requests = null;
  }
  try {
    while (Date.now() < deadline && Date.now() - last < quietMs) await wait(50);
  } finally {
    mutations.disconnect();
    requests?.disconnect();
  }
}

/** Waits for a page that has just opened: its load, then a quiet moment. */
export async function waitForPageReady(): Promise<void> {
  if (document.readyState !== 'complete') {
    await Promise.race([
      new Promise((resolve) => window.addEventListener('load', resolve, { once: true })),
      wait(LOAD_QUIET_MAX_MS),
    ]);
  }
  await waitForQuiet(QUIET_MS, LOAD_QUIET_MAX_MS);
}

/** Waits, briefly, for what the last step started (a request, a re-render) to finish. */
export function waitForStepReady(): Promise<void> {
  return waitForQuiet(STEP_QUIET_MS, STEP_QUIET_MAX_MS);
}

/** The locator the spec would write for a step, or null when none was recorded. */
export function locatorFor(step: RecordedStep): string | null {
  return stepLocator(step.target, { locators: 'stable' });
}

/** Every element a locator finds on the page now, the extension's own surfaces left out. */
export function findAll(locator: string): Element[] {
  const engine = createLocatorEngine(document, { ignore: isOwnHost });
  try {
    return engine.queryAll(parseLocatorChain(locator));
  } catch {
    return [];
  }
}

export type Resolution = { ok: true; element: Element } | { ok: false; reason: string };

function sameRect(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * Waits until the step's element can take the action, and answers it; or,
 * after `timeout`, why it could not.
 */
export async function resolveForAction(step: RecordedStep, timeout = ACTION_TIMEOUT_MS): Promise<Resolution> {
  const locator = locatorFor(step);
  if (!locator) return { ok: false, reason: t('replay_reasonNoLocator') };
  const deadline = Date.now() + timeout;
  let reason = '';
  for (;;) {
    const found = findAll(locator);
    const model = new DomModel();
    if (found.length === 0) reason = t('replay_reasonNoMatch', { locator });
    else if (found.length > 1) reason = tn('replay_reasonManyMatches', found.length, { locator });
    else if (!model.isVisible(found[0]!)) reason = t('replay_reasonHidden', { locator });
    else if (step.action !== 'hover' && model.disabled(found[0]!)) reason = t('replay_reasonDisabled', { locator });
    else {
      const element = found[0]!;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const before = element.getBoundingClientRect();
      await nextFrame();
      await nextFrame();
      if (element.isConnected && sameRect(before, element.getBoundingClientRect())) return { ok: true, element };
      reason = t('replay_reasonMoving', { locator });
    }
    if (Date.now() >= deadline) return { ok: false, reason };
    await wait(POLL_MS);
  }
}

/** What the page shows for an assertion step's element, or for the page itself. */
export function observe(step: RecordedStep): Observation {
  const url = location.href;
  const locator = step.assertion?.matcher === 'toHaveURL' ? null : locatorFor(step);
  const found = locator ? findAll(locator) : [];
  const first = found[0];
  if (!first) return { count: 0, text: null, value: null, name: null, visible: false, enabled: false, url };
  const model = new DomModel();
  const value =
    'value' in first && typeof (first as HTMLInputElement).value === 'string'
      ? (first as HTMLInputElement).value
      : null;
  return {
    count: found.length,
    text: first.textContent,
    value,
    name: model.accessibleName(first, false),
    visible: model.isVisible(first),
    enabled: !model.disabled(first),
    url,
  };
}

function center(element: Element): { x: number; y: number } {
  const r = element.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function mouseInit(x: number, y: number): MouseEventInit {
  return { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
}

/** The element the replay's pointer is over, which gets the leave events when it moves on. */
let hovered: Element | null = null;

function chainOf(element: Element): Element[] {
  const chain: Element[] = [];
  for (let n: Element | null = element; n; n = parentOf(n)) chain.push(n);
  return chain;
}

/**
 * The pointer leaving the element it was over for `next` (null: for no
 * element), as a mouse sends it: out of that element, then a leave for each of
 * its ancestors `next` is not inside, innermost first. A menu that opens on
 * hover closes on it.
 */
function dispatchLeave(next: Element | null, x: number, y: number): void {
  const previous = hovered;
  if (!previous || previous === next) return;
  hovered = null;
  if (!previous.isConnected) return;
  const init = { ...mouseInit(x, y), relatedTarget: next };
  const pointer: PointerEventInit = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  const staying = new Set(next ? chainOf(next) : []);
  previous.dispatchEvent(new PointerEvent('pointerout', pointer));
  previous.dispatchEvent(new MouseEvent('mouseout', init));
  for (const el of chainOf(previous)) {
    if (staying.has(el)) break;
    el.dispatchEvent(new PointerEvent('pointerleave', { ...pointer, bubbles: false }));
    el.dispatchEvent(new MouseEvent('mouseleave', { ...init, bubbles: false }));
  }
}

/**
 * The pointer arriving over an element, as a mouse sends it on its way to a
 * click: out of the last element, over this one and into each ancestor it was
 * not in yet, outermost first, then a move. CSS `:hover` moves with it
 * (`hoverElement`). Menus and selects rely on it: a Radix or Reka select
 * ignores the release that picks an option unless the pointer moved since it
 * opened.
 */
function dispatchHover(element: Element, x: number, y: number): void {
  const init = mouseInit(x, y);
  const pointer: PointerEventInit = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  hoverElement(element);
  if (hovered !== element) {
    const previous = hovered?.isConnected ? hovered : null;
    const before = new Set(previous ? chainOf(previous) : []);
    dispatchLeave(element, x, y);
    const entering = chainOf(element)
      .filter((el) => !before.has(el))
      .reverse();
    element.dispatchEvent(new PointerEvent('pointerover', { ...pointer, relatedTarget: previous }));
    for (const el of entering) {
      el.dispatchEvent(new PointerEvent('pointerenter', { ...pointer, bubbles: false, relatedTarget: previous }));
    }
    element.dispatchEvent(new MouseEvent('mouseover', { ...init, relatedTarget: previous }));
    for (const el of entering) {
      el.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false, relatedTarget: previous }));
    }
    hovered = element;
  }
  element.dispatchEvent(new PointerEvent('pointermove', pointer));
  element.dispatchEvent(new MouseEvent('mousemove', init));
}

/** The pointer leaving the page's elements, and the emulated `:hover` removed: the replay is over. */
export function endHover(): void {
  dispatchLeave(null, 0, 0);
  endHoverEmulation();
}

/** A click as a person makes it: pointer and mouse down and up, focus, then the click. */
function dispatchClick(element: Element, x: number, y: number): void {
  const init = mouseInit(x, y);
  const pointer: PointerEventInit = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  element.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
  element.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
  if (element instanceof HTMLElement || element instanceof SVGElement) element.focus({ preventScroll: true });
  element.dispatchEvent(new PointerEvent('pointerup', pointer));
  element.dispatchEvent(new MouseEvent('mouseup', init));
  element.dispatchEvent(new MouseEvent('click', { ...init, detail: 1 }));
}

async function pointAt(element: Element, cursor: FakeCursor, caption: string): Promise<{ x: number; y: number }> {
  const target = center(element);
  cursor.outline(element.getBoundingClientRect());
  await cursor.moveTo(target.x, target.y, caption);
  dispatchHover(element, target.x, target.y);
  return target;
}

/** A hover: the pointer moves over the element and stays there. */
export async function performHover(element: Element, cursor: FakeCursor, caption: string): Promise<void> {
  await pointAt(element, cursor, caption);
  cursor.outline(null);
}

export async function performClick(element: Element, cursor: FakeCursor, caption: string): Promise<void> {
  const { x, y } = await pointAt(element, cursor, caption);
  await cursor.press();
  cursor.outline(null);
  dispatchClick(element, x, y);
}

/**
 * Fields whose value is only valid whole (`09:30`, `2026-09-27`, `#22c55e`):
 * a browser drops a partial one, so the replay sets them in one go.
 */
const WHOLE_VALUE_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range']);

/** Typed in steps a person can follow, at most about a second and a half whatever its length. */
export async function performFill(
  element: Element,
  value: string,
  cursor: FakeCursor,
  caption: string,
): Promise<boolean> {
  const { x, y } = await pointAt(element, cursor, caption);
  await cursor.press();
  dispatchClick(element, x, y);
  cursor.outline(null);
  if (element instanceof HTMLElement && element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }),
    );
    return true;
  }
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  element.focus({ preventScroll: true });
  if (element instanceof HTMLInputElement && WHOLE_VALUE_TYPES.has(element.type)) {
    element.value = value;
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText' }),
    );
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return element.value === value;
  }
  element.value = '';
  element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
  const perTick = Math.max(1, Math.ceil(value.length / 40));
  for (let i = 0; i < value.length; i += perTick) {
    const chunk = value.slice(i, i + perTick);
    element.value += chunk;
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: chunk }),
    );
    await wait(35);
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return element.value === value;
}

export async function performCheck(
  element: Element,
  checked: boolean,
  cursor: FakeCursor,
  caption: string,
): Promise<boolean> {
  const input = element as HTMLInputElement;
  if (typeof input.checked !== 'boolean' || input.checked === checked) {
    await pointAt(element, cursor, caption);
    cursor.outline(null);
    return typeof input.checked !== 'boolean' ? false : true;
  }
  await performClick(element, cursor, caption);
  return input.checked === checked;
}

export async function performSelect(
  element: Element,
  value: string,
  cursor: FakeCursor,
  caption: string,
): Promise<boolean> {
  await pointAt(element, cursor, caption);
  await cursor.press();
  cursor.outline(null);
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

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The events for a key as Playwright writes it: `Enter`, `?`, or a shortcut
 * such as `ControlOrMeta+K` (Ctrl, or ⌘ on a Mac) or `Shift+Tab`.
 */
function keyboardInit(combo: string): KeyboardEventInit {
  const parts = combo.length > 1 ? combo.split(/\+(?=.)/) : [combo];
  const name = parts.pop()!;
  const held = new Set(parts);
  const key = name === 'Space' ? ' ' : name;
  const code = /^[a-z]$/i.test(key)
    ? `Key${key.toUpperCase()}`
    : /^\d$/.test(key)
      ? `Digit${key}`
      : key === ' '
        ? 'Space'
        : key;
  return {
    key,
    code,
    ctrlKey: held.has('Control') || (held.has('ControlOrMeta') && !IS_MAC),
    metaKey: held.has('Meta') || (held.has('ControlOrMeta') && IS_MAC),
    altKey: held.has('Alt'),
    shiftKey: held.has('Shift'),
    bubbles: true,
    cancelable: true,
    composed: true,
  };
}

/**
 * A key press. Enter in a form's field submits the form, which the browser
 * does not do for an event a script sends, unless the page cancelled the key.
 */
export async function performPress(
  element: Element | null,
  key: string,
  cursor: FakeCursor,
  caption: string,
): Promise<void> {
  const target = element ?? document.activeElement ?? document.body;
  if (element) {
    await pointAt(element, cursor, caption);
    cursor.outline(null);
    if (element instanceof HTMLElement) element.focus({ preventScroll: true });
  }
  const init = keyboardInit(key);
  const down = new KeyboardEvent('keydown', init);
  target.dispatchEvent(down);
  // Enter, and a character typed without Ctrl or ⌘, also send the older `keypress` some pages still listen to.
  if (key === 'Enter' || ([...init.key!].length === 1 && !init.ctrlKey && !init.metaKey)) {
    target.dispatchEvent(new KeyboardEvent('keypress', init));
  }
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  if (key === 'Enter' && !down.defaultPrevented && target instanceof HTMLInputElement && target.form) {
    target.form.requestSubmit();
  }
}
