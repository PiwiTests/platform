/**
 * The pure half of the trusted-input driver: what the background worker sends
 * through `chrome.debugger` (the Chrome DevTools Protocol's `Input` domain) for
 * each action a replay performs, where on the page it lands, and which driver
 * a replay uses.
 *
 * Coordinates are CSS pixels relative to the top-level viewport, which is what
 * `Input.dispatchMouseEvent` takes and what `getBoundingClientRect` gives in
 * the top document.
 */

/** How a replay acts on the page: trusted input through the debugging protocol, or the page's own events. */
export type ReplayDriver = 'cdp' | 'synthetic';

/** Why a replay plays with the page's own events rather than trusted input. */
export type FallbackReason =
  /** The browser has no `chrome.debugger` (Firefox). */
  | 'unavailable'
  /** Attaching failed: another debugger, a policy, a page the browser protects. */
  | 'refused'
  /** The person clicked Cancel on the browser's debugging bar. */
  | 'canceled'
  /** The tab closed or the browser ended the session. */
  | 'lost';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One action the worker performs for the replay, as the replay script asks for it. */
export type InputOp =
  | { op: 'move'; x: number; y: number }
  | { op: 'click'; x: number; y: number; count: 1 | 2 }
  | { op: 'press'; combo: string }
  | { op: 'insertText'; text: string }
  | { op: 'drag'; from: Point; to: Point };

/** A protocol command: its method and parameters. */
export interface CdpCommand {
  method: string;
  params: Record<string, unknown>;
}

/** The protocol's modifier bits. */
export const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const;
type Modifier = keyof typeof MODIFIER_BITS;

interface KeyDefinition {
  key: string;
  code: string;
  keyCode: number;
  /** What the key types, when it types something. */
  text?: string;
  location?: number;
}

const NAMED_KEYS: Record<string, Omit<KeyDefinition, 'key'>> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Insert: { code: 'Insert', keyCode: 45 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Shift: { code: 'ShiftLeft', keyCode: 16, location: 1 },
  Control: { code: 'ControlLeft', keyCode: 17, location: 1 },
  Alt: { code: 'AltLeft', keyCode: 18, location: 1 },
  Meta: { code: 'MetaLeft', keyCode: 91, location: 1 },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
};

/** Punctuation on a US keyboard: the key's code and key code, and whether Shift types it. */
const PUNCTUATION: Record<string, { code: string; keyCode: number }> = {
  ';': { code: 'Semicolon', keyCode: 186 },
  ':': { code: 'Semicolon', keyCode: 186 },
  '=': { code: 'Equal', keyCode: 187 },
  '+': { code: 'Equal', keyCode: 187 },
  ',': { code: 'Comma', keyCode: 188 },
  '<': { code: 'Comma', keyCode: 188 },
  '-': { code: 'Minus', keyCode: 189 },
  _: { code: 'Minus', keyCode: 189 },
  '.': { code: 'Period', keyCode: 190 },
  '>': { code: 'Period', keyCode: 190 },
  '/': { code: 'Slash', keyCode: 191 },
  '?': { code: 'Slash', keyCode: 191 },
  '`': { code: 'Backquote', keyCode: 192 },
  '~': { code: 'Backquote', keyCode: 192 },
  '[': { code: 'BracketLeft', keyCode: 219 },
  '{': { code: 'BracketLeft', keyCode: 219 },
  '\\': { code: 'Backslash', keyCode: 220 },
  '|': { code: 'Backslash', keyCode: 220 },
  ']': { code: 'BracketRight', keyCode: 221 },
  '}': { code: 'BracketRight', keyCode: 221 },
  "'": { code: 'Quote', keyCode: 222 },
  '"': { code: 'Quote', keyCode: 222 },
  '!': { code: 'Digit1', keyCode: 49 },
  '@': { code: 'Digit2', keyCode: 50 },
  '#': { code: 'Digit3', keyCode: 51 },
  $: { code: 'Digit4', keyCode: 52 },
  '%': { code: 'Digit5', keyCode: 53 },
  '^': { code: 'Digit6', keyCode: 54 },
  '&': { code: 'Digit7', keyCode: 55 },
  '*': { code: 'Digit8', keyCode: 56 },
  '(': { code: 'Digit9', keyCode: 57 },
  ')': { code: 'Digit0', keyCode: 48 },
};

