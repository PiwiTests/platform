// Drop this file into server/plugins/ in your Nitro / Nuxt project.
// Active only when NODE_ENV !== 'production'.
//
// Captures Warning/Error log entries per request using AsyncLocalStorage
// and writes them (gzip-compressed, base64-encoded) to the X-Piwi-Logs
// response header before the response is sent.
//
// Piwi Dashboard reporter reads this header from each network request and
// attaches the entries as serverLogs on the matching network request entry.

import { AsyncLocalStorage } from 'node:async_hooks';
import { gzipSync } from 'node:zlib';
import { consola } from 'consola';
import { setResponseHeader } from 'h3';

const MAX_ENTRIES = 50;
const MAX_MSG_LENGTH = 500;

interface PiwiTestLogEntry {
  timestamp: number;
  level: string;
  category: string;
  message: string;
}

// One ALS instance shared across all requests; each request gets its own store.
const als = new AsyncLocalStorage<PiwiTestLogEntry[]>();

// The consola reporter is process-global — register it only once.
let reporterAdded = false;

export default defineNitroPlugin((nitroApp) => {
  if (process.env.NODE_ENV === 'production') return;

  if (!reporterAdded) {
    reporterAdded = true;
    consola.addReporter({
      log(logObj) {
        if (logObj.level > 1) return; // Warning (1) and Error / Fatal (0) only
        const store = als.getStore();
        if (!store) return;
        const msg = logObj.args.map(String).join(' ');
        store.push({
          timestamp: Date.now(),
          level: logObj.level <= 0 ? 'Error' : 'Warning',
          category: logObj.tag ?? '',
          message: msg.length > MAX_MSG_LENGTH ? `${msg.slice(0, MAX_MSG_LENGTH)}…` : msg,
        });
      },
    });
  }

  // enterWith() sets the store on the current async resource and propagates
  // it to all child continuations — middleware, route handlers, response hooks
  // all share the same buffer for the lifetime of this request.
  nitroApp.hooks.hook('request', (_event) => {
    als.enterWith([]);
  });

  nitroApp.hooks.hook('beforeResponse', (event, _response) => {
    const logs = als.getStore();
    if (!logs?.length) return;
    const payload = logs.length > MAX_ENTRIES ? logs.slice(0, MAX_ENTRIES) : logs;
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload)));
    setResponseHeader(event, 'X-Piwi-Logs', compressed.toString('base64'));
  });
});
