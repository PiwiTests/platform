import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Server-probe support (Piwi Test Map, level two). A probe run signs a fault
 * spec into the `X-Piwi-Probe` request header; the instrumentation verifies the
 * signature here and, when server probes are enabled, applies the fault inside
 * the request scope. In this release the header is only parsed and verified —
 * nothing is applied unless a project turns server probes on, which stays off by
 * default (see the README).
 */

/** A fault the probe run asks the server to apply to one request. */
export interface PiwiProbeSpec {
  /** Route pattern the fault targets, e.g. `POST /api/orders`. */
  route?: string;
  /** The fault to apply. The client-safe subset is applied first (see README). */
  fault: string;
  /** Apply only to the Nth matching request (1-based); default the first. */
  nth?: number;
  /** Dependency name a dependency fault targets, when scoped to one. */
  dependency?: string;
}

/** The signed envelope carried in the `X-Piwi-Probe` header (base64 JSON). */
export interface SignedProbe {
  /** Single-use nonce, hex. */
  nonce: string;
  /** Issued-at, Unix epoch milliseconds — the TTL is measured from here. */
  ts: number;
  /** The exact JSON string of the {@link PiwiProbeSpec} that was signed. */
  specJson: string;
  /** Hex HMAC-SHA256 over `${nonce}.${ts}.${specJson}` with the shared secret. */
  sig: string;
}

/** Default probe header lifetime — a probe is honored within a minute of issue. */
export const PROBE_TTL_MS = 60_000;

/** The message signed and verified for a probe: nonce, timestamp and spec JSON. */
export function probeSigningMessage(nonce: string, ts: number, specJson: string): string {
  return `${nonce}.${ts}.${specJson}`;
}

/** Compute the hex HMAC-SHA256 signature for a probe envelope. */
export function signProbeMessage(secret: string, nonce: string, ts: number, specJson: string): string {
  return createHmac('sha256', secret).update(probeSigningMessage(nonce, ts, specJson)).digest('hex');
}

/**
 * A TTL-bounded set of probe nonces already honored, so a signed header is
 * single-use: a replay within the TTL is rejected. Entries prune lazily on each
 * use, bounding memory to the probes seen within one TTL window.
 */
export class ProbeNonceCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs: number = PROBE_TTL_MS) {}

  /** Record a nonce as used; returns false when it was already used within the TTL. */
  use(nonce: string, nowMs: number): boolean {
    for (const [n, expiry] of this.seen) if (expiry <= nowMs) this.seen.delete(n);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, nowMs + this.ttlMs);
    return true;
  }
}

/** Constant-time hex-signature comparison; false on any length or format mismatch. */
function signaturesEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify a signed probe header and return its fault spec, or null when the
 * header is absent, malformed, past its TTL, or fails the signature check. Pure
 * over its inputs (no environment reads) so it can be unit-tested directly.
 */
export function verifyProbeHeader(
  headerValue: string | string[] | undefined,
  secret: string | undefined,
  nowMs: number,
  ttlMs: number = PROBE_TTL_MS,
  seen?: ProbeNonceCache,
): PiwiProbeSpec | null {
  if (!secret) return null;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return null;

  let envelope: SignedProbe;
  try {
    envelope = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as SignedProbe;
  } catch {
    return null;
  }
  if (!envelope || typeof envelope !== 'object') return null;
  const { nonce, ts, specJson, sig } = envelope;
  if (typeof nonce !== 'string' || typeof ts !== 'number' || typeof specJson !== 'string' || typeof sig !== 'string') {
    return null;
  }
  // TTL: reject an expired or not-yet-valid (clock-skewed future) probe.
  if (!Number.isFinite(ts) || nowMs - ts > ttlMs || ts - nowMs > ttlMs) return null;

  const expected = signProbeMessage(secret, nonce, ts, specJson);
  if (!signaturesEqual(sig, expected)) return null;

  let spec: PiwiProbeSpec;
  try {
    spec = JSON.parse(specJson) as PiwiProbeSpec;
  } catch {
    return null;
  }
  if (!spec || typeof spec !== 'object' || typeof spec.fault !== 'string') return null;

  // Single-use: reject a replay of a nonce already honored within the TTL.
  if (seen && !seen.use(nonce, nowMs)) return null;
  return spec;
}
