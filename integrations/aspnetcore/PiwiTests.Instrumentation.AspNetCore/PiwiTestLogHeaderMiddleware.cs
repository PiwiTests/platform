using System;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace PiwiTests.Instrumentation.AspNetCore;

public sealed class PiwiTestLogHeaderMiddleware(RequestDelegate next)
{
    private const string HeaderName = "X-Piwi-Logs";

    public async Task InvokeAsync(HttpContext context)
    {
        PiwiTestLogCapture.Begin();
        try
        {
            await next(context);
        }
        finally
        {
            // The level filter, entry cap and message truncation are applied by PiwiTestLogCapture.TryAdd.
            var logs = PiwiTestLogCapture.Stop();
            if (logs is { Count: > 0 } && !context.Response.HasStarted)
            {
                var json = JsonSerializer.SerializeToUtf8Bytes(logs);

                using var ms = new MemoryStream();
                await using (var gz = new GZipStream(ms, CompressionLevel.Fastest, leaveOpen: true))
                    gz.Write(json);

                context.Response.Headers[HeaderName] = Convert.ToBase64String(ms.ToArray());
            }
        }
    }
}
