# PiwiDashboard.AspNetCore

ASP.NET Core integration for [Piwi Dashboard](https://phenx.github.io/piwi-dashboard) — captures Warning and Error log entries per HTTP request and delivers them to the Piwi Dashboard reporter via the `X-Piwi-Logs` response header.

During a Playwright test run, the reporter reads this header from every response and stores the entries alongside the network request. The entries are then available in the Piwi Dashboard test-case view and are included in the AI diagnosis context.

**Active only in Development and Test environments.** No header is emitted in Production.

## Installation

```bash
dotnet add package PiwiDashboard.AspNetCore
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

## License

MIT
