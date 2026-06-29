---
title: Backend logs
lang: en-US
---

# Backend logs

Piwi Dashboard can capture server-side Warning and Error log entries during a Playwright test run and surface them in the test-case detail view and the AI diagnosis context.

The mechanism is straightforward: the backend integration adds a `X-Piwi-Logs` response header (gzip-compressed, Base64-encoded JSON) to every HTTP response. The Piwi Dashboard reporter reads this header from each captured network request and stores the entries as `serverLogs` on that request.

**Active only in non-production environments.** The header is never emitted in production builds.

## How it looks in the dashboard

When backend logs are captured, they appear in:

- **Test case detail → Traces & Console tab** — the "Network & backend logs" panel lists each captured request (method, status, response time, content type, and timestamp). Requests that returned server-side logs show an inline warning/error count and expand to reveal **every log entry attached to that exact request** — level, category, message, timestamp, and a collapsible stack trace. Requests are sorted so failures and those carrying error logs surface first, and a filter lets you narrow to "Failed" or "With logs".
- **AI diagnosis context** — warnings and errors are included automatically when diagnosing a failure cluster, giving the AI visibility into what went wrong on the server side

Because the logs are stored per request (rather than as one flat list), you can immediately tell *which* HTTP call produced a given warning or error — the response and its server-side cause sit side by side.

## Available integrations

### ASP.NET Core (NuGet)

```bash
dotnet add package PiwiTests.Instrumentation.AspNetCore
```

```csharp
var builder = WebApplication.CreateBuilder(args);

// Register the log capture provider (before Build())
builder.AddPiwiTestLogs();

var app = builder.Build();

// Add the response header middleware (early in the pipeline)
app.UsePiwiTestLogs();

app.Run();
```

`AddPiwiTestLogs()` registers an `ILoggerProvider` that intercepts Warning and Error log entries and buffers them per HTTP request using `AsyncLocal<T>`.

`UsePiwiTestLogs()` adds middleware that writes the buffer to the `X-Piwi-Logs` response header before the response is sent — only when the environment is Development or Test.

**Requirements:** .NET 8, 9, or 10.

### Nitro / Nuxt (npm)

```bash
npm install @piwitests/instrumentation
```

Create a file in your project's `server/plugins/` directory:

```typescript
// server/plugins/piwi-test-logs.ts
export { default } from '@piwitests/instrumentation'
```

The plugin is auto-loaded by Nitro. It captures `consola` Warning/Error entries and unhandled H3 errors, then writes them to the `X-Piwi-Logs` header in the `beforeResponse` hook — only when `NODE_ENV !== 'production'`.

**Requirements:** Nuxt 3+ / Nitro 2+ (peer deps `nitropack ≥2`, `h3 ≥1`, `consola ≥3` — all included in any Nuxt project).

## Reporter setup

On the Playwright side, the reporter reads `X-Piwi-Logs` automatically from every captured network response. No additional configuration is needed beyond having the fixtures active.

Make sure your test files import `test` from the Piwi Dashboard fixtures (or extend with `dashboardFixtures`) so network requests are captured:

```typescript
// tests/fixtures.ts
import { test as base, expect } from '@playwright/test'
import { dashboardFixtures } from '@piwitests/reporter'

export const test = base.extend(dashboardFixtures)
export { expect }
```

See [Reporter → Performance metrics & Web Vitals](/reporter#performance-metrics-web-vitals) for details.

## Log entry format

Each entry in the `X-Piwi-Logs` array has this shape:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `number` | Unix timestamp in milliseconds |
| `level` | `string` | `"Warning"`, `"Error"`, or `"Critical"` |
| `category` | `string` | Logger category or tag (e.g. `MyApp.Services.OrderService`) |
| `message` | `string` | Log message (truncated at 500 characters) |
| `stack` | `string` | Optional. Shrunk stack trace — framework/internal frames removed, namespace parts shortened to first lowercase letter, max 5 frames |

The ASP.NET Core integration additionally captures `exceptionMessage` when an exception was logged.

## Building your own integration

Any backend can implement the `X-Piwi-Logs` protocol by:

1. Initializing a per-request log buffer when the request starts
2. Capturing Warning and Error log entries into the buffer during request processing
3. Before sending the response, serializing the buffer to a JSON array, gzip-compressing it, Base64-encoding the result, and writing it to the `X-Piwi-Logs` response header

The reporter decodes the header with:

```typescript
import { gunzipSync } from 'zlib'
const entries = JSON.parse(gunzipSync(Buffer.from(header, 'base64')).toString('utf-8'))
```

Cap entries at a reasonable limit (50 is the default in the provided integrations) and truncate long messages to avoid bloating responses.
