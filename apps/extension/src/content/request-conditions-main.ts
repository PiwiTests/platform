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
 * 500 without sending it; a failure rejects as the network does. Documents,
 * scripts, images and a service worker's requests go past it.
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
  const absolute = (url: string) => {
    try {
      return new URL(url, location.href).href;
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
  const requests = new WeakMap<XMLHttpRequest, { method: string; url: string; async: boolean }>();

  proto.open = function open(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    requests.set(this, { method, url: absolute(String(url)), async: rest[0] !== false });
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;

  /** Ends `xhr` as if the server had answered `status`, or as a network error when 0. */
  const settle = (xhr: XMLHttpRequest, url: string, status: number) => {
    const text = status ? 'Internal Server Error' : '';
    const define = (name: string, value: unknown) => Object.defineProperty(xhr, name, { configurable: true, value });
    define('readyState', 4);
    define('status', status);
    define('statusText', status ? 'Internal Server Error' : '');
    define('responseText', text);
    define('response', text);
    define('responseURL', status ? url : '');
    define('getAllResponseHeaders', () => (status ? 'content-type: text/plain\r\n' : ''));
    define('getResponseHeader', (name: string) =>
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
    const apply = () => {
      const condition = conditionFor(hook.conditions, request.method, request.url);
      if (condition?.kind === 'error') setTimeout(() => settle(this, request.url, 500));
      else if (condition?.kind === 'abort') setTimeout(() => settle(this, request.url, 0));
      else if (condition?.kind === 'delay') setTimeout(() => originalSend.call(this, body), condition.delayMs);
      else originalSend.call(this, body);
    };
    if (hook.known) apply();
    else void whenKnown().then(apply);
  };
}

if (!g.__piwiRequestConditions) install();
