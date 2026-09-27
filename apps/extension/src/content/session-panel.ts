import { initI18n, t, tn, uiLanguage } from '../shared/i18n.js';
import { startTool, endTool, installEscapeToCancel, teardownToolSurfaces } from '../shared/tool-session.js';
import {
  installPickerOverlay,
  removePickerOverlay,
  highlightLocator,
  LOCATOR_SYNTAX_CSS,
  type PickerOverlayArg,
} from '@piwitests/picker-dom';
import { deriveTopLocator } from './verified-locators.js';
import {
  getSessionPicks,
  addSessionPick,
  removeSessionPick,
  clearSessionPicks,
  type SessionPick,
} from '../shared/session-storage.js';
import { isValidPickName, renderFixture, renderMarkdown, renderJson } from '../shared/session-export.js';
import { ensureSessionAccess } from '../shared/session-access.js';

const HOST_ID = 'piwi-session-panel-host';
const NAME_HOST_ID = 'piwi-session-name-host';

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

/** Picks one element, skipping the anchors step — same reasoning as `assertion-panel.ts`. Returns null on Escape/skip. */
async function pickOne(): Promise<Element | null> {
  clearPickGlobals();
  const overlayArg: PickerOverlayArg = { transport: 'global', failing: null };
  installPickerOverlay(overlayArg);
  const state = await waitForGlobal<string>('__piwiPickState');
  const el = state === 'picked' ? ((globalThis as any).__piwiPickedElement as Element) : null;
  // A committed pick leaves the banner/highlight mounted, so every flow that
  // owns the element from here has to take them down — this one runs the
  // overlay repeatedly, so each cycle clears before the name prompt shows.
  removePickerOverlay();
  clearPickGlobals();
  return el;
}

