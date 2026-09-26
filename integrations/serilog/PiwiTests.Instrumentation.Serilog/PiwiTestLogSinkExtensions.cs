using System;
using PiwiTests.Instrumentation;
using PiwiTests.Instrumentation.Serilog;
using Serilog.Configuration;
using Serilog.Events;

namespace Serilog;

/// <summary>Registers the Piwi test log sink as <c>WriteTo.PiwiTestLogs()</c>.</summary>
public static class PiwiTestLogSinkExtensions
{
    /// <summary>
    /// Feeds Warning, Error and Fatal events into the Piwi test log capture, so they ride back on
    /// the <c>X-Piwi-Logs</c> header of the request that logged them. The middleware added by
    /// <c>UsePiwiTestLogs</c> (<c>PiwiTests.Instrumentation.AspNetCore</c>) decides which
    /// environments capture runs in; outside a request it brackets, the sink does nothing, so it
    /// can be registered unconditionally.
    /// </summary>
    /// <param name="sinkConfiguration">Logger sink configuration.</param>
    /// <param name="restrictedToMinimumLevel">
    /// The minimum level of events passed to the sink. Capture never goes below
    /// <see cref="PiwiTestLogCapture.MinimumLevel"/> (Warning), whatever this is set to.
    /// </param>
    public static LoggerConfiguration PiwiTestLogs(
        this LoggerSinkConfiguration sinkConfiguration,
        LogEventLevel restrictedToMinimumLevel = LevelAlias.Minimum)
    {
        ArgumentNullException.ThrowIfNull(sinkConfiguration);
        return sinkConfiguration.Sink(new PiwiTestLogSink(), restrictedToMinimumLevel);
    }
}
