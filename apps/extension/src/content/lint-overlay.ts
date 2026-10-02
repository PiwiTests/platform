import { formatNumber, initI18n, t, tn, uiLanguage } from '../shared/i18n.js';
import { startTool, endTool, installEscapeToCancel, toolIsCurrent } from '../shared/tool-session.js';
import { scanForLintIssues, type LintFinding, type LintScan } from './lint-scan.js';
import { attachPanelShadow } from './panel-root.js';
import { copyWithFeedback } from '../shared/clipboard.js';

const HOST_ID = 'piwi-lint-overlay-host';

function markdownChecklist(findings: LintFinding[]): string {
  const lines = findings.map((f) => {
    const name = f.accessibleName ? ` "${f.accessibleName}"` : '';
    return `- [ ] \`${f.element.tagName.toLowerCase()}\` (role: ${f.role}${name}) — add \`data-testid="${f.suggestedTestId}"\``;
  });
  return lines.join('\n');
}

/**
 * One-keystroke (from the popup) audit overlay: outlines every
 * interactive element that would score badly as a locator target right now,
 * with a suggested `data-testid` per element and a Markdown checklist export.
 * The panel opens at once and fills in when the scan, which works in slices,
 * is done. A second trigger toggles it back off, same pattern as the
 * Playwright view.
 */
