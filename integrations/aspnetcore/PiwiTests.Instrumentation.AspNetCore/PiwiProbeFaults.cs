using System;
using System.Collections.Concurrent;
using System.Linq;

namespace PiwiTests.Instrumentation.AspNetCore;

/// <summary>
/// Server-probe fault classes (Test Map, level two) — the pure decisions the
/// middleware applies to one signed request. Mirrors the Nitro package's
/// <c>faults.ts</c>. Handler-level faults (status, auth, throw, delay, extreme)
/// are applied here; data mutation before serialization and dependency faults on
/// outbound calls are the Nitro-only subset until this package emits spans.
/// </summary>
public static class PiwiProbeFaults
{
    private const int DelayMs = 5000;

    // Per-spec count of matching requests this process, honoring the nth selector.
    private static readonly ConcurrentDictionary<string, int> MatchCounts = new();

    /// <summary>The HTTP status a fault forces, or null when it forces none.</summary>
    public static int? FaultStatus(string fault) => fault switch
    {
        "status" or "status-500" => 500,
        "auth" => 401,
        _ => null,
    };

    /// <summary>The delay (ms) a timing fault adds, or 0 for none.</summary>
    public static int FaultDelayMs(string fault) =>
        fault is "delay" or "slow" or "slow-first" ? DelayMs : 0;

    public static bool IsThrowFault(string fault) => fault == "throw";

    public static bool IsExtremeFault(string fault) => fault == "extreme";

    /// <summary>True when a concrete request matches a route pattern with <c>:param</c> segments.</summary>
    public static bool RouteMatches(string? route, string method, string path)
    {
        if (string.IsNullOrEmpty(route)) return true;
        var space = route!.IndexOf(' ');
        var routeMethod = space < 0 ? "" : route[..space].ToUpperInvariant();
        var pattern = space < 0 ? route : route[(space + 1)..];
        if (routeMethod.Length > 0 && routeMethod != method.ToUpperInvariant()) return false;

        var p = pattern.Split('?')[0].Split('/', StringSplitOptions.RemoveEmptyEntries);
        var a = path.Split('?')[0].Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (p.Length != a.Length) return false;
        for (var i = 0; i < p.Length; i++)
        {
            var seg = p[i];
            var dynamic = seg.StartsWith(':') ||
                          (seg.StartsWith('[') && seg.EndsWith(']')) ||
                          (seg.StartsWith('{') && seg.EndsWith('}'));
            if (dynamic) continue;
            if (seg != a[i]) return false;
        }
        return true;
    }

    /// <summary>
    /// True when this request is the spec's nth match. Advances the per-spec
    /// counter, so it returns true exactly once per (route, fault, nth).
    /// </summary>
    public static bool ShouldApply(string? route, string fault, int nth, string method, string path)
    {
        if (!RouteMatches(route, method, path)) return false;
        var key = $"{route}\u0000{fault}";
        var count = MatchCounts.AddOrUpdate(key, 1, (_, v) => v + 1);
        return count == Math.Max(1, nth);
    }

    /// <summary>The label reported for the fault the server actually applied.</summary>
    public static string AppliedLabel(PiwiProbeSpec spec) =>
        string.IsNullOrEmpty(spec.Dependency) ? spec.Fault : $"{spec.Fault}:{spec.Dependency}";
}
