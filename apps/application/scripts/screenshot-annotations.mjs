/**
 * In-page annotation overlay for the feature-screenshot harness.
 *
 * Draws boxes, arrows, numbered steps, callouts, spotlights and redactions on
 * top of a live page, positioned from `getBoundingClientRect()` so a target is
 * named by selector rather than by coordinates. The overlay is a single layer
 * appended inside the element being captured, with every coordinate relative to
 * that element, and `clearAnnotations()` removes it — so a scene can take an
 * annotated and a clean shot in the same visit.
 *
 * No runtime dependency and no CDN: the browser half below runs through
 * `page.evaluate`.
 *
 * Annotation shapes (`target`/`from`/`to` are CSS selectors, or `{x, y}` points
 * in viewport coordinates):
 *   { type: 'box',       target, label?, pad? }
 *   { type: 'arrow',     from, to, label?, curve? }
 *   { type: 'step',      target, n, corner? }        corner: tl|tr|bl|br
 *   { type: 'callout',   target, text, side? }       side: right|left|top|bottom
 *   { type: 'spotlight', target, pad?, opacity? }
 *   { type: 'redact',    target, label? }
 */

/**
 * Annotation accent. Deliberately outside the product palette — the dashboard
 * is full of greens, reds and ambers that carry meaning, so an annotation drawn
 * in any of them reads as UI rather than as commentary. Magenta appears nowhere
 * in the app and holds up on both the light and dark docs themes.
 */
export const ACCENT = '#d4145a';
export const ACCENT_TEXT = '#ffffff';

