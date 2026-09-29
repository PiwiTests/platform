using System;
using System.Linq;
using System.Threading.Tasks;
using PiwiTests.Instrumentation.AspNetCore;
using Serilog;
using Serilog.Events;
using Xunit;

namespace PiwiTests.Instrumentation.Tests;

public class SerilogSinkTests
{
    [Fact]
    public void Captures_warning_error_and_fatal_as_their_log_levels()
    {
        using var logger = new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.PiwiTestLogs().CreateLogger();

        PiwiTestLogCapture.Begin();
        foreach (var level in Enum.GetValues<LogEventLevel>())
            logger.Write(level, "{Level} event", level);
        var logs = PiwiTestLogCapture.Stop()!;

        Assert.Equal(["Warning", "Error", "Critical"], logs.Select(e => e.Level));
        Assert.Equal(["Warning event", "Error event", "Fatal event"], logs.Select(e => e.Message));
    }

    [Fact]
    public void Takes_the_category_from_the_source_context_and_keeps_the_exception()
    {
        using var logger = new LoggerConfiguration().WriteTo.PiwiTestLogs().CreateLogger();

        PiwiTestLogCapture.Begin();
        logger.ForContext<SerilogSinkTests>().Error(new InvalidOperationException("boom"), "Order {OrderId} failed", 7);
        logger.Warning("No context");
        var logs = PiwiTestLogCapture.Stop()!;

        Assert.Equal(typeof(SerilogSinkTests).FullName, logs[0].Category);
        Assert.Equal("Order 7 failed", logs[0].Message);
        Assert.Equal("boom", logs[0].ExceptionMessage);
        Assert.Equal("", logs[1].Category);
    }

    [Fact]
    public void Does_nothing_outside_a_capture()
    {
        using var logger = new LoggerConfiguration().WriteTo.PiwiTestLogs().CreateLogger();

        logger.Error("dropped");

        Assert.Null(PiwiTestLogCapture.Stop());
    }

    [Fact]
    public void Honors_a_raised_minimum_level()
    {
        using var logger = new LoggerConfiguration().WriteTo.PiwiTestLogs(LogEventLevel.Error).CreateLogger();

        PiwiTestLogCapture.Begin();
        logger.Warning("dropped");
        logger.Error("kept");
        var logs = PiwiTestLogCapture.Stop()!;

        Assert.Equal(["kept"], logs.Select(e => e.Message));
    }

    [Fact]
    public async Task Rides_on_the_response_header_when_Serilog_replaces_the_logger_factory()
    {
        using var logger = new LoggerConfiguration().WriteTo.PiwiTestLogs().CreateLogger();
        await using var app = await TestApp.StartAsync("Integration",
            (a, env) => a.UsePiwiTestLogs(env, "Development", "Integration"),
            hostBuilder: h => h.UseSerilog(logger));

        var entry = Assert.Single((await app.GetLogsAsync("/json"))!);

        Assert.Equal("Warning", entry.Level);
        Assert.Equal("Orders", entry.Category);
        Assert.Equal("Stock low for 42", entry.Message);
    }
}