/** A key as Playwright names it (`Enter`, `a`, `?`, `F5`, `Space`), as the protocol describes it. */
export function keyDefinition(name: string): KeyDefinition {
  const key = name === 'Space' ? ' ' : name;
  const named = NAMED_KEYS[key];
  if (named) return { key, ...named };
  if (/^[a-z]$/i.test(key))
    return { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), text: key };
  if (/^\d$/.test(key)) return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key };
  const f = /^F(\d{1,2})$/.exec(key);
  if (f && Number(f[1]) >= 1 && Number(f[1]) <= 24) return { key, code: key, keyCode: 111 + Number(f[1]) };
  const punctuation = PUNCTUATION[key];
  if (punctuation) return { key, ...punctuation, text: key };
  // Any other single character types itself; any other name is sent as it is.
  return [...key].length === 1 ? { key, code: '', keyCode: 0, text: key } : { key, code: key, keyCode: 0 };
}

/**
 * A combination as Playwright writes it (`ControlOrMeta+K`, `Shift+Tab`,
 * `Enter`, `+`): the modifiers held, in the order they go down, and the key.
 * `ControlOrMeta` is ⌘ on a Mac and Ctrl elsewhere.
 */
export function parseCombo(combo: string, isMac: boolean): { modifiers: Modifier[]; key: string } {
  const parts = combo.length > 1 ? combo.split(/\+(?=.)/) : [combo];
  const key = parts.pop()!;
  const modifiers: Modifier[] = [];
  for (const part of parts) {
    const modifier: Modifier | null =
      part === 'ControlOrMeta'
        ? isMac
          ? 'Meta'
          : 'Control'
        : part === 'Control' || part === 'Meta' || part === 'Alt' || part === 'Shift'
          ? part
          : null;
    if (modifier && !modifiers.includes(modifier)) modifiers.push(modifier);
  }
  return { modifiers, key };
}

function modifierMask(modifiers: readonly Modifier[]): number {
  return modifiers.reduce((mask, m) => mask | MODIFIER_BITS[m], 0);
}

/**
 * The editing commands a Mac runs for a shortcut. Chrome on macOS does not
 * turn a synthesized ⌘ key into an editing action by itself, so the protocol
 * names the command, as Playwright does.
 */
const MAC_COMMANDS: Record<string, string> = {
  'Meta+KeyA': 'selectAll',
  'Meta+KeyC': 'copy',
  'Meta+KeyX': 'cut',
  'Meta+KeyV': 'paste',
  'Meta+KeyZ': 'undo',
  'Meta+Shift+KeyZ': 'redo',
};

function keyEvent(
  type: 'keyDown' | 'rawKeyDown' | 'keyUp',
  def: KeyDefinition,
  modifiers: number,
  extra: Record<string, unknown> = {},
): CdpCommand {
  return {
    method: 'Input.dispatchKeyEvent',
    params: {
      type,
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      nativeVirtualKeyCode: def.keyCode,
      modifiers,
      ...(def.location ? { location: def.location } : {}),
      ...extra,
    },
  };
}

/**
 * The key events for one press of a combination: each modifier down, the key
 * down and up, the modifiers up in reverse. The key types its text only when
 * no modifier but Shift is held, as a keyboard does.
 */
export function keyEvents(combo: string, isMac: boolean): CdpCommand[] {
  const { modifiers, key } = parseCombo(combo, isMac);
  const def = keyDefinition(key);
  const events: CdpCommand[] = [];
  const held: Modifier[] = [];
  for (const m of modifiers) {
    held.push(m);
    events.push(keyEvent('rawKeyDown', keyDefinition(m), modifierMask(held)));
  }
  const mask = modifierMask(modifiers);
  const types = !!def.text && modifiers.every((m) => m === 'Shift');
  const text = types
    ? modifiers.includes('Shift') && def.text!.length === 1
      ? def.text!.toUpperCase()
      : def.text!
    : '';
  const command = isMac ? MAC_COMMANDS[[...(modifiers as string[])].sort().concat(def.code).join('+')] : undefined;
  events.push(
    keyEvent(types ? 'keyDown' : 'rawKeyDown', def, mask, {
      ...(types ? { text, unmodifiedText: def.text } : {}),
      ...(command ? { commands: [command] } : {}),
    }),
  );
  events.push(keyEvent('keyUp', def, mask));
  for (const m of [...modifiers].reverse()) {
    held.splice(held.indexOf(m), 1);
    events.push(keyEvent('keyUp', keyDefinition(m), modifierMask(held)));
  }
  return events;
}

function mouseEvent(type: string, point: Point, extra: Record<string, unknown> = {}): CdpCommand {
  return {
    method: 'Input.dispatchMouseEvent',
    params: { type, x: point.x, y: point.y, pointerType: 'mouse', ...extra },
  };
}

/** The pointer moving to a point, no button held. */
export function moveEvents(point: Point): CdpCommand[] {
  return [mouseEvent('mouseMoved', point, { button: 'none', buttons: 0 })];
}

