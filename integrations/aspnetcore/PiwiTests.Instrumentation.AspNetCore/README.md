# PiwiTests.Instrumentation.AspNetCore

ASP.NET Core integration for [Piwi Dashboard](https://piwitests.dev) — captures Warning and Error log entries per HTTP request and delivers them to the Piwi Dashboard reporter via the `X-Piwi-Logs` response header.

During a Playwright test run, the reporter reads this header from every response and stores the entries alongside the network request. The entries are then available in the Piwi Dashboard test-case view and are included in the AI diagnosis context.

**Active in Development and Test by default.** No header is emitted in Production unless you opt in — see [Choosing the environments](#choosing-the-environments) for recette tiers with their own environment names.

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

`AddPiwiTestLogs()` registers an `ILoggerProvider` that feeds Warning and Error entries into a per-request capture buffer (`PiwiTestLogCapture`, from the [`PiwiTests.Instrumentation.Core`](https://www.nuget.org/packages/PiwiTests.Instrumentation.Core) package this one depends on), scoped to the current HTTP request with `AsyncLocal`.

`UsePiwiTestLogs()` adds middleware that serializes the buffer to JSON, gzip-compresses it, and writes the result (Base64-encoded) to the `X-Piwi-Logs` response header as the response starts, but only in the active environments (Development and Test by default). Entries logged after that point (while a body is still streaming) can no longer ride on the response.

## Serilog or the classic Generic Host + `Startup` model

The capture buffer is decoupled from any single logging front-end, so the integration is not limited to minimal hosting or to the Microsoft.Extensions.Logging pipeline.

Hosting-agnostic overloads are available for `Startup`-based apps:

```csharp
public void ConfigureServices(IServiceCollection services)
{
    services.AddPiwiTestLogs();   // also available on ILoggingBuilder
}

public void Configure(IApplicationBuilder app, IHostEnvironment env)
{
    app.UsePiwiTestLogs(env);     // or pass the environments to activate, see below
}
```

When logging is routed through **Serilog** (with the default `writeToProviders: false`), other `ILoggerProvider`s are never called, so `AddPiwiTestLogs()` alone captures nothing. Feed the buffer from a small Serilog sink instead. `PiwiTestLogCapture` is public and self-guards the level, so the sink only needs to map an event and call `TryAdd`:

```csharp
using Serilog.Core;
using Serilog.Events;
using PiwiTests.Instrumentation;

sealed class PiwiTestLogSink : ILogEventSink
{
    public void Emit(LogEvent e) => PiwiTestLogCapture.TryAdd(
        level: e.Level switch
        {
            LogEventLevel.Warning => LogLevel.Warning,
            LogEventLevel.Error => LogLevel.Error,
            LogEventLevel.Fatal => LogLevel.Critical,
            _ => LogLevel.Information, // dropped by TryAdd's level self-guard
        },
        category: e.Properties.TryGetValue("SourceContext", out var c) ? c.ToString().Trim('"') : "",
        message: e.RenderMessage(),
        exception: e.Exception);
}
```

```csharp
// Serilog configuration
loggerConfiguration.WriteTo.Sink(new PiwiTestLogSink());

// Startup.Configure
app.UsePiwiTestLogs();
```

`TryAdd` centralizes the level filter (Warning and above), the 50-entry cap, and the 500-character message truncation, so no feeding path can over-capture, even one that bypasses `IsEnabled`.

## Choosing the environments

Test tiers often run under their own environment names (`Podman`, `Integration`, …). Only the middleware needs to know them: outside a request it brackets, the capture buffer is inert, so the log provider and the Serilog sink can stay registered everywhere at no cost.

Pick where the middleware is active in one of three ways:

```csharp
// 1. A predicate, for full control
app.UsePiwiTestLogs(env, e => e.IsDevelopment() || e.IsEnvironment("Podman") || e.IsEnvironment("Integration"));

// 2. Environment names (case-insensitive)
app.UsePiwiTestLogs(env, "Development", "Podman", "Integration");

// 3. Options, set once in ConfigureServices (or builder.AddPiwiTestLogs(o => ...))
services.AddPiwiTestLogs(o => o.IsActive = e => e.IsDevelopment() || e.IsEnvironment("Integration"));
services.AddPiwiTestLogs(o => o.Environments.Add("Integration"));   // replaces the Development/Test default
```

Or leave the code alone and set the variables on the backend:

| Variable                      | Effect                                                                                  |
|-------------------------------|-----------------------------------------------------------------------------------------|
| `PIWI_TEST_LOGS_ENVIRONMENTS` | Comma-separated environment names, e.g. `Development,Podman,Integration`                |
| `PIWI_TEST_LOGS_DISABLED`     | `true` turns the middleware off everywhere; `false` turns it on in any environment      |

The first setting present wins:

1. `PIWI_TEST_LOGS_DISABLED` (`true` or `false`) — overrides everything below
2. the predicate passed to `UsePiwiTestLogs`
3. the environment names passed to `UsePiwiTestLogs`
4. `PiwiTestLogsOptions.IsActive`
5. `PiwiTestLogsOptions.Environments`
6. `PIWI_TEST_LOGS_ENVIRONMENTS`
7. the default: Development and Test

The decision is made once, when the pipeline is built.

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
