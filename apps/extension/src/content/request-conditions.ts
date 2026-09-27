import { initI18n, t, tn, uiLanguage } from '../shared/i18n.js';
import { conditionText } from '../shared/condition-words.js';
import { CONDITIONS_MESSAGE_SOURCE, isCondition, type RequestCondition } from '../shared/request-conditions.js';
import { attachPanelShadow } from './panel-root.js';

/**
 * The isolated-world half of Slow down or fail a request: asks the background
 * worker for this tab's conditions, hands them to the main-world script by
 * `window.postMessage`, and shows a banner while any is on, with Turn off.
 * Injected again whenever the conditions change, which posts them again.
 */

const BANNER_HOST_ID = 'piwi-conditions-banner';

async function conditionsForThisTab(): Promise<RequestCondition[]> {
  try {
    const reply = (await chrome.runtime.sendMessage({ type: 'piwi-get-conditions' })) as { conditions?: unknown[] };
    return (reply?.conditions ?? []).filter(isCondition);
  } catch {
    return [];
  }
}

function drawBanner(conditions: RequestCondition[]): void {
  document.getElementById(BANNER_HOST_ID)?.remove();
  if (conditions.length === 0) return;
  const host = document.createElement('div');
  host.id = BANNER_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483646;';
  const root = attachPanelShadow(host, { mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .bar {
      display: flex; gap: 10px; align-items: center; max-width: min(560px, 90vw);
      background: #78350f; color: #fffbeb; border-radius: 8px; padding: 7px 10px;
      font: 12.5px ui-sans-serif, system-ui, -apple-system, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35);
    }
    ul { margin: 0; padding: 0 0 0 16px; }
    button {
      font: inherit; color: inherit; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.4);
      border-radius: 6px; padding: 3px 9px; cursor: pointer; flex-shrink: 0;
    }
  `;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'status');
  bar.lang = uiLanguage();
  const text = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = tn('devtools_conditionsOn', conditions.length);
  const list = document.createElement('ul');
  for (const condition of conditions) {
    const item = document.createElement('li');
    item.textContent = conditionText(condition);
    list.appendChild(item);
  }
  text.append(title, list);
  const off = document.createElement('button');
  off.type = 'button';
  off.textContent = t('devtools_conditionsOff');
  off.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'piwi-clear-conditions' }).catch(() => undefined);
  });
  bar.append(text, off);
  root.append(style, bar);
  (document.body ?? document.documentElement).appendChild(host);
}

async function relay(): Promise<void> {
  const [conditions] = await Promise.all([conditionsForThisTab(), initI18n()]);
  window.postMessage({ source: CONDITIONS_MESSAGE_SOURCE, conditions }, '*');
  if (conditions.length === 0) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => drawBanner(conditions), { once: true });
  } else drawBanner(conditions);
}

void relay();