/** A click, or a double click (`count` 2: two presses, the second counting 2), after moving there. */
export function clickEvents(point: Point, count: 1 | 2): CdpCommand[] {
  const events = moveEvents(point);
  for (let n = 1; n <= count; n++) {
    events.push(mouseEvent('mousePressed', point, { button: 'left', buttons: 1, clickCount: n }));
    events.push(mouseEvent('mouseReleased', point, { button: 'left', buttons: 0, clickCount: n }));
  }
  return events;
}

/** The pointer pressed at `from`, carried in `steps` moves to `to`, where it is released later. */
export function dragPathEvents(from: Point, to: Point, steps = 8): CdpCommand[] {
  const events = [...moveEvents(from), mouseEvent('mousePressed', from, { button: 'left', buttons: 1, clickCount: 1 })];
  for (let i = 1; i <= steps; i++) {
    const point = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    events.push(mouseEvent('mouseMoved', point, { button: 'left', buttons: 1 }));
  }
  return events;
}

export function releaseEvent(point: Point): CdpCommand {
  return mouseEvent('mouseReleased', point, { button: 'left', buttons: 0, clickCount: 1 });
}

/**
 * The box of an element inside frames, in the top viewport: its box in its own
 * frame, moved by each enclosing frame's content origin, innermost first.
 */
export function boxInTopViewport(box: Box, frameOrigins: readonly Point[]): Box {
  let { left, top } = box;
  for (const origin of frameOrigins) {
    left += origin.x;
    top += origin.y;
  }
  return { left, top, width: box.width, height: box.height };
}

/**
 * Where to act on a box: its center, kept inside the visible part of the box
 * and of the viewport, so a box larger than the screen is still hit. Null when
 * no part of it is on screen.
 */
export function actionPoint(box: Box, viewport: { width: number; height: number }): Point | null {
  const left = Math.max(box.left, 0);
  const top = Math.max(box.top, 0);
  const right = Math.min(box.left + box.width, viewport.width);
  const bottom = Math.min(box.top + box.height, viewport.height);
  if (right <= left || bottom <= top) return null;
  return { x: Math.round(((left + right) / 2) * 100) / 100, y: Math.round(((top + bottom) / 2) * 100) / 100 };
}

/**
 * Which driver a replay plays with: trusted input while the debugging
 * protocol is there and attached, the page's own events otherwise. A replay
 * that lost the protocol once (the person cancelled the debugging bar) stays on
 * the page's events for the rest of it.
 */
export function chooseDriver(input: {
  available: boolean;
  attached: boolean;
  previous: { driver: ReplayDriver; reason: FallbackReason | null } | null;
  attachError?: FallbackReason;
}): { driver: ReplayDriver; reason: FallbackReason | null } {
  if (input.previous?.driver === 'synthetic') return input.previous;
  if (!input.available) return { driver: 'synthetic', reason: 'unavailable' };
  if (!input.attached) return { driver: 'synthetic', reason: input.attachError ?? 'refused' };
  return { driver: 'cdp', reason: null };
}

/** What a failed attach or a detach means, from the browser's words. */
export function fallbackReasonOf(detachReason: string | null, attachError: string | null): FallbackReason {
  if (detachReason === 'canceled_by_user') return 'canceled';
  if (detachReason) return 'lost';
  if (attachError && /closed|No tab with/i.test(attachError)) return 'lost';
  return 'refused';
}

const MAX_TEXT = 20_000;

function isPoint(v: unknown): v is Point {
  const p = v as Point | null;
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Keeps the operations a replay script may ask for, checked field by field; null when one is not. */
export function readInputOps(value: unknown): InputOp[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const ops: InputOp[] = [];
  for (const raw of value as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') return null;
    switch (raw.op) {
      case 'move':
        if (!isPoint(raw)) return null;
        ops.push({ op: 'move', x: raw.x as number, y: raw.y as number });
        break;
      case 'click':
        if (!isPoint(raw) || (raw.count !== 1 && raw.count !== 2)) return null;
        ops.push({ op: 'click', x: raw.x as number, y: raw.y as number, count: raw.count });
        break;
      case 'press':
        if (typeof raw.combo !== 'string' || raw.combo.length === 0 || raw.combo.length > 64) return null;
        ops.push({ op: 'press', combo: raw.combo });
        break;
      case 'insertText':
        if (typeof raw.text !== 'string' || raw.text.length > MAX_TEXT) return null;
        ops.push({ op: 'insertText', text: raw.text });
        break;
      case 'drag':
        if (!isPoint(raw.from) || !isPoint(raw.to)) return null;
        ops.push({ op: 'drag', from: { x: raw.from.x, y: raw.from.y }, to: { x: raw.to.x, y: raw.to.y } });
        break;
      default:
        return null;
    }
  }
  return ops;
}
