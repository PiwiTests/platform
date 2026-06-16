namespace PiwiDashboard.AspNetCore;

public sealed record PiwiTestLogEntry(
    long Timestamp,
    string Level,
    string Category,
    string Message,
    string? ExceptionMessage
);
