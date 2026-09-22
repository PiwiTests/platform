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
    private const string ProbeHeaderName = "X-Piwi-Probe";

    // The shared secret a probe run signs the X-Piwi-Probe header with. Server
    // probes stay off unless a project opts in (PIWI_SERVER_PROBES=true); off is
    // the default in this milestone, so a verified probe is recorded but no fault
    // is applied — only the client-safe subset would ever be, and only once on.
    private static readonly string? ProbeSecret = Environment.GetEnvironmentVariable("PIWI_PROBE_SECRET");
    private static readonly bool ServerProbesEnabled =
        string.Equals(Environment.GetEnvironmentVariable("PIWI_SERVER_PROBES"), "true", StringComparison.Ordinal);

    public async Task InvokeAsync(HttpContext context)
    {
        // Verify a signed probe header (this middleware runs only in Development
        // and Test environments — the same guard as log capture). The verified
        // spec is recorded on the request for handlers to read; nothing is
        // applied while server probes are off.
        var probe = PiwiProbe.Verify(
            context.Request.Headers[ProbeHeaderName],
            ProbeSecret,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        if (probe is not null)
        {
            context.Items["PiwiProbe"] = probe;
            // Server probes are off in this milestone, so nothing is applied.
            context.Items["PiwiProbeApplied"] = false;
            _ = ServerProbesEnabled;
        }

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
