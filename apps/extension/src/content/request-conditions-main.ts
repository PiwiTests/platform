import {
  CONDITIONS_MESSAGE_SOURCE,
  conditionFor,
  isCondition,
  type RequestCondition,
} from '../shared/request-conditions.js';

/**
 * Slow down or fail a request, in the page's own JavaScript world: wraps
 * `fetch` and `XMLHttpRequest` and applies the conditions the isolated-world
 * script posts (`request-conditions.ts`) to the calls whose method and URL
 * match. A delay holds the request back before it goes out; an error answers
 * 500 without sending it; a failure rejects as the network does. An XHR held
 * back ends with the page's `abort()`, which fires the browser's own events, or
 * with a new `open()`. Documents, scripts, images and a service worker's
 * requests go past it.
 *
 * It imports nothing that touches `chrome.*`: the main world has none. Until
 * the first conditions arrive, a request waits for them, at most
 * {@link WAIT_MS}.
 */

const WAIT_MS = 1000;

interface ConditionsHook {
  conditions: RequestCondition[];
  known: boolean;
  waiters: Array<() => void>;
}

const g = window as unknown as { __piwiRequestConditions?: ConditionsHook };

function install(): void {
  const hook: ConditionsHook = { conditions: [], known: false, waiters: [] };
  g.__piwiRequestConditions = hook;

  window.addEventListener('message', (event) => {
    const data = event.data as { source?: unknown; conditions?: unknown } | null;
    if (event.source !== window || data?.source !== CONDITIONS_MESSAGE_SOURCE || !Array.isArray(data.conditions))
      return;
    hook.conditions = data.conditions.filter(isCondition);
    hook.known = true;
    for (const resolve of hook.waiters.splice(0)) resolve();
  });

  const whenKnown = (): Promise<void> =>
    hook.known
      ? Promise.resolve()
      : new Promise((resolve) => {
          hook.waiters.push(resolve);
          setTimeout(resolve, WAIT_MS);
        });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // Against the document's base URL, as the browser resolves a request's URL.
  const absolute = (url: string) => {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return url;
    }
  };

  const originalFetch = window.fetch;
  window.fetch = function fetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = absolute(input instanceof Request ? input.url : input instanceof URL ? input.href : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    return whenKnown().then(async () => {
      const condition = conditionFor(hook.conditions, method, url);
      if (condition?.kind === 'error') {
        return new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'text/plain' },
        });
      }
      if (condition?.kind === 'abort') throw new TypeError('Failed to fetch');
      if (condition?.kind === 'delay') await sleep(condition.delayMs);
      return originalFetch.call(this === undefined ? window : this, input, init);
    });
  } as typeof window.fetch;

  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalAbort = proto.abort;
  const requests = new WeakMap<XMLHttpRequest, { method: string; url: string; async: boolean }>();
  /** The sends held back, each with its timer once its delay or answer is due. */
  const held = new WeakMap<XMLHttpRequest, { timer?: ReturnType<typeof setTimeout> }>();
  /** What an answer given here sets on the XHR itself, over the browser's own getters. */
  const ANSWERED = [
    'readyState',
    'status',
    'statusText',
    'responseText',
    'response',
    'responseURL',
    'getAllResponseHeaders',
    'getResponseHeader',
  ];

  const define = (xhr: XMLHttpRequest, name: string, value: unknown) =>
    Object.defineProperty(xhr, name, { configurable: true, value });
  const forget = (xhr: XMLHttpRequest) => {
    for (const name of ANSWERED) delete (xhr as unknown as Record<string, unknown>)[name];
  };
  /** Drops the send `xhr` holds back; true when there was one. */
  const release = (xhr: XMLHttpRequest): boolean => {
    const send = held.get(xhr);
    if (!send) return false;
    clearTimeout(send.timer);
    held.delete(xhr);
    return true;
  };

  proto.open = function open(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    // Opening again ends the request before, as the browser's own open() does: a send held back, an answer given.
    release(this);
    forget(this);
    requests.set(this, { method, url: absolute(String(url)), async: rest[0] !== false });
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;

  /** Ends `xhr` as if the server had answered `status`, or as a network error when 0. */
  const settle = (xhr: XMLHttpRequest, url: string, status: number) => {
    const text = status ? 'Internal Server Error' : '';
    define(xhr, 'readyState', 4);
    define(xhr, 'status', status);
    define(xhr, 'statusText', status ? 'Internal Server Error' : '');
    define(xhr, 'responseText', text);
    define(xhr, 'response', text);
    define(xhr, 'responseURL', status ? url : '');
    define(xhr, 'getAllResponseHeaders', () => (status ? 'content-type: text/plain\r\n' : ''));
    define(xhr, 'getResponseHeader', (name: string) =>
      status && name.toLowerCase() === 'content-type' ? 'text/plain' : null,
    );
    xhr.dispatchEvent(new Event('readystatechange'));
    if (status) xhr.dispatchEvent(new ProgressEvent('load'));
    else xhr.dispatchEvent(new ProgressEvent('error'));
    xhr.dispatchEvent(new ProgressEvent('loadend'));
  };

  proto.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const request = requests.get(this);
    // A synchronous request cannot wait: it goes out as it is.
    if (!request?.async) return originalSend.call(this, body);
    const send: { timer?: ReturnType<typeof setTimeout> } = {};
    held.set(this, send);
    const after = (ms: number, then: () => void) => {
      send.timer = setTimeout(() => {
        if (held.get(this) !== send) return;
        held.delete(this);
        then();
      }, ms);
    };
    const apply = () => {
      if (held.get(this) !== send) return;
      const condition = conditionFor(hook.conditions, request.method, request.url);
      if (condition?.kind === 'error') after(0, () => settle(this, request.url, 500));
      else if (condition?.kind === 'abort') after(0, () => settle(this, request.url, 0));
      else if (condition?.kind === 'delay') after(condition.delayMs, () => originalSend.call(this, body));
      else {
        held.delete(this);
        originalSend.call(this, body);
      }
    };
    if (hook.known) apply();
    else void whenKnown().then(apply);
  };

  // The browser knows nothing of a send held back or of an answer given here, and its abort() leaves them as they
  // are: the XHR ends here instead, unsent, after the events of a request aborted on its way.
  proto.abort = function abort(this: XMLHttpRequest) {
    const wasHeld = release(this);
    const answered = Object.prototype.hasOwnProperty.call(this, 'readyState');
    const result = originalAbort.call(this);
    if (wasHeld || answered) forget(this);
    if (wasHeld) {
      define(this, 'readyState', 4);
      this.dispatchEvent(new Event('readystatechange'));
      this.dispatchEvent(new ProgressEvent('abort'));
      this.dispatchEvent(new ProgressEvent('loadend'));
    }
    if (wasHeld || answered) define(this, 'readyState', 0);
    return result;
  };
}

if (!g.__piwiRequestConditions) install();
