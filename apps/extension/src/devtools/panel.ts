import { LOCATOR_SYNTAX_CSS } from '@piwitests/picker-dom';
import { initI18n, localizeDocument, t, uiLanguage } from '../shared/i18n.js';
import { RECORDING_KEY } from '../shared/recording-storage.js';
import { REPLAY_KEY } from '../shared/replay-storage.js';
import { CONDITIONS_KEY } from '../shared/request-conditions.js';
import {
  evalInPage,
  injectContentScript,
  inspectedOrigin,
  inspectedTabId,
  requestSiteAccess,
  sitePattern,
} from './inspected.js';
import { renderRecordTab } from './panel-record.js';
import { renderReplayTab } from './panel-replay.js';
import { refreshNetworkList, renderNetworkTab, startNetworkLog } from './panel-network.js';

/**
 * The Piwi panel in DevTools. It mirrors what runs on the page, from the same
 * session storage the in-page panels read: the recording's steps (Record),
 * the replay's steps and verdict (Replay), and redraws whenever that storage
 * changes, so it stays up across the page's navigations. Network lists the
 * page's API calls from DevTools' own log, for Mock this response. The in-page panels
 * stay: the panel is an addition for people with DevTools open.
 */

type TabId = 'record' | 'replay' | 'network';

const TAB_KEYS: Record<TabId, string[]> = {
  record: [RECORDING_KEY],
  replay: [REPLAY_KEY],
  network: [CONDITIONS_KEY],
};

const content = document.getElementById('content') as HTMLElement;
const notice = document.getElementById('notice') as HTMLElement;
const tabButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

let current: TabId = 'record';
let generation = 0;

async function render(): Promise<void> {
  const mine = ++generation;
  const container = document.createElement('div');
  if (current === 'record') await renderRecordTab(container);
  else if (current === 'replay') await renderReplayTab(container);
  else await renderNetworkTab(container);
  if (mine === generation) content.replaceChildren(...container.childNodes);
}

function select(tab: TabId): void {
  current = tab;
  for (const button of tabButtons) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  void render();
}

/** Turns the Playwright view on or off in the inspected tab, asking for the site first when the extension has no access. */
async function togglePlaywrightView(): Promise<void> {
  notice.replaceChildren();
  const injected = await injectContentScript('playwright-view.js');
  if (injected.ok) return;
  const pattern = sitePattern(await inspectedOrigin());
  const text = document.createElement('span');
  if (!pattern) {
    text.textContent = t('devtools_restricted');
    notice.replaceChildren(text);
    return;
  }
  text.textContent = t('devtools_noAccess', { site: pattern.replace(/\/\*$/, '') });
  const allow = document.createElement('button');
  allow.type = 'button';
  allow.className = 'primary';
  allow.textContent = t('devtools_allowSite');
  allow.addEventListener('click', () => {
    void requestSiteAccess(pattern).then((granted) => {
      if (!granted) return;
      notice.replaceChildren();
      void injectContentScript('playwright-view.js');
    });
  });
  notice.replaceChildren(text, allow);
}

/** Opens Save login for tests for the inspected tab, in a tab of its own. */
async function openSaveLogin(): Promise<void> {
  const href = await evalInPage<string>('location.href');
  const url = href.ok && typeof href.value === 'string' ? href.value : '';
  const query = new URLSearchParams({ tabId: String(inspectedTabId()), url });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`login.html?${query}`) });
}

async function start(): Promise<void> {
  await initI18n();
  document.documentElement.lang = uiLanguage();
  localizeDocument();
  const style = document.createElement('style');
  style.textContent = LOCATOR_SYNTAX_CSS;
  document.head.appendChild(style);

  for (const button of tabButtons) {
    button.addEventListener('click', () => select(button.dataset.tab as TabId));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const index = tabButtons.indexOf(button);
      const next = tabButtons[(index + (event.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length]!;
      next.focus();
      select(next.dataset.tab as TabId);
    });
  }
  document.getElementById('playwright-view')!.addEventListener('click', () => void togglePlaywrightView());
  document.getElementById('save-login')!.addEventListener('click', () => void openSaveLogin());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    if (TAB_KEYS[current].some((key) => key in changes)) void render();
  });
  startNetworkLog(() => {
    if (current === 'network') refreshNetworkList();
  });
  select('record');
}

void start();
