using Microsoft.Extensions.Logging;
using Serilog.Core;
using Serilog.Events;

namespace PiwiTests.Instrumentation.Serilog;

/// <summary>
/// A Serilog sink that feeds <see cref="PiwiTestLogCapture"/>, so events logged during a request
/// ride back on that request's <c>X-Piwi-Logs</c> header. Register it with
/// <c>WriteTo.PiwiTestLogs()</c>. It does nothing outside a request the Piwi test log middleware
/// brackets, so it can stay registered in every environment.
/// </summary>
public sealed class PiwiTestLogSink : ILogEventSink
{
    public void Emit(LogEvent logEvent)
    {
        // Hot path: nothing to do outside a captured request.
        if (!PiwiTestLogCapture.IsCapturing) return;

        // Skip rendering an event the capture would drop; TryAdd re-checks the level as a self-guard.
        var level = ToLogLevel(logEvent.Level);
        if (level < PiwiTestLogCapture.MinimumLevel) return;

        PiwiTestLogCapture.TryAdd(level, SourceContext(logEvent), logEvent.RenderMessage(), logEvent.Exception);
    }

    private static LogLevel ToLogLevel(LogEventLevel level) => level switch
    {
        LogEventLevel.Verbose => LogLevel.Trace,
        LogEventLevel.Debug => LogLevel.Debug,
        LogEventLevel.Information => LogLevel.Information,
        LogEventLevel.Warning => LogLevel.Warning,
        LogEventLevel.Error => LogLevel.Error,
        _ => LogLevel.Critical,
    };

    private static string SourceContext(LogEvent logEvent) =>
        logEvent.Properties.TryGetValue(Constants.SourceContextPropertyName, out var value)
        && value is ScalarValue { Value: string name }
            ? name
            : "";
}
