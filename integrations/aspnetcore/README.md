# PiwiTests.Instrumentation.AspNetCore

ASP.NET Core integration for [Piwi Dashboard](https://piwitests.dev) — captures Warning and Error log entries per HTTP request and delivers them to the Piwi Dashboard reporter via the `X-Piwi-Logs` response header.

During a Playwright test run, the reporter reads this header from every response and stores the entries alongside the network request. The entries are then available in the Piwi Dashboard test-case view and are included in the AI diagnosis context.

**Active only in Development and Test environments.** No header is emitted in Production.

## Installation

```bash
dotnet add package PiwiTests.Instrumentation.AspNetCore
```

## Usage

```csharp
var builder = WebApplication.CreateBuilder(args);

// 1. Register the log capture provider (before Build())
builder.AddPiwiTestLogs();

var app = builder.Build();

// 2. Add the response header middleware (early in the pipeline)
app.UsePiwiTestLogs();

app.Run();
```

`AddPiwiTestLogs()` registers an `ILoggerProvider` that intercepts Warning and Error entries and stores them in an `AsyncLocal` buffer scoped to the current HTTP request.

`UsePiwiTestLogs()` adds middleware that serializes the buffer to JSON, gzip-compresses it, and writes the result (Base64-encoded) to the `X-Piwi-Logs` response header before the response is sent — but only when the environment is Development or Test.

## What gets captured

| Level       | Included |
|-------------|----------|
| Trace       | No       |
| Debug       | No       |
| Information | No       |
| Warning     | Yes      |
| Error       | Yes      |
| Critical    | Yes      |

Each captured entry contains:

| Field              | Description                                                                                          |
|--------------------|------------------------------------------------------------------------------------------------------|
| `timestamp`        | Unix timestamp in milliseconds                                                                       |
| `level`            | `"Warning"`, `"Error"`, or `"Critical"`                                                              |
| `category`         | Logger category name (e.g. `MyApp.Services.OrderService`)                                            |
| `message`          | Formatted log message                                                                                |
| `exceptionMessage` | Exception message, if one was logged                                                                 |
| `StackTrace`       | Shrunk stack trace (5 frames max, framework frames removed, namespace parts shortened to first letter)|

## Requirements

- .NET 8, 9, or 10
- `Microsoft.AspNetCore.App` framework reference (included automatically in ASP.NET Core projects)

## How it works with Piwi Dashboard

```
Playwright test
  └─ page.goto('/api/orders')
       └─ ASP.NET Core handler runs
            ├─ logger.LogWarning("Stock low for {ProductId}", id)   ← captured
            └─ HTTP response
                 └─ X-Piwi-Logs: <gzip+base64 JSON>
                      └─ Piwi reporter reads header
                           └─ stored as serverLogs on the network request
                                └─ visible in test-case detail + AI diagnosis
```

## Server probes — the `X-Piwi-Probe` header

The middleware can accept a signed fault instruction from a Piwi probe run (Test
Map, level two). **In this release the header is only verified and recorded — no
fault is applied**, and the middleware runs only in Development and Test
environments (the same guard as log capture). A fault is applied only once a
project turns server probes on (`PIWI_SERVER_PROBES=true`), which stays off by
default, and even then only the client-safe subset.

| Variable             | Effect                                                             |
|----------------------|-------------------------------------------------------------------|
| `PIWI_PROBE_SECRET`  | Shared HMAC secret. When unset, the probe header is ignored.      |
| `PIWI_SERVER_PROBES` | `true` to apply verified faults. Off (unset) in this milestone.   |

**Header format.** `X-Piwi-Probe` carries a base64-encoded JSON envelope, the
same scheme as the Nitro package:

```jsonc
{
  "nonce": "<hex, single use>",
  "ts": 1700000000000,            // issued-at, Unix ms; honored within 60s
  "specJson": "{\"route\":\"POST /api/orders\",\"fault\":\"status-500\",\"nth\":1}",
  "sig": "<hex HMAC-SHA256>"      // over `${nonce}.${ts}.${specJson}` with PIWI_PROBE_SECRET
}
```

A verified spec is stored in `HttpContext.Items["PiwiProbe"]`. Verification lives
in `PiwiProbe.Verify`; `PiwiProbe.Sign` produces a matching signature.

> **Scope note.** This package emits only the `X-Piwi-Logs` header today; it does
> not yet emit server spans (`X-Piwi-Trace`), so the root-span handler-source
> field the Nitro package adds does not apply here. The `X-Piwi-Probe` support
> above is the minimal, forward-compatible piece of the M2 instrumentation
> release for ASP.NET Core. It was authored but **not compiled in this
> environment** (no .NET SDK available); build it with `dotnet build` before
> release.

## License

MIT
