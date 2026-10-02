/** An ancestor the human blessed as an anchor, with its in-page uniqueness counts. */
export interface PickedAnchorInfo {
  tag: string;
  /** Hops from the picked element (1 = direct parent). */
  depth: number;
  testId: string | null;
  id: string | null;
  ariaLabel: string | null;
  /** Resolved anchor role (explicit attribute or tag-implied). */
  role: string | null;
  /** Document-wide match count for the anchor's own data-testid. */
  testIdCount?: number;
  /** Document-wide match count for the anchor's own id. */
  idCount?: number;
  /** Document-wide count of same-role elements carrying the same aria-label. */
  labeledRoleCount?: number;
  /** Document-wide count of elements resolving to the anchor's role. */
  roleCount?: number;
  /** Leaf matches (picked element's identity) within this anchor's subtree. */
  scopedLeafCount?: number;
}

/** The picked element's identity used for anchor-scoped candidates. */
export interface PickedLeafInfo {
  role: string | null;
  level: number | null;
}

/** Arguments for `showAnchorPicker` — the role maps mirror the single source of truth in `@piwitests/core`. */
export interface AnchorPickerArg {
  tagRoles: Record<string, string>;
  inputRoles: Record<string, string>;
  roleSources: string;
  leafRole: string;
  leafLevel: number | null;
  leafTestId: string | null;
}

/**
 * Runs inside the browser via `evaluate()` — the anchor step: lists the picked
 * element's ancestors so the human can bless one or more stable parents to
 * scope the locator to. Each row shows the ancestor's strongest hook and how
 * many leaf matches it contains; the footer shows a live "matches N" count for
 * the combined selection, recomputed against the real page on every toggle
 * (exactly 1 = green). Hovering a row outlines that ancestor in the page and
 * names it in a chip pinned to it. Resolves through `__piwiAnchorState` ('done' | 'skipped'); selected anchors
 * land in `__piwiPickAnchors` (+ `__piwiPickChainCount`). While the step
 * shows, `__piwiAnchorCleanup` holds its teardown (see `removeAnchorPicker`).
 * Role resolution reuses the maps passed in `arg` (single source of truth in
 * `@piwitests/core`). Must stay fully self-contained.
 */
