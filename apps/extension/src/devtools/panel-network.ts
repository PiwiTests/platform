import { formatNumber, t, tn } from '../shared/i18n.js';
import { mockCode, type MockKind, type MockSource, mockUrlPattern } from '../shared/mock-code.js';
import { copyText, inspectedOrigin } from './inspected.js';
import { conditionActions, pageConditions, renderConditions } from './panel-conditions.js';
import { button, el, emptyState, flash } from './ui.js';

/**
 * The Network tab: the page's `fetch` and XHR requests (and, with **Every
 * kind**, its documents, scripts, images and the rest, which a condition can
 * slow down or fail through the debugging protocol), read from
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
  /** A `fetch` or XHR call, rather than a document, a script, an image… */
  api: boolean;
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
    api: isApiCall(har),
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
  /** Every kind of request, not only `fetch` and XHR. */
  allTypes: boolean;
  selected: number | null;
  kind: MockKind;
  reveal: boolean;
  pattern: string | null;
}

const view: NetworkView = {
  allOrigins: false,
  allTypes: false,
  selected: null,
  kind: 'response',
  reveal: false,
  pattern: null,
};

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

const KINDS = [
  ['response', 'devtools_mockResponse'],
  ['error', 'devtools_mockError'],
  ['abort', 'devtools_mockAbort'],
] as const;

/** A label and its field, for the `.fields` grid. */
function field(id: string, label: string, control: HTMLInputElement | HTMLSelectElement): HTMLElement[] {
  control.id = id;
  const labelEl = el('label', '', label);
  labelEl.htmlFor = id;
  return [labelEl, control];
}

async function renderMock(pane: HTMLElement, entry: NetworkEntry): Promise<void> {
  const { text, base64 } = await entry.body();
  const source: MockSource = {
    method: entry.method,
    url: entry.url,
    status: entry.status,
    mimeType: entry.mimeType,
    body: text,
    base64,
  };

  const mock = el('section', 'mock');
  mock.setAttribute('aria-label', t('devtools_mockTitle'));
  const title = el('h3', 'request-title', `${entry.method} ${entry.url}`);

  const patternInput = el('input');
  patternInput.type = 'text';
  patternInput.value = view.pattern ?? mockUrlPattern(entry.url);
  patternInput.spellcheck = false;
  const kind = el('select');
  for (const [value, key] of KINDS) {
    const option = el('option', '', t(key));
    option.value = value;
    kind.appendChild(option);
  }
  kind.value = view.kind;
  const fields = el('div', 'fields');
  fields.append(
    ...field('mock-pattern', t('devtools_mockPattern'), patternInput),
    ...field('mock-kind', t('devtools_mockKind'), kind),
  );

  const notes = el('div', 'notes');
  const code = el('pre', 'code');
  const copy = button(
    t('devtools_mockCopy'),
    () => {
      void copyText(code.textContent ?? '').then((copied) => {
        if (copied) flash(copy, t('common_copied'));
      });
    },
    'primary copy-code',
  );
  const codeBox = el('div', 'code-box');
  codeBox.append(code, copy);
  const fileActions = el('div', 'controls');

  const update = () => {
    view.pattern = patternInput.value;
    const result = mockCode(source, { kind: view.kind, pattern: patternInput.value, reveal: view.reveal });
    code.textContent = result.code;
    notes.replaceChildren();
    fileActions.replaceChildren();
    if (view.kind === 'response' && text === null) notes.appendChild(el('p', 'warn-text', t('devtools_mockNoBody')));
    if (result.hidden > 0) notes.appendChild(el('p', '', tn('devtools_mockHidden', result.hidden)));
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
      notes.appendChild(reveal);
    }
    if (result.file) {
      const file = result.file;
      const name = file.path.split('/').pop()!;
      notes.appendChild(el('p', '', t('devtools_mockFileHint', { path: file.path })));
      fileActions.appendChild(
        button(t('devtools_mockDownload', { file: name }), () => download(file.content, name, file.base64)),
      );
    }
  };
  patternInput.addEventListener('input', update);
  kind.addEventListener('change', () => {
    view.kind = kind.value as MockKind;
    update();
  });
  update();
  mock.append(title, fields, notes, codeBox, fileActions);
  pane.replaceChildren(mock, conditionActions(entry, dom?.origin ?? null));
}

