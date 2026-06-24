namespace PiwiTests.Instrumentation.AspNetCore;

public sealed record PiwiTestLogEntry(
    long Timestamp,
    string Level,
    string Category,
    string Message,
    string? ExceptionMessage,
    string? StackTrace
);
