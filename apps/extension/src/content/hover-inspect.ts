import { startTool, endTool, installEscapeToCancel } from '../shared/tool-session.js';
import { probeElementAttrs, highlightLocator, LOCATOR_SYNTAX_CSS } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  CAPTURED_ATTRIBUTES,
} from '@piwitests/core/locator-generation';

const HOST_ID = 'piwi-hover-inspect-host';
const PROBE_ARG = {
  keep: [...CAPTURED_ATTRIBUTES],
  includeStructural: false,
};

/**
 * Toggleable "what would Piwi call this?" mode: the best-ranked locator for
 * whatever's under the cursor, shown in a tooltip, no click needed. A second
 * trigger (or Escape) turns it back off — state lives on `globalThis` so a
 * fresh injection of this same module toggles rather than stacking.
 */
function toggleHoverInspect(): void {
  const g = globalThis as any;
  if (g.__piwiHoverInspectOff) {
    g.__piwiHoverInspectOff();
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  // The box carries a light hairline outside its ring and a dark one outside
  // that, so its edge survives white, black and busy backgrounds alike.
  style.textContent = `
    ${LOCATOR_SYNTAX_CSS}
    .box {
      position: fixed; pointer-events: none; box-sizing: border-box; display: none;
      border: 2px solid #a855f7; background: rgba(168,85,247,.14); border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 0 3px rgba(59,7,100,.55), inset 0 0 0 1px rgba(255,255,255,.5);
    }
    .tip {
      position: fixed; pointer-events: none; background: #0b1120; color: #f9fafb; font-size: 12.5px; line-height: 1.5;
      padding: 5px 9px; border-radius: 7px; border: 1px solid #7c3aed; box-shadow: 0 4px 18px rgba(0,0,0,.5);
      display: none; max-width: 60vw;
    }
  `;
  const box = document.createElement('div');
  box.className = 'box';
  const tip = document.createElement('div');
  // Dark in both color schemes: the chip floats over an unknown page, so it
  // keeps its own high-contrast backing and the token palette to match.
  tip.className = 'tip piwi-loc piwi-loc-dark';
  root.append(style, box, tip);

  let lastEl: Element | null = null;
  const onMove = (e: MouseEvent) => {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || host.contains(target)) return;
    if (target === lastEl) {
      position(target, e);
      return;
    }
    lastEl = target;
    const attrs = probeElementAttrs(target as any, PROBE_ARG);
    const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
    const ranked = generateAlternatives({ ...attrs, accessibleName });
    if (ranked.length === 0) {
      box.style.display = 'none';
      tip.style.display = 'none';
      return;
    }
    const tag = target.tagName.toLowerCase();
    tip.innerHTML = `<span style="color:#c4b5fd">&lt;${tag}&gt;</span> ${highlightLocator(ranked[0]!.locator)}`;
    tip.style.display = 'block';
    box.style.display = 'block';
    position(target, e);
  };
  // Pin the tip above the element, flipping below when the top edge is too
  // close to the viewport, and keep the whole chip inside the horizontal bounds.
  const position = (target: Element, e: MouseEvent) => {
    const r = target.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    const tipRect = tip.getBoundingClientRect();
    const top = r.top - tipRect.height - 6 < 4 ? r.bottom + 6 : r.top - tipRect.height - 6;
    const left = Math.max(6, Math.min(e.clientX, window.innerWidth - tipRect.width - 6));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') off();
  };

  let toolEpoch = 0;
  const off = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    delete g.__piwiHoverInspectOff;
    endTool(toolEpoch);
  };
  g.__piwiHoverInspectOff = off;
  toolEpoch = startTool('hover-inspect', off);
  installEscapeToCancel();
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('keydown', onKey, true);
}

toggleHoverInspect();
