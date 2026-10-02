import { initI18n, localizeDocument, t, tn, uiLanguage } from '../shared/i18n.js';
import { cookieOriginPatterns, setupSnippet, toStorageState, type BrowserCookie } from '../shared/storage-state.js';

/**
 * Save login for tests: the tab's cookies, `httpOnly` ones included, and its
 * origin's `localStorage`, written as Playwright's `storageState` file. Opened
 * from the popup or the Piwi panel with the tab's id and address. The
 * `cookies` permission and the site's host permission are asked for in the
 * click that saves, for that one site; nothing is read before.
 */

const params = new URLSearchParams(location.search);
const tabId = Number(params.get('tabId'));
const pageUrl = params.get('url') ?? '';

function webOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

async function readCookies(origin: string): Promise<BrowserCookie[]> {
  const { hostname } = new URL(origin);
  // By address: the cookies a request to the site sends, the parent domain's included. By domain: those on other paths.
  const [byUrl, byDomain] = await Promise.all([
    chrome.cookies.getAll({ url: `${origin}/` }),
    chrome.cookies.getAll({ domain: hostname }),
  ]);
  return [...byUrl, ...byDomain];
}

async function readLocalStorage(): Promise<Array<[string, string]>> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const entries: Array<[string, string]> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i);
        if (name !== null) entries.push([name, localStorage.getItem(name) ?? '']);
      }
      return entries;
    },
  });
  return (result?.result as Array<[string, string]> | undefined) ?? [];
}

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function copyButton(button: HTMLButtonElement, text: () => string): void {
  button.addEventListener('click', () => {
    void navigator.clipboard.writeText(text()).then(() => {
      const original = button.textContent;
      button.textContent = t('common_copied');
      setTimeout(() => {
        button.textContent = original;
      }, 1200);
    });
  });
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
        const state = toStorageState(cookies, origin, storage);
        download(`${JSON.stringify(state, null, 2)}\n`, 'user.json');
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
