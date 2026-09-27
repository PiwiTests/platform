import { formatNumber, t, tn } from '../shared/i18n.js';
import { mockCode, type MockKind, type MockSource, mockUrlPattern } from '../shared/mock-code.js';
import { copyText, inspectedOrigin } from './inspected.js';

/**
 * The Network tab: the page's `fetch` and XHR requests, read from
 * `chrome.devtools.network` while DevTools is open, and Mock this response,
 * which writes a request as `page.route(...)` code. Nothing read here leaves
 * the browser but what the user copies or downloads.
 */

export interface NetworkEntry {
  id: number;
  method: string;
  url: string;
  status: number;
  mimeType: string;
  /** Milliseconds from the request to the end of the response. */
  time: number;
  /** The response body, as DevTools kept it. */
  body(): Promise<{ text: string | null; base64: boolean }>;
}

/** How many requests the tab keeps, the oldest dropped first. */
const MAX_ENTRIES = 500;

/** Resource types that are the page's API calls; Firefox names none, and a type is read from the response instead. */
const API_TYPES = new Set(['fetch', 'xhr']);
const NOT_API_MIME =
  /^(text\/(html|css|javascript)|application\/(javascript|x-javascript)|image\/|font\/|video\/|audio\/)/i;

type HarEntry = Omit<chrome.devtools.network.Request, 'getContent'> & {
  _resourceType?: string;
  getContent?: (callback: (content: string, encoding: string) => void) => void;
};

let nextId = 1;
const entries: NetworkEntry[] = [];
let listeners: Array<() => void> = [];

function isApiCall(har: HarEntry): boolean {
  if (har._resourceType) return API_TYPES.has(har._resourceType);
  return !NOT_API_MIME.test(har.response?.content?.mimeType ?? '');
}

function toEntry(har: HarEntry): NetworkEntry {
  return {
    id: nextId++,
    method: har.request.method,
    url: har.request.url,
    status: har.response.status,
    mimeType: har.response.content?.mimeType ?? '',
    time: Math.round(har.time ?? 0),
    body: () =>
      new Promise((resolve) => {
        if (typeof har.getContent === 'function') {
          har.getContent((content, encoding) =>
            resolve({ text: content ?? har.response.content?.text ?? null, base64: encoding === 'base64' }),
          );
        } else {
          const content = har.response.content;
          resolve({ text: content?.text ?? null, base64: content?.encoding === 'base64' });
        }
      }),
  };
}

function add(har: HarEntry): void {
  if (!isApiCall(har)) return;
  entries.push(toEntry(har));
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const listener of listeners) listener();
}

/** Starts reading the network log: what DevTools holds already, then each request as it finishes. */
export function startNetworkLog(onChange: () => void): void {
  listeners.push(onChange);
  chrome.devtools.network.getHAR((har) => {
    for (const entry of (har?.entries ?? []) as HarEntry[]) add(entry);
  });
  chrome.devtools.network.onRequestFinished.addListener((request) => add(request as HarEntry));
}

