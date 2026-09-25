using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PiwiTests.Instrumentation.AspNetCore;

namespace PiwiTests.Instrumentation.Tests;

/// <summary>
/// An in-memory app on the Generic Host with a classic <c>Configure(IApplicationBuilder)</c>
/// pipeline. <c>/json</c> logs a warning and writes a JSON body, <c>/empty</c> logs a warning
/// and ends with no body, and <c>/throw</c> logs a warning and throws.
/// </summary>
internal sealed class TestApp : IAsyncDisposable
{
    private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly IHost _host;

    private TestApp(IHost host)
    {
        _host = host;
        Client = host.GetTestClient();
    }

    public HttpClient Client { get; }

    public static async Task<TestApp> StartAsync(
        string environment,
        Action<IApplicationBuilder, IHostEnvironment> usePiwi,
        Action<IServiceCollection>? services = null,
        Action<IApplicationBuilder>? outer = null)
    {
        var host = await new HostBuilder()
            .ConfigureWebHost(web => web
                .UseTestServer()
                .UseEnvironment(environment)
                .ConfigureServices(s =>
                {
                    s.AddPiwiTestLogs();
                    services?.Invoke(s);
                })
                .Configure((context, app) =>
                {
                    outer?.Invoke(app);
                    usePiwi(app, context.HostingEnvironment);
                    app.Run(HandleAsync);
                }))
            .StartAsync();
        return new TestApp(host);
    }

    /// <summary>Requests <paramref name="path"/> and decodes its X-Piwi-Logs header, or null when absent.</summary>
    public async Task<List<PiwiTestLogEntry>?> GetLogsAsync(string path)
    {
        var response = await Client.GetAsync(path);
        return DecodeLogs(response);
    }

    public static List<PiwiTestLogEntry>? DecodeLogs(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("X-Piwi-Logs", out var values))
            return null;

        using var gz = new GZipStream(new MemoryStream(Convert.FromBase64String(values.Single())), CompressionMode.Decompress);
        return JsonSerializer.Deserialize<List<PiwiTestLogEntry>>(gz, ReadOptions);
    }

    private static async Task HandleAsync(HttpContext context)
    {
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Orders");
        logger.LogWarning("Stock low for {ProductId}", 42);

        switch (context.Request.Path.Value)
        {
            case "/empty":
                context.Response.StatusCode = StatusCodes.Status204NoContent;
                return;
            case "/throw":
                throw new InvalidOperationException("boom");
            default:
                await context.Response.WriteAsJsonAsync(new { ok = true });
                return;
        }
    }

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _host.StopAsync();
        _host.Dispose();
    }
}
