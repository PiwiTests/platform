using System;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace PiwiDashboard.AspNetCore;

public sealed class PiwiTestLogHeaderMiddleware(RequestDelegate next)
{
    private const int MaxEntries = 50;
    private const string HeaderName = "X-Piwi-Logs";

    public async Task InvokeAsync(HttpContext context)
    {
        PiwiTestLoggerProvider.BeginCapture();
        try
        {
            await next(context);
        }
        finally
        {
            var logs = PiwiTestLoggerProvider.StopCapture();
            if (logs is { Count: > 0 } && !context.Response.HasStarted)
            {
                var payload = logs.Count > MaxEntries ? logs[..MaxEntries] : logs;
                var json = JsonSerializer.SerializeToUtf8Bytes(payload);

                using var ms = new MemoryStream();
                await using (var gz = new GZipStream(ms, CompressionLevel.Fastest, leaveOpen: true))
                    gz.Write(json);

                context.Response.Headers[HeaderName] = Convert.ToBase64String(ms.ToArray());
            }
        }
    }
}
