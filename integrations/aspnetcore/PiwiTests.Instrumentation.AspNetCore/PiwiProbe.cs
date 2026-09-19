using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PiwiTests.Instrumentation.AspNetCore;

/// <summary>
/// A fault a probe run asks the server to apply to one request (Piwi Test Map,
/// level two). In this release the header is only parsed and verified — nothing
/// is applied unless a project turns server probes on, which stays off by
/// default. See the README for the header format and guards.
/// </summary>
public sealed class PiwiProbeSpec
{
    /// <summary>Route the fault targets, e.g. <c>POST /api/orders</c>.</summary>
    [JsonPropertyName("route")]
    public string? Route { get; set; }

    /// <summary>The fault to apply. The client-safe subset is applied first.</summary>
    [JsonPropertyName("fault")]
    public string Fault { get; set; } = "";

    /// <summary>Apply only to the Nth matching request (1-based); default the first.</summary>
    [JsonPropertyName("nth")]
    public int? Nth { get; set; }
}

internal sealed class SignedProbe
{
    [JsonPropertyName("nonce")] public string Nonce { get; set; } = "";
    [JsonPropertyName("ts")] public long Ts { get; set; }
    [JsonPropertyName("specJson")] public string SpecJson { get; set; } = "";
    [JsonPropertyName("sig")] public string Sig { get; set; } = "";
}

/// <summary>
/// Verifies the signed <c>X-Piwi-Probe</c> request header. The scheme mirrors the
/// Nitro package: a base64 JSON envelope <c>{ nonce, ts, specJson, sig }</c> whose
/// <c>sig</c> is a hex HMAC-SHA256 over <c>{nonce}.{ts}.{specJson}</c> with a
/// secret shared between the reporter and the instrumentation.
/// </summary>
public static class PiwiProbe
{
    /// <summary>Default probe header lifetime in milliseconds.</summary>
    public const long TtlMs = 60_000;

    private static readonly JsonSerializerOptions SpecOptions = new() { PropertyNameCaseInsensitive = true };

    /// <summary>The message signed and verified for a probe.</summary>
    public static string SigningMessage(string nonce, long ts, string specJson) => $"{nonce}.{ts}.{specJson}";

    /// <summary>Compute the hex HMAC-SHA256 signature for a probe envelope.</summary>
    public static string Sign(string secret, string nonce, long ts, string specJson)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var mac = hmac.ComputeHash(Encoding.UTF8.GetBytes(SigningMessage(nonce, ts, specJson)));
        return Convert.ToHexString(mac).ToLowerInvariant();
    }

    /// <summary>
    /// Verify a signed probe header and return its fault spec, or null when the
    /// header is absent, malformed, past its TTL, or fails the signature check.
    /// </summary>
    public static PiwiProbeSpec? Verify(string? headerValue, string? secret, long nowMs, long ttlMs = TtlMs)
    {
        if (string.IsNullOrEmpty(secret) || string.IsNullOrEmpty(headerValue)) return null;

        SignedProbe? envelope;
        try
        {
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(headerValue));
            envelope = JsonSerializer.Deserialize<SignedProbe>(json);
        }
        catch
        {
            return null;
        }
        if (envelope is null || string.IsNullOrEmpty(envelope.Nonce) || string.IsNullOrEmpty(envelope.SpecJson)
            || string.IsNullOrEmpty(envelope.Sig))
        {
            return null;
        }

        // TTL: reject an expired or clock-skewed future probe.
        if (nowMs - envelope.Ts > ttlMs || envelope.Ts - nowMs > ttlMs) return null;

        var expected = Sign(secret, envelope.Nonce, envelope.Ts, envelope.SpecJson);
        if (!FixedTimeHexEquals(envelope.Sig, expected)) return null;

        try
        {
            var spec = JsonSerializer.Deserialize<PiwiProbeSpec>(envelope.SpecJson, SpecOptions);
            return spec is null || string.IsNullOrEmpty(spec.Fault) ? null : spec;
        }
        catch
        {
            return null;
        }
    }

    private static bool FixedTimeHexEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        try
        {
            return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(a), Convert.FromHexString(b));
        }
        catch
        {
            return false;
        }
    }
}
