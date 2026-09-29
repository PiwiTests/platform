namespace PiwiTests.Instrumentation;

/// <summary>One captured log entry, as serialized into the <c>X-Piwi-Logs</c> response header.</summary>
public sealed record PiwiTestLogEntry(
    long Timestamp,
    string Level,
    string Category,
    string Message,
    string? ExceptionMessage,
    string? StackTrace
);
