using System;
using Microsoft.Extensions.Logging;

namespace PiwiTests.Instrumentation.AspNetCore;

/// <summary>
/// A thin <see cref="ILoggerProvider"/> adapter that feeds Microsoft.Extensions.Logging entries
/// into the shared <see cref="PiwiTestLogCapture"/> buffer. This is the default capture source;
/// other front-ends (e.g. a Serilog sink) can feed the same buffer via
/// <see cref="PiwiTestLogCapture.TryAdd"/> without going through this provider.
/// </summary>
public sealed class PiwiTestLoggerProvider : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new PiwiTestLogger(categoryName);

    public void Dispose() { }

    private sealed class PiwiTestLogger(string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        // IsEnabled is the hot path — only capture when a buffer is active and the level qualifies.
        public bool IsEnabled(LogLevel logLevel) =>
            PiwiTestLogCapture.IsCapturing && logLevel >= PiwiTestLogCapture.MinimumLevel;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            // Skip formatting when we would not capture; TryAdd re-checks the level as a self-guard.
            if (!IsEnabled(logLevel)) return;

            PiwiTestLogCapture.TryAdd(logLevel, category, formatter(state, exception), exception);
        }
    }
}
