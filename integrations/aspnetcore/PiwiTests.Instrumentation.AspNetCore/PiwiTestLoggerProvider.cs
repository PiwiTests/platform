using System;
using System.Collections.Generic;
using System.Threading;
using Microsoft.Extensions.Logging;

namespace PiwiTests.Instrumentation.AspNetCore;

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
                ExceptionMessage: exception?.Message,
                StackTrace: ShrinkStackTrace(exception)
            ));
        }

        private static string Truncate(string s, int maxLength) =>
            s.Length <= maxLength ? s : string.Concat(s.AsSpan(0, maxLength), "…");
    }

    /// <summary>
    /// Extract and shrink an exception's stack trace: filter out framework frames,
    /// shorten namespace parts to their first letter, strip parameters, keep max 5 frames.
    /// </summary>
    internal static string? ShrinkStackTrace(Exception? exception)
    {
        if (exception?.StackTrace is not { Length: > 0 } stack)
            return null;

        var lines = stack.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var frames = new List<string>();

        foreach (var line in lines)
        {
            // Skip framework / runtime frames
            if (line.Contains(" System.") ||
                line.Contains(" Microsoft.") ||
                line.Contains(" in /usr/share/dotnet/") ||
                line.Contains(" in /dotnet/shared/") ||
                line.StartsWith("---") ||
                line.StartsWith("Server stack trace") ||
                line.StartsWith("Exception rethrown"))
                continue;

            if (frames.Count >= 5) break;

            var frame = ShrinkFrame(line);
            if (frame != null)
                frames.Add(frame);
        }

        return frames.Count > 0 ? string.Join("\n", frames) : null;
    }

    internal static string? ShrinkFrame(string line)
    {
        var trimmed = line.TrimStart();
        if (trimmed.StartsWith("at ", StringComparison.Ordinal))
            trimmed = trimmed[3..];

        var inIdx = trimmed.IndexOf(" in ", StringComparison.Ordinal);
        string identifier;
        string? location;

        if (inIdx >= 0)
        {
            // Has source file location — extract method part and strip parameters
            var methodPart = trimmed[..inIdx];
            location = trimmed[inIdx..];

            var parenIdx = methodPart.LastIndexOf('(');
            if (parenIdx > 0)
                methodPart = methodPart[..parenIdx];

            identifier = methodPart;
        }
        else
        {
            identifier = trimmed;
            location = null;
        }

        var shrunk = ShrinkNamespace(identifier);
        return location != null ? $"{shrunk}{location}" : shrunk;
    }

    /// <summary>
    /// Shorten each namespace segment to its first lowercase letter.
    /// e.g. "MyApp.Services.PaymentService.ProcessPayment" → "m.s.PaymentService.ProcessPayment"
    /// </summary>
    internal static string ShrinkNamespace(string identifier)
    {
        var parts = identifier.Split('.');
        if (parts.Length <= 2) return identifier;

        // Keep the last two parts (class.method) as-is, shrink the namespace prefix
        for (var i = 0; i < parts.Length - 2; i++)
        {
            if (parts[i].Length > 0 && char.IsUpper(parts[i][0]))
                parts[i] = char.ToLowerInvariant(parts[i][0]).ToString();
        }

        return string.Join(".", parts);
    }
}
