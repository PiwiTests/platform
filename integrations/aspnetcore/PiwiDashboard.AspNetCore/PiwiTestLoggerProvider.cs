using System;
using System.Collections.Generic;
using System.Threading;
using Microsoft.Extensions.Logging;

namespace PiwiDashboard.AspNetCore;

public sealed class PiwiTestLoggerProvider : ILoggerProvider
{
    private static readonly AsyncLocal<List<PiwiTestLogEntry>?> Buffer = new();

    internal static void BeginCapture() => Buffer.Value = [];

    public static List<PiwiTestLogEntry>? StopCapture()
    {
        var logs = Buffer.Value;
        Buffer.Value = null;
        return logs;
    }

    public ILogger CreateLogger(string categoryName) => new PiwiTestLogger(categoryName);

    public void Dispose() { }

    private sealed class PiwiTestLogger(string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        // IsEnabled is the hot path — only pay the lock cost when a buffer exists
        public bool IsEnabled(LogLevel logLevel) => Buffer.Value is not null && logLevel >= LogLevel.Warning;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (Buffer.Value is not { } logs) return;

            logs.Add(new PiwiTestLogEntry(
                Timestamp: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Level: logLevel.ToString(),
                Category: category,
                Message: Truncate(formatter(state, exception), 500),
                ExceptionMessage: exception?.Message
            ));
        }

        private static string Truncate(string s, int maxLength) =>
            s.Length <= maxLength ? s : string.Concat(s.AsSpan(0, maxLength), "…");
    }
}
