using System;
using System.IO;
using System.IO.Compression;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace PiwiTests.Instrumentation.AspNetCore;

public sealed class PiwiTestLogHeaderMiddleware(RequestDelegate next)
{
    private const int MaxEntries = 50;
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
            context.Items["PiwiProbeApplied"] = false;
            if (ServerProbesEnabled)
            {
                var method = context.Request.Method;
                var path = context.Request.Path.Value ?? "";
                if (PiwiProbeFaults.ShouldApply(probe.Route, method, path))
                {
                    context.Items["PiwiProbeApplied"] = PiwiProbeFaults.AppliedLabel(probe);

                    var delay = PiwiProbeFaults.FaultDelayMs(probe.Fault);
                    if (delay > 0) await Task.Delay(delay);

                    if (PiwiProbeFaults.IsThrowFault(probe.Fault))
                        throw new InvalidOperationException("Piwi probe: injected error");

                    var status = PiwiProbeFaults.FaultStatus(probe.Fault);
                    if (status is not null)
                    {
                        context.Response.StatusCode = status.Value;
                        return;
                    }

                    if (PiwiProbeFaults.IsExtremeFault(probe.Fault))
                    {
                        context.Response.StatusCode = 200;
                        return;
                    }
                }
            }
        }

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
