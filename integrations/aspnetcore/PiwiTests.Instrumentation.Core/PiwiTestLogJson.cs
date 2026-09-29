using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace PiwiTests.Instrumentation;

/// <summary>
/// Serializes captured entries into the JSON array the <c>X-Piwi-Logs</c> header carries, one
/// <c>{ "timestamp", "level", "category", "message", "stack" }</c> object per entry with camelCase
/// keys. <c>stack</c> is the exception message followed by the shrunk stack trace, and is left out
/// when the entry has neither.
/// </summary>
public static class PiwiTestLogJson
{
    /// <summary>Serializes <paramref name="entries"/> to UTF-8 JSON in the shape the dashboard reads.</summary>
    public static byte[] Serialize(IEnumerable<PiwiTestLogEntry> entries)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartArray();
            foreach (var entry in entries)
            {
                writer.WriteStartObject();
                writer.WriteNumber("timestamp", entry.Timestamp);
                writer.WriteString("level", entry.Level);
                writer.WriteString("category", entry.Category);
                writer.WriteString("message", entry.Message);
                if (Stack(entry) is { } stack)
                    writer.WriteString("stack", stack);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
        }

        return stream.ToArray();
    }

    private static string? Stack(PiwiTestLogEntry entry)
    {
        var stack = string.Join(
            "\n",
            new[] { entry.ExceptionMessage, entry.StackTrace }.Where(part => !string.IsNullOrEmpty(part)));
        return stack.Length > 0 ? stack : null;
    }
}
