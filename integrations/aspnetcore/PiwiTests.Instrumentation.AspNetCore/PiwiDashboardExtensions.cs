using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace PiwiTests.Instrumentation.AspNetCore;

public static class PiwiDashboardExtensions
{
    /// <summary>
    /// Registers the Piwi test log capture provider on any <see cref="ILoggingBuilder"/>.
    /// This is the hosting-agnostic entry point; the other <c>AddPiwiTestLogs</c> overloads
    /// delegate to it. Works under minimal hosting and the classic Generic Host + <c>Startup</c> model.
    /// </summary>
    public static ILoggingBuilder AddPiwiTestLogs(this ILoggingBuilder logging)
    {
        logging.AddProvider(new PiwiTestLoggerProvider());
        return logging;
    }

    /// <summary>
    /// Registers the Piwi test log capture provider through an <see cref="IServiceCollection"/>,
    /// for hosts that configure logging via services (e.g. <c>Startup.ConfigureServices</c>).
    /// </summary>
    public static IServiceCollection AddPiwiTestLogs(this IServiceCollection services) =>
        services.AddLogging(logging => logging.AddPiwiTestLogs());

    /// <summary>
    /// Registers the Piwi test log capture provider. Call on the builder before <c>Build()</c>.
    /// </summary>
    public static WebApplicationBuilder AddPiwiTestLogs(this WebApplicationBuilder builder)
    {
        builder.Logging.AddPiwiTestLogs();
        return builder;
    }

    /// <summary>
    /// Adds the Piwi test log header middleware to any <see cref="IApplicationBuilder"/> (works
    /// under the classic Generic Host + <c>Startup</c> model). Active only in Development and Test
    /// environments. The environment is taken from <paramref name="environment"/> when supplied,
    /// otherwise resolved from the app's service provider. Register early in the pipeline so it
    /// wraps all subsequent middleware.
    /// </summary>
    public static IApplicationBuilder UsePiwiTestLogs(this IApplicationBuilder app, IHostEnvironment? environment = null)
    {
        environment ??= app.ApplicationServices.GetRequiredService<IHostEnvironment>();
        if (environment.IsDevelopment() || environment.IsEnvironment("Test"))
            app.UseMiddleware<PiwiTestLogHeaderMiddleware>();

        return app;
    }

    /// <summary>
    /// Adds the Piwi test log header middleware. Active only in Development and Test environments.
    /// Register early in the pipeline so it wraps all subsequent middleware.
    /// </summary>
    public static WebApplication UsePiwiTestLogs(this WebApplication app)
    {
        ((IApplicationBuilder)app).UsePiwiTestLogs(app.Environment);
        return app;
    }
}
