using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace PiwiDashboard.AspNetCore;

public static class PiwiDashboardExtensions
{
    /// <summary>
    /// Registers the Piwi test log capture provider. Call on the builder before <c>Build()</c>.
    /// </summary>
    public static WebApplicationBuilder AddPiwiTestLogs(this WebApplicationBuilder builder)
    {
        builder.Logging.AddProvider(new PiwiTestLoggerProvider());
        return builder;
    }

    /// <summary>
    /// Adds the Piwi test log header middleware. Active only in Development and Test environments.
    /// Register early in the pipeline so it wraps all subsequent middleware.
    /// </summary>
    public static WebApplication UsePiwiTestLogs(this WebApplication app)
    {
        if (app.Environment.IsDevelopment() || app.Environment.IsEnvironment("Test"))
            app.UseMiddleware<PiwiTestLogHeaderMiddleware>();

        return app;
    }
}
