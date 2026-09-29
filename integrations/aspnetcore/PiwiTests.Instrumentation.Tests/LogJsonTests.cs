using System.Linq;
using System.Text.Json;
using Xunit;

namespace PiwiTests.Instrumentation.Tests;

public class LogJsonTests
{
    [Fact]
    public void Writes_the_dashboard_keys_and_no_PascalCase_ones()
    {
        var entry = new PiwiTestLogEntry(1700000000000, "Error", "Orders", "failed", "boom", "p.Orders.Place");

        using var json = JsonDocument.Parse(PiwiTestLogJson.Serialize([entry]));

        var written = Assert.Single(json.RootElement.EnumerateArray());
        Assert.Equal(["category", "level", "message", "stack", "timestamp"], TestApp.SortedKeys(written));
        Assert.Equal(1700000000000, written.GetProperty("timestamp").GetInt64());
        Assert.Equal("Error", written.GetProperty("level").GetString());
        Assert.Equal("Orders", written.GetProperty("category").GetString());
        Assert.Equal("failed", written.GetProperty("message").GetString());
    }

    [Fact]
    public void Leaves_stack_out_when_the_entry_has_no_exception()
    {
        var entry = new PiwiTestLogEntry(1700000000000, "Warning", "Orders", "low stock", null, null);

        using var json = JsonDocument.Parse(PiwiTestLogJson.Serialize([entry]));

        var written = Assert.Single(json.RootElement.EnumerateArray());
        Assert.Equal(["category", "level", "message", "timestamp"], TestApp.SortedKeys(written));
    }

    [Theory]
    [InlineData("boom", "p.Orders.Place", "boom\np.Orders.Place")]
    [InlineData("boom", null, "boom")]
    [InlineData(null, "p.Orders.Place", "p.Orders.Place")]
    [InlineData("", "p.Orders.Place", "p.Orders.Place")]
    public void Folds_the_exception_message_into_stack(string? exceptionMessage, string? stackTrace, string expected)
    {
        var entry = new PiwiTestLogEntry(1700000000000, "Error", "Orders", "failed", exceptionMessage, stackTrace);

        using var json = JsonDocument.Parse(PiwiTestLogJson.Serialize([entry]));

        var written = json.RootElement.EnumerateArray().Single();
        Assert.Equal(expected, written.GetProperty("stack").GetString());
    }
}
