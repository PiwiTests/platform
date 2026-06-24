# @piwitests/instrumentation

Nitro / Nuxt server plugin for [Piwi Dashboard](https://piwitests.github.io) — captures Warning and Error log entries per HTTP request and delivers them to the Piwi Dashboard reporter via the `X-Piwi-Logs` response header.

During a Playwright test run, the reporter reads this header from every response and stores the entries alongside the network request. The entries are then available in the Piwi Dashboard test-case view and are included in the AI diagnosis context.

**Active only when `NODE_ENV !== 'production'`.** No header is emitted in production builds.

## Installation

```bash
npm install @piwitests/instrumentation
```

## Usage

Create a file in your project's `server/plugins/` directory:

```typescript
// server/plugins/piwi-test-logs.ts
export { default } from '@piwitests/instrumentation'
```

That's all. Nitro auto-loads all files in `server/plugins/` on startup.

## What gets captured

| Source                               | What is captured                               |
|--------------------------------------|------------------------------------------------|
| `consola.warn()` / `consola.error()` | Warning and Error entries logged via consola   |
| Unhandled H3/Nitro errors            | Errors thrown in route handlers and middleware |

Each captured entry contains:

| Field       | Description                               |
|-------------|-------------------------------------------|
| `timestamp` | Unix timestamp in milliseconds            |
| `level`     | `"Warning"` or `"Error"`                  |
| `category`  | Logger tag/category (e.g. `"database"`)   |
| `message`   | Log message (truncated at 500 characters) |

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

The plugin uses two mechanisms:

1. **`event.context._piwiLogs`** — a plain array attached to the H3 event, readable by both the request and `beforeResponse` hooks via the same event object (no async-context propagation needed).
2. **`AsyncLocalStorage`** — seeded in the `request` hook so that `consola` reporters can append to the per-request buffer from within synchronous route-handler code.
3. **`error` hook** — catches unhandled Nitro/H3 errors that bypass consola.

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
