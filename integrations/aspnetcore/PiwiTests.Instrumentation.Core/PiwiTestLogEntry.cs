namespace PiwiTests.Instrumentation;

/// <summary>One captured log entry. <see cref="PiwiTestLogJson"/> writes it into the <c>X-Piwi-Logs</c> response header.</summary>
public sealed record PiwiTestLogEntry(
    long Timestamp,
    string Level,
    string Category,
    string Message,
    string? ExceptionMessage,
    string? StackTrace
);
