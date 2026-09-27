/** Small pieces the DevTools pages share: buttons, empty states and their icons. */

const SVG = 'http://www.w3.org/2000/svg';

/** Outline icons, 24 × 24, drawn with the page's stroke. */
const ICONS = {
  select: ['M5 3l14 7-6 2-2 6z', 'M13 13l6 6'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 017 0v3'],
  record: ['M12 4a8 8 0 100 16 8 8 0 000-16z', 'M12 9a3 3 0 100 6 3 3 0 000-6z'],
  replay: ['M8 5.5v13l10-6.5z'],
  network: ['M7 4v16', 'M4 7l3-3 3 3', 'M17 20V4', 'M14 17l3 3 3-3'],
  blocked: ['M12 4a8 8 0 100 16 8 8 0 000-16z', 'M6.5 6.5l11 11'],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  if (className) b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A centered message for an area with nothing to show yet, with an icon and, when given, what to do. */
export function emptyState(name: IconName, text: string, ...actions: HTMLElement[]): HTMLElement {
  const box = el('div', 'empty');
  box.append(icon(name), el('p', '', text), ...actions);
  return box;
}

/** Shows `done` on a button for a moment, then its label again. */
export function flash(btn: HTMLButtonElement, done: string): void {
  const original = btn.textContent;
  btn.textContent = done;
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}
