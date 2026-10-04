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
 * 500 without sending it; a failure rejects as the network does. A request
 * held back goes on as one on its way: a fetch rejects as soon as its signal
 * aborts; an XHR counts its timeout from `send()`, gets the events of one that
 * starts and ends here when it never goes out (`loadstart` included, its
 * upload's too), and ends with the page's `abort()`, with the events the
 * browser's own fires, or with a new `open()`. Documents, scripts, images and
 * a service worker's requests go past it.
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
  /** `promise`, or a rejection with the signal's reason as soon as it aborts, as `fetch()` rejects. */
  const unlessAborted = <T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> => {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  };

  const originalFetch = window.fetch;
  window.fetch = function fetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = absolute(input instanceof Request ? input.url : input instanceof URL ? input.href : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const signal = init?.signal !== undefined ? init.signal : input instanceof Request ? input.signal : null;
    return unlessAborted(whenKnown(), signal).then(async () => {
      const condition = conditionFor(hook.conditions, method, url);
      if (condition?.kind === 'error') {
        return new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'text/plain' },
        });
      }
      if (condition?.kind === 'abort') throw new TypeError('Failed to fetch');
      if (condition?.kind === 'delay') await unlessAborted(sleep(condition.delayMs), signal);
      return originalFetch.call(this === undefined ? window : this, input, init);
    });
  } as typeof window.fetch;

  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalAbort = proto.abort;
  const timeoutProperty = Object.getOwnPropertyDescriptor(proto, 'timeout')!;
  const requests = new WeakMap<XMLHttpRequest, { method: string; url: string; async: boolean }>();
  /**
   * A send held back: when send() was called, whether it gave a body to
   * upload, whether its loadstart has fired here, and its timers once set.
   */
  interface Held {
    sentAt: number;
    upload: boolean;
    started: boolean;
    timer?: ReturnType<typeof setTimeout>;
    timeout?: ReturnType<typeof setTimeout>;
  }
  const held = new WeakMap<XMLHttpRequest, Held>();
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
  /** A progress event of 0 bytes out of 0, as the browser fires one for a request with no response. */
  const progress = (target: EventTarget, type: string) => target.dispatchEvent(new ProgressEvent(type));
  /** The loadstart events of a send that goes no further than here, once; one that goes out gets the browser's own. */
  const begin = (xhr: XMLHttpRequest, send: Held) => {
    if (send.started) return;
    send.started = true;
    progress(xhr, 'loadstart');
    if (send.upload) progress(xhr.upload, 'loadstart');
  };
  /** Takes off what an answer given here set on `xhr`, and hands the browser the timeout the page set. */
  const forget = (xhr: XMLHttpRequest) => {
    for (const name of ANSWERED) delete (xhr as unknown as Record<string, unknown>)[name];
    const own = Object.getOwnPropertyDescriptor(xhr, 'timeout');
    if (own?.get) {
      const timeout = own.get.call(xhr) as number;
      delete (xhr as unknown as Record<string, unknown>).timeout;
      timeoutProperty.set!.call(xhr, timeout);
    }
  };
  /** Drops the send `xhr` holds back, with its timers: that send, or null when there was none. */
  const release = (xhr: XMLHttpRequest): Held | null => {
    const send = held.get(xhr);
    if (!send) return null;
    clearTimeout(send.timer);
    clearTimeout(send.timeout);
    held.delete(xhr);
    return send;
  };

  proto.open = function open(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    // Opening again ends the request before, as the browser's own open() does: a send held back, an answer given.
    release(this);
    forget(this);
    requests.set(this, { method, url: absolute(String(url)), async: rest[0] !== false });
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;

  /**
   * Ends `xhr` as if the server had answered `status`, or, when 0, as `failure`
   * ends a request: a network error or a timeout. Its upload object gets its
   * events too when send() gave a body.
   */
  const settle = (xhr: XMLHttpRequest, url: string, status: number, send: Held, failure = 'error') => {
    begin(xhr, send);
    const { upload } = send;
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
    if (status && upload) {
      progress(xhr.upload, 'load');
      progress(xhr.upload, 'loadend');
    }
    xhr.dispatchEvent(new Event('readystatechange'));
    if (!status && upload) {
      progress(xhr.upload, failure);
      progress(xhr.upload, 'loadend');
    }
    progress(xhr, status ? 'load' : failure);
    progress(xhr, 'loadend');
  };

  /** Sends what was held back, its timeout counted from send(), while the page reads and sets its own. */
  const sendLate = (xhr: XMLHttpRequest, body: Parameters<typeof originalSend>[0], send: Held) => {
    let timeout = xhr.timeout;
    if (timeout > 0) {
      const heldMs = Date.now() - send.sentAt;
      const setLeft = (ms: number) => timeoutProperty.set!.call(xhr, ms > 0 ? Math.max(1, ms - heldMs) : 0);
      setLeft(timeout);
      Object.defineProperty(xhr, 'timeout', {
        configurable: true,
        get: () => timeout,
        set: (ms: unknown) => {
          timeout = Number(ms) >>> 0;
          setLeft(timeout);
        },
      });
    }
    originalSend.call(xhr, body);
  };

  proto.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const request = requests.get(this);
    // A synchronous request cannot wait, and one no condition applies to need not: they go out as they are.
    if (!request?.async || (hook.known && !conditionFor(hook.conditions, request.method, request.url))) {
      return originalSend.call(this, body);
    }
    // The browser sends no body with a GET or a HEAD.
    const upload = body != null && !/^(GET|HEAD)$/i.test(request.method);
    const send: Held = { sentAt: Date.now(), upload, started: false };
    held.set(this, send);
    // Answered here without going out: its loadstart now, as send() fires it.
    const known = hook.known ? conditionFor(hook.conditions, request.method, request.url) : null;
    if (known && known.kind !== 'delay') begin(this, send);
    // A loadstart listener aborted it or opened it again.
    if (held.get(this) !== send) return;
    const after = (ms: number, then: () => void) =>
      setTimeout(() => {
        if (held.get(this) !== send) return;
        release(this);
        then();
      }, ms);
    if (this.timeout > 0) send.timeout = after(this.timeout, () => settle(this, request.url, 0, send, 'timeout'));
    const apply = () => {
      if (held.get(this) !== send) return;
      const condition = conditionFor(hook.conditions, request.method, request.url);
      if (condition?.kind === 'error') send.timer = after(0, () => settle(this, request.url, 500, send));
      else if (condition?.kind === 'abort') send.timer = after(0, () => settle(this, request.url, 0, send));
      else if (condition?.kind === 'delay') send.timer = after(condition.delayMs, () => sendLate(this, body, send));
      else {
        release(this);
        sendLate(this, body, send);
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
      begin(this, wasHeld);
      define(this, 'readyState', 4);
      this.dispatchEvent(new Event('readystatechange'));
      if (wasHeld.upload) {
        progress(this.upload, 'abort');
        progress(this.upload, 'loadend');
      }
      progress(this, 'abort');
      progress(this, 'loadend');
    }
    if (wasHeld || answered) define(this, 'readyState', 0);
    return result;
  };
}

if (!g.__piwiRequestConditions) install();
