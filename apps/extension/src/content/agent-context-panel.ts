import { initI18n, t, uiLanguage } from '../shared/i18n.js';
import { startTool, endTool, installEscapeToCancel, teardownToolSurfaces } from '../shared/tool-session.js';
import { installPickerOverlay, removePickerOverlay, type PickerOverlayArg } from '@piwitests/picker-dom';
import { buildAgentContext } from './agent-context.js';

const HOST_ID = 'piwi-agent-context-host';

const PICK_GLOBALS = ['__piwiPickState', '__piwiPickedElement'] as const;

function clearPickGlobals(): void {
  for (const key of PICK_GLOBALS) delete (globalThis as any)[key];
}

/** Poll for a global the picker overlay sets, mirroring `pick.ts`'s own helper. */
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

function renderContextPanel(context: string): Promise<void> {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  // Exposed for agent-context.spec.ts: buildAgentContext calls
  // @piwitests/core's generateAlternatives, which has its own private
  // module-level helpers Function.prototype.toString() reconstruction can't
  // carry along — real bundling is the only way to exercise it correctly,
  // same as lint-overlay.ts/assertion-panel.ts.
  (globalThis as any).__piwiAgentContext = context;

  const style = document.createElement('style');
  style.textContent = `
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
    .sub { color: #9ca3af; font-size: 12px; overflow-wrap: anywhere; hyphens: auto; }
    @media (prefers-color-scheme: light) {
      .sub { color: #6b7280; }
    }
    .close {
      background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px;
      line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    pre {
      background: rgba(128,128,128,.1); border: 1px solid rgba(128,128,128,.3); border-radius: 8px;
      padding: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
      white-space: pre-wrap; word-break: break-word; max-height: 50vh; overflow: auto; margin: 0 0 10px 0;
    }
    button.copy {
      background: #7c3aed; color: #fff; border: 1px solid #7c3aed; border-radius: 6px;
      padding: 7px 14px; font: inherit; font-size: 12.5px; cursor: pointer;
    }
    button.copy:hover, button.copy:focus-visible { background: #6d28d9; }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.lang = uiLanguage();
  panel.setAttribute('aria-label', t('agent_title'));
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t('agent_title');
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${t('agent_hint')} · ${t('common_escToClose')}`;
  titleWrap.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', t('common_close'));
  closeBtn.textContent = '×';
  header.append(titleWrap, closeBtn);
  panel.appendChild(header);

  const pre = document.createElement('pre');
  // The block is written for a coding agent, in English, whatever the interface language.
  pre.lang = 'en';
  pre.textContent = context;
  panel.appendChild(pre);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy';
  copyBtn.type = 'button';
  copyBtn.textContent = t('common_copy');
  copyBtn.addEventListener('click', () => void copyToClipboard(context, copyBtn));
  panel.appendChild(copyBtn);

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

    backdrop.appendChild(panel);
    root.appendChild(backdrop);
    panel.focus();
  });
}

/**
 * Runs the copy-context-for-agent flow (E1, standalone portion): pick a
 * single element, then show one paste-able block (page URL, element
 * summary, ranked locators) with a single copy button. Reuses pick.ts's
 * single-pick mechanism (sharing its `__piwiPicking` guard) but skips the
 * anchors step, same reasoning as `assertion-panel.ts`/`session-panel.ts`.
 */
async function runAgentContextPanel(): Promise<void> {
  const g = globalThis as any;
  if (g.__piwiPicking) return;
  g.__piwiPicking = true;
  const toolEpoch = startTool('agent-context-panel', teardownToolSurfaces);
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
    const context = buildAgentContext(el, location.href);
    await i18nReady;
    await renderContextPanel(context);
  } finally {
    clearPickGlobals();
    g.__piwiPicking = false;
    endTool(toolEpoch);
  }
}

void runAgentContextPanel();
