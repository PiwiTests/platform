import { stepLocator } from '@piwitests/core/codegen';
import { parseLocatorChain } from '@piwitests/core/locator-chain';
import type { RecordedStep } from '@piwitests/core/recording';
import { DomModel } from './engine-aria.js';
import { createLocatorEngine } from './locator-engine.js';
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
  if (!locator) return { ok: false, reason: 'No locator was recorded for this element.' };
  const deadline = Date.now() + timeout;
  let reason = '';
  for (;;) {
    const found = findAll(locator);
    const model = new DomModel();
    if (found.length === 0) reason = `Nothing on this page matches ${locator}.`;
    else if (found.length > 1) reason = `${found.length} elements match ${locator}; an action needs exactly one.`;
    else if (!model.isVisible(found[0]!)) reason = `${locator} is on the page but hidden.`;
    else if (model.disabled(found[0]!)) reason = `${locator} is disabled.`;
    else {
      const element = found[0]!;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      const before = element.getBoundingClientRect();
      await nextFrame();
      await nextFrame();
      if (element.isConnected && sameRect(before, element.getBoundingClientRect())) return { ok: true, element };
      reason = `${locator} kept moving.`;
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
  return target;
}

export async function performClick(element: Element, cursor: FakeCursor, caption: string): Promise<void> {
  const { x, y } = await pointAt(element, cursor, caption);
  await cursor.press();
  cursor.outline(null);
  dispatchClick(element, x, y);
}

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
  const init: KeyboardEventInit = {
    key,
    code: key === 'Enter' ? 'Enter' : key,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const down = new KeyboardEvent('keydown', init);
  target.dispatchEvent(down);
  if (key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  if (key === 'Enter' && !down.defaultPrevented && target instanceof HTMLInputElement && target.form) {
    target.form.requestSubmit();
  }
}