function toggleLintOverlay(): void {
  const g = globalThis as any;
  if (g.__piwiLintOverlayOff) {
    g.__piwiLintOverlayOff();
    return;
  }
  // The page is claimed before it is scanned and drawn on: the tool this
  // replaces takes its surfaces with it here. `off` is set below, before
  // anything can call this teardown.
  const toolEpoch = startTool('lint-overlay', () => off());
  installEscapeToCancel();
  let closed = false;
  delete g.__piwiLintFindings;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);
  const root = attachPanelShadow(host, { mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .box {
      position: fixed; pointer-events: none; box-sizing: border-box; border: 2px dashed #ef4444;
      background: rgba(239,68,68,.14); border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 0 0 3px rgba(69,10,10,.5);
    }
    .panel {
      position: fixed; top: 12px; right: 12px; pointer-events: auto; width: min(360px, 88vw);
      max-height: 82vh; overflow: auto; background: #111827; color: #f9fafb; border-radius: 12px;
      padding: 14px; box-shadow: 0 8px 40px rgba(0,0,0,.5); font: 13px ui-sans-serif, system-ui, -apple-system, sans-serif;
    }
    @media (prefers-color-scheme: light) {
      .panel { background: #ffffff; color: #111827; box-shadow: 0 8px 40px rgba(0,0,0,.2); }
    }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .title { font-weight: 600; font-size: 13.5px; min-width: 0; overflow-wrap: anywhere; hyphens: auto; }
    .close {
      background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 17px;
      line-height: 1; padding: 2px 7px; border-radius: 6px;
    }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .empty, .notice { color: #9ca3af; font-size: 12.5px; overflow-wrap: anywhere; hyphens: auto; }
    .notice { margin-bottom: 8px; }
    .export {
      display: block; width: 100%; margin-bottom: 10px; padding: 6px 10px; border-radius: 6px;
      border: 1px solid #f87171; background: rgba(248,113,113,.12); color: inherit; font: inherit;
      font-size: 12px; cursor: pointer;
    }
    .export:hover, .export:focus-visible { background: rgba(248,113,113,.22); }
    .row { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 7px 9px; margin-bottom: 7px; font-size: 12px; }
    .row .tag { color: #f87171; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .row .name { color: #9ca3af; overflow-wrap: anywhere; }
    .row code {
      display: block; margin-top: 5px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      word-break: break-all; cursor: pointer; border: 1px dashed rgba(128,128,128,.4); border-radius: 5px; padding: 3px 6px;
    }
    @media (prefers-color-scheme: light) {
      .empty, .notice, .row .name { color: #6b7280; }
      .row .tag { color: #b91c1c; }
    }
  `;
  root.appendChild(style);

  // The boxes sit under the panel.
  const layer = document.createElement('div');
  root.appendChild(layer);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.lang = uiLanguage();
  panel.setAttribute('aria-label', t('lint_dialog'));

  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t('lint_checking');
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', t('lint_close'));
  closeBtn.textContent = '×';
  header.append(title, closeBtn);
  panel.appendChild(header);
  root.appendChild(panel);

  let findings: LintFinding[] = [];

  const showFindings = (scan: LintScan) => {
    title.textContent = findings.length === 0 ? t('lint_none') : tn('lint_found', findings.length);
    if (scan.checked < scan.interactive) {
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.textContent = t('lint_truncated', {
        checked: formatNumber(scan.checked),
        total: formatNumber(scan.interactive),
      });
      panel.appendChild(notice);
    }

    if (findings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = t('lint_allGood');
      panel.appendChild(empty);
      return;
    }
    const exportBtn = document.createElement('button');
    exportBtn.className = 'export';
    exportBtn.type = 'button';
    exportBtn.textContent = t('lint_copyChecklist');
    exportBtn.addEventListener('click', () => void copyWithFeedback(markdownChecklist(findings), exportBtn));
    panel.appendChild(exportBtn);

    for (const f of findings) {
      const row = document.createElement('div');
      row.className = 'row';
      const head = document.createElement('div');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `<${f.element.tagName.toLowerCase()}>`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = f.accessibleName
        ? t('lint_roleNamed', { role: f.role, name: f.accessibleName })
        : t('lint_role', { role: f.role });
      head.append(tag, ' ', name);
      const attribute = `data-testid="${f.suggestedTestId}"`;
      const code = document.createElement('code');
      code.textContent = attribute;
      code.title = t('common_clickToCopy');
      code.addEventListener('click', () => void copyWithFeedback(attribute, code));
      row.append(head, code);
      panel.appendChild(row);
    }
  };

  const boxes: HTMLDivElement[] = [];
  /** Every element's box is read before any outline moves, so the page lays out once per draw. */
  const drawBoxes = () => {
    const rects = findings.map((f) => f.element.getBoundingClientRect());
    while (boxes.length < rects.length) {
      const box = document.createElement('div');
      box.className = 'box';
      layer.appendChild(box);
      boxes.push(box);
    }
    rects.forEach((r, i) => {
      boxes[i]!.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
    });
  };
  let frame = 0;
  const reposition = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawBoxes();
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      off();
    }
  };

  const off = () => {
    closed = true;
    cancelAnimationFrame(frame);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition, true);
    host.remove();
    delete g.__piwiLintOverlayOff;
    endTool(toolEpoch);
  };
  g.__piwiLintOverlayOff = off;
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition, true);
  closeBtn.addEventListener('click', off);

  void scanForLintIssues({ keepGoing: () => !closed && toolIsCurrent(toolEpoch) }).then((scan) => {
    if (!scan || closed || !toolIsCurrent(toolEpoch)) return;
    findings = scan.findings;
    // Exposed for lint-scan.spec.ts: scanForLintIssues calls @piwitests/core's
    // generateAlternatives, which has its own private module-level helpers
    // that Function.prototype.toString() reconstruction (the trick
    // derivePattern's own tests use) can't carry along —
    // real bundling is the only way to exercise it correctly, so results are
    // bridged out here the same way picker state is bridged through other
    // well-known globals elsewhere in this extension.
    g.__piwiLintFindings = findings.map((f) => ({
      tag: f.element.tagName.toLowerCase(),
      role: f.role,
      accessibleName: f.accessibleName,
      suggestedTestId: f.suggestedTestId,
      bestScore: f.bestScore,
    }));
    showFindings(scan);
    drawBoxes();
  });
}

void initI18n().then(toggleLintOverlay);