export function showAnchorPicker(arg: AnchorPickerArg): void {
  const g = globalThis as any;
  const doc = g.document;
  const el = g.__piwiPickedElement;
  if (!doc || !doc.body || !el) {
    g.__piwiAnchorState = 'skipped';
    return;
  }
  const Z = 2147483600;
  const { tagRoles, inputRoles, roleSources, leafRole, leafLevel, leafTestId } = arg;

  const roleOf = (n: any): string | null => {
    const explicit = n.getAttribute && n.getAttribute('role');
    if (explicit) return explicit;
    const tag = (n.tagName || '').toLowerCase();
    if (tag === 'input') return inputRoles[(n.getAttribute('type') || 'text').toLowerCase()] ?? 'textbox';
    if (tag === 'select') return n.getAttribute('multiple') != null ? 'listbox' : 'combobox';
    if (tag === 'a') return n.getAttribute('href') != null ? 'link' : null;
    return tagRoles[tag] ?? null;
  };
  const levelOf = (n: any): number | null => {
    const m = /^h([1-6])$/.exec((n.tagName || '').toLowerCase());
    if (m) return Number(m[1]);
    const al = n.getAttribute && n.getAttribute('aria-level');
    return al && /^\d+$/.test(al) ? Number(al) : null;
  };

  // Leaf matches inside a scope: same data-testid when the element has one,
  // otherwise same resolved role (level-scoped for headings).
  const leafMatches = (scope: any): number => {
    try {
      if (leafTestId) return scope.querySelectorAll(`[data-testid=${JSON.stringify(leafTestId)}]`).length;
      const nodes = scope.querySelectorAll(roleSources);
      if (nodes.length > 2000) return -1;
      let matched = 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (roleOf(n) !== leafRole) continue;
        if (leafLevel != null && levelOf(n) !== leafLevel) continue;
        matched++;
      }
      return matched;
    } catch {
      return -1;
    }
  };

  // Document-wide role nodes, computed once for anchor uniqueness counts.
  let roleNodes: any[] = [];
  try {
    const all = doc.querySelectorAll(roleSources);
    if (all.length <= 4000) roleNodes = Array.from(all);
  } catch {
    roleNodes = [];
  }
  const count = (sel: string): number | undefined => {
    try {
      return doc.querySelectorAll(sel).length;
    } catch {
      return undefined;
    }
  };

  // Ancestor rows, nearest parent first, up to (not including) body.
  interface Row {
    node: any;
    info: any;
    hookLabel: string;
    selectable: boolean;
  }
  const rows: Row[] = [];
  let node = el.parentElement;
  let depth = 0;
  while (node && depth < 12) {
    depth++;
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'body' || tag === 'html') break;
    const testId = node.getAttribute('data-testid');
    const id = node.getAttribute('id');
    const ariaLabel = node.getAttribute('aria-label');
    const role = roleOf(node);
    const info: any = { tag, depth, testId: testId || null, id: id || null, ariaLabel: ariaLabel || null, role };
    if (testId) info.testIdCount = count(`[data-testid=${JSON.stringify(testId)}]`);
    if (id) {
      try {
        info.idCount = count(`#${doc.defaultView.CSS.escape(id)}`);
      } catch {
        // Keep idCount undefined — the Node side treats it as non-unique.
      }
    }
    if (role) {
      let roleCount = 0;
      let labeledCount = 0;
      for (const n of roleNodes) {
        if (roleOf(n) !== role) continue;
        roleCount++;
        if (ariaLabel && n.getAttribute && n.getAttribute('aria-label') === ariaLabel) labeledCount++;
      }
      info.roleCount = roleCount;
      if (ariaLabel) info.labeledRoleCount = labeledCount;
    }
    info.scopedLeafCount = leafMatches(node);

    const hookLabel = testId
      ? `data-testid="${testId}"`
      : id
        ? `#${id}`
        : ariaLabel && role
          ? `${role} "${ariaLabel}"`
          : role
            ? `role ${role}`
            : 'no stable hook';
    rows.push({
      node,
      info,
      hookLabel,
      selectable: !!(testId || id || (role && (ariaLabel || info.roleCount === 1))),
    });
    node = node.parentElement;
  }

  if (rows.length === 0) {
    g.__piwiAnchorState = 'skipped';
    return;
  }

  const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  // A light hairline outside each ring and a dark one outside that, so both
  // outlines keep their edge over white, black and busy backgrounds alike.
  const outline = doc.createElement('div');
  outline.style.cssText =
    `position:fixed;pointer-events:none;z-index:${Z};box-sizing:border-box;` +
    'border:2px solid #22c55e;background:rgba(34,197,94,.10);border-radius:4px;display:none;' +
    'box-shadow:0 0 0 1px rgba(255,255,255,.9),0 0 0 3px rgba(5,46,22,.5);';
  // Names the ancestor the hovered row would scope to, pinned to that ancestor.
  const outlineLabel = doc.createElement('div');
  outlineLabel.style.cssText =
    `position:fixed;pointer-events:none;z-index:${Z + 1};display:none;box-sizing:border-box;` +
    'max-width:min(420px,90vw);background:#0b1120;color:#f9fafb;border:1px solid #22c55e;' +
    `border-radius:6px;padding:3px 7px;font:12px/1.45 ${MONO};white-space:nowrap;` +
    'overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 18px rgba(0,0,0,.5);';
  const pickedOutline = doc.createElement('div');
  const pr = el.getBoundingClientRect();
  pickedOutline.style.cssText =
    `position:fixed;pointer-events:none;z-index:${Z};box-sizing:border-box;` +
    'border:2px solid #a855f7;background:rgba(168,85,247,.14);border-radius:4px;' +
    'box-shadow:0 0 0 1px rgba(255,255,255,.9),0 0 0 3px rgba(59,7,100,.55);' +
    `left:${pr.left}px;top:${pr.top}px;width:${pr.width}px;height:${pr.height}px;`;
  const panel = doc.createElement('div');
  panel.style.cssText =
    `position:fixed;top:12px;right:12px;z-index:${Z + 3};width:340px;max-height:82vh;overflow:auto;` +
    'background:#111827;color:#f9fafb;border-radius:10px;padding:16px;' +
    'font:12px/1.5 system-ui,sans-serif;box-shadow:0 8px 40px rgba(0,0,0,.5);';
  const title = doc.createElement('div');
  title.style.cssText = 'font-weight:600;font-size:13px;margin-bottom:2px;';
  title.textContent = 'Scope to stable parents (optional)';
  const sub = doc.createElement('div');
  sub.style.cssText = 'color:#9ca3af;margin-bottom:10px;';
  sub.textContent = 'Pick one or more parents to anchor the locator to. Hover a row to see the parent.';
  panel.appendChild(title);
  panel.appendChild(sub);

  const selected = new Set<number>();
  const footer = doc.createElement('div');
  footer.style.cssText = 'margin:10px 0;font-weight:600;';

  // Segment priority mirrors the Node-side generator so the live count and the
  // emitted chain agree: testid > id > labeled role > bare role.
  const segMatches = (scope: any, info: any): any[] => {
    try {
      if (info.testId) return Array.from(scope.querySelectorAll(`[data-testid=${JSON.stringify(info.testId)}]`));
      if (info.id) return Array.from(scope.querySelectorAll(`#${doc.defaultView.CSS.escape(info.id)}`));
      const nodes = Array.from(scope.querySelectorAll(roleSources));
      if (nodes.length > 2000) return [];
      return nodes.filter(
        (n: any) =>
          roleOf(n) === info.role &&
          (!info.ariaLabel || (n.getAttribute && n.getAttribute('aria-label') === info.ariaLabel)),
      );
    } catch {
      return [];
    }
  };

  const chainCount = (): number => {
    const chosen = rows.filter((_, i) => selected.has(i)).sort((a, b) => b.info.depth - a.info.depth);
    if (chosen.length === 0) return -1;
    let scopes: any[] = [doc];
    for (const row of chosen) {
      const next: any[] = [];
      for (const s of scopes) next.push(...segMatches(s, row.info));
      scopes = next.slice(0, 200);
      if (scopes.length === 0) return 0;
    }
    let total = 0;
    for (const s of scopes) {
      const c = leafMatches(s);
      if (c > 0) total += c;
      if (total > 50) return total;
    }
    return total;
  };

  const refreshFooter = () => {
    if (selected.size === 0) {
      footer.textContent = 'No parents selected — standard alternatives only.';
      footer.style.color = '#9ca3af';
      g.__piwiPickChainCount = undefined;
      return;
    }
    const c = chainCount();
    g.__piwiPickChainCount = c;
    if (c === 1) {
      footer.textContent = '✓ Selection matches exactly 1 element';
      footer.style.color = '#4ade80';
    } else {
      footer.textContent = c < 0 ? 'Match count unavailable' : `✗ Selection matches ${c} elements`;
      footer.style.color = '#fbbf24';
    }
  };

  rows.forEach((row, i) => {
    const line = doc.createElement('label');
    line.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #374151;border-radius:6px;' +
      `margin-bottom:6px;cursor:${row.selectable ? 'pointer' : 'default'};opacity:${row.selectable ? '1' : '.45'};`;
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.disabled = !row.selectable;
    const text = doc.createElement('span');
    text.style.cssText = 'flex:1;min-width:0;';
    const code = doc.createElement('code');
    code.style.cssText = `display:block;font:12px ${MONO};color:#f3f4f6;word-break:break-all;`;
    code.textContent = `<${row.info.tag}> ${row.hookLabel}`;
    const hint = doc.createElement('span');
    hint.style.cssText = 'color:#9ca3af;';
    hint.textContent = row.selectable
      ? row.info.scopedLeafCount === 1
        ? 'contains exactly 1 matching element'
        : `contains ${row.info.scopedLeafCount ?? '?'} matching elements`
      : 'add a data-testid to make this usable';
    text.appendChild(code);
    text.appendChild(hint);
    line.appendChild(box);
    line.appendChild(text);
    line.addEventListener('mouseenter', () => {
      const r = row.node.getBoundingClientRect();
      outline.style.display = 'block';
      outline.style.left = r.left + 'px';
      outline.style.top = r.top + 'px';
      outline.style.width = r.width + 'px';
      outline.style.height = r.height + 'px';
      outlineLabel.textContent = `<${row.info.tag}> ${row.hookLabel}`;
      outlineLabel.style.display = 'block';
      const lr = outlineLabel.getBoundingClientRect();
      const vw = g.innerWidth || doc.documentElement.clientWidth || 0;
      const top = r.top - lr.height - 6 < 4 ? r.bottom + 6 : r.top - lr.height - 6;
      outlineLabel.style.left = Math.max(6, Math.min(r.left, vw - lr.width - 6)) + 'px';
      outlineLabel.style.top = top + 'px';
    });
    line.addEventListener('mouseleave', () => {
      outline.style.display = 'none';
      outlineLabel.style.display = 'none';
    });
    box.addEventListener('change', () => {
      if (box.checked) selected.add(i);
      else selected.delete(i);
      refreshFooter();
    });
    panel.appendChild(line);
  });

  panel.appendChild(footer);

  const cleanup = () => {
    doc.removeEventListener('keydown', onKey, true);
    panel.remove();
    outline.remove();
    outlineLabel.remove();
    pickedOutline.remove();
    if (g.__piwiAnchorCleanup === cleanup) delete g.__piwiAnchorCleanup;
  };
  const done = (state: 'done' | 'skipped') => {
    g.__piwiPickAnchors = state === 'done' ? rows.filter((_, i) => selected.has(i)).map((r) => r.info) : [];
    g.__piwiAnchorState = state;
    cleanup();
  };
  const onKey = (e: any) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    done('skipped');
  };

  const buttonRow = doc.createElement('div');
  buttonRow.style.cssText = 'display:flex;gap:8px;margin-top:4px;';
  const useBtn = doc.createElement('button');
  useBtn.style.cssText =
    'flex:1;background:#7c3aed;color:#fff;border:none;border-radius:6px;padding:8px;cursor:pointer;font:600 12px system-ui;';
  useBtn.textContent = 'Use selected parents';
  useBtn.addEventListener('click', (e: any) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    done(selected.size > 0 ? 'done' : 'skipped');
  });
  const skipBtn = doc.createElement('button');
  skipBtn.style.cssText =
    'background:none;border:1px solid #374151;color:#9ca3af;border-radius:6px;padding:8px 10px;cursor:pointer;font:12px system-ui;';
  skipBtn.textContent = 'Skip (Esc)';
  skipBtn.addEventListener('click', (e: any) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    done('skipped');
  });
  buttonRow.appendChild(useBtn);
  buttonRow.appendChild(skipBtn);
  panel.appendChild(buttonRow);

  refreshFooter();
  g.__piwiAnchorCleanup = cleanup;
  doc.addEventListener('keydown', onKey, true);
  doc.body.appendChild(pickedOutline);
  doc.body.appendChild(outline);
  doc.body.appendChild(outlineLabel);
  doc.body.appendChild(panel);
}

/**
 * Tears down the anchors step, if one is showing: its panel, outlines and key
 * listener. It leaves `__piwiAnchorState` unset: a caller still waiting on it
 * answers it, or stops waiting. Safe to call more than once.
 */
export function removeAnchorPicker(): void {
  const g = globalThis as any;
  const cleanup = g.__piwiAnchorCleanup;
  if (typeof cleanup === 'function') cleanup();
  delete g.__piwiAnchorCleanup;
}
