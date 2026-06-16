import { AsyncLocalStorage } from 'node:async_hooks';
import { gzipSync } from 'node:zlib';
import { consola } from 'consola';
import { defineNitroPlugin } from 'nitropack/runtime';

const MAX_ENTRIES = 50;
const MAX_MSG_LENGTH = 500;

export interface PiwiTestLogEntry {
  timestamp: number;
  level: string;
  category: string;
  message: string;
}

// ALS is used only by the consola reporter (links log calls to the current request).
// Cross-hook state lives on event.context._piwiLogs instead.
const als = new AsyncLocalStorage<PiwiTestLogEntry[]>();

// The consola reporter is process-global — register it only once.
let reporterAdded = false;

export default defineNitroPlugin((nitroApp) => {
  if (process.env.NODE_ENV === 'production') return;

  if (!reporterAdded) {
    reporterAdded = true;
    consola.addReporter({
      log(logObj) {
        if (logObj.level > 1) return; // Warning (1) and Error/Fatal (0) only
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

  nitroApp.hooks.hook('request', (event) => {
    const logs: PiwiTestLogEntry[] = [];
    event.context._piwiLogs = logs;
    als.enterWith(logs);

    // Patch res.end so the X-Piwi-Logs header is injected for ALL responses,
    // including H3 error responses where Nitro bypasses the 'beforeResponse' hook
    // (h3 skips onBeforeResponse once the error handler has called res.end).
    const res = event.node.res as any;
    const originalEnd = res.end.bind(res) as (...args: any[]) => any;
    res.end = (...args: any[]) => {
      if (!res.headersSent) {
        // Collect any unhandled H3/Nitro errors — they are synchronously pushed
        // to event.context.nitro.errors before errorHandler runs, so they're
        // always available here even for error responses.
        const nitroErrors = (event.context.nitro as any)?.errors as
          | Array<{ error: unknown }>
          | undefined;
        if (nitroErrors?.length) {
          for (const { error } of nitroErrors) {
            const msg = error instanceof Error ? (error.message || String(error)) : String(error);
            logs.push({
              timestamp: Date.now(),
              level: 'Error',
              category: 'server',
              message: msg.length > MAX_MSG_LENGTH ? `${msg.slice(0, MAX_MSG_LENGTH)}…` : msg,
            });
          }
        }
        const payload = logs.length > MAX_ENTRIES ? logs.slice(0, MAX_ENTRIES) : logs;
        res.setHeader('X-Piwi-Logs', gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64'));
      }
      return originalEnd(...args);
    };
  });
});