interface NetworkDom {
  list: HTMLElement;
  detail: HTMLElement;
  origin: string | null;
}

let dom: NetworkDom | null = null;

/** Redraws the list of requests, leaving the mock being edited as it is. */
export function refreshNetworkList(): void {
  if (!dom) return;
  const { list, origin } = dom;
  const shown = entries.filter(
    (entry) => (entry.api || view.allTypes) && (view.allOrigins || !origin || originOf(entry.url) === origin),
  );
  if (shown.length === 0) {
    list.replaceChildren(el('li', 'note', t('devtools_networkEmpty')));
    return;
  }
  list.replaceChildren(
    ...shown.map((entry) => {
      const item = el('li');
      const row = el('button', 'request');
      row.type = 'button';
      row.title = `${entry.method} ${entry.url}`;
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
    dom.detail.replaceChildren(emptyState('network', t('devtools_networkSelect')));
    return;
  }
  await renderMock(dom.detail, selected);
}

/**
 * Draws the tab: the conditions on, across the top; the requests on the left,
 * most recent last; the selected one on the right, to mock, slow down or fail.
 */
export async function renderNetworkTab(container: HTMLElement): Promise<void> {
  const origin = await inspectedOrigin();
  const strip = el('section', 'conditions-strip');
  strip.setAttribute('aria-label', t('devtools_conditionsTitle'));

  const allLabel = el('label', 'check');
  const all = el('input');
  all.type = 'checkbox';
  all.checked = view.allOrigins;
  all.addEventListener('change', () => {
    view.allOrigins = all.checked;
    refreshNetworkList();
  });
  allLabel.append(all, t('devtools_networkAllOrigins'));
  const clear = button(t('devtools_networkClear'), () => {
    entries.length = 0;
    view.selected = null;
    refreshNetworkList();
    void showSelected();
  });
  const toolbar = el('div', 'pane-toolbar');
  const pageStatus = el('span', 'warn-text');
  pageStatus.setAttribute('role', 'status');
  // Documents, scripts and images: only where the debugging protocol can slow them down or fail them.
  const typesLabel = el('label', 'check');
  if (typeof chrome.debugger?.attach === 'function') {
    const types = el('input');
    types.type = 'checkbox';
    types.checked = view.allTypes;
    types.addEventListener('change', () => {
      view.allTypes = types.checked;
      refreshNetworkList();
    });
    typesLabel.append(types, t('devtools_networkAllTypes'));
  }
  toolbar.append(
    allLabel,
    typesLabel,
    clear,
    await pageConditions(origin, (text) => {
      pageStatus.textContent = text;
    }),
    pageStatus,
  );
  const head = el('div', 'request-head');
  head.setAttribute('aria-hidden', 'true');
  head.append(
    el('span', '', t('devtools_colMethod')),
    el('span', '', t('devtools_colPath')),
    el('span', '', t('devtools_colStatus')),
    el('span', '', t('devtools_colTime')),
  );
  const list = el('ul', 'requests');
  list.setAttribute('aria-label', t('devtools_tabNetwork'));
  const requests = el('div', 'requests-pane');
  requests.append(toolbar, head, list, el('p', 'pane-foot', t('devtools_networkHint')));
  const detail = el('div', 'detail-pane');

  const grid = el('div', 'network');
  grid.append(strip, requests, detail);
  container.replaceChildren(grid);
  dom = { list, detail, origin };
  await renderConditions(strip, origin);
  refreshNetworkList();
  await showSelected();
}
