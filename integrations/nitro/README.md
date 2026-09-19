# @piwitests/instrumentation-nitro

Nitro / Nuxt server plugin for [Piwi Dashboard](https://piwitests.dev) — captures Warning and Error log entries per HTTP request and delivers them to the Piwi Dashboard reporter via the `X-Piwi-Logs` response header.

During a Playwright test run, the reporter reads this header from every response and stores the entries alongside the network request. The entries are then available in the Piwi Dashboard test-case view and are included in the AI diagnosis context.

**Active outside production by default.** Capture is controlled by the `PIWI_TEST_LOGS_DISABLED` environment variable:

- unset — capture is on, except when `NODE_ENV === 'production'`
- `PIWI_TEST_LOGS_DISABLED=true` — capture is off everywhere
- `PIWI_TEST_LOGS_DISABLED=false` — capture is on even in production builds (useful for a production-mode test deployment)

## Installation

```bash
npm install @piwitests/instrumentation-nitro
```

## Usage

Create a file in your project's server plugins directory:

```typescript
// Nuxt: server/plugins/piwi-test-logs.ts
// Standalone Nitro: plugins/piwi-test-logs.ts
export { default } from '@piwitests/instrumentation-nitro'
```

That's all. Nitro auto-loads every file in that directory on startup (`server/plugins/` in a Nuxt app, `plugins/` under the Nitro `srcDir` in a standalone Nitro app).

A runnable end-to-end demo lives in [`examples/playwright-fixtures`](../../examples/playwright-fixtures) — a standalone Nitro app instrumented with this package, with a Playwright spec showing the captured logs in the dashboard.

## What gets captured

| Source                               | What is captured                               |
|--------------------------------------|------------------------------------------------|
| `consola.warn()` / `consola.error()` | Warning and Error entries logged via consola   |
| Unhandled H3/Nitro errors            | Errors thrown in route handlers and middleware |

> Only calls made through **consola** are captured — bare `console.warn()` / `console.error()` output is not. Nuxt server code typically logs via consola already; in a standalone Nitro app, `import { consola } from 'consola'` in your handlers.

Each captured entry contains:

| Field       | Description                                                                          |
|-------------|--------------------------------------------------------------------------------------|
| `timestamp` | Unix timestamp in milliseconds                                                       |
| `level`     | `"Warning"` or `"Error"`                                                             |
| `category`  | Logger tag/category (e.g. `"database"`)                                              |
| `message`   | Log message (truncated at 500 characters)                                            |
| `stack`     | Shrunk stack trace when an `Error` was logged (max 5 frames, internal frames dropped) |

Up to 50 entries per request are included. The header is always emitted (with an empty array when no entries were captured) so the Piwi reporter can confirm the plugin is active.

## How it works

```
Playwright test
  └─ page.goto('/api/orders')
       └─ Nitro route handler runs
            ├─ consola.warn('Stock low')     ← captured via consola reporter
            └─ HTTP response
                 └─ X-Piwi-Logs: <gzip+base64 JSON>
                      └─ Piwi reporter reads header
                           └─ stored as serverLogs on the network request
                                └─ visible in test-case detail + AI diagnosis
```

The plugin wraps Nitro's root H3 handler and uses three mechanisms:

1. **`event.context._piwiLogs`** — a plain per-request array attached to the H3 event as the wrapped handler starts; everything captured for the request accumulates here.
2. **`AsyncLocalStorage.run()`** — scopes that buffer around the entire downstream chain (hooks, middleware, route handlers), so the process-global `consola` reporter always appends to the correct request's buffer.
3. **A patched `res.end`** — the header is written just before the response goes out, which covers **every** response, including H3 error responses that bypass Nitro's `beforeResponse` hook. Right before writing, unhandled errors are drained from `event.context.nitro.errors`, so thrown errors appear even when nothing logged via consola.

## Server probes — the `X-Piwi-Probe` header

The plugin can accept a signed fault instruction from a Piwi probe run (Test Map,
level two), so a passing test can be checked against the server's real error
path. **In this release the header is only verified and recorded — no fault is
applied.** A fault is applied only once a project turns server probes on
(`PIWI_SERVER_PROBES=true`), which stays off by default, and even then only the
client-safe subset.

The header is honored only outside production, under the **same guard as log
capture** (`PIWI_TEST_LOGS_DISABLED`), and only when a shared secret is set:

| Variable             | Effect                                                             |
|----------------------|-------------------------------------------------------------------|
| `PIWI_PROBE_SECRET`  | Shared HMAC secret. When unset, the probe header is ignored.      |
| `PIWI_SERVER_PROBES` | `true` to apply verified faults. Off (unset) in this milestone.   |

**Header format.** `X-Piwi-Probe` carries a base64-encoded JSON envelope:

```jsonc
{
  "nonce": "<hex, single use>",
  "ts": 1700000000000,            // issued-at, Unix ms; honored within 60s
  "specJson": "{\"route\":\"POST /api/orders\",\"fault\":\"status-500\",\"nth\":1}",
  "sig": "<hex HMAC-SHA256>"      // over `${nonce}.${ts}.${specJson}` with PIWI_PROBE_SECRET
}
```

`specJson` is the exact JSON string that was signed (the plugin re-parses it
after the signature check, so no canonicalization is needed). A verified spec is
exposed on `event.context._piwiProbe` for future handler use. The signing and
verification helpers are exported (`signProbeMessage`, `verifyProbeHeader`).

The root request span also carries the matched handler's source file as
`attrs['piwi.handler']` when Nitro exposes it, so the dashboard can attribute a
route to its handler by observation rather than by convention.

## Peer dependencies

| Package     | Version   |
|-------------|-----------|
| `nitropack` | `>=2.0.0` |
| `h3`        | `>=1.0.0` |
| `consola`   | `>=3.0.0` |

These are already installed in any Nuxt project — no extra installs needed.

## Building from source

```bash
cd integrations/nitro
npm run build   # emits dist/index.js + dist/index.d.ts
```

## License

MIT
