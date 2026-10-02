import { initI18n, localizeDocument, t, tn, uiLanguage } from '../shared/i18n.js';
import { cookieOriginPatterns, setupSnippet, toStorageState, type BrowserCookie } from '../shared/storage-state.js';
import { copyWithFeedback } from '../shared/clipboard.js';
import { downloadBlob } from '../shared/download.js';
import { webOrigin } from '../shared/web-origin.js';

/**
 * Save login for tests: the tab's cookies, `httpOnly` ones included, and its
 * origin's `localStorage`, written as Playwright's `storageState` file. Opened
 * from the Piwi panel in DevTools with the tab's id and address. The
 * `cookies` permission and the site's host permission are asked for in the
 * click that saves, for that one site; nothing is read before.
 */

const params = new URLSearchParams(location.search);
const tabId = Number(params.get('tabId'));
const pageUrl = params.get('url') ?? '';

async function readCookies(origin: string): Promise<BrowserCookie[]> {
  const { hostname } = new URL(origin);
  // By address: the cookies a request to the site sends, the parent domain's included. By domain: those on other paths.
  const [byUrl, byDomain] = await Promise.all([
    chrome.cookies.getAll({ url: `${origin}/` }),
    chrome.cookies.getAll({ domain: hostname }),
  ]);
  return [...byUrl, ...byDomain];
}

/** The `localStorage` of the document the tab holds now, with that document's origin. */
async function readLocalStorage(): Promise<{ origin: string; entries: Array<[string, string]> }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const entries: Array<[string, string]> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i);
        if (name !== null) entries.push([name, localStorage.getItem(name) ?? '']);
      }
      return { origin: location.origin, entries };
    },
  });
  const read = result?.result as { origin?: unknown; entries?: Array<[string, string]> } | undefined;
  return { origin: typeof read?.origin === 'string' ? read.origin : '', entries: read?.entries ?? [] };
}

function copyButton(button: HTMLButtonElement, text: () => string): void {
  button.addEventListener('click', () => void copyWithFeedback(text(), button));
}

async function start(): Promise<void> {
  await initI18n();
  document.documentElement.lang = uiLanguage();
  localizeDocument();
  const origin = webOrigin(pageUrl);
  const site = document.getElementById('site')!;
  const save = document.getElementById('save') as HTMLButtonElement;
  const status = document.getElementById('status')!;
  const snippet = document.getElementById('snippet')!;
  snippet.textContent = setupSnippet();
  copyButton(document.getElementById('copy-snippet') as HTMLButtonElement, () => setupSnippet());
  copyButton(document.getElementById('copy-gitignore') as HTMLButtonElement, () => 'playwright/.auth\n');

  if (!origin || !Number.isInteger(tabId)) {
    site.textContent = t('login_noSite');
    save.disabled = true;
    return;
  }
  site.textContent = t('login_site', { site: origin });

  save.addEventListener('click', () => {
    status.textContent = '';
    // Asked for inside the click, which the browser requires; the rest waits for the answer.
    const permission = chrome.permissions.request({
      permissions: ['cookies'],
      origins: cookieOriginPatterns(new URL(origin).hostname),
    });
    // Disabled until the file is saved, so a second click downloads no second copy.
    save.disabled = true;
    void permission
      .then(async (granted) => {
        if (!granted) {
          status.textContent = t('login_denied');
          return;
        }
        const [cookies, storage] = await Promise.all([readCookies(origin), readLocalStorage()]);
        // The tab shows another site by now: what it holds is not this site's login.
        if (storage.origin !== origin) {
          status.textContent = t('login_siteChanged', { site: origin });
          return;
        }
        const state = toStorageState(cookies, origin, storage.entries);
        downloadBlob(new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: 'application/json' }), 'user.json');
        status.textContent = `${tn('login_savedCookies', state.cookies.length)} ${tn(
          'login_savedStorage',
          state.origins[0]?.localStorage.length ?? 0,
        )}`;
      })
      .catch((err: unknown) => {
        status.textContent = t('login_failed', { error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        save.disabled = false;
      });
  });
}

void start();
