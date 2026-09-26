using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Hosting;

namespace PiwiTests.Instrumentation.AspNetCore;

/// <summary>
/// Decides, once while the pipeline is built, whether the Piwi test log middleware joins it.
/// Only the middleware needs this gate: outside a request it brackets, the capture buffer is
/// inert, so every log source can stay registered unconditionally.
/// </summary>
internal static class PiwiTestLogsGate
{
    internal const string DisabledVariable = "PIWI_TEST_LOGS_DISABLED";
    internal const string EnvironmentsVariable = "PIWI_TEST_LOGS_ENVIRONMENTS";

    private static readonly string[] DefaultEnvironments = ["Development", "Test"];

    /// <summary>
    /// <c>PIWI_TEST_LOGS_DISABLED</c> overrides everything: <c>true</c> turns the middleware off,
    /// <c>false</c> turns it on in any environment. Otherwise the first setting present wins: the
    /// <paramref name="isActive"/> argument, the <paramref name="environments"/> argument, the
    /// options' <see cref="PiwiTestLogsOptions.IsActive"/>, the options'
    /// <see cref="PiwiTestLogsOptions.Environments"/>, <c>PIWI_TEST_LOGS_ENVIRONMENTS</c>, and
    /// finally Development and Test.
    /// </summary>
    internal static bool IsActive(
        IHostEnvironment environment,
        Func<IHostEnvironment, bool>? isActive,
        IEnumerable<string>? environments,
        PiwiTestLogsOptions? options,
        Func<string, string?> readVariable)
    {
        if (bool.TryParse(readVariable(DisabledVariable), out var disabled))
            return !disabled;

        var predicate = isActive
            ?? Named(environments)
            ?? options?.IsActive
            ?? Named(options?.Environments)
            ?? Named(readVariable(EnvironmentsVariable)?.Split(','))
            ?? Named(DefaultEnvironments)!;
        return predicate(environment);
    }

    /// <summary>A predicate matching any of <paramref name="names"/>, or null when none is given.</summary>
    private static Func<IHostEnvironment, bool>? Named(IEnumerable<string?>? names)
    {
        var list = names?.Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n!.Trim()).ToArray();
        return list is { Length: > 0 } ? env => list.Any(env.IsEnvironment) : null;
    }
}
