import { initI18n, t, tn, tNodes, uiLanguage } from '../shared/i18n.js';
import { startTool, endTool, installEscapeToCancel, teardownToolSurfaces } from '../shared/tool-session.js';
import {
  installPickerOverlay,
  removePickerOverlay,
  highlightLocator,
  LOCATOR_SYNTAX_CSS,
  type PickerOverlayArg,
} from '@piwitests/picker-dom';
import { suggestAssertions, type AssertionSuggestion } from './assertion-suggest.js';
import { attachPanelShadow } from './panel-root.js';

const HOST_ID = 'piwi-assertion-panel-host';

const PICK_GLOBALS = ['__piwiPickState', '__piwiPickedElement'] as const;

function clearPickGlobals(): void {
  for (const key of PICK_GLOBALS) delete (globalThis as any)[key];
}

/** Poll for a global the picker overlay sets, mirroring `pick.ts`'s own helper — the assertion suggester only ever needs the element-pick step, never the anchors step (it suggests assertions against the top-ranked locator, not a refined one). */
function waitForGlobal<T>(key: string): Promise<T> {
  return new Promise((resolve) => {
    const check = () => {
      const value = (globalThis as any)[key];
      if (value !== undefined) {
        resolve(value as T);
        return;
      }
      setTimeout(check, 120);
    };
    check();
  });
}

async function copyToClipboard(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const original = btn.textContent;
  btn.textContent = t('common_copied');
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

async function renderAssertionPanel(suggestion: AssertionSuggestion): Promise<void> {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = attachPanelShadow(host, { mode: 'closed' });

  // Exposed for assertion-suggest.spec.ts: suggestAssertions calls
  // @piwitests/core's generateAlternatives, which has its own private
  // module-level helpers that Function.prototype.toString() reconstruction
  // can't carry along — real bundling is the only way to exercise it
  // correctly, so the result is bridged out here the same way lint findings
  // are bridged out of lint-overlay.ts.
  (globalThis as any).__piwiAssertionSuggestion = suggestion;

  const style = document.createElement('style');
  style.textContent = `
    ${LOCATOR_SYNTAX_CSS}
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,.35);
      display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh;
    }
    .panel {
      background: #111827; color: #f9fafb; border-radius: 12px; padding: 16px;
      width: min(640px, 92vw); max-height: 78vh; overflow: auto;
      box-shadow: 0 8px 40px rgba(0,0,0,.5); font-size: 13px; line-height: 1.5;
    }
    @media (prefers-color-scheme: light) {
      .panel { background: #ffffff; color: #111827; box-shadow: 0 8px 40px rgba(0,0,0,.2); }
    }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .header > div { min-width: 0; }
    .title { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; hyphens: auto; }
    .sub { color: #9ca3af; font-size: 12px; overflow-wrap: anywhere; }
    .close {
      background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px;
      line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .empty { color: #9ca3af; font-size: 12.5px; overflow-wrap: anywhere; }
    .row { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
    .row-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .method { color: #c4b5fd; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
    .detail { color: #9ca3af; font-size: 11.5px; margin-bottom: 6px; word-break: break-word; }
    .row code { display: block; font-size: 13px; line-height: 1.55; margin-bottom: 6px; }
    button.copy {
      background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
      border-radius: 6px; padding: 4px 9px; font-size: 11.5px; cursor: pointer; flex-shrink: 0;
    }
    button.copy:hover, button.copy:focus-visible { background: rgba(128,128,128,.25); }
    @media (prefers-color-scheme: light) {
      .sub, .empty, .detail { color: #6b7280; }
      .method { color: #6d28d9; }
    }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.lang = uiLanguage();
  panel.setAttribute('aria-label', t('assert_dialog'));
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent =
    suggestion.candidates.length === 0 ? t('assert_none') : tn('assert_count', suggestion.candidates.length);
  const sub = document.createElement('div');
  sub.className = 'sub';
  if (suggestion.locator) {
    const locator = document.createElement('span');
    locator.className = 'piwi-loc';
    locator.innerHTML = highlightLocator(suggestion.locator);
    sub.append(...tNodes('assert_locator', { locator }));
  }
  titleWrap.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', t('common_close'));
  closeBtn.textContent = '×';
  header.append(titleWrap, closeBtn);
  panel.appendChild(header);

  if (suggestion.candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('assert_noLocator');
    panel.appendChild(empty);
  }

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    closeBtn.addEventListener('click', finish);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish();
    });

    for (const candidate of suggestion.candidates) {
      const row = document.createElement('div');
      row.className = 'row';
      const top = document.createElement('div');
      top.className = 'row-top';
      const method = document.createElement('span');
      method.className = 'method';
      method.textContent = candidate.method;
      const btn = document.createElement('button');
      btn.className = 'copy';
      btn.type = 'button';
      btn.textContent = t('common_copy');
      btn.addEventListener('click', () => void copyToClipboard(candidate.expectLine, btn));
      top.append(method, btn);
      row.appendChild(top);

      if (candidate.detail != null) {
        const detail = document.createElement('div');
        detail.className = 'detail';
        detail.textContent = candidate.detail;
        row.appendChild(detail);
      }

      const code = document.createElement('code');
      code.className = 'piwi-loc';
      code.innerHTML = highlightLocator(candidate.expectLine);
      row.appendChild(code);

      panel.appendChild(row);
    }

    backdrop.appendChild(panel);
    root.appendChild(backdrop);
    panel.focus();
  });
}

/**
 * Runs the assertion-suggester flow: pick a single element or region,
 * then suggest ranked `expect(...)` candidates against its top-ranked
 * locator. Reuses the same single-pick mechanism as `pick.ts` (sharing its
 * `__piwiPicking` re-entrancy guard, since both drive the same underlying
 * overlay) but skips the anchors step — this is about assertions, not
 * refining the locator itself.
 */
async function runAssertionSuggester(): Promise<void> {
  const g = globalThis as any;
  if (g.__piwiPicking) return;
  g.__piwiPicking = true;
  const toolEpoch = startTool('assertion-panel', teardownToolSurfaces);
  installEscapeToCancel();
  const i18nReady = initI18n();
  try {
    clearPickGlobals();
    const overlayArg: PickerOverlayArg = { transport: 'global', failing: null };
    installPickerOverlay(overlayArg);
    const state = await waitForGlobal<string>('__piwiPickState');
    if (state !== 'picked') return;
    // Done with the picking overlay — otherwise it stays up behind this
    // tool's own panel, still reading "Analyzing element…".
    removePickerOverlay();

    const el = g.__piwiPickedElement as Element;
    const suggestion = suggestAssertions(el);
    await i18nReady;
    await renderAssertionPanel(suggestion);
  } finally {
    clearPickGlobals();
    g.__piwiPicking = false;
    endTool(toolEpoch);
  }
}

void runAssertionSuggester();