/** A small bottom bar prompting for a name, validated live against JS-identifier rules and the session's existing names (a pick's name becomes a fixture class field, so it must be unique and syntactically valid). Escape cancels just this pick. */
function promptForName(existingNames: Set<string>): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = NAME_HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      .bar {
        position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); pointer-events: auto;
        display: flex; flex-direction: column; gap: 6px; background: #111827; color: #f9fafb;
        border-radius: 10px; padding: 10px 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4);
        font: 13px ui-sans-serif, system-ui, -apple-system, sans-serif; min-width: 280px; max-width: min(480px, 92vw);
      }
      @media (prefers-color-scheme: light) {
        .bar { background: #ffffff; color: #111827; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
      }
      .row { display: flex; gap: 6px; align-items: center; }
      input {
        flex: 1; font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4);
        background: rgba(128,128,128,.08); color: inherit; min-width: 0;
      }
      input:focus-visible { outline: 2px solid #7c3aed; outline-offset: 1px; }
      button {
        border-radius: 6px; padding: 5px 10px; font: inherit; font-size: 12.5px; cursor: pointer;
        border: 1px solid rgba(128,128,128,.3); background: rgba(128,128,128,.12); color: inherit; flex-shrink: 0;
      }
      button:hover, button:focus-visible { background: rgba(128,128,128,.25); }
      button.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
      .error { color: #f87171; font-size: 11.5px; min-height: 14px; overflow-wrap: anywhere; hyphens: auto; }
      @media (prefers-color-scheme: light) {
        .error { color: #b91c1c; }
      }
    `;
    root.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.lang = uiLanguage();
    const row = document.createElement('div');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('session_namePlaceholder');
    input.setAttribute('aria-label', t('session_nameLabel'));
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'primary';
    saveBtn.textContent = t('common_save');
    row.append(input, saveBtn);
    const error = document.createElement('div');
    error.className = 'error';
    bar.append(row, error);
    root.appendChild(bar);

    const finish = (name: string | null) => {
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve(name);
    };

    const trySave = () => {
      const name = input.value.trim();
      if (!name) {
        error.textContent = t('session_nameRequired');
        return;
      }
      if (!isValidPickName(name)) {
        error.textContent = t('session_nameInvalid');
        return;
      }
      if (existingNames.has(name)) {
        error.textContent = t('session_nameTaken', { name });
        return;
      }
      finish(name);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(null);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        trySave();
      }
    });
    saveBtn.addEventListener('click', trySave);
    input.focus();
  });
}

type PanelAction = { type: 'add' } | { type: 'remove'; name: string } | { type: 'clear' } | { type: 'close' };

/** Renders the session panel for one snapshot of `picks`; resolves once an action that changes what's picked (add/remove/clear) or closes the panel is taken. Export-button clicks are handled inline (copy + flash) and don't resolve — the panel stays open. */
function renderSessionPanelOnce(picks: SessionPick[]): Promise<PanelAction> {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

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
    .sub { color: #9ca3af; font-size: 12px; overflow-wrap: anywhere; hyphens: auto; }
    .close {
      background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px;
      line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .empty { color: #9ca3af; font-size: 12.5px; margin-bottom: 12px; overflow-wrap: anywhere; }
    .row { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
    .row-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .row-top > div { min-width: 0; }
    .name { font-weight: 600; overflow-wrap: anywhere; }
    .row code { font-size: 13px; line-height: 1.55; }
    .url { color: #9ca3af; font-size: 11px; margin-top: 4px; word-break: break-all; }
    button.remove {
      background: none; border: none; color: inherit; opacity: .6; cursor: pointer; font-size: 15px;
      line-height: 1; padding: 2px 6px; border-radius: 6px; flex-shrink: 0;
    }
    button.remove:hover, button.remove:focus-visible { opacity: 1; background: rgba(248,113,113,.2); }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; }
    button.action {
      background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
      border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer;
    }
    button.action:hover, button.action:focus-visible { background: rgba(128,128,128,.25); }
    button.action.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
    button.action.danger:hover, button.action.danger:focus-visible { background: rgba(248,113,113,.2); border-color: #f87171; }
    @media (prefers-color-scheme: light) {
      .sub, .empty, .url { color: #6b7280; }
    }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.lang = uiLanguage();
  panel.setAttribute('aria-label', t('session_dialog'));
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = picks.length === 0 ? t('session_none') : tn('session_count', picks.length);
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${t('common_escToClose')} · ${t('session_kept')}`;
  titleWrap.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', t('common_close'));
  closeBtn.textContent = '×';
  header.append(titleWrap, closeBtn);
  panel.appendChild(header);

  return new Promise<PanelAction>((resolve) => {
    let done = false;
    const finish = (action: PanelAction) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
      resolve(action);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish({ type: 'close' });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    closeBtn.addEventListener('click', () => finish({ type: 'close' }));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish({ type: 'close' });
    });

    if (picks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = t('session_intro');
      panel.appendChild(empty);
    } else {
      for (const pick of picks) {
        const row = document.createElement('div');
        row.className = 'row';
        const top = document.createElement('div');
        top.className = 'row-top';
        const nameWrap = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = pick.name;
        const code = document.createElement('code');
        code.className = 'piwi-loc';
        code.innerHTML = highlightLocator(pick.locator);
        nameWrap.append(name, code);
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove';
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', t('session_remove', { name: pick.name }));
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => finish({ type: 'remove', name: pick.name }));
        top.append(nameWrap, removeBtn);
        row.appendChild(top);
        const url = document.createElement('div');
        url.className = 'url';
        url.textContent = pick.pageUrl;
        row.appendChild(url);
        panel.appendChild(row);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'action primary';
    addBtn.textContent = t('session_add');
    addBtn.addEventListener('click', () => finish({ type: 'add' }));
    actions.appendChild(addBtn);

    if (picks.length > 0) {
      const exportSpecs: Array<{ label: string; render: () => string }> = [
        { label: t('session_copyPageObject'), render: () => renderFixture(picks) },
        { label: t('session_copyMarkdown'), render: () => renderMarkdown(picks) },
        { label: t('session_copyJson'), render: () => renderJson(picks) },
      ];
      for (const spec of exportSpecs) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action';
        btn.textContent = spec.label;
        btn.addEventListener('click', () => void copyToClipboard(spec.render(), btn));
        actions.appendChild(btn);
      }
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'action danger';
      clearBtn.textContent = t('session_clear');
      clearBtn.addEventListener('click', () => finish({ type: 'clear' }));
      actions.appendChild(clearBtn);
    }
    panel.appendChild(actions);

    backdrop.appendChild(panel);
    root.appendChild(backdrop);
    panel.focus();
  });
}

/**
 * Runs the named pick-session flow (C3/C7): view the running session, add a
 * named pick (skipping the anchors step, same as `assertion-panel.ts`),
 * remove one, or export as a Playwright fixture class, Markdown table, or
 * JSON. Backed by `chrome.storage.session` so the list survives the popup
 * closing and reopening across pages — see `shared/session-storage.ts`.
 */
async function runSessionPanel(): Promise<void> {
  const g = globalThis as any;
  if (g.__piwiSessionPanelRunning) return;
  g.__piwiSessionPanelRunning = true;
  const toolEpoch = startTool('session-panel', teardownToolSurfaces);
  installEscapeToCancel();
  try {
    // Pick sessions live in session storage — see `session-access.ts`.
    await Promise.all([ensureSessionAccess(), initI18n()]);
    for (;;) {
      const picks = await getSessionPicks();
      const action = await renderSessionPanelOnce(picks);

      if (action.type === 'close') return;

      if (action.type === 'remove') {
        await removeSessionPick(action.name);
        continue;
      }

      if (action.type === 'clear') {
        await clearSessionPicks();
        continue;
      }

      // action.type === 'add'
      if (g.__piwiPicking) continue;
      g.__piwiPicking = true;
      try {
        const el = await pickOne();
        if (!el) continue;
        const { locator } = deriveTopLocator(el);
        if (!locator) continue;
        const name = await promptForName(new Set(picks.map((p) => p.name)));
        if (!name) continue;
        await addSessionPick({ name, locator, pageUrl: location.href });
      } finally {
        g.__piwiPicking = false;
      }
    }
  } finally {
    g.__piwiSessionPanelRunning = false;
    endTool(toolEpoch);
  }
}

void runSessionPanel();
