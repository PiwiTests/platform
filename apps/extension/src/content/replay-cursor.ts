import { CURSOR_HOST_ID, SHARED_STYLE } from './record-ui.js';

/**
 * The replay's fake cursor: an arrow that glides to each element before the
 * replay acts on it, a ripple where it clicks, and a caption saying what it
 * does. It never takes a click itself (`pointer-events: none`), and with
 * reduced motion it jumps instead of gliding.
 */

const MOVE_MS = 450;
const PRESS_MS = 380;

export interface FakeCursor {
  /** Glide to a viewport point, with a caption such as `Click "Apply"`. */
  moveTo(x: number, y: number, caption?: string): Promise<void>;
  /** The ripple of a click where the cursor is. */
  press(): Promise<void>;
  /** Outline a box on the page, in viewport pixels, until the next move. */
  outline(rect: { left: number; top: number; width: number; height: number } | null): void;
  position(): { x: number; y: number };
  remove(): void;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createCursor(start: { x: number; y: number } | null): FakeCursor {
  document.getElementById(CURSOR_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = CURSOR_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const still = reducedMotion();
  const style = document.createElement('style');
  style.textContent = `
    ${SHARED_STYLE}
    .cursor { position: fixed; left: 0; top: 0; width: 22px; height: 26px; will-change: transform;
      transition: transform ${still ? 0 : MOVE_MS}ms cubic-bezier(.2,.7,.2,1); filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
    .caption { position: absolute; left: 20px; top: 22px; white-space: nowrap; max-width: 280px; overflow: hidden;
      text-overflow: ellipsis; background: #7c3aed; color: #fff; font-size: 11.5px; line-height: 1.3; padding: 3px 7px;
      border-radius: 6px; opacity: 0; transition: opacity 150ms; }
    .caption.shown { opacity: 1; }
    .ripple { position: fixed; left: 0; top: 0; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
      border: 2px solid #7c3aed; background: rgba(124,58,237,.25); pointer-events: none;
      animation: ripple ${PRESS_MS}ms ease-out forwards; }
    @keyframes ripple { from { transform: scale(.3); opacity: .9; } to { transform: scale(1.3); opacity: 0; } }
    .outline { position: fixed; border: 2px solid #7c3aed; border-radius: 4px; background: rgba(124,58,237,.08);
      pointer-events: none; transition: all ${still ? 0 : 150}ms; }
  `;
  const outline = document.createElement('div');
  outline.className = 'outline';
  outline.hidden = true;
  const cursor = document.createElement('div');
  cursor.className = 'cursor';
  cursor.innerHTML =
    '<svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">' +
    '<path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.5 15 L17 15 Z" fill="#fff" stroke="#111827" stroke-width="1.6" stroke-linejoin="round"/>' +
    '</svg>';
  const caption = document.createElement('div');
  caption.className = 'caption';
  cursor.appendChild(caption);
  root.append(style, outline, cursor);

  let x = start?.x ?? Math.round(window.innerWidth / 2);
  let y = start?.y ?? Math.round(window.innerHeight / 2);
  const place = () => {
    // The arrow's tip is 2px in from its box.
    cursor.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
  };
  // Placed without a transition first, so a new page does not glide in from the corner.
  cursor.style.transition = 'none';
  place();
  void cursor.getBoundingClientRect();
  cursor.style.transition = '';

  return {
    async moveTo(nx, ny, text) {
      caption.textContent = text ?? '';
      caption.classList.toggle('shown', !!text);
      const distance = Math.hypot(nx - x, ny - y);
      x = Math.round(nx);
      y = Math.round(ny);
      place();
      if (!still && distance > 1) await wait(MOVE_MS);
    },
    async press() {
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      root.appendChild(ripple);
      setTimeout(() => ripple.remove(), PRESS_MS);
      if (!still) await wait(PRESS_MS / 2);
    },
    outline(rect) {
      outline.hidden = !rect;
      if (!rect) return;
      outline.style.left = `${rect.left - 3}px`;
      outline.style.top = `${rect.top - 3}px`;
      outline.style.width = `${rect.width + 6}px`;
      outline.style.height = `${rect.height + 6}px`;
    },
    position: () => ({ x, y }),
    remove: () => host.remove(),
  };
}