export function networkEntries(): readonly NetworkEntry[] {
  return entries;
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

interface NetworkView {
  allOrigins: boolean;
  selected: number | null;
  kind: MockKind;
  reveal: boolean;
  pattern: string | null;
}

const view: NetworkView = { allOrigins: false, selected: null, kind: 'response', reveal: false, pattern: null };

/** Buttons a later part of the panel adds under a selected request. */
export type RequestActions = (entry: NetworkEntry) => HTMLElement[];

let extraActions: RequestActions = () => [];

export function setRequestActions(actions: RequestActions): void {
  extraActions = actions;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function download(content: string, filename: string, base64: boolean): void {
  const bytes = base64 ? Uint8Array.from(atob(content), (c) => c.charCodeAt(0)) : content;
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function renderMock(section: HTMLElement, entry: NetworkEntry): Promise<void> {
  const { text, base64 } = await entry.body();
  const source: MockSource = {
    method: entry.method,
    url: entry.url,
    status: entry.status,
    mimeType: entry.mimeType,
    body: text,
    base64,
  };
  const pattern = view.pattern ?? mockUrlPattern(entry.url);

  const patternLabel = el('label', 'field');
  patternLabel.append(el('span', '', t('devtools_mockPattern')));
  const patternInput = el('input');
  patternInput.type = 'text';
  patternInput.value = pattern;
  patternInput.spellcheck = false;
  patternLabel.appendChild(patternInput);

  const kindLabel = el('label', 'field');
  kindLabel.append(el('span', '', t('devtools_mockKind')));
  const kind = el('select');
  for (const [value, key] of [
    ['response', 'devtools_mockResponse'],
    ['error', 'devtools_mockError'],
    ['abort', 'devtools_mockAbort'],
  ] as const) {
    const option = el('option', '', t(key));
    option.value = value;
    kind.appendChild(option);
  }
  kind.value = view.kind;
  kindLabel.appendChild(kind);

  const code = el('pre', 'code');
  const notes = el('div', 'notes');
  const actions = el('div', 'controls');

  const update = () => {
    view.pattern = patternInput.value;
    const result = mockCode(source, { kind: view.kind, pattern: patternInput.value, reveal: view.reveal });
    code.textContent = result.code;
    notes.replaceChildren();
    if (view.kind === 'response' && text === null) notes.appendChild(el('p', 'note warn', t('devtools_mockNoBody')));
    if (result.hidden > 0 || view.reveal) {
      const reveal = el('label', 'check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = view.reveal;
      box.addEventListener('change', () => {
        view.reveal = box.checked;
        update();
      });
      reveal.append(box, t('devtools_mockReveal'));
      if (result.hidden > 0) notes.appendChild(el('p', 'note', tn('devtools_mockHidden', result.hidden)));
      notes.appendChild(reveal);
    }
    const copy = el('button', 'primary', t('devtools_mockCopy'));
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void copyText(code.textContent ?? '').then((copied) => {
        if (!copied) return;
        copy.textContent = t('common_copied');
        setTimeout(() => {
          copy.textContent = t('devtools_mockCopy');
        }, 1200);
      });
    });
    actions.replaceChildren(copy);
    if (result.file) {
      const file = result.file;
      const name = file.path.split('/').pop()!;
      const save = el('button', '', t('devtools_mockDownload', { file: name }));
      save.type = 'button';
      save.addEventListener('click', () => download(file.content, name, file.base64));
      actions.appendChild(save);
      notes.appendChild(el('p', 'note', t('devtools_mockFileHint', { path: file.path })));
    }
    actions.append(...extraActions(entry));
  };
  patternInput.addEventListener('input', update);
  kind.addEventListener('change', () => {
    view.kind = kind.value as MockKind;
    update();
  });
  update();
  section.replaceChildren(
    el('h3', 'request-title', `${entry.method} ${entry.url}`),
    patternLabel,
    kindLabel,
    notes,
    code,
    actions,
  );
}

interface NetworkDom {
  list: HTMLElement;
  section: HTMLElement;
  origin: string | null;
}

let dom: NetworkDom | null = null;

/** Redraws the list of requests, leaving the mock being edited as it is. */
export function refreshNetworkList(): void {
  if (!dom) return;
  const { list, origin } = dom;
  const shown = entries.filter((entry) => view.allOrigins || !origin || originOf(entry.url) === origin);
  if (shown.length === 0) {
    list.replaceChildren(el('li', 'note', t('devtools_networkEmpty')));
    return;
  }
  list.replaceChildren(
    ...shown.map((entry) => {
      const item = el('li');
      const row = el('button', 'request');
      row.type = 'button';
      row.setAttribute('aria-pressed', String(entry.id === view.selected));
      row.append(
        el('span', 'method', entry.method),
        el('span', 'path', view.allOrigins ? entry.url : pathOf(entry.url)),
        el('span', entry.status >= 400 || entry.status === 0 ? 'status bad' : 'status', String(entry.status)),
        el('span', 'time', t('devtools_requestTime', { ms: formatNumber(entry.time) })),
      );
      row.addEventListener('click', () => {
        view.selected = entry.id;
        view.pattern = null;
        view.kind = 'response';
        view.reveal = false;
        refreshNetworkList();
        void showSelected();
      });
      item.appendChild(row);
      return item;
    }),
  );
}

async function showSelected(): Promise<void> {
  if (!dom) return;
  const selected = entries.find((entry) => entry.id === view.selected);
  if (!selected) {
    dom.section.replaceChildren();
    return;
  }
  await renderMock(dom.section, selected);
}

/** Draws the tab: the requests, most recent last, and Mock this response under the selected one. */
export async function renderNetworkTab(container: HTMLElement): Promise<void> {
  const origin = await inspectedOrigin();
  const toolbar = el('div', 'controls');
  const allLabel = el('label', 'check');
  const all = el('input');
  all.type = 'checkbox';
  all.checked = view.allOrigins;
  all.addEventListener('change', () => {
    view.allOrigins = all.checked;
    refreshNetworkList();
  });
  allLabel.append(all, t('devtools_networkAllOrigins'));
  const clear = el('button', '', t('devtools_networkClear'));
  clear.type = 'button';
  clear.addEventListener('click', () => {
    entries.length = 0;
    view.selected = null;
    refreshNetworkList();
    void showSelected();
  });
  toolbar.append(allLabel, clear);
  const list = el('ul', 'requests');
  list.setAttribute('aria-label', t('devtools_tabNetwork'));
  const section = el('section', 'mock');
  section.setAttribute('aria-label', t('devtools_mockTitle'));
  container.replaceChildren(toolbar, el('p', 'note', t('devtools_networkHint')), list, section);
  dom = { list, section, origin };
  refreshNetworkList();
  await showSelected();
}