/** Runs in the page. Self-contained — it closes over nothing, so page.evaluate can serialize it. */
function installOverlay({ shapes, accent, accentText, container }) {
  const NS = 'http://www.w3.org/2000/svg';
  const LAYER_ID = '__piwi_shot_overlay';

  document.getElementById(LAYER_ID)?.remove();

  // The overlay lives inside the element being captured, with every coordinate
  // relative to it. Element screenshots scroll their target into view, and this
  // dashboard scrolls inside a panel rather than moving the document — an
  // overlay pinned to the viewport or to the document would slide out of
  // register with the content underneath it.
  const host = (container && document.querySelector(container)) || document.body;
  if (getComputedStyle(host).position === 'static') {
    host.dataset.piwiShotPositioned = host.style.position || '';
    host.style.position = 'relative';
  }
  const base = host.getBoundingClientRect();
  const docWidth = Math.max(host.scrollWidth, host.clientWidth);
  const docHeight = Math.max(host.scrollHeight, host.clientHeight);

  const layer = document.createElement('div');
  layer.id = LAYER_ID;
  layer.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    `width:${docWidth}px`,
    `height:${docHeight}px`,
    'pointer-events:none',
    'z-index:2147483647',
  ].join(';');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(docWidth));
  svg.setAttribute('height', String(docHeight));
  svg.style.cssText = 'position:absolute;top:0;left:0;overflow:visible';
  layer.appendChild(svg);

  // HTML labels rather than SVG <text>: subpixel-antialiased text stays crisp
  // at the scales these images are shown at, and wrapping comes for free.
  const labels = document.createElement('div');
  labels.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%';
  layer.appendChild(labels);

  // In the document before anything is drawn: label placement reads
  // offsetWidth/offsetHeight, which are 0 while the layer is detached.
  host.appendChild(layer);

  const defs = document.createElementNS(NS, 'defs');
  const marker = document.createElementNS(NS, 'marker');
  marker.setAttribute('id', '__piwi_arrowhead');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const head = document.createElementNS(NS, 'path');
  head.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  head.setAttribute('fill', accent);
  marker.appendChild(head);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const offsetX = -base.left + host.scrollLeft;
  const offsetY = -base.top + host.scrollTop;
  const missing = [];

  /** Host-relative rect for a selector, or null when it resolves to nothing. */
  function rectOf(selector) {
    const el = document.querySelector(selector);
    if (!el) {
      missing.push(selector);
      return null;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      missing.push(selector);
      return null;
    }
    return { x: r.left + offsetX, y: r.top + offsetY, width: r.width, height: r.height };
  }

  /** A target is either a selector or a viewport point; both become host-relative coordinates. */
  function pointOf(target) {
    if (target && typeof target === 'object') return { x: target.x + offsetX, y: target.y + offsetY };
    const r = rectOf(target);
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }

  function labelChip(text, style) {
    const chip = document.createElement('div');
    chip.textContent = text;
    chip.style.cssText = [
      'position:absolute',
      `background:${accent}`,
      `color:${accentText}`,
      'font:600 13px/1.35 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'padding:4px 9px',
      'border-radius:6px',
      'white-space:nowrap',
      'box-shadow:0 1px 3px rgba(0,0,0,.28)',
      style,
    ].join(';');
    labels.appendChild(chip);
    return chip;
  }

  // Spotlights dim the whole page, so they go down first and only once — two
  // stacked dimming layers would darken everything twice over.
  const spotlights = shapes.filter((s) => s.type === 'spotlight');
  if (spotlights.length > 0) {
    const holes = spotlights.map((s) => ({ shape: s, rect: rectOf(s.target) })).filter((h) => h.rect);
    if (holes.length > 0) {
      const maskId = '__piwi_spotlight_mask';
      const mask = svgEl('mask', { id: maskId });
      mask.appendChild(svgEl('rect', { x: 0, y: 0, width: docWidth, height: docHeight, fill: 'white' }));
      for (const { shape, rect } of holes) {
        const pad = shape.pad ?? 8;
        mask.appendChild(
          svgEl('rect', {
            x: rect.x - pad,
            y: rect.y - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            rx: 10,
            fill: 'black',
          }),
        );
      }
      defs.appendChild(mask);
      svg.appendChild(
        svgEl('rect', {
          x: 0,
          y: 0,
          width: docWidth,
          height: docHeight,
          fill: 'rgba(15,17,26,.62)',
          mask: `url(#${maskId})`,
        }),
      );
    }
  }

  for (const shape of shapes) {
    if (shape.type === 'spotlight') continue;

    if (shape.type === 'box' || shape.type === 'redact') {
      const rect = rectOf(shape.target);
      if (!rect) continue;
      const pad = shape.pad ?? (shape.type === 'box' ? 6 : 0);
      const box = {
        x: rect.x - pad,
        y: rect.y - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      };
      svg.appendChild(
        svgEl('rect', {
          ...box,
          rx: shape.type === 'redact' ? 4 : 8,
          fill: shape.type === 'redact' ? '#242938' : 'none',
          stroke: accent,
          'stroke-width': shape.type === 'redact' ? 1 : 2.5,
        }),
      );
      if (shape.label) {
        const chip = labelChip(shape.label, `left:${Math.max(0, box.x + 12)}px;top:0`);
        // Straddling the top edge, so the chip reads as a tag on the box and
        // covers only the box's own border rather than the content above it.
        chip.style.top = `${Math.max(0, box.y - chip.offsetHeight / 2)}px`;
      }
      continue;
    }

    if (shape.type === 'arrow') {
      const from = pointOf(shape.from);
      const to = pointOf(shape.to);
      if (!from || !to) continue;
      const fromRect = typeof shape.from === 'string' ? rectOf(shape.from) : null;
      const toRect = typeof shape.to === 'string' ? rectOf(shape.to) : null;
      // Start and end on the facing edges rather than the centers, so the line
      // never lies across the thing it points at.
      const start = fromRect ? edgePoint(fromRect, to) : from;
      const end = toRect ? edgePoint(toRect, from) : to;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const bend = shape.curve ?? 0.22;
      // Control point pushed perpendicular to the straight line, so the arrow
      // reads as a deliberate curve rather than a slightly crooked segment.
      const cx = (start.x + end.x) / 2 - dy * bend;
      const cy = (start.y + end.y) / 2 + dx * bend;
      svg.appendChild(
        svgEl('path', {
          d: `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`,
          fill: 'none',
          stroke: accent,
          'stroke-width': 2.5,
          'stroke-linecap': 'round',
          'marker-end': 'url(#__piwi_arrowhead)',
        }),
      );
      if (shape.label) {
        const chip = labelChip(shape.label, 'left:0;top:0');
        chip.style.left = `${cx - chip.offsetWidth / 2}px`;
        chip.style.top = `${cy - chip.offsetHeight / 2}px`;
      }
      continue;
    }

    if (shape.type === 'step') {
      const rect = rectOf(shape.target);
      if (!rect) continue;
      const r = 15;
      const corner = shape.corner ?? 'tl';
      // Sat just outside the corner rather than centered on it, so the badge
      // does not land on the first word of whatever it is numbering.
      const nudge = r * 0.55;
      const right = corner === 'tr' || corner === 'br';
      const bottom = corner === 'bl' || corner === 'br';
      const cx = (right ? rect.x + rect.width : rect.x) + (right ? nudge : -nudge);
      const cy = (bottom ? rect.y + rect.height : rect.y) + (bottom ? nudge : -nudge);
      svg.appendChild(svgEl('circle', { cx, cy, r, fill: accent, stroke: '#fff', 'stroke-width': 2 }));
      const badge = document.createElement('div');
      badge.textContent = String(shape.n);
      badge.style.cssText = [
        'position:absolute',
        `left:${cx - r}px`,
        `top:${cy - r}px`,
        `width:${r * 2}px`,
        `height:${r * 2}px`,
        'display:flex',
        'align-items:center',
        'justify-content:center',
        `color:${accentText}`,
        'font:700 15px/1 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      ].join(';');
      labels.appendChild(badge);
      continue;
    }

    if (shape.type === 'callout') {
      const rect = rectOf(shape.target);
      if (!rect) continue;
      const side = shape.side ?? 'right';
      const gap = 28;
      const bubble = document.createElement('div');
      bubble.textContent = shape.text;
      bubble.style.cssText = [
        'position:absolute',
        `background:${accent}`,
        `color:${accentText}`,
        'font:600 13px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
        'padding:7px 11px',
        'border-radius:8px',
        'max-width:230px',
        'box-shadow:0 2px 6px rgba(0,0,0,.3)',
        'left:0',
        'top:0',
      ].join(';');
      labels.appendChild(bubble);

      const anchor = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const bw = bubble.offsetWidth;
      const bh = bubble.offsetHeight;
      let bx = anchor.x;
      let by = anchor.y;
      if (side === 'right') {
        bx = rect.x + rect.width + gap;
        by = anchor.y - bh / 2;
      } else if (side === 'left') {
        bx = rect.x - gap - bw;
        by = anchor.y - bh / 2;
      } else if (side === 'top') {
        bx = anchor.x - bw / 2;
        by = rect.y - gap - bh;
      } else {
        bx = anchor.x - bw / 2;
        by = rect.y + rect.height + gap;
      }
      bx = Math.max(4, Math.min(bx, docWidth - bw - 4));
      by = Math.max(4, Math.min(by, docHeight - bh - 4));
      bubble.style.left = `${bx}px`;
      bubble.style.top = `${by}px`;

      const bubbleRect = { x: bx, y: by, width: bw, height: bh };
      const leaderStart = edgePoint(bubbleRect, anchor);
      const leaderEnd = edgePoint(rect, { x: bx + bw / 2, y: by + bh / 2 });
      svg.appendChild(
        svgEl('line', {
          x1: leaderStart.x,
          y1: leaderStart.y,
          x2: leaderEnd.x,
          y2: leaderEnd.y,
          stroke: accent,
          'stroke-width': 2,
          'stroke-linecap': 'round',
        }),
      );
      svg.appendChild(svgEl('circle', { cx: leaderEnd.x, cy: leaderEnd.y, r: 3.5, fill: accent }));
      continue;
    }

    missing.push(`unknown annotation type: ${shape.type}`);
  }

  /** Where the line from a rect's center toward `toward` crosses the rect's edge. */
  function edgePoint(rect, toward) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const scale = Math.min(
      dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx),
      dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy),
    );
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  return missing;
}

/**
 * Draw `shapes` over the current page. Throws when a target resolves to
 * nothing — a silently skipped annotation produces an image that looks
 * finished and points at nothing.
 */
export async function drawAnnotations(page, shapes, options = {}) {
  const missing = await page.evaluate(installOverlay, {
    shapes,
    accent: options.accent ?? ACCENT,
    accentText: ACCENT_TEXT,
    container: options.container ?? null,
  });
  if (missing.length > 0) {
    throw new Error(`annotation target(s) not found: ${[...new Set(missing)].join(', ')}`);
  }
}

/** Remove the overlay so the same page can also be captured clean. */
export async function clearAnnotations(page) {
  await page.evaluate(() => {
    document.getElementById('__piwi_shot_overlay')?.remove();
    for (const el of document.querySelectorAll('[data-piwi-shot-positioned]')) {
      el.style.position = el.dataset.piwiShotPositioned;
      delete el.dataset.piwiShotPositioned;
    }
  });
}
